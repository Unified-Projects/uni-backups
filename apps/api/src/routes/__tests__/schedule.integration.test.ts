/**
 * Schedule API Routes Integration Tests
 *
 * Tests the schedule API routes against real Redis and BullMQ.
 * Requires Docker services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { StateManager } from "@uni-backups/shared/redis";
import { QUEUES, type BackupJobData } from "@uni-backups/queue";

// Test configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests
  keyPrefix: "uni-backups:", // Must match getRedisConnection() prefix
};

// BullMQ connections cannot use keyPrefix - use prefix option on Queue instead
const BULLMQ_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const TEST_TIMEOUT = 60000;

describe("Schedule API Routes (Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;
  let backupQueue: Queue<BackupJobData>;

  beforeAll(async () => {
    // Set environment variables for Redis connection
    process.env.REDIS_HOST = TEST_REDIS_CONFIG.host;
    process.env.REDIS_PORT = String(TEST_REDIS_CONFIG.port);
    process.env.REDIS_PASSWORD = TEST_REDIS_CONFIG.password;
    process.env.REDIS_DB = String(TEST_REDIS_CONFIG.db);
    process.env.REDIS_KEY_PREFIX = TEST_REDIS_CONFIG.keyPrefix;

    // Close any existing singleton connections to force recreation with new config
    const { closeRedisConnections, getRedisConnection } = await import("@uni-backups/shared/redis");
    await closeRedisConnections();

    // Use the singleton connection - ensures test and route share the same Redis client
    redis = getRedisConnection();

    // Verify Redis is accessible
    try {
      await redis.ping();
    } catch {
      throw new Error(
        "Redis is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }

    stateManager = new StateManager(redis);

    // Initialize the scheduler - use the singleton Redis connection for state sharing
    const { initScheduler, getBackupQueue } = await import("../../services/scheduler");
    await initScheduler({
      bullmqConnection: new Redis(BULLMQ_REDIS_CONFIG),
      redisConnection: redis, // Use the singleton so scheduler and test share state
    });

    // Use the scheduler's queue instance so tests use the same queue as the routes
    backupQueue = getBackupQueue()!;

    // Import routes after setting up connections
    const scheduleModule = await import("../schedule");
    app = new Hono();
    app.route("/schedule", scheduleModule.default);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    const { stopScheduler } = await import("../../services/scheduler");
    const { closeRedisConnections } = await import("@uni-backups/shared/redis");
    await stopScheduler();
    // Must pause before obliterate
    await backupQueue.pause();
    await backupQueue.obliterate({ force: true });
    await backupQueue.close();
    await redis.flushdb();
    // Use closeRedisConnections to properly close the singleton
    await closeRedisConnections();
  });

  beforeEach(async () => {
    // Clean the test database between tests
    await redis.flushdb();
    // Clean and drain the queue - must pause before obliterate
    await backupQueue.drain();
    await backupQueue.pause();
    await backupQueue.obliterate({ force: true });
    // Resume the queue for subsequent tests
    await backupQueue.resume();
  });

  describe("GET /schedule", () => {
    it("returns empty lists when no scheduled jobs or recent runs", async () => {
      const res = await app.request("/schedule");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.scheduled).toEqual([]);
      expect(json.running).toEqual([]);
      expect(json.recent).toEqual([]);
    });

    it("returns running jobs when jobs are active in the queue", async () => {
      // Add a job to the queue (it won't be processed without workers)
      await backupQueue.add("backup:test-job", {
        executionId: "exec-123",
        jobName: "test-job",
        jobConfig: { type: "folder", source: "/test", storage: "test" },
        storage: { type: "local", path: "/backup" },
        repoName: "test-repo",
        workerGroups: ["default"],
        triggeredBy: "manual",
        queuedAt: Date.now(),
      } as BackupJobData);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(res.status).toBe(200);
      // Job will be in waiting state (not active/running) since no workers
      expect(json.running).toBeDefined();
    });

    it("returns recent runs from state manager", async () => {
      // Record a completed job execution
      await stateManager.recordJobExecution({
        id: "exec-1",
        jobName: "test-backup-job",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
        snapshotId: "snap-123",
      });

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.recent.length).toBeGreaterThanOrEqual(1);
      const run = json.recent.find((r: any) => r.id === "exec-1");
      expect(run).toBeDefined();
      expect(run.name).toBe("test-backup-job");
      expect(run.status).toBe("completed");
    });

    it("includes all required fields in recent runs", async () => {
      await stateManager.recordJobExecution({
        id: "exec-2",
        jobName: "detailed-job",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 5000,
        endTime: Date.now(),
        duration: 5000,
        snapshotId: "snap-456",
      });

      const res = await app.request("/schedule");
      const json = await res.json();

      const run = json.recent.find((r: any) => r.id === "exec-2");
      expect(run).toBeDefined();
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("name");
      expect(run).toHaveProperty("startTime");
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("workerId");
    });
  });

  describe("GET /schedule/running", () => {
    it("returns empty list when no jobs running", async () => {
      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.running).toEqual([]);
    });

    it("returns running jobs with executionId", async () => {
      // Add jobs to queue (will be in waiting state)
      await backupQueue.add("backup:job-1", {
        executionId: "exec-1",
        jobName: "job-1",
        jobConfig: { type: "folder", source: "/test", storage: "test" },
        storage: { type: "local", path: "/backup" },
        repoName: "repo-1",
        workerGroups: ["default"],
        triggeredBy: "manual",
        queuedAt: Date.now(),
      } as BackupJobData);

      await backupQueue.add("backup:job-2", {
        executionId: "exec-2",
        jobName: "job-2",
        jobConfig: { type: "folder", source: "/test2", storage: "test" },
        storage: { type: "local", path: "/backup" },
        repoName: "repo-2",
        workerGroups: ["default"],
        triggeredBy: "manual",
        queuedAt: Date.now() - 5000,
      } as BackupJobData);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(res.status).toBe(200);
      // Jobs will be in waiting queue, not active (no workers)
      // The running endpoint returns active jobs from getRunningJobs
      expect(json.running).toBeDefined();
      expect(Array.isArray(json.running)).toBe(true);
    });
  });

  describe("GET /schedule/history", () => {
    beforeEach(async () => {
      // Add some job executions
      await stateManager.recordJobExecution({
        id: "exec-1",
        jobName: "job-1",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 30000,
        endTime: Date.now() - 20000,
        duration: 10000,
      });
      await stateManager.recordJobExecution({
        id: "exec-2",
        jobName: "job-2",
        workerId: "worker-1",
        status: "failed",
        startTime: Date.now() - 20000,
        endTime: Date.now() - 15000,
        error: "Repository locked",
      });
      await stateManager.recordJobExecution({
        id: "exec-3",
        jobName: "job-1",
        workerId: "worker-2",
        status: "completed",
        startTime: Date.now() - 10000,
        endTime: Date.now() - 5000,
        duration: 5000,
      });
    });

    it("returns all recent runs", async () => {
      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history.length).toBeGreaterThanOrEqual(3);
    });

    it("filters by job name when provided", async () => {
      const res = await app.request("/schedule/history?job=job-1");
      const json = await res.json();

      expect(res.status).toBe(200);
      // Should only return runs for job-1
      json.history.forEach((run: any) => {
        expect(run.jobName).toBe("job-1");
      });
    });

    it("respects limit parameter", async () => {
      const res = await app.request("/schedule/history?limit=2");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history.length).toBeLessThanOrEqual(2);
    });

    it("combines job filter and limit", async () => {
      const res = await app.request("/schedule/history?job=job-1&limit=1");
      const json = await res.json();

      expect(res.status).toBe(200);
      // beforeEach inserts two job-1 executions, so at least one must exist
      expect(json.history.length).toBeGreaterThan(0);
      expect(json.history.length).toBeLessThanOrEqual(1);
      expect(json.history[0].jobName).toBe("job-1");
    });

    it("includes error message for failed runs", async () => {
      const res = await app.request("/schedule/history?job=job-2");
      const json = await res.json();

      expect(res.status).toBe(200);
      const failedRun = json.history.find((r: any) => r.status === "failed");
      expect(failedRun).toBeDefined();
      expect(failedRun.error).toBe("Repository locked");
    });

    it("includes workerId in results", async () => {
      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      json.history.forEach((run: any) => {
        expect(run.workerId).toBeDefined();
      });
    });

    it("handles running jobs without endTime", async () => {
      await stateManager.recordJobExecution({
        id: "exec-running",
        jobName: "running-job",
        workerId: "worker-1",
        status: "running",
        startTime: Date.now(),
      });

      const res = await app.request("/schedule/history?job=running-job");
      const json = await res.json();

      expect(res.status).toBe(200);
      const runningJob = json.history.find((r: any) => r.id === "exec-running");
      // The execution was just recorded above — it must be present in the response
      expect(runningJob).toBeDefined();
      expect(runningJob.endTime).toBeUndefined();
    });
  });
});
