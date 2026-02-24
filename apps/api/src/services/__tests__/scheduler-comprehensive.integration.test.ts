/**
 * Scheduler Comprehensive Tests
 *
 * Tests BullMQ-based job scheduling including:
 * - Cron pattern validation
 * - Schedule synchronization
 * - Manual job queuing
 * - Priority ordering
 * - Queue statistics
 * - Concurrent schedule updates
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { Queue, Worker, Job } from "bullmq";
import { QUEUES, type BackupJobData } from "@uni-backups/queue";
import * as scheduler from "../scheduler";
import * as configModule from "@uni-backups/shared/config";

// Mock the config module
vi.mock("@uni-backups/shared/config", async (importOriginal) => {
  const original = await importOriginal() as typeof configModule;
  return {
    ...original,
    getConfig: vi.fn(),
  };
});

// Test Redis configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
};

function createBullMQConnection(): Redis {
  return new Redis({
    ...TEST_REDIS_CONFIG,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Mock config helper
function createMockConfig(jobs: Array<{ name: string; schedule?: string; storage: string; priority?: number; worker_group?: string }>) {
  const jobsMap = new Map();
  const storageMap = new Map([
    ["test-storage", { type: "local" as const, path: "/backup" }],
  ]);

  for (const job of jobs) {
    jobsMap.set(job.name, {
      type: "folder" as const,
      source: "/data",
      storage: job.storage,
      schedule: job.schedule,
      priority: job.priority,
      worker_group: job.worker_group || "default",
    });
  }

  return {
    jobs: jobsMap,
    storage: storageMap,
    resticPassword: "test-password",
  };
}

describe("Scheduler Comprehensive Tests", { timeout: 60000 }, () => {
  let redis: Redis;
  let bullmqConnection: Redis;
  let testQueue: Queue;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    bullmqConnection = createBullMQConnection();

    // Create test queue for inspection
    testQueue = new Queue(QUEUES.BACKUP_JOBS, {
      connection: createBullMQConnection(),
    });

    // Default mock config
    vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([]) as any);
  });

  afterEach(async () => {
    await scheduler.stopScheduler();
    // Flush DB to clean all state (BullMQ queue data + repeatables)
    // This is more reliable than obliterate which requires pause in BullMQ 5.69+
    await redis.flushdb();
    await testQueue.close();
    await bullmqConnection.quit();
  });

  // ==========================================================================
  // Cron Pattern Tests
  // ==========================================================================

  describe("Cron Pattern: Every Minute", () => {
    it("schedules job with * * * * * (every minute)", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "every-minute", schedule: "* * * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].name).toBe("every-minute");
      expect(scheduledJobs[0].schedule).toBe("* * * * *");
    });
  });

  describe("Cron Pattern: Hourly", () => {
    it("schedules job with 0 * * * * (every hour)", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "hourly-job", schedule: "0 * * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].name).toBe("hourly-job");
      expect(scheduledJobs[0].schedule).toBe("0 * * * *");
    });
  });

  describe("Cron Pattern: Daily Midnight", () => {
    it("schedules job with 0 0 * * * (midnight)", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "midnight-backup", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].name).toBe("midnight-backup");
      expect(scheduledJobs[0].schedule).toBe("0 0 * * *");
    });
  });

  describe("Cron Pattern: Complex Schedule", () => {
    it("schedules job with 0 2,14 * * 1-5 (weekdays at 2am and 2pm)", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "weekday-backup", schedule: "0 2,14 * * 1-5", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].name).toBe("weekday-backup");
      expect(scheduledJobs[0].schedule).toBe("0 2,14 * * 1-5");
    });

    it("schedules multiple complex patterns", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "job-1", schedule: "*/15 * * * *", storage: "test-storage" }, // Every 15 minutes
        { name: "job-2", schedule: "0 */2 * * *", storage: "test-storage" }, // Every 2 hours
        { name: "job-3", schedule: "0 0 * * 0", storage: "test-storage" }, // Every Sunday at midnight
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(3);

      const job1 = scheduledJobs.find((j) => j.name === "job-1");
      const job2 = scheduledJobs.find((j) => j.name === "job-2");
      const job3 = scheduledJobs.find((j) => j.name === "job-3");

      expect(job1?.schedule).toBe("*/15 * * * *");
      expect(job2?.schedule).toBe("0 */2 * * *");
      expect(job3?.schedule).toBe("0 0 * * 0");
    });
  });

  // ==========================================================================
  // Priority Tests
  // ==========================================================================

  describe("Priority Ordering", () => {
    it("queues jobs with correct priority", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "low-priority", storage: "test-storage", priority: 10 },
        { name: "high-priority", storage: "test-storage", priority: 1 },
        { name: "medium-priority", storage: "test-storage", priority: 5 },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Queue all jobs and verify they were queued successfully
      const result1 = await scheduler.queueJob("low-priority");
      const result2 = await scheduler.queueJob("high-priority");
      const result3 = await scheduler.queueJob("medium-priority");

      expect(result1.queued).toBe(true);
      expect(result2.queued).toBe(true);
      expect(result3.queued).toBe(true);

      // Small delay to ensure jobs are persisted to Redis
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get all jobs (waiting + prioritized) to verify they exist
      const allJobs = await testQueue.getJobs(["waiting", "prioritized"]);

      const job1 = allJobs.find((j) => j.data.executionId === result1.executionId);
      const job2 = allJobs.find((j) => j.data.executionId === result2.executionId);
      const job3 = allJobs.find((j) => j.data.executionId === result3.executionId);

      expect(job1).toBeDefined();
      expect(job2).toBeDefined();
      expect(job3).toBeDefined();

      // Verify priorities are correct on the jobs
      expect(job1?.opts?.priority).toBe(10);
      expect(job2?.opts?.priority).toBe(1);
      expect(job3?.opts?.priority).toBe(5);
    });

    it("default priority is applied when not specified", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "no-priority", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const result = await scheduler.queueJob("no-priority");

      expect(result.queued).toBe(true);

      const job = await testQueue.getJob(result.executionId);
      expect(job).toBeDefined();
    });
  });

  // ==========================================================================
  // Schedule Sync Tests
  // ==========================================================================

  describe("Schedule Sync Adds New Jobs", () => {
    it("adds new schedules when config is updated", async () => {
      // Initial config with one job
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "initial-job", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      let scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);

      // Update config with additional job
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "initial-job", schedule: "0 0 * * *", storage: "test-storage" },
        { name: "new-job", schedule: "0 12 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.syncSchedules();

      scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(2);

      const newJob = scheduledJobs.find((j) => j.name === "new-job");
      expect(newJob).toBeDefined();
      expect(newJob?.schedule).toBe("0 12 * * *");
    });
  });

  describe("Schedule Sync Removes Old Jobs", () => {
    it("removes schedules when job is removed from config", async () => {
      // Initial config with two jobs
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "keep-job", schedule: "0 0 * * *", storage: "test-storage" },
        { name: "remove-job", schedule: "0 12 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      let scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(2);

      // Update config removing one job
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "keep-job", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.syncSchedules();

      scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].name).toBe("keep-job");
    });

    it("removes schedule when job schedule is disabled", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "scheduled-job", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      let scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);

      // Disable schedule (no schedule property)
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "scheduled-job", storage: "test-storage" }, // No schedule
      ]) as any);

      await scheduler.syncSchedules();

      scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Concurrent Updates Tests
  // ==========================================================================

  describe("Concurrent Schedule Updates", () => {
    it("handles multiple concurrent sync calls", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "job-1", schedule: "0 0 * * *", storage: "test-storage" },
        { name: "job-2", schedule: "0 6 * * *", storage: "test-storage" },
        { name: "job-3", schedule: "0 12 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Call sync multiple times concurrently
      await Promise.all([
        scheduler.syncSchedules(),
        scheduler.syncSchedules(),
        scheduler.syncSchedules(),
      ]);

      const scheduledJobs = await scheduler.getScheduledJobs();

      // Should have exactly 3 jobs (no duplicates)
      expect(scheduledJobs).toHaveLength(3);
    });

    it("handles concurrent job queuing", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "concurrent-job", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Queue same job multiple times concurrently
      const results = await Promise.all([
        scheduler.queueJob("concurrent-job"),
        scheduler.queueJob("concurrent-job"),
        scheduler.queueJob("concurrent-job"),
      ]);

      // All should be queued successfully
      for (const result of results) {
        expect(result.queued).toBe(true);
        expect(result.executionId).toBeDefined();
      }

      // Each should have unique execution ID
      const ids = results.map((r) => r.executionId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  // ==========================================================================
  // Queue Statistics Tests
  // ==========================================================================

  describe("Queue Statistics", () => {
    it("returns accurate queue statistics", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "stats-job", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Queue multiple jobs
      for (let i = 0; i < 5; i++) {
        await scheduler.queueJob("stats-job");
      }

      const stats = await scheduler.getQueueStats();

      expect(stats.waiting).toBe(5);
      expect(stats.active).toBe(0); // No workers processing
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it("updates statistics when jobs complete", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "complete-job", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Create a worker to process jobs
      const workerConnection = createBullMQConnection();
      const worker = new Worker(
        QUEUES.BACKUP_JOBS,
        async () => "done",
        { connection: workerConnection }
      );

      await worker.waitUntilReady();

      // Queue a job
      const { executionId } = await scheduler.queueJob("complete-job");

      // Wait for job to complete by polling
      let stats = await scheduler.getQueueStats();
      const deadline = Date.now() + 5000;
      while (stats.completed === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        stats = await scheduler.getQueueStats();
      }

      expect(stats.waiting).toBe(0);
      expect(stats.completed).toBe(1);

      await worker.close();
      await workerConnection.quit();
    });
  });

  // ==========================================================================
  // Job State Tests
  // ==========================================================================

  describe("Job State Tracking", () => {
    it("isJobActive returns true for queued jobs", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "active-check", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      await scheduler.queueJob("active-check");

      const isActive = await scheduler.isJobActive("active-check");
      expect(isActive).toBe(true);
    });

    it("isJobActive returns false for non-queued jobs", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "idle-job", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const isActive = await scheduler.isJobActive("idle-job");
      expect(isActive).toBe(false);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("Error Handling", () => {
    it("queueJob returns error for non-existent job", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const result = await scheduler.queueJob("non-existent-job");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("queueJob returns error for missing storage", async () => {
      // Create config with job referencing non-existent storage
      const config = createMockConfig([]);
      config.jobs.set("bad-storage-job", {
        type: "folder",
        source: "/data",
        storage: "non-existent-storage",
        worker_group: "default",
      });

      vi.mocked(configModule.getConfig).mockReturnValue(config as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      const result = await scheduler.queueJob("bad-storage-job");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("Storage");
    });
  });

  // ==========================================================================
  // Running Jobs Tests
  // ==========================================================================

  describe("Running Jobs Tracking", () => {
    it("getRunningJobs returns active jobs", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "running-test", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      // Create a slow worker with its own connection
      const workerConnection = createBullMQConnection();
      let resolveJob: () => void;
      const jobPromise = new Promise<void>((r) => { resolveJob = r; });

      const worker = new Worker(
        QUEUES.BACKUP_JOBS,
        async () => {
          await jobPromise;
          return "done";
        },
        { connection: workerConnection }
      );

      await worker.waitUntilReady();

      // Queue job
      const { executionId } = await scheduler.queueJob("running-test");

      // Wait for job to become active
      const deadline = Date.now() + 5000;
      let runningJobs = await scheduler.getRunningJobs();
      while (runningJobs.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        runningJobs = await scheduler.getRunningJobs();
      }

      expect(runningJobs.length).toBeGreaterThan(0);
      const job = runningJobs.find((j) => j.executionId === executionId);
      expect(job).toBeDefined();
      expect(job?.jobName).toBe("running-test");

      // Let the job finish before cleanup to avoid "Missing key" error
      resolveJob!();
      await new Promise((r) => setTimeout(r, 200));
      await worker.close();
      await workerConnection.quit();
    });
  });

  // ==========================================================================
  // Scheduler Lifecycle Tests
  // ==========================================================================

  describe("Scheduler Lifecycle", () => {
    it("stopScheduler cleans up resources", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "lifecycle-job", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });

      let scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);

      await scheduler.stopScheduler();

      // After stop, getScheduledJobs should return empty (queue closed)
      scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(0);
    });

    it("can reinitialize after stop", async () => {
      vi.mocked(configModule.getConfig).mockReturnValue(createMockConfig([
        { name: "reinit-job", schedule: "0 0 * * *", storage: "test-storage" },
      ]) as any);

      await scheduler.initScheduler({ bullmqConnection, redisConnection: redis });
      await scheduler.stopScheduler();

      // Reinitialize with new connection
      const newConnection = createBullMQConnection();
      await scheduler.initScheduler({ bullmqConnection: newConnection, redisConnection: redis });

      const scheduledJobs = await scheduler.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);

      await scheduler.stopScheduler();
      await newConnection.quit();
    });
  });
});
