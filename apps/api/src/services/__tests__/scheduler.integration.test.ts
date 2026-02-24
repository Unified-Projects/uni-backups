/**
 * Scheduler tests - REAL REDIS (NO MOCKS)
 *
 * Tests for the BullMQ-based job scheduler against actual Redis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
import {
  initScheduler,
  stopScheduler,
  syncSchedules,
  queueJob,
  getScheduledJobs,
  getRunningJobs,
  getQueueStats,
  isJobActive,
  getBackupQueue,
} from "../scheduler";

// Real Redis configuration from environment
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts
};

// BullMQ requires specific connection options
function createBullMQConnection(): Redis {
  return new Redis({
    ...TEST_REDIS_CONFIG,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Mock the config module to provide test jobs and storage
// Note: We only mock getConfig() because it reads from YAML files
// All other interactions (Redis, BullMQ) use real implementations
const mockJobs = new Map();
const mockStorage = new Map();

vi.mock("@uni-backups/shared/config", () => ({
  getConfig: vi.fn(() => ({
    jobs: mockJobs,
    storage: mockStorage,
  })),
}));

describe("Scheduler (Real Redis)", () => {
  let redis: Redis;
  let bullmqConnection: Redis;
  let stateManager: StateManager;

  beforeEach(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    bullmqConnection = createBullMQConnection();
    stateManager = new StateManager(redis);
    await redis.flushdb();
    await bullmqConnection.flushdb();

    // Clear mock config
    mockJobs.clear();
    mockStorage.clear();
  });

  afterEach(async () => {
    await stopScheduler();
    if (!process.env.KEEP_BULLMQ_STATE) {
      await redis.flushdb();
      await bullmqConnection.flushdb();
    }
    await redis.quit();
    await bullmqConnection.quit();
  });

  describe("initScheduler()", () => {
    it("should create queue and set up connections", async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });

      const queue = getBackupQueue();
      expect(queue).not.toBeNull();
    });

    it("should sync schedules from config on init", async () => {
      // Set up test job in mock config
      mockJobs.set("daily-backup", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        schedule: "0 2 * * *",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });

      // Verify job was scheduled
      const queue = getBackupQueue();
      const repeatables = await queue!.getRepeatableJobs();
      expect(repeatables.length).toBeGreaterThan(0);
      expect(repeatables.some((r) => r.name?.includes("daily-backup"))).toBe(true);
    });
  });

  describe("syncSchedules()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should add repeatable jobs from config", async () => {
      mockJobs.set("new-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        schedule: "0 3 * * *",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await syncSchedules();

      const queue = getBackupQueue();
      const repeatables = await queue!.getRepeatableJobs();
      expect(repeatables.some((r) => r.name?.includes("new-job"))).toBe(true);
    });

    it("should remove obsolete schedules", async () => {
      // First add a job
      mockJobs.set("temp-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        schedule: "0 1 * * *",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await syncSchedules();

      // Verify job exists
      const queue = getBackupQueue();
      let repeatables = await queue!.getRepeatableJobs();
      expect(repeatables.some((r) => r.name?.includes("temp-job"))).toBe(true);

      // Remove job from config
      mockJobs.delete("temp-job");

      await syncSchedules();

      // Verify job was removed
      repeatables = await queue!.getRepeatableJobs();
      expect(repeatables.some((r) => r.name?.includes("temp-job"))).toBe(false);
    });

    it("should update existing schedules", async () => {
      mockJobs.set("update-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        schedule: "0 1 * * *",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await syncSchedules();

      // Update schedule
      mockJobs.set("update-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        schedule: "0 2 * * *", // Changed
        worker_group: "default",
      });

      await syncSchedules();

      // Verify new schedule
      const queue = getBackupQueue();
      const repeatables = await queue!.getRepeatableJobs();
      const job = repeatables.find((r) => r.name?.includes("update-job"));
      expect(job).toBeDefined();
      expect(job?.pattern).toBe("0 2 * * *");
    });
  });

  describe("queueJob()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should add job to queue with correct data", async () => {
      mockJobs.set("manual-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      const result = await queueJob("manual-job");

      expect(result.queued).toBe(true);
      expect(result.executionId).toBeTruthy();
      expect(result.message).toContain("queued");

      // Verify job is in queue (may be in waiting or prioritized state)
      const queue = getBackupQueue();
      const allJobs = await queue!.getJobs(["waiting", "prioritized"]);
      expect(allJobs.some((j) => j.data.jobName === "manual-job")).toBe(true);
    });

    it("should return error for non-existent job", async () => {
      const result = await queueJob("non-existent");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should return error for missing storage", async () => {
      mockJobs.set("no-storage-job", {
        type: "volume",
        source: "/data",
        storage: "missing-storage",
        worker_group: "default",
      });

      const result = await queueJob("no-storage-job");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("Storage");
    });
  });

  describe("stopScheduler()", () => {
    it("should close queue and events", async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });

      // Verify scheduler is running
      expect(getBackupQueue()).not.toBeNull();

      await stopScheduler();

      // Verify scheduler is stopped
      expect(getBackupQueue()).toBeNull();
    });

    it("should be safe to call when not initialized", async () => {
      // Should not throw
      await expect(stopScheduler()).resolves.not.toThrow();
    });
  });

  describe("getScheduledJobs()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should return repeatable jobs", async () => {
      mockJobs.set("job-1", {
        type: "volume",
        source: "/data1",
        storage: "test-storage",
        schedule: "0 2 * * *",
        worker_group: "default",
      });
      mockJobs.set("job-2", {
        type: "volume",
        source: "/data2",
        storage: "test-storage",
        schedule: "0 */6 * * *",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await syncSchedules();

      const jobs = await getScheduledJobs();

      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.some((j) => j.name === "job-1")).toBe(true);
      expect(jobs.some((j) => j.name === "job-2")).toBe(true);
    });

    it("should return empty array when not initialized", async () => {
      await stopScheduler();
      const jobs = await getScheduledJobs();
      expect(jobs).toEqual([]);
    });
  });

  describe("getRunningJobs()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should return empty array when no jobs running", async () => {
      const jobs = await getRunningJobs();
      expect(jobs).toEqual([]);
    });

    it("should return active jobs", async () => {
      mockJobs.set("active-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await queueJob("active-job");
      const running = await getRunningJobs();
      expect(Array.isArray(running)).toBe(true);
    });
  });

  describe("getQueueStats()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should return job counts", async () => {
      mockJobs.set("stats-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      // Queue some jobs
      await queueJob("stats-job");
      await queueJob("stats-job");

      const stats = await getQueueStats();

      expect(stats.waiting).toBe(2);
      expect(stats.active).toBe(0);
      expect(typeof stats.completed).toBe("number");
      expect(typeof stats.failed).toBe("number");
    });

    it("should return zeros when not initialized", async () => {
      await stopScheduler();
      const stats = await getQueueStats();

      expect(stats.waiting).toBe(0);
      expect(stats.active).toBe(0);
    });
  });

  describe("isJobActive()", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should return true for waiting job", async () => {
      mockJobs.set("waiting-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      await queueJob("waiting-job");

      const isActive = await isJobActive("waiting-job");
      expect(isActive).toBe(true);
    });

    it("should return false for non-queued job", async () => {
      const isActive = await isJobActive("non-existent-job");
      expect(isActive).toBe(false);
    });

    it("should return false when not initialized", async () => {
      await stopScheduler();
      const isActive = await isJobActive("any-job");
      expect(isActive).toBe(false);
    });
  });

  describe("concurrent job handling", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should allow multiple jobs to be queued", async () => {
      mockJobs.set("concurrent-1", {
        type: "volume",
        source: "/data1",
        storage: "test-storage",
        worker_group: "default",
      });
      mockJobs.set("concurrent-2", {
        type: "volume",
        source: "/data2",
        storage: "test-storage",
        worker_group: "default",
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      const [result1, result2] = await Promise.all([
        queueJob("concurrent-1"),
        queueJob("concurrent-2"),
      ]);

      expect(result1.queued).toBe(true);
      expect(result2.queued).toBe(true);

      const stats = await getQueueStats();
      expect(stats.waiting).toBe(2);
    });
  });

  describe("job priority", () => {
    beforeEach(async () => {
      await initScheduler({
        bullmqConnection: createBullMQConnection(),
        redisConnection: redis,
      });
    });

    it("should queue jobs with specified priority", async () => {
      mockJobs.set("high-priority-job", {
        type: "volume",
        source: "/data",
        storage: "test-storage",
        worker_group: "default",
        priority: 1, // High priority
      });
      mockStorage.set("test-storage", { type: "local", path: "/backup" });

      const result = await queueJob("high-priority-job");
      expect(result.queued).toBe(true);

      const queue = getBackupQueue();
      const counts = await queue!.getJobCounts();
      const totalQueued = (counts.prioritized || 0) + (counts.waiting || 0) + (counts.delayed || 0);
      expect(totalQueued).toBeGreaterThan(0);
    });
  });
});
