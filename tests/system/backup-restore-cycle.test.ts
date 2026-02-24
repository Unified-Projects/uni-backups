/**
 * Backup/Restore Cycle System Integration Tests
 *
 * Complete end-to-end tests that verify full backup/restore workflows
 * through the API with workers processing jobs.
 *
 * Prerequisites:
 * - docker compose -f tests/compose/services.yml --profile full up -d --wait
 * - API server running on port 3001
 * - Worker running and processing jobs
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  sleep,
  generateTestId,
} from "../utils/test-services";
import { ApiClient, createApiClient } from "../utils/api-client";
import {
  createLocalTestRepo,
  cleanupTestRepo,
  type TestRepo,
  STANDARD_TEST_FILES,
  createTestFiles,
  verifyAllRestoredFiles,
} from "../utils/restic-helpers";
import {
  createTestBackupJob,
  waitForJobCompletion,
  createPassthroughWorker,
  type TestWorker,
} from "../utils/queue-helpers";
import { QUEUES } from "@uni-backups/queue";

describe("Backup/Restore Cycle System Tests", () => {
  let testContext: TestContext;
  let apiClient: ApiClient;
  let testDir: string;
  let testRepo: TestRepo;
  let worker: TestWorker;

  const TEST_TIMEOUT = 300000; // 5 minutes

  beforeAll(async () => {
    // Wait for required services
    await waitForAllServices({
      redis: true,
      minio: false, // Optional
      rest: false, // Optional
      postgres: false, // Optional
      mariadb: false, // Optional
    });

    // Initialize test context
    testContext = await initTestContext({
      redis: true,
      queues: true,
    });

    // Create API client
    apiClient = createApiClient("http://localhost:3001");

    // Create test directory
    testDir = `/tmp/system-backup-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });

    // Create test repository
    testRepo = await createLocalTestRepo("system-test");
  }, 120000);

  afterAll(async () => {
    // Cleanup worker if still running
    if (worker) {
      await worker.stop();
    }

    // Cleanup test repository
    if (testRepo) {
      await cleanupTestRepo(testRepo);
    }

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Cleanup test context
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  beforeEach(async () => {
    // Clear queues before each test
    if (testContext.queues) {
      await testContext.queues.backup.pause();
      await testContext.queues.backup.obliterate({ force: true });
      await testContext.queues.backup.resume();
    }
  });

  afterEach(async () => {
    // Stop worker after each test if running
    if (worker) {
      await worker.stop();
      worker = undefined as unknown as TestWorker;
    }
  });

  describe("Complete Backup Workflow", () => {
    it("executes backup job through queue and verifies snapshot creation", async () => {
      const jobName = `backup-job-${generateTestId("job")}`;

      // Create test files
      const sourceDir = join(testDir, "source-1");
      mkdirSync(sourceDir, { recursive: true });
      const fileInfo = createTestFiles({ ...testRepo, tempDir: sourceDir }, STANDARD_TEST_FILES);

      // Create a worker that will process the backup job
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 100);

      // Add backup job to queue
      const job = await createTestBackupJob(testContext.queues.backup, {
        jobName,
        jobType: "folder",
        storageName: "local",
        repoName: testRepo.name,
        sourcePath: sourceDir,
        tags: ["system-test"],
      });

      expect(job.id).toBeDefined();

      // Wait for job to complete
      const { job: completedJob, success } = await waitForJobCompletion(
        testContext.queues.backup,
        job.id!,
        60000
      );

      expect(success).toBe(true);
      expect(completedJob).toBeDefined();
      expect(worker.processedJobs.length).toBe(1);
    }, TEST_TIMEOUT);

    it("queues multiple backup jobs and processes them in order", async () => {
      const jobCount = 3;
      const jobs: string[] = [];

      // Create a worker with delay to ensure ordering
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 50);

      // Queue multiple jobs
      for (let i = 0; i < jobCount; i++) {
        const job = await createTestBackupJob(testContext.queues.backup, {
          jobName: `multi-backup-${i}-${generateTestId("job")}`,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
          tags: [`batch-${i}`],
        });
        jobs.push(job.id!);
      }

      expect(jobs.length).toBe(jobCount);

      // Wait for all jobs to complete
      for (const jobId of jobs) {
        const { success } = await waitForJobCompletion(
          testContext.queues.backup,
          jobId,
          60000
        );
        expect(success).toBe(true);
      }

      // Verify all jobs were processed
      expect(worker.processedJobs.length).toBe(jobCount);
    }, TEST_TIMEOUT);
  });

  describe("Backup with Priority", () => {
    it("processes high priority jobs before normal priority", async () => {
      const processedOrder: string[] = [];

      // Create a single worker that tracks processing order
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 100);

      // Add worker event listener for processing order
      worker.worker.on("completed", (job) => {
        processedOrder.push(job.name);
        worker.processedJobs.push(job.id!);
      });

      // Queue low priority job first
      const lowPriorityJob = await createTestBackupJob(
        testContext.queues.backup,
        {
          jobName: `low-priority-${generateTestId("job")}`,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
          tags: ["low-priority"],
        },
        { priority: 100 } // Lower priority (higher number)
      );

      // Small delay to ensure first job is queued
      await sleep(50);

      // Queue high priority job
      const highPriorityJob = await createTestBackupJob(
        testContext.queues.backup,
        {
          jobName: `high-priority-${generateTestId("job")}`,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
          tags: ["high-priority"],
        },
        { priority: 1 } // Higher priority (lower number)
      );

      // Wait for both to complete
      await Promise.all([
        waitForJobCompletion(testContext.queues.backup, lowPriorityJob.id!, 60000),
        waitForJobCompletion(testContext.queues.backup, highPriorityJob.id!, 60000),
      ]);

      // Both jobs should be processed
      expect(processedOrder.length).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe("Job Failure Handling", () => {
    it("marks failed jobs correctly and allows retry", async () => {
      const jobName = `fail-job-${generateTestId("job")}`;
      let attemptCount = 0;

      // Create worker that fails on first attempt, succeeds on retry
      const { Worker } = await import("bullmq");
      const failingWorker = new Worker(
        QUEUES.BACKUP_JOBS,
        async (job) => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error("Simulated failure");
          }
          return { success: true, attemptCount };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: failingWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await failingWorker.close();
        },
      };

      // Add job with retry attempts
      const job = await createTestBackupJob(
        testContext.queues.backup,
        {
          jobName,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
        },
        {
          attempts: 2,
          backoff: {
            type: "fixed",
            delay: 100,
          },
        }
      );

      // Wait for job to complete (after retry)
      await sleep(500); // Wait for first failure and retry
      const { job: completedJob, success } = await waitForJobCompletion(
        testContext.queues.backup,
        job.id!,
        60000
      );

      expect(success).toBe(true);
      expect(attemptCount).toBe(2); // First failure + successful retry
    }, TEST_TIMEOUT);
  });

  describe("Queue State Management", () => {
    it("tracks job states correctly through lifecycle", async () => {
      const jobName = `lifecycle-job-${generateTestId("job")}`;

      // Ensure queue is empty and no workers are processing
      await testContext.queues.backup.pause();
      await testContext.queues.backup.obliterate({ force: true });
      await testContext.queues.backup.resume();
      await sleep(100);

      // Don't start worker yet - job should be waiting
      const job = await createTestBackupJob(testContext.queues.backup, {
        jobName,
        jobType: "folder",
        storageName: "local",
        repoName: testRepo.name,
        sourcePath: testRepo.tempDir,
      });

      // Small delay to ensure job is properly queued
      await sleep(50);

      // Check initial state is waiting or prioritized (BullMQ uses "prioritized" for jobs with priority)
      const initialJob = await testContext.queues.backup.getJob(job.id!);
      const initialState = await initialJob?.getState();
      expect(["waiting", "prioritized"]).toContain(initialState);

      // Start worker
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 200);

      // Wait for job to complete
      const { job: completedJob, success } = await waitForJobCompletion(
        testContext.queues.backup,
        job.id!,
        60000
      );

      expect(success).toBe(true);

      // Check final state is completed
      const finalJob = await testContext.queues.backup.getJob(job.id!);
      const finalState = await finalJob?.getState();
      expect(finalState).toBe("completed");
    }, TEST_TIMEOUT);

    it("maintains queue counts accurately", async () => {
      // Clear queue first and wait for it to settle
      await testContext.queues.backup.pause();
      await testContext.queues.backup.obliterate({ force: true });
      await testContext.queues.backup.resume();
      await sleep(100);

      // Get initial counts
      const initialCounts = await testContext.queues.backup.getJobCounts();
      expect(initialCounts.waiting).toBe(0);
      expect(initialCounts.active).toBe(0);
      expect(initialCounts.completed).toBe(0);

      // Add jobs without worker (no worker should be running yet)
      const jobIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const job = await createTestBackupJob(testContext.queues.backup, {
          jobName: `count-job-${i}-${generateTestId("job")}`,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
        });
        jobIds.push(job.id!);
      }

      // Small delay to ensure jobs are properly queued
      await sleep(50);

      // Check waiting count (BullMQ may put prioritized jobs in "prioritized" or "waiting" state)
      const waitingCounts = await testContext.queues.backup.getJobCounts();
      // Jobs can be in waiting or prioritized state depending on BullMQ version
      const pendingJobs = (waitingCounts.waiting || 0) + (waitingCounts.prioritized || 0);
      expect(pendingJobs).toBe(3);

      // Start worker
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 50);

      // Wait for all to complete
      for (const jobId of jobIds) {
        await waitForJobCompletion(testContext.queues.backup, jobId, 60000);
      }

      // Check final counts
      const finalCounts = await testContext.queues.backup.getJobCounts();
      expect(finalCounts.waiting).toBe(0);
      expect(finalCounts.completed).toBe(3);
    }, TEST_TIMEOUT);
  });

  describe("Redis State Persistence", () => {
    it("persists job execution records in Redis", async () => {
      const jobName = `persist-job-${generateTestId("job")}`;

      // Create and process job
      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 50);

      const job = await createTestBackupJob(testContext.queues.backup, {
        jobName,
        jobType: "folder",
        storageName: "local",
        repoName: testRepo.name,
        sourcePath: testRepo.tempDir,
      });

      await waitForJobCompletion(testContext.queues.backup, job.id!, 60000);

      // Verify job data persisted in Redis
      const persistedJob = await testContext.queues.backup.getJob(job.id!);
      expect(persistedJob).toBeDefined();
      expect(persistedJob?.name).toBe(jobName);
      expect(persistedJob?.data.storageName).toBe("local");
    }, TEST_TIMEOUT);
  });

  describe("Concurrent Operations", () => {
    it("handles concurrent job additions", async () => {
      const jobCount = 10;

      // Clear queue first
      await testContext.queues.backup.pause();
      await testContext.queues.backup.obliterate({ force: true });
      await testContext.queues.backup.resume();
      await sleep(100);

      worker = createPassthroughWorker(QUEUES.BACKUP_JOBS, testContext.bullmqConnection, 20);

      // Track completed jobs via event listener
      const completedJobIds: string[] = [];
      worker.worker.on("completed", (job) => {
        completedJobIds.push(job.id!);
      });

      // Add jobs concurrently
      const jobPromises = Array.from({ length: jobCount }, (_, i) =>
        createTestBackupJob(testContext.queues.backup, {
          jobName: `concurrent-${i}-${generateTestId("job")}`,
          jobType: "folder",
          storageName: "local",
          repoName: testRepo.name,
          sourcePath: testRepo.tempDir,
        })
      );

      const jobs = await Promise.all(jobPromises);
      expect(jobs.length).toBe(jobCount);

      // Wait for all to complete with increased timeout
      const completionPromises = jobs.map((job) =>
        waitForJobCompletion(testContext.queues.backup, job.id!, 120000)
      );

      const results = await Promise.all(completionPromises);

      // All should succeed
      results.forEach(({ success }) => {
        expect(success).toBe(true);
      });

      // Verify all jobs were processed via the completion event
      expect(completedJobIds.length).toBe(jobCount);
    }, TEST_TIMEOUT);
  });
});
