/**
 * Worker-Redis Integration Tests - REAL REDIS (NO MOCKS)
 *
 * These tests verify worker interaction with actual Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager, REDIS_KEYS } from "@uni-backups/shared/redis";

// Real Redis configuration from environment
// Use DB 14 to avoid conflicts with other test files using DB 15
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 14, // Use DB 14 to avoid conflicts with queue tests using DB 15
};

describe("Worker-Redis Integration (Real Redis)", () => {
  let redis: Redis;
  let stateManager: StateManager;

  beforeEach(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    stateManager = new StateManager(redis);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  describe("Worker Registration and Heartbeat", () => {
    it("should register worker and update heartbeat", async () => {
      const workerState = {
        id: "worker-integration-1",
        name: "Integration Worker 1",
        hostname: "localhost",
        groups: ["default", "volume-workers"],
        status: "healthy" as const,
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: {
          jobsProcessed: 0,
          jobsFailed: 0,
          lastJobTime: 0,
        },
      };

      await stateManager.setWorkerState(workerState);

      // Verify worker is registered
      const retrieved = await stateManager.getWorkerState(workerState.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(workerState.id);
      expect(retrieved!.groups).toEqual(workerState.groups);

      // Verify heartbeat is in sorted set
      const heartbeats = await redis.zrange(REDIS_KEYS.WORKER_HEARTBEATS, 0, -1);
      expect(heartbeats).toContain(workerState.id);

      // Verify group memberships
      for (const group of workerState.groups) {
        const members = await redis.smembers(REDIS_KEYS.WORKERS_BY_GROUP(group));
        expect(members).toContain(workerState.id);
      }
    });

    it("should update worker state on subsequent heartbeats", async () => {
      const initialState = {
        id: "worker-update-test",
        name: "Update Test Worker",
        hostname: "localhost",
        groups: ["default"],
        status: "starting" as const,
        lastHeartbeat: Date.now() - 10000,
        currentJobs: [],
        metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
      };

      await stateManager.setWorkerState(initialState);

      // Update state
      const updatedState = {
        ...initialState,
        status: "healthy" as const,
        lastHeartbeat: Date.now(),
        currentJobs: ["job-1"],
        metrics: { jobsProcessed: 5, jobsFailed: 1, lastJobTime: Date.now() },
      };

      await stateManager.setWorkerState(updatedState);

      const retrieved = await stateManager.getWorkerState(initialState.id);
      expect(retrieved!.status).toBe("healthy");
      expect(retrieved!.currentJobs).toEqual(["job-1"]);
      expect(retrieved!.metrics.jobsProcessed).toBe(5);
    });
  });

  describe("Job Execution Recording", () => {
    it("should record and retrieve job executions", async () => {
      const execution = {
        id: "exec-integration-1",
        jobName: "test-backup",
        workerId: "worker-1",
        status: "running" as const,
        startTime: Date.now(),
      };

      await stateManager.recordJobExecution(execution);

      const retrieved = await stateManager.getJobExecution(execution.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.jobName).toBe(execution.jobName);
      expect(retrieved!.status).toBe("running");

      // Update to completed
      await stateManager.updateJobExecution(execution.id, {
        status: "completed",
        endTime: Date.now() + 5000,
        snapshotId: "snap-123",
        duration: 5000,
      });

      const updated = await stateManager.getJobExecution(execution.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.snapshotId).toBe("snap-123");
    });

    it("should maintain job history by name", async () => {
      const jobName = "daily-backup";

      // Record multiple executions
      for (let i = 0; i < 5; i++) {
        await stateManager.recordJobExecution({
          id: `exec-${i}`,
          jobName,
          workerId: "worker-1",
          status: "completed" as const,
          startTime: Date.now() - i * 1000,
        });
      }

      const history = await stateManager.getRecentJobs(jobName, 10);
      expect(history).toHaveLength(5);
      expect(history.every((j) => j.jobName === jobName)).toBe(true);
    });
  });

  describe("Worker Group State", () => {
    it("should persist worker group state", async () => {
      const groupState = {
        groupId: "volume-workers",
        workers: ["worker-1", "worker-2", "worker-3"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 2,
        fenceToken: null,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };

      await stateManager.setWorkerGroupState(groupState);

      const retrieved = await stateManager.getWorkerGroupState(groupState.groupId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.primaryWorkerId).toBe("worker-1");
      expect(retrieved!.failoverOrder).toEqual(["worker-2", "worker-3"]);
      expect(retrieved!.quorumSize).toBe(2);
    });

    it("should handle voting for failover", async () => {
      const groupId = "test-group";

      // Worker 2 votes that worker 1 is down
      const vote1 = await stateManager.castDownVote(
        groupId,
        "worker-2",
        "worker-1"
      );
      expect(vote1).toBe(1);

      // Worker 3 also votes
      const vote2 = await stateManager.castDownVote(
        groupId,
        "worker-3",
        "worker-1"
      );
      expect(vote2).toBe(2);

      // Clear votes after failover
      await stateManager.clearVotes(groupId);

      // Verify votes cleared
      const votes = await redis.hgetall(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
      expect(Object.keys(votes)).toHaveLength(0);
    });

    it("should handle failover locks", async () => {
      const groupId = "lock-test-group";

      // Worker 2 acquires lock
      const acquired = await stateManager.acquireFailoverLock(
        groupId,
        "worker-2"
      );
      expect(acquired).toBe(true);

      // Worker 3 cannot acquire while locked
      const notAcquired = await stateManager.acquireFailoverLock(
        groupId,
        "worker-3"
      );
      expect(notAcquired).toBe(false);

      // Release lock
      await stateManager.releaseFailoverLock(groupId);

      // Now worker 3 can acquire
      const nowAcquired = await stateManager.acquireFailoverLock(
        groupId,
        "worker-3"
      );
      expect(nowAcquired).toBe(true);
    });
  });

  describe("Multiple Workers Coordination", () => {
    it("should track multiple workers independently", async () => {
      const workers = [
        { id: "worker-a", groups: ["default", "group-1"] },
        { id: "worker-b", groups: ["default", "group-2"] },
        { id: "worker-c", groups: ["group-1", "group-2"] },
      ];

      // Register all workers
      for (const w of workers) {
        await stateManager.setWorkerState({
          id: w.id,
          name: w.id,
          hostname: "localhost",
          groups: w.groups,
          status: "healthy" as const,
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
        });
      }

      // Verify all workers registered
      const allWorkers = await stateManager.getAllWorkers();
      expect(allWorkers).toHaveLength(3);

      // Verify group memberships
      const defaultGroup = await stateManager.getWorkersInGroup("default");
      expect(defaultGroup.sort()).toEqual(["worker-a", "worker-b"]);

      const group1 = await stateManager.getWorkersInGroup("group-1");
      expect(group1.sort()).toEqual(["worker-a", "worker-c"]);

      const group2 = await stateManager.getWorkersInGroup("group-2");
      expect(group2.sort()).toEqual(["worker-b", "worker-c"]);
    });

    it("should correctly identify healthy workers", async () => {
      const now = Date.now();

      // Register healthy worker
      await stateManager.setWorkerState({
        id: "healthy-worker",
        name: "Healthy",
        hostname: "localhost",
        groups: ["default"],
        status: "healthy" as const,
        lastHeartbeat: now - 5000, // 5 seconds ago
        currentJobs: [],
        metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
      });

      // Register stale worker
      await stateManager.setWorkerState({
        id: "stale-worker",
        name: "Stale",
        hostname: "localhost",
        groups: ["default"],
        status: "healthy" as const,
        lastHeartbeat: now - 60000, // 60 seconds ago
        currentJobs: [],
        metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
      });

      const healthy = await stateManager.getHealthyWorkers(30000); // 30 second threshold
      expect(healthy).toContain("healthy-worker");
      expect(healthy).not.toContain("stale-worker");
    });
  });

  describe("Clean Worker Shutdown", () => {
    it("should clean up worker data on deregistration", async () => {
      const workerState = {
        id: "shutdown-worker",
        name: "Shutdown Test",
        hostname: "localhost",
        groups: ["default", "test-group"],
        status: "healthy" as const,
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: { jobsProcessed: 10, jobsFailed: 2, lastJobTime: Date.now() },
      };

      // Register worker
      await stateManager.setWorkerState(workerState);
      expect(await stateManager.getWorkerState(workerState.id)).not.toBeNull();

      // Deregister worker
      await stateManager.removeWorker(workerState.id);

      // Verify cleanup
      expect(await stateManager.getWorkerState(workerState.id)).toBeNull();

      const heartbeats = await redis.zrange(REDIS_KEYS.WORKER_HEARTBEATS, 0, -1);
      expect(heartbeats).not.toContain(workerState.id);

      for (const group of workerState.groups) {
        const members = await redis.smembers(REDIS_KEYS.WORKERS_BY_GROUP(group));
        expect(members).not.toContain(workerState.id);
      }
    });
  });
});
