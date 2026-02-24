/**
 * Scheduled Backup System Integration Tests
 *
 * End-to-end tests that verify scheduled backup functionality:
 * - Cron-based job scheduling
 * - Repeatable job management
 * - Schedule execution and timing
 * - Missed job handling
 *
 * Prerequisites:
 * - docker compose -f tests/compose/services.yml --profile redis up -d --wait
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  sleep,
  generateTestId,
} from "../utils/test-services";
import {
  createAllTestQueues,
  createRepeatableJob,
  getRepeatableJobs,
  removeRepeatableJob,
  removeAllRepeatableJobs,
  waitForQueueDrained,
  createPassthroughWorker,
  type TestQueues,
  type TestWorker,
} from "../utils/queue-helpers";
import { QUEUES } from "@uni-backups/queue";

describe("Scheduled Backup System Tests", () => {
  let testContext: TestContext;
  let testQueues: TestQueues;
  let worker: TestWorker;
  let testDir: string;

  const TEST_TIMEOUT = 120000; // 2 minutes per test

  beforeAll(async () => {
    // Wait for Redis
    await waitForAllServices({
      redis: true,
    });

    // Initialize test context
    testContext = await initTestContext({
      redis: true,
      queues: true,
    });

    // Create test queues
    testQueues = createAllTestQueues(testContext.bullmqConnection);

    // Create test directory
    testDir = `/tmp/system-schedule-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  }, 60000);

  afterAll(async () => {
    // Cleanup queues - but don't quit the shared connection
    // since it's shared with testContext
    if (testQueues) {
      try {
        await testQueues.backup.pause();
        await testQueues.prune.pause();
        await testQueues.scheduled.pause();
        await testQueues.healthCheck.pause();
        await testQueues.failover.pause();
        await testQueues.backup.obliterate({ force: true });
        await testQueues.prune.obliterate({ force: true });
        await testQueues.scheduled.obliterate({ force: true });
        await testQueues.healthCheck.obliterate({ force: true });
        await testQueues.failover.obliterate({ force: true });
        await testQueues.backup.close();
        await testQueues.prune.close();
        await testQueues.scheduled.close();
        await testQueues.healthCheck.close();
        await testQueues.failover.close();
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Cleanup test context (this will close the connection)
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  beforeEach(async () => {
    // Clear all repeatable jobs before each test
    await removeAllRepeatableJobs(testQueues.scheduled);
    await testQueues.scheduled.pause();
    await testQueues.scheduled.obliterate({ force: true });
    await testQueues.scheduled.resume();
  });

  afterEach(async () => {
    // Stop worker if running
    if (worker) {
      await worker.stop();
      worker = undefined as unknown as TestWorker;
    }

    // Clear repeatable jobs
    await removeAllRepeatableJobs(testQueues.scheduled);
  });

  describe("Repeatable Job Creation", () => {
    it("creates a repeatable job with cron pattern", async () => {
      const jobName = `scheduled-backup-${generateTestId("job")}`;
      const cronPattern = "*/5 * * * *"; // Every 5 minutes

      await createRepeatableJob(testQueues.scheduled, jobName, {
        type: "backup",
        storageName: "test-storage",
        repoName: "test-repo",
        sourcePath: testDir,
      }, cronPattern);

      // Verify repeatable job exists
      const repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(1);
      expect(repeatables[0].name).toBe(jobName);
      expect(repeatables[0].cron).toBe(cronPattern);
    }, TEST_TIMEOUT);

    it("creates multiple repeatable jobs with different schedules", async () => {
      const jobs = [
        { name: `hourly-${generateTestId("job")}`, cron: "0 * * * *" },
        { name: `daily-${generateTestId("job")}`, cron: "0 0 * * *" },
        { name: `weekly-${generateTestId("job")}`, cron: "0 0 * * 0" },
      ];

      for (const { name, cron } of jobs) {
        await createRepeatableJob(testQueues.scheduled, name, {
          type: "backup",
          storageName: "test-storage",
        }, cron);
      }

      const repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(3);

      // Verify all jobs exist with correct cron patterns
      for (const { name, cron } of jobs) {
        const job = repeatables.find((r) => r.name === name);
        expect(job).toBeDefined();
        expect(job?.cron).toBe(cron);
      }
    }, TEST_TIMEOUT);

    it("updates existing repeatable job when re-added", async () => {
      const jobName = `updatable-${generateTestId("job")}`;
      const initialCron = "*/10 * * * *";
      const updatedCron = "*/15 * * * *";

      // Create initial job
      await createRepeatableJob(testQueues.scheduled, jobName, {
        version: 1,
      }, initialCron);

      // Remove and re-add with new pattern
      await removeRepeatableJob(testQueues.scheduled, jobName, initialCron);
      await createRepeatableJob(testQueues.scheduled, jobName, {
        version: 2,
      }, updatedCron);

      const repeatables = await getRepeatableJobs(testQueues.scheduled);
      const job = repeatables.find((r) => r.name === jobName);
      expect(job).toBeDefined();
      expect(job?.cron).toBe(updatedCron);
    }, TEST_TIMEOUT);
  });

  describe("Repeatable Job Removal", () => {
    it("removes a specific repeatable job", async () => {
      const jobName = `removable-${generateTestId("job")}`;
      const cronPattern = "*/5 * * * *";

      await createRepeatableJob(testQueues.scheduled, jobName, {}, cronPattern);

      // Verify job exists
      let repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(1);

      // Remove job
      const removed = await removeRepeatableJob(testQueues.scheduled, jobName, cronPattern);
      expect(removed).toBe(true);

      // Verify job is gone
      repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(0);
    }, TEST_TIMEOUT);

    it("removes all repeatable jobs", async () => {
      // Create multiple jobs
      for (let i = 0; i < 5; i++) {
        await createRepeatableJob(
          testQueues.scheduled,
          `batch-${i}-${generateTestId("job")}`,
          {},
          `*/${i + 1} * * * *`
        );
      }

      // Verify all exist
      let repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(5);

      // Remove all
      await removeAllRepeatableJobs(testQueues.scheduled);

      // Verify all gone
      repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe("Schedule Execution", () => {
    it("executes scheduled job at specified interval", async () => {
      const jobName = `fast-schedule-${generateTestId("job")}`;
      const executedJobs: string[] = [];

      // Create worker that tracks executions
      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async (job) => {
          executedJobs.push(job.id!);
          return { executed: true };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      // Create job that runs every second (for testing)
      await createRepeatableJob(testQueues.scheduled, jobName, {
        testData: true,
      }, "* * * * * *"); // Every second (cron with seconds)

      // Wait for at least 2 executions (allow extra buffer for BullMQ scheduler startup)
      await sleep(4500);

      // Should have executed at least twice
      expect(executedJobs.length).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);

    it("maintains job data across scheduled executions", async () => {
      const jobName = `data-persist-${generateTestId("job")}`;
      const jobDataArray: Record<string, unknown>[] = [];

      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async (job) => {
          jobDataArray.push(job.data);
          return { executed: true };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      const expectedData = {
        storageName: "test-storage",
        repoName: "test-repo",
        customField: "persistent-value",
      };

      await createRepeatableJob(testQueues.scheduled, jobName, expectedData, "* * * * * *");

      // Wait for executions (allow extra buffer for BullMQ scheduler startup)
      await sleep(4500);

      // Verify data was consistent across executions
      expect(jobDataArray.length).toBeGreaterThanOrEqual(2);
      for (const data of jobDataArray) {
        expect(data.storageName).toBe(expectedData.storageName);
        expect(data.repoName).toBe(expectedData.repoName);
        expect(data.customField).toBe(expectedData.customField);
      }
    }, TEST_TIMEOUT);
  });

  describe("Schedule State Management", () => {
    it("tracks next execution time", async () => {
      const jobName = `next-run-${generateTestId("job")}`;
      const cronPattern = "*/5 * * * *"; // Every 5 minutes

      await createRepeatableJob(testQueues.scheduled, jobName, {}, cronPattern);

      // Get delayed jobs (next scheduled runs)
      const delayedJobs = await testQueues.scheduled.getDelayed();

      // Should have a delayed job waiting
      expect(delayedJobs.length).toBeGreaterThanOrEqual(1);
    }, TEST_TIMEOUT);

    it("handles pause and resume of scheduled queue", async () => {
      const jobName = `pausable-${generateTestId("job")}`;
      const executedJobs: string[] = [];

      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async (job) => {
          executedJobs.push(job.id!);
          return { executed: true };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      await createRepeatableJob(testQueues.scheduled, jobName, {}, "* * * * * *");

      // Let it run briefly
      await sleep(1500);
      const countBeforePause = executedJobs.length;
      expect(countBeforePause).toBeGreaterThanOrEqual(1);

      // Pause queue
      await testQueues.scheduled.pause();

      // Wait
      await sleep(1500);

      // Should not have processed more jobs
      const countAfterPause = executedJobs.length;
      expect(countAfterPause).toBe(countBeforePause);

      // Resume
      await testQueues.scheduled.resume();

      // Wait for more executions
      await sleep(1500);

      // Should have processed more jobs
      expect(executedJobs.length).toBeGreaterThan(countAfterPause);
    }, TEST_TIMEOUT);
  });

  describe("Job History and Retention", () => {
    it("tracks completed scheduled jobs", async () => {
      const jobName = `history-${generateTestId("job")}`;

      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async () => ({ success: true }),
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      await createRepeatableJob(testQueues.scheduled, jobName, {}, "* * * * * *");

      // Wait for executions (allow extra buffer for BullMQ scheduler startup)
      await sleep(5000);

      // Check completed jobs
      const completedJobs = await testQueues.scheduled.getCompleted();
      expect(completedJobs.length).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);

    it("tracks failed scheduled jobs separately", async () => {
      const jobName = `failing-schedule-${generateTestId("job")}`;
      let failCount = 0;

      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async () => {
          failCount++;
          if (failCount <= 2) {
            throw new Error("Simulated failure");
          }
          return { success: true };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      await createRepeatableJob(testQueues.scheduled, jobName, {}, "* * * * * *");

      // Wait for executions
      await sleep(3500);

      // Should have some failed and some completed
      const failedJobs = await testQueues.scheduled.getFailed();
      expect(failedJobs.length).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);
  });

  describe("Cron Pattern Validation", () => {
    it("accepts valid cron patterns", async () => {
      const validPatterns = [
        { name: "every-minute", cron: "* * * * *" },
        { name: "hourly", cron: "0 * * * *" },
        { name: "daily-midnight", cron: "0 0 * * *" },
        { name: "weekly-sunday", cron: "0 0 * * 0" },
        { name: "monthly-first", cron: "0 0 1 * *" },
        { name: "every-5-min", cron: "*/5 * * * *" },
        { name: "workdays-9am", cron: "0 9 * * 1-5" },
      ];

      for (const { name, cron } of validPatterns) {
        const fullName = `${name}-${generateTestId("job")}`;
        await createRepeatableJob(testQueues.scheduled, fullName, {}, cron);
      }

      const repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(validPatterns.length);
    }, TEST_TIMEOUT);
  });

  describe("Multi-Schedule Coordination", () => {
    it("runs multiple schedules concurrently without interference", async () => {
      const scheduleResults: Record<string, number> = {};

      const { Worker } = await import("bullmq");
      const scheduleWorker = new Worker(
        QUEUES.BACKUP_SCHEDULED,
        async (job) => {
          const key = job.name;
          scheduleResults[key] = (scheduleResults[key] || 0) + 1;
          return { success: true };
        },
        {
          connection: testContext.bullmqConnection,
        }
      );

      worker = {
        worker: scheduleWorker,
        processedJobs: [],
        failedJobs: [],
        async stop() {
          await scheduleWorker.close();
        },
      };

      // Create multiple schedules
      const schedule1 = `concurrent-1-${generateTestId("job")}`;
      const schedule2 = `concurrent-2-${generateTestId("job")}`;

      await createRepeatableJob(testQueues.scheduled, schedule1, {}, "* * * * * *");
      await createRepeatableJob(testQueues.scheduled, schedule2, {}, "* * * * * *");

      // Wait for executions (allow extra buffer for BullMQ scheduler startup)
      await sleep(4500);

      // Both schedules should have executed
      expect(scheduleResults[schedule1]).toBeGreaterThanOrEqual(2);
      expect(scheduleResults[schedule2]).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);
  });

  describe("Schedule Persistence", () => {
    it("persists schedules across queue recreation", async () => {
      const jobName = `persistent-${generateTestId("job")}`;

      // Create schedule
      await createRepeatableJob(testQueues.scheduled, jobName, {
        persistent: true,
      }, "*/5 * * * *");

      // Verify it exists
      let repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(1);

      // Close and recreate queue (simulates restart)
      await testQueues.scheduled.close();

      const { Queue } = await import("bullmq");
      testQueues.scheduled = new Queue(QUEUES.BACKUP_SCHEDULED, {
        connection: testContext.bullmqConnection,
      });

      // Schedule should still exist
      repeatables = await getRepeatableJobs(testQueues.scheduled);
      expect(repeatables.length).toBe(1);
      expect(repeatables[0].name).toBe(jobName);
    }, TEST_TIMEOUT);
  });
});
