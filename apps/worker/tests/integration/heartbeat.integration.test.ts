/**
 * HeartbeatService tests - REAL REDIS (NO MOCKS)
 *
 * Tests the heartbeat service against actual Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
import { HeartbeatService } from "../../src/services/heartbeat";
import type { WorkerConfig } from "../../src/config";

// Real Redis configuration from environment
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts
};

function createTestConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    id: "test-worker-1",
    name: "Test Worker 1",
    groups: ["default", "test-group"],
    hostname: "localhost",
    healthPort: 3002,
    heartbeatInterval: 100, // Fast interval for testing
    heartbeatTimeout: 30000,
    concurrency: 2,
    ...overrides,
  };
}

describe("HeartbeatService (Real Redis)", () => {
  let redis: Redis;
  let stateManager: StateManager;
  let heartbeatService: HeartbeatService;
  let config: WorkerConfig;

  beforeEach(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    stateManager = new StateManager(redis);
    await redis.flushdb();

    config = createTestConfig();
    heartbeatService = new HeartbeatService(config, stateManager);
  });

  afterEach(async () => {
    if (heartbeatService.isRunning()) {
      await heartbeatService.stop();
    }
    await redis.flushdb();
    await redis.quit();
  });

  describe("start()", () => {
    it("should set running to true and send initial heartbeat", async () => {
      expect(heartbeatService.isRunning()).toBe(false);

      await heartbeatService.start();

      expect(heartbeatService.isRunning()).toBe(true);

      // Verify heartbeat was sent to real Redis
      const workerState = await stateManager.getWorkerState(config.id);
      expect(workerState).not.toBeNull();
      expect(workerState!.id).toBe(config.id);
      expect(workerState!.status).toBe("starting");
    });

    it("should not restart if already running", async () => {
      await heartbeatService.start();
      expect(heartbeatService.isRunning()).toBe(true);

      // Wait for initial heartbeat to be written to Redis
      await new Promise((r) => setTimeout(r, 50));

      // Second start call should be ignored (no-op)
      await heartbeatService.start();

      // Still running (didn't restart or error)
      expect(heartbeatService.isRunning()).toBe(true);

      // Verify we still have valid worker state in Redis
      const workerState = await stateManager.getWorkerState(config.id);
      expect(workerState).not.toBeNull();
      expect(workerState!.id).toBe(config.id);
    });

    it("should begin periodic heartbeats at configured interval", async () => {
      await heartbeatService.start();

      const initialHeartbeat = (await stateManager.getWorkerState(config.id))!
        .lastHeartbeat;

      // Wait for a few heartbeat intervals
      await new Promise((r) => setTimeout(r, config.heartbeatInterval * 3));

      const laterHeartbeat = (await stateManager.getWorkerState(config.id))!
        .lastHeartbeat;

      // Heartbeat should have been updated
      expect(laterHeartbeat).toBeGreaterThan(initialHeartbeat);
    });
  });

  describe("stop()", () => {
    it("should stop heartbeats and send final heartbeat", async () => {
      await heartbeatService.start();

      await heartbeatService.stop();

      expect(heartbeatService.isRunning()).toBe(false);

      // Final heartbeat should have "stopping" status
      const workerState = await stateManager.getWorkerState(config.id);
      expect(workerState!.status).toBe("stopping");
    });

    it("should be idempotent (no error if not running)", async () => {
      expect(heartbeatService.isRunning()).toBe(false);

      // Should not throw
      await expect(heartbeatService.stop()).resolves.not.toThrow();
    });

    it("should stop periodic heartbeats", async () => {
      await heartbeatService.start();

      // Wait for a heartbeat
      await new Promise((r) => setTimeout(r, config.heartbeatInterval + 50));

      await heartbeatService.stop();

      const heartbeatAfterStop = (await stateManager.getWorkerState(config.id))!
        .lastHeartbeat;

      // Wait for what would be another heartbeat
      await new Promise((r) => setTimeout(r, config.heartbeatInterval * 2));

      const laterHeartbeat = (await stateManager.getWorkerState(config.id))!
        .lastHeartbeat;

      // Heartbeat should not have been updated (or only by final stop heartbeat)
      expect(laterHeartbeat).toBe(heartbeatAfterStop);
    });
  });

  describe("jobStarted()", () => {
    it("should add job ID to currentJobs set", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-123");
      heartbeatService.jobStarted("job-456");

      const state = heartbeatService.getState();
      expect(state.currentJobs).toContain("job-123");
      expect(state.currentJobs).toContain("job-456");
      expect(state.currentJobs).toHaveLength(2);
    });

    it("should persist job info in Redis on next heartbeat", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-123");

      // Wait for heartbeat
      await new Promise((r) => setTimeout(r, config.heartbeatInterval + 50));

      const workerState = await stateManager.getWorkerState(config.id);
      expect(workerState!.currentJobs).toContain("job-123");
    });
  });

  describe("jobCompleted()", () => {
    it("should remove job ID and increment jobsProcessed on success", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-123");
      heartbeatService.jobCompleted("job-123", true);

      const state = heartbeatService.getState();
      expect(state.currentJobs).not.toContain("job-123");
      expect(state.metrics.jobsProcessed).toBe(1);
      expect(state.metrics.jobsFailed).toBe(0);
    });

    it("should increment jobsFailed on failure", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-123");
      heartbeatService.jobCompleted("job-123", false);

      const state = heartbeatService.getState();
      expect(state.currentJobs).not.toContain("job-123");
      expect(state.metrics.jobsProcessed).toBe(0);
      expect(state.metrics.jobsFailed).toBe(1);
    });

    it("should update lastJobTime", async () => {
      const beforeTime = Date.now();
      await heartbeatService.start();

      heartbeatService.jobStarted("job-123");
      heartbeatService.jobCompleted("job-123", true);

      const state = heartbeatService.getState();
      expect(state.metrics.lastJobTime).toBeGreaterThanOrEqual(beforeTime);
      expect(state.metrics.lastJobTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("getState()", () => {
    it("should return current state snapshot", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobStarted("job-2");
      heartbeatService.jobCompleted("job-1", true);

      const state = heartbeatService.getState();

      expect(state.running).toBe(true);
      expect(state.currentJobs).toEqual(["job-2"]);
      expect(state.metrics.jobsProcessed).toBe(1);
      expect(state.metrics.jobsFailed).toBe(0);
    });

    it("should return immutable copy of state", async () => {
      await heartbeatService.start();
      heartbeatService.jobStarted("job-1");

      const state1 = heartbeatService.getState();
      const state2 = heartbeatService.getState();

      expect(state1).not.toBe(state2);
      expect(state1.currentJobs).not.toBe(state2.currentJobs);
      expect(state1.metrics).not.toBe(state2.metrics);
    });
  });

  describe("isRunning()", () => {
    it("should return false before start", () => {
      expect(heartbeatService.isRunning()).toBe(false);
    });

    it("should return true after start", async () => {
      await heartbeatService.start();
      expect(heartbeatService.isRunning()).toBe(true);
    });

    it("should return false after stop", async () => {
      await heartbeatService.start();
      await heartbeatService.stop();
      expect(heartbeatService.isRunning()).toBe(false);
    });
  });

  describe("sendHeartbeat()", () => {
    it("should persist state to real Redis", async () => {
      await heartbeatService.start();

      // Verify state is in Redis
      const workerState = await stateManager.getWorkerState(config.id);

      expect(workerState).not.toBeNull();
      expect(workerState!.id).toBe(config.id);
      expect(workerState!.name).toBe(config.name);
      expect(workerState!.hostname).toBe(config.hostname);
      expect(workerState!.groups).toEqual(config.groups);
      expect(workerState!.currentJobs).toEqual([]);
      expect(workerState!.metrics).toEqual({
        jobsProcessed: 0,
        jobsFailed: 0,
        lastJobTime: 0,
      });
    });

    it("should include current jobs in heartbeat", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobStarted("job-2");

      // Wait for heartbeat
      await new Promise((r) => setTimeout(r, config.heartbeatInterval + 50));

      const workerState = await stateManager.getWorkerState(config.id);
      expect(workerState!.currentJobs).toContain("job-1");
      expect(workerState!.currentJobs).toContain("job-2");
    });

    it("should update worker in heartbeat sorted set", async () => {
      await heartbeatService.start();

      const healthyWorkers = await stateManager.getHealthyWorkers(30000);
      expect(healthyWorkers).toContain(config.id);
    });

    it("should register worker in group sets", async () => {
      await heartbeatService.start();

      // Wait for heartbeat
      await new Promise((r) => setTimeout(r, config.heartbeatInterval + 50));

      for (const groupId of config.groups) {
        const workersInGroup = await stateManager.getWorkersInGroup(groupId);
        expect(workersInGroup).toContain(config.id);
      }
    });
  });
});
