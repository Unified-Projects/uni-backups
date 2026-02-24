/**
 * Queue Integration Tests - REAL REDIS (NO MOCKS)
 *
 * Tests BullMQ queue operations against actual Redis.
 * Requires Docker services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { QUEUES, QUEUE_CONFIG, getQueueConfig, JOB_PRIORITY } from "../queues";
import type { BackupJobData, PruneJobData } from "../types";

// Test configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests
};

const TEST_TIMEOUT = 60000;

describe("Queue Integration Tests (Real Redis)", () => {
  let redis: Redis;

  beforeAll(async () => {
    // Connect to real Redis
    redis = new Redis(TEST_REDIS_CONFIG);

    // Verify Redis is accessible
    await redis.ping();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean the test database between tests
    await redis.flushdb();
  });

  describe("Queue Name Compatibility", () => {
    it("should use valid BullMQ queue names (no colons or spaces)", () => {
      // BullMQ uses colons internally for key prefixes
      expect(QUEUES.BACKUP_JOBS).not.toContain(":");
      expect(QUEUES.BACKUP_SCHEDULED).not.toContain(":");
      expect(QUEUES.PRUNE_JOBS).not.toContain(":");
      expect(QUEUES.HEALTH_CHECKS).not.toContain(":");
      expect(QUEUES.FAILOVER).not.toContain(":");
    });

    it("should define all required queue names", () => {
      expect(QUEUES.BACKUP_JOBS).toBe("backup-jobs");
      expect(QUEUES.BACKUP_SCHEDULED).toBe("backup-scheduled");
      expect(QUEUES.PRUNE_JOBS).toBe("prune-jobs");
      expect(QUEUES.HEALTH_CHECKS).toBe("health-checks");
      expect(QUEUES.FAILOVER).toBe("failover-jobs");
    });
  });

  describe("Queue Configuration", () => {
    it("should provide default job options for all queues", () => {
      const backupConfig = getQueueConfig(QUEUES.BACKUP_JOBS);
      const pruneConfig = getQueueConfig(QUEUES.PRUNE_JOBS);
      const healthConfig = getQueueConfig(QUEUES.HEALTH_CHECKS);

      expect(backupConfig.attempts).toBeDefined();
      expect(pruneConfig.attempts).toBeDefined();
      expect(healthConfig.attempts).toBeDefined();
    });

    it("should return empty config for unknown queue", () => {
      // @ts-ignore - Testing invalid input
      const config = getQueueConfig("non-existent-queue");
      expect(config).toEqual({});
    });

    it("should have proper retry configuration for backup jobs", () => {
      const config = getQueueConfig(QUEUES.BACKUP_JOBS);
      expect(config.attempts).toBeGreaterThan(1);
      expect(config.backoff).toBeDefined();
    });
  });

  describe("Backup Queue Operations", () => {
    let backupQueue: Queue<BackupJobData>;
    let connection: Redis;
    // Use a unique queue name per test suite to avoid conflicts
    const BACKUP_QUEUE_NAME = `test-backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => {
      connection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      backupQueue = new Queue<BackupJobData>(BACKUP_QUEUE_NAME, {
        connection,
        defaultJobOptions: getQueueConfig(QUEUES.BACKUP_JOBS),
      });

      // Ensure queue is clean before each test
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.resume();
    });

    afterEach(async () => {
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.close();
      await connection.quit();
    });

    it("should add backup jobs to the queue", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-123",
        jobName: "test-backup",
        storageName: "local-storage",
        repoName: "test-repo",
        backupType: "volume",
        source: {
          type: "volume",
          volumeName: "test-volume",
        },
        tags: ["test"],
        priority: JOB_PRIORITY.NORMAL,
      };

      const job = await backupQueue.add("backup", jobData);

      expect(job.id).toBeDefined();
      expect(job.name).toBe("backup");
      expect(job.data.executionId).toBe("exec-123");
    });

    it("should retrieve job counts correctly", async () => {
      // Add multiple jobs
      await backupQueue.add("job-1", { executionId: "e1", jobName: "j1" } as BackupJobData);
      await backupQueue.add("job-2", { executionId: "e2", jobName: "j2" } as BackupJobData);
      await backupQueue.add("job-3", { executionId: "e3", jobName: "j3" } as BackupJobData);

      const counts = await backupQueue.getJobCounts();

      expect(counts.waiting).toBe(3);
      expect(counts.active).toBe(0);
    });

    it("should support job priorities", async () => {
      await backupQueue.add(
        "low",
        { executionId: "low", jobName: "low-priority" } as BackupJobData,
        { priority: JOB_PRIORITY.LOW }
      );

      await backupQueue.add(
        "high",
        { executionId: "high", jobName: "high-priority" } as BackupJobData,
        { priority: JOB_PRIORITY.HIGH }
      );

      await backupQueue.add(
        "critical",
        { executionId: "critical", jobName: "critical-priority" } as BackupJobData,
        { priority: JOB_PRIORITY.CRITICAL }
      );

      const jobs = await backupQueue.getJobs(["waiting"], 0, 10);

      // Jobs should be ordered by priority (lower number = higher priority)
      const priorities = jobs.map((j) => j.opts.priority || JOB_PRIORITY.NORMAL);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    });

    it("should retrieve jobs by ID", async () => {
      const job = await backupQueue.add("test-job", {
        executionId: "exec-456",
        jobName: "retrievable-job",
      } as BackupJobData);

      const retrieved = await backupQueue.getJob(job.id!);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.data.executionId).toBe("exec-456");
      expect(retrieved!.data.jobName).toBe("retrievable-job");
    });

    it("should support removing jobs", async () => {
      const job = await backupQueue.add("removable", { executionId: "remove-me" } as BackupJobData);

      await job.remove();

      const retrieved = await backupQueue.getJob(job.id!);
      // BullMQ returns undefined (not null) for removed/non-existent jobs
      expect(retrieved).toBeUndefined();
    });

    it("should drain the queue", async () => {
      await backupQueue.add("job-1", { executionId: "e1" } as BackupJobData);
      await backupQueue.add("job-2", { executionId: "e2" } as BackupJobData);

      let counts = await backupQueue.getJobCounts();
      expect(counts.waiting).toBe(2);

      await backupQueue.drain();

      counts = await backupQueue.getJobCounts();
      expect(counts.waiting).toBe(0);
    });
  });

  describe("Worker Processing", () => {
    let backupQueue: Queue<BackupJobData>;
    let worker: Worker<BackupJobData>;
    let connection: Redis;
    let queueConnection: Redis;
    // Use a unique queue name per test suite to avoid conflicts
    const WORKER_QUEUE_NAME = `test-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => {
      connection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      queueConnection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      backupQueue = new Queue<BackupJobData>(WORKER_QUEUE_NAME, {
        connection: queueConnection,
      });

      // Ensure queue is clean before each test
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.resume();
    });

    afterEach(async () => {
      if (worker) {
        await worker.close();
      }
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.close();
      await queueConnection.quit();
      await connection.quit();
    });

    it("should process jobs with a worker", async () => {
      const processed: string[] = [];

      worker = new Worker<BackupJobData>(
        WORKER_QUEUE_NAME,
        async (job) => {
          processed.push(job.data.executionId);
          return { success: true };
        },
        { connection, autorun: true }
      );

      await backupQueue.add("process-test", {
        executionId: "worker-test-1",
        jobName: "worker-job",
      } as BackupJobData);

      // Wait for job to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(processed).toContain("worker-test-1");
    });

    it("should handle job failures and retries", async () => {
      let attemptCount = 0;

      worker = new Worker<BackupJobData>(
        WORKER_QUEUE_NAME,
        async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error("Simulated failure");
          }
          return { success: true };
        },
        {
          connection,
          autorun: true,
        }
      );

      await backupQueue.add(
        "retry-test",
        { executionId: "exec-retry", jobName: "retry-job" } as BackupJobData,
        { attempts: 3, backoff: { type: "fixed", delay: 100 } }
      );

      // Wait for retries
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(attemptCount).toBeGreaterThanOrEqual(2);
    });

    it("should process jobs concurrently", async () => {
      // Use a unique prefix to track only our jobs
      const uniquePrefix = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const processedIds = new Set<string>();
      const startTimes: number[] = [];

      // Drain any leftover jobs first
      await backupQueue.drain();

      worker = new Worker<BackupJobData>(
        WORKER_QUEUE_NAME,
        async (job) => {
          // Only track jobs from this test run
          if (job.data.executionId.startsWith(uniquePrefix)) {
            processedIds.add(job.data.executionId);
            startTimes.push(Date.now());
          }
          await new Promise((r) => setTimeout(r, 200));
          return { success: true };
        },
        { connection, autorun: true, concurrency: 3 }
      );

      // Wait for worker to be ready
      await worker.waitUntilReady();

      // Add 3 jobs with unique IDs
      await Promise.all([
        backupQueue.add("c1", { executionId: `${uniquePrefix}-c1` } as BackupJobData),
        backupQueue.add("c2", { executionId: `${uniquePrefix}-c2` } as BackupJobData),
        backupQueue.add("c3", { executionId: `${uniquePrefix}-c3` } as BackupJobData),
      ]);

      // Wait for processing
      await new Promise((r) => setTimeout(r, 1500));

      // All 3 unique jobs should have been processed
      expect(processedIds.size).toBe(3);
      expect(startTimes.length).toBe(3);
      const startSpread = Math.max(...startTimes) - Math.min(...startTimes);
      expect(startSpread).toBeLessThan(500); // Should start within 500ms of each other
    });
  });

  describe("Prune Queue Operations", () => {
    let pruneQueue: Queue<PruneJobData>;
    let connection: Redis;
    // Use a unique queue name per test suite to avoid conflicts
    const PRUNE_QUEUE_NAME = `test-prune-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => {
      connection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      pruneQueue = new Queue<PruneJobData>(PRUNE_QUEUE_NAME, {
        connection,
        defaultJobOptions: getQueueConfig(QUEUES.PRUNE_JOBS),
      });

      // Ensure queue is clean before each test
      await pruneQueue.pause();
      await pruneQueue.obliterate({ force: true });
      await pruneQueue.resume();
    });

    afterEach(async () => {
      await pruneQueue.pause();
      await pruneQueue.obliterate({ force: true });
      await pruneQueue.close();
      await connection.quit();
    });

    it("should add prune jobs to the queue", async () => {
      const jobData: PruneJobData = {
        executionId: "prune-123",
        storageName: "local-storage",
        repoName: "test-repo",
        retentionPolicy: {
          keepLast: 10,
          keepDaily: 7,
          keepWeekly: 4,
          keepMonthly: 12,
        },
        dryRun: false,
      };

      const job = await pruneQueue.add("prune", jobData);

      expect(job.id).toBeDefined();
      expect(job.data.executionId).toBe("prune-123");
      expect(job.data.retentionPolicy.keepLast).toBe(10);
    });
  });

  describe("Queue Events", () => {
    let backupQueue: Queue<BackupJobData>;
    let worker: Worker<BackupJobData>;
    let workerConnection: Redis;
    let queueEvents: QueueEvents;
    let connection: Redis;
    let queueConnection: Redis;
    // Use a unique queue name per test suite to avoid conflicts
    const EVENTS_QUEUE_NAME = `test-events-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => {
      connection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      queueConnection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      backupQueue = new Queue<BackupJobData>(EVENTS_QUEUE_NAME, {
        connection: queueConnection,
      });

      // Ensure queue is clean before each test
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.resume();

      queueEvents = new QueueEvents(EVENTS_QUEUE_NAME, { connection });
      await queueEvents.waitUntilReady();
    });

    afterEach(async () => {
      if (worker) {
        await worker.close();
      }
      if (workerConnection) {
        await workerConnection.quit();
      }
      await queueEvents.close();
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.close();
      await queueConnection.quit();
      await connection.quit();
    });

    it("should emit completed event when job finishes", async () => {
      const completedJobIds: string[] = [];

      queueEvents.on("completed", ({ jobId }) => {
        completedJobIds.push(jobId);
      });

      workerConnection = new Redis({ ...TEST_REDIS_CONFIG, maxRetriesPerRequest: null, enableReadyCheck: false });
      worker = new Worker<BackupJobData>(
        EVENTS_QUEUE_NAME,
        async () => ({ success: true }),
        { connection: workerConnection }
      );

      // Wait for worker to be ready
      await worker.waitUntilReady();

      const job = await backupQueue.add("event-test", { executionId: "event-123" } as BackupJobData);

      // Wait for job to complete using BullMQ's waitUntilFinished
      await job.waitUntilFinished(queueEvents, 5000);

      expect(completedJobIds).toContain(job.id);
    });

    it("should emit failed event when job fails", async () => {
      const failedJobIds: string[] = [];
      const failReasons: string[] = [];

      queueEvents.on("failed", ({ jobId, failedReason }) => {
        failedJobIds.push(jobId);
        failReasons.push(failedReason);
      });

      workerConnection = new Redis({ ...TEST_REDIS_CONFIG, maxRetriesPerRequest: null, enableReadyCheck: false });
      worker = new Worker<BackupJobData>(
        EVENTS_QUEUE_NAME,
        async () => {
          throw new Error("Intentional failure");
        },
        { connection: workerConnection }
      );

      // Wait for worker to be ready
      await worker.waitUntilReady();

      const job = await backupQueue.add(
        "fail-test",
        { executionId: "exec-fail" } as BackupJobData,
        { attempts: 1 }
      );

      // Wait for job to complete (it will fail)
      try {
        await job.waitUntilFinished(queueEvents, 5000);
      } catch {
        // Expected to throw since job fails
      }

      // Wait a bit for the event to propagate
      await new Promise((r) => setTimeout(r, 100));

      expect(failedJobIds).toContain(job.id);
      // The failed reason should contain our error message (BullMQ may wrap it)
      expect(failReasons.length).toBeGreaterThan(0);
      expect(failReasons.some((r) => r.includes("Intentional failure"))).toBe(true);
    });
  });

  describe("Repeatable Jobs (Scheduling)", () => {
    let backupQueue: Queue<BackupJobData>;
    let connection: Redis;
    // Use a unique queue name per test suite to avoid conflicts
    const REPEATABLE_QUEUE_NAME = `test-repeatable-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => {
      connection = new Redis({
        ...TEST_REDIS_CONFIG,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      backupQueue = new Queue<BackupJobData>(REPEATABLE_QUEUE_NAME, { connection });

      // Ensure queue is clean before each test
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.resume();
    });

    afterEach(async () => {
      // Remove all repeatables
      const repeatables = await backupQueue.getRepeatableJobs();
      for (const repeatable of repeatables) {
        await backupQueue.removeRepeatableByKey(repeatable.key);
      }
      await backupQueue.pause();
      await backupQueue.obliterate({ force: true });
      await backupQueue.close();
      await connection.quit();
    });

    it("should add repeatable jobs with cron patterns", async () => {
      await backupQueue.add(
        "schedule:daily-backup",
        { executionId: "", jobName: "daily-backup" } as BackupJobData,
        { repeat: { pattern: "0 2 * * *" } } // Every day at 2 AM
      );

      const repeatables = await backupQueue.getRepeatableJobs();

      expect(repeatables.length).toBe(1);
      expect(repeatables[0].name).toBe("schedule:daily-backup");
      expect(repeatables[0].pattern).toBe("0 2 * * *");
    });

    it("should remove repeatable jobs by key", async () => {
      await backupQueue.add(
        "schedule:removable",
        { executionId: "", jobName: "removable" } as BackupJobData,
        { repeat: { pattern: "*/5 * * * *" } }
      );

      let repeatables = await backupQueue.getRepeatableJobs();
      const removable = repeatables.find((r) => r.name === "schedule:removable");
      expect(removable).toBeDefined();

      await backupQueue.removeRepeatableByKey(removable!.key);

      repeatables = await backupQueue.getRepeatableJobs();
      const stillExists = repeatables.find((r) => r.name === "schedule:removable");
      expect(stillExists).toBeUndefined();
    });

    it("should update repeatable job by removing and re-adding", async () => {
      // Add initial schedule
      await backupQueue.add(
        "schedule:updatable",
        { executionId: "", jobName: "updatable" } as BackupJobData,
        { repeat: { pattern: "0 * * * *" } } // Every hour
      );

      let repeatables = await backupQueue.getRepeatableJobs();
      const initial = repeatables.find((r) => r.name === "schedule:updatable");
      expect(initial!.pattern).toBe("0 * * * *");

      // Remove and re-add with new schedule
      await backupQueue.removeRepeatableByKey(initial!.key);
      await backupQueue.add(
        "schedule:updatable",
        { executionId: "", jobName: "updatable" } as BackupJobData,
        { repeat: { pattern: "*/30 * * * *" } } // Every 30 minutes
      );

      repeatables = await backupQueue.getRepeatableJobs();
      const updated = repeatables.find((r) => r.name === "schedule:updatable");
      expect(updated!.pattern).toBe("*/30 * * * *");
    });
  });
});
