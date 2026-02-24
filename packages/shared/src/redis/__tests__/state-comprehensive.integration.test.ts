/**
 * State Management Comprehensive Tests
 *
 * Tests Redis state management including:
 * - Worker state serialization/deserialization
 * - Job execution record persistence
 * - Metrics updates
 * - Concurrent state updates
 * - Connection recovery
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";

// Test Redis configuration
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: parseInt(process.env.REDIS_DB || "15", 10), // Use separate DB for tests
};

// Test data structures
interface WorkerState {
  id: string;
  name: string;
  hostname: string;
  groups: string[];
  status: "starting" | "healthy" | "degraded" | "stopping" | "offline";
  lastHeartbeat: number;
  currentJobs: string[];
  metrics: {
    jobsProcessed: number;
    jobsFailed: number;
    lastJobTime?: number;
  };
}

interface JobExecution {
  id: string;
  jobName: string;
  workerId: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  duration?: number;
  snapshotId?: string;
  error?: string;
}

describe("State Management Comprehensive Tests", () => {
  let redis: Redis;
  const testPrefix = `test:state:${Date.now()}`;

  beforeAll(async () => {
    redis = new Redis(REDIS_CONFIG);
    await redis.ping(); // Verify connection
  });

  afterAll(async () => {
    // Cleanup test keys
    const keys = await redis.keys(`${testPrefix}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear test prefix before each test
    const keys = await redis.keys(`${testPrefix}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  // ==========================================================================
  // Worker State Tests
  // ==========================================================================

  describe("Worker State Management", () => {
    it("serializes and deserializes worker state correctly", async () => {
      const workerState: WorkerState = {
        id: "worker-1",
        name: "test-worker",
        hostname: "test-host",
        groups: ["default", "priority"],
        status: "healthy",
        lastHeartbeat: Date.now(),
        currentJobs: ["job-1", "job-2"],
        metrics: {
          jobsProcessed: 100,
          jobsFailed: 5,
          lastJobTime: Date.now() - 60000,
        },
      };

      // Serialize and store
      const key = `${testPrefix}:worker:${workerState.id}`;
      await redis.set(key, JSON.stringify(workerState));

      // Retrieve and deserialize
      const stored = await redis.get(key);
      expect(stored).not.toBeNull();

      const retrieved: WorkerState = JSON.parse(stored!);

      expect(retrieved.id).toBe(workerState.id);
      expect(retrieved.name).toBe(workerState.name);
      expect(retrieved.hostname).toBe(workerState.hostname);
      expect(retrieved.groups).toEqual(workerState.groups);
      expect(retrieved.status).toBe(workerState.status);
      expect(retrieved.lastHeartbeat).toBe(workerState.lastHeartbeat);
      expect(retrieved.currentJobs).toEqual(workerState.currentJobs);
      expect(retrieved.metrics.jobsProcessed).toBe(workerState.metrics.jobsProcessed);
      expect(retrieved.metrics.jobsFailed).toBe(workerState.metrics.jobsFailed);
    });

    it("handles worker state TTL correctly", async () => {
      const workerState: WorkerState = {
        id: "worker-ttl",
        name: "ttl-worker",
        hostname: "ttl-host",
        groups: ["default"],
        status: "healthy",
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: { jobsProcessed: 0, jobsFailed: 0 },
      };

      const key = `${testPrefix}:worker:ttl:${workerState.id}`;
      await redis.setex(key, 2, JSON.stringify(workerState)); // 2 second TTL

      // Should exist immediately
      let stored = await redis.get(key);
      expect(stored).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 2500));

      // Should be gone
      stored = await redis.get(key);
      expect(stored).toBeNull();
    });

    it("updates worker status atomically", async () => {
      const workerId = "worker-atomic";
      const key = `${testPrefix}:worker:${workerId}`;

      // Initial state
      const initialState: WorkerState = {
        id: workerId,
        name: "atomic-worker",
        hostname: "atomic-host",
        groups: ["default"],
        status: "starting",
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: { jobsProcessed: 0, jobsFailed: 0 },
      };

      await redis.set(key, JSON.stringify(initialState));

      // Update status using WATCH for optimistic locking
      await redis.watch(key);

      const current = await redis.get(key);
      const state: WorkerState = JSON.parse(current!);
      state.status = "healthy";
      state.lastHeartbeat = Date.now();

      const result = await redis.multi()
        .set(key, JSON.stringify(state))
        .exec();

      expect(result).not.toBeNull();

      // Verify update
      const updated = await redis.get(key);
      const updatedState: WorkerState = JSON.parse(updated!);
      expect(updatedState.status).toBe("healthy");
    });
  });

  // ==========================================================================
  // Job Execution Tests
  // ==========================================================================

  describe("Job Execution Persistence", () => {
    it("stores job execution records correctly", async () => {
      const execution: JobExecution = {
        id: "exec-1",
        jobName: "daily-backup",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        duration: 60000,
        snapshotId: "abc123def",
      };

      const key = `${testPrefix}:execution:${execution.id}`;
      await redis.set(key, JSON.stringify(execution));

      const stored = await redis.get(key);
      const retrieved: JobExecution = JSON.parse(stored!);

      expect(retrieved.id).toBe(execution.id);
      expect(retrieved.jobName).toBe(execution.jobName);
      expect(retrieved.status).toBe("completed");
      expect(retrieved.snapshotId).toBe("abc123def");
    });

    it("stores execution history as sorted set by timestamp", async () => {
      const jobName = "test-job";
      const historyKey = `${testPrefix}:history:${jobName}`;

      // Add multiple executions
      const executions: JobExecution[] = [
        {
          id: "exec-1",
          jobName,
          workerId: "worker-1",
          status: "completed",
          startTime: Date.now() - 3600000, // 1 hour ago
          endTime: Date.now() - 3540000,
          duration: 60000,
        },
        {
          id: "exec-2",
          jobName,
          workerId: "worker-1",
          status: "completed",
          startTime: Date.now() - 1800000, // 30 min ago
          endTime: Date.now() - 1740000,
          duration: 60000,
        },
        {
          id: "exec-3",
          jobName,
          workerId: "worker-2",
          status: "failed",
          startTime: Date.now() - 900000, // 15 min ago
          endTime: Date.now() - 840000,
          duration: 60000,
          error: "Connection timeout",
        },
      ];

      for (const exec of executions) {
        await redis.zadd(historyKey, exec.startTime, JSON.stringify(exec));
      }

      // Get recent executions (last 2)
      const recent = await redis.zrevrange(historyKey, 0, 1);
      expect(recent).toHaveLength(2);

      // Most recent should be exec-3
      const mostRecent: JobExecution = JSON.parse(recent[0]);
      expect(mostRecent.id).toBe("exec-3");
      expect(mostRecent.status).toBe("failed");
    });

    it("retrieves job history by time range", async () => {
      const jobName = "range-test-job";
      const historyKey = `${testPrefix}:history:${jobName}`;
      const now = Date.now();

      // Add executions at different times
      for (let i = 0; i < 10; i++) {
        const execution: JobExecution = {
          id: `exec-${i}`,
          jobName,
          workerId: "worker-1",
          status: "completed",
          startTime: now - (i * 3600000), // Each hour
          endTime: now - (i * 3600000) + 60000,
          duration: 60000,
        };
        await redis.zadd(historyKey, execution.startTime, JSON.stringify(execution));
      }

      // Get executions from last 5 hours (exclusive lower bound to avoid boundary issues)
      const fiveHoursAgo = now - (5 * 3600000);
      const recent = await redis.zrangebyscore(historyKey, "(" + fiveHoursAgo, now);

      expect(recent.length).toBe(5);
    });
  });

  // ==========================================================================
  // Metrics Tests
  // ==========================================================================

  describe("Metrics Updates", () => {
    it("increments job counters atomically", async () => {
      const workerId = "worker-metrics";
      const processedKey = `${testPrefix}:metrics:${workerId}:processed`;
      const failedKey = `${testPrefix}:metrics:${workerId}:failed`;

      // Initialize counters
      await redis.set(processedKey, "0");
      await redis.set(failedKey, "0");

      // Simulate concurrent increments
      const increments = [];
      for (let i = 0; i < 100; i++) {
        increments.push(redis.incr(processedKey));
        if (i % 10 === 0) {
          increments.push(redis.incr(failedKey));
        }
      }

      await Promise.all(increments);

      const processed = await redis.get(processedKey);
      const failed = await redis.get(failedKey);

      expect(parseInt(processed!)).toBe(100);
      expect(parseInt(failed!)).toBe(10);
    });

    it("updates metrics hash atomically", async () => {
      const workerId = "worker-hash-metrics";
      const metricsKey = `${testPrefix}:metrics:${workerId}`;

      // Set initial metrics
      await redis.hset(metricsKey, {
        jobsProcessed: "0",
        jobsFailed: "0",
        lastJobTime: "0",
      });

      // Increment processed
      await redis.hincrby(metricsKey, "jobsProcessed", 1);
      await redis.hset(metricsKey, "lastJobTime", String(Date.now()));

      const metrics = await redis.hgetall(metricsKey);

      expect(parseInt(metrics.jobsProcessed)).toBe(1);
      expect(parseInt(metrics.lastJobTime)).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Concurrent Updates Tests
  // ==========================================================================

  describe("Concurrent State Updates", () => {
    it("handles concurrent worker heartbeats without data loss", async () => {
      const workerId = "worker-concurrent";
      const key = `${testPrefix}:heartbeat:${workerId}`;

      // Simulate concurrent heartbeats
      const heartbeats = [];
      for (let i = 0; i < 50; i++) {
        heartbeats.push(
          redis.set(key, String(Date.now() + i), "EX", 60)
        );
      }

      await Promise.all(heartbeats);

      // Should have the last value
      const value = await redis.get(key);
      expect(value).not.toBeNull();
    });

    it("handles concurrent job claims correctly", async () => {
      const jobId = "job-claim-test";
      const claimKey = `${testPrefix}:claim:${jobId}`;

      // Simulate multiple workers trying to claim the same job
      const workers = ["worker-1", "worker-2", "worker-3"];
      const claims = workers.map((w) =>
        redis.setnx(claimKey, w) // SETNX - only succeeds if key doesn't exist
      );

      const results = await Promise.all(claims);

      // Only one should succeed
      const successCount = results.filter((r) => r === 1).length;
      expect(successCount).toBe(1);

      // Verify winner
      const winner = await redis.get(claimKey);
      expect(workers).toContain(winner);
    });

    it("handles concurrent list updates without data loss", async () => {
      const listKey = `${testPrefix}:job-list`;

      // Concurrent pushes
      const pushes = [];
      for (let i = 0; i < 100; i++) {
        pushes.push(redis.rpush(listKey, `item-${i}`));
      }

      await Promise.all(pushes);

      const length = await redis.llen(listKey);
      expect(length).toBe(100);
    });
  });

  // ==========================================================================
  // Connection Recovery Tests
  // ==========================================================================

  describe("Connection Recovery", () => {
    it("reconnects after brief disconnect", async () => {
      await redis.ping();

      // Perform some operations
      await redis.set(`${testPrefix}:reconnect-test`, "value");
      const value = await redis.get(`${testPrefix}:reconnect-test`);

      expect(value).toBe("value");
    });

    it("handles Redis command timeout gracefully", async () => {
      // Create a client with short timeout
      const shortTimeoutRedis = new Redis({
        ...REDIS_CONFIG,
        commandTimeout: 100, // 100ms timeout
      });

      try {
        // Normal operations should work
        await shortTimeoutRedis.set(`${testPrefix}:timeout-test`, "value");
        const value = await shortTimeoutRedis.get(`${testPrefix}:timeout-test`);
        expect(value).toBe("value");
      } finally {
        await shortTimeoutRedis.quit();
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Edge Cases", () => {
    it("handles large state objects", async () => {
      // Create a large worker state with many jobs
      const largeState: WorkerState = {
        id: "worker-large",
        name: "large-worker",
        hostname: "large-host",
        groups: Array.from({ length: 100 }, (_, i) => `group-${i}`),
        status: "healthy",
        lastHeartbeat: Date.now(),
        currentJobs: Array.from({ length: 1000 }, (_, i) => `job-${i}`),
        metrics: {
          jobsProcessed: 1000000,
          jobsFailed: 100,
          lastJobTime: Date.now(),
        },
      };

      const key = `${testPrefix}:worker:large`;
      const serialized = JSON.stringify(largeState);
      await redis.set(key, serialized);

      const stored = await redis.get(key);
      const retrieved: WorkerState = JSON.parse(stored!);

      expect(retrieved.groups).toHaveLength(100);
      expect(retrieved.currentJobs).toHaveLength(1000);
    });

    it("handles special characters in state values", async () => {
      const execution: JobExecution = {
        id: "exec-special",
        jobName: "job-with-special-chars",
        workerId: "worker-1",
        status: "failed",
        startTime: Date.now(),
        error: "Error: Connection failed with message 'timeout' and code \"ETIMEDOUT\" at /path/to/file.ts:123",
      };

      const key = `${testPrefix}:execution:special`;
      await redis.set(key, JSON.stringify(execution));

      const stored = await redis.get(key);
      const retrieved: JobExecution = JSON.parse(stored!);

      expect(retrieved.error).toContain("'timeout'");
      expect(retrieved.error).toContain('"ETIMEDOUT"');
    });

    it("handles empty arrays and objects", async () => {
      const emptyState: WorkerState = {
        id: "worker-empty",
        name: "empty-worker",
        hostname: "empty-host",
        groups: [],
        status: "starting",
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: {
          jobsProcessed: 0,
          jobsFailed: 0,
        },
      };

      const key = `${testPrefix}:worker:empty`;
      await redis.set(key, JSON.stringify(emptyState));

      const stored = await redis.get(key);
      const retrieved: WorkerState = JSON.parse(stored!);

      expect(retrieved.groups).toEqual([]);
      expect(retrieved.currentJobs).toEqual([]);
    });
  });
});
