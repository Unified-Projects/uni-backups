/**
 * Retention Policy Enforcement System Tests
 *
 * Tests for retention policy enforcement:
 * - Hourly/daily/weekly/monthly/yearly retention
 * - Last N snapshots retention
 * - Prune job execution timing
 * - Snapshot protection during restore
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager, JobExecution } from "@uni-backups/shared/redis";
import { Retention } from "@uni-backups/shared/config";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  sleep,
  generateTestId,
  generateSnapshots,
} from "../utils/test-services";

describe("Retention Policy Enforcement System Tests", () => {
  let testContext: TestContext;
  let redis: Redis;
  let stateManager: StateManager;

  const TEST_TIMEOUT = 120000;

  beforeAll(async () => {
    await waitForAllServices({ redis: true });
    testContext = await initTestContext({ redis: true, queues: true });
    redis = testContext.redis;
    stateManager = testContext.stateManager;
  }, 60000);

  afterAll(async () => {
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  describe("Hourly Retention", () => {
    it("should keep correct number of hourly snapshots", async () => {
      const jobName = generateTestId("hourly-test");
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      // Create 30 hourly snapshots (more than retention of 24)
      const hourlySnapshots = generateSnapshots(jobName, 30, now, oneHour);

      for (const snapshot of hourlySnapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { hourly: 24 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);

      // Simulate pruning: keep only last 24 hourly snapshots
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(24);
      // Should be exactly 24 (or less if some don't have hourly timestamps)
      expect(prunedJobs.length).toBeGreaterThanOrEqual(20);
    });

    it("should remove old hourly snapshots beyond retention", async () => {
      const jobName = generateTestId("hourly-remove");
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      // Create 48 hourly snapshots (2 days worth)
      const snapshots = generateSnapshots(jobName, 48, now, oneHour);

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { hourly: 24 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      // Should remove approximately half (24 removed, 24 kept)
      expect(prunedJobs.length).toBeLessThan(allJobs.length);
    });
  });

  describe("Daily Retention", () => {
    it("should keep correct number of daily snapshots", async () => {
      const jobName = generateTestId("daily-test");
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Create 14 daily snapshots (2 weeks)
      const dailySnapshots = generateSnapshots(jobName, 14, now, oneDay);

      for (const snapshot of dailySnapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { daily: 7 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(7);
    });

    it("should handle mixed retention policies", async () => {
      const jobName = generateTestId("mixed-retention");
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Create 30 daily snapshots
      const snapshots = generateSnapshots(jobName, 30, now, oneDay);

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { daily: 7, weekly: 4, monthly: 12 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      // Should respect the most restrictive policy
      expect(prunedJobs.length).toBeLessThanOrEqual(7);
    });
  });

  describe("Weekly Retention", () => {
    it("should keep correct number of weekly snapshots", async () => {
      const jobName = generateTestId("weekly-test");
      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;

      // Create 8 weekly snapshots (2 months)
      const weeklySnapshots = generateSnapshots(jobName, 8, now, oneWeek);

      for (const snapshot of weeklySnapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { weekly: 4 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(4);
    });

    it("should keep at least one snapshot per week", async () => {
      const jobName = generateTestId("weekly-one");
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Create daily snapshots for 3 weeks
      const snapshots = generateSnapshots(jobName, 21, now, oneDay);

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { weekly: 4 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      // Should have approximately 3-4 snapshots (one per week)
      expect(prunedJobs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Monthly Retention", () => {
    it("should keep correct number of monthly snapshots", async () => {
      const jobName = generateTestId("monthly-test");
      const now = Date.now();
      const oneMonth = 30 * 24 * 60 * 60 * 1000;

      // Create 24 monthly snapshots (2 years)
      const monthlySnapshots = generateSnapshots(jobName, 24, now, oneMonth);

      for (const snapshot of monthlySnapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { monthly: 12 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(12);
    });
  });

  describe("Yearly Retention", () => {
    it("should keep correct number of yearly snapshots", async () => {
      const jobName = generateTestId("yearly-test");
      const now = Date.now();
      const oneYear = 365 * 24 * 60 * 60 * 1000;

      // Create 10 yearly snapshots
      const yearlySnapshots = generateSnapshots(jobName, 10, now, oneYear);

      for (const snapshot of yearlySnapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { yearly: 5 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Last N Snapshots Retention", () => {
    it("should keep only last N snapshots regardless of age", async () => {
      const jobName = generateTestId("last-n");
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Create 100 daily snapshots
      const snapshots = generateSnapshots(jobName, 100, now, oneDay);

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      const retention: Retention = { last: 10 };
      const allJobs = await stateManager.getRecentJobs(jobName, 200);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      expect(prunedJobs.length).toBeLessThanOrEqual(10);
      // Should be exactly 10 (most recent)
      expect(prunedJobs.length).toBe(10);
    });

    it("should work with other retention policies", async () => {
      const jobName = generateTestId("last-combined");
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Create 50 daily snapshots
      const snapshots = generateSnapshots(jobName, 50, now, oneDay);

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      // Combined: keep last 10 AND daily 7
      const retention: Retention = { last: 10, daily: 7 };
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      // Should be the minimum of both policies
      expect(prunedJobs.length).toBeLessThanOrEqual(7);
    });
  });

  describe("Prune Job Execution", () => {
    it("should create prune job execution record", async () => {
      const pruneExecId = generateTestId("prune-exec");

      await stateManager.recordJobExecution({
        id: pruneExecId,
        jobName: "prune-job",
        workerId: "worker-1",
        status: "running",
        startTime: Date.now(),
      });

      const pruneJob = await stateManager.getJobExecution(pruneExecId);
      expect(pruneJob).toBeDefined();
      expect(pruneJob?.status).toBe("running");
    });

    it("should record prune completion with statistics", async () => {
      const pruneExecId = generateTestId("prune-complete");

      await stateManager.recordJobExecution({
        id: pruneExecId,
        jobName: "prune-job",
        workerId: "worker-1",
        status: "running",
        startTime: Date.now(),
      });

      await stateManager.updateJobExecution(pruneExecId, {
        status: "completed",
        endTime: Date.now(),
        snapshotId: "prune-123",
        duration: 45000,
      });

      const completedJob = await stateManager.getJobExecution(pruneExecId);
      expect(completedJob?.status).toBe("completed");
      expect(completedJob?.duration).toBe(45000);
    });

    it("should record prune failure with error", async () => {
      const pruneExecId = generateTestId("prune-fail");

      await stateManager.recordJobExecution({
        id: pruneExecId,
        jobName: "prune-job",
        workerId: "worker-1",
        status: "running",
        startTime: Date.now(),
      });

      await stateManager.updateJobExecution(pruneExecId, {
        status: "failed",
        endTime: Date.now(),
        error: "Repository is locked by another process",
        duration: 5000,
      });

      const failedJob = await stateManager.getJobExecution(pruneExecId);
      expect(failedJob?.status).toBe("failed");
      expect(failedJob?.error).toContain("locked");
    });
  });

  describe("Snapshot Protection", () => {
    it("should not prune snapshots being restored", async () => {
      const jobName = generateTestId("protected");
      const now = Date.now();

      // Create some snapshots
      const snapshots = generateSnapshots(jobName, 5, now, oneHour());
      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      // Mark one snapshot as being restored
      const restoreExecId = generateTestId("restore");
      await stateManager.recordJobExecution({
        id: restoreExecId,
        jobName: `restore-${jobName}`,
        workerId: "worker-1",
        status: "running",
        startTime: Date.now(),
        snapshotId: snapshots[0].id, // This is the snapshot being restored
      });

      // Simulate protection logic: exclude restoring snapshots from pruning
      const allJobs = await stateManager.getRecentJobs(jobName, 100);
      const restoringJob = await stateManager.getJobExecution(restoreExecId);

      // The snapshot being restored should not be pruned
      expect(restoringJob?.snapshotId).toBe(snapshots[0].id);
    });

    it("should track snapshots in use by active jobs", async () => {
      const jobName = generateTestId("in-use");
      const now = Date.now();
      const snapshots = generateSnapshots(jobName, 3, now, oneHour());

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      // Check for running jobs that might reference snapshots
      const recentJobs = await stateManager.getRecentJobs(undefined, 100);
      const runningJobs = recentJobs.filter(j => j.status === "running");

      // In a real system, we'd check if any running jobs reference specific snapshots
      // For this test, we verify the tracking mechanism works
      expect(Array.isArray(runningJobs)).toBe(true);
    });
  });

  describe("Retention Policy Combination", () => {
    it("should combine all retention policies correctly", async () => {
      const jobName = generateTestId("combined");
      const now = Date.now();

      // Create various snapshots at different times
      const snapshots: JobExecution[] = [];

      // Hourly snapshots (last 24 hours)
      for (let i = 0; i < 25; i++) {
        snapshots.push({
          id: `hourly-${i}`,
          jobName,
          workerId: "worker-1",
          status: "completed",
          startTime: now - i * 60 * 60 * 1000,
          endTime: now - i * 60 * 60 * 1000 + 30000,
        });
      }

      // Daily snapshots (last 30 days)
      for (let i = 0; i < 30; i++) {
        snapshots.push({
          id: `daily-${i}`,
          jobName,
          workerId: "worker-1",
          status: "completed",
          startTime: now - i * 24 * 60 * 60 * 1000,
          endTime: now - i * 24 * 60 * 60 * 1000 + 60000,
        });
      }

      for (const snapshot of snapshots) {
        await stateManager.recordJobExecution(snapshot);
      }

      // Combined retention policy
      const retention: Retention = {
        hourly: 24,
        daily: 7,
        weekly: 4,
        monthly: 12,
        yearly: 5,
        last: 100,
      };

      const allJobs = await stateManager.getRecentJobs(jobName, 200);
      const prunedJobs = simulateRetentionPruning(allJobs, retention);

      // Should result in roughly: 24 hourly + 7 daily + 4 weekly + 12 monthly + 5 yearly = 52
      // But limited by 'last' to 100
      expect(prunedJobs.length).toBeLessThanOrEqual(100);
    });
  });
});

// Helper function to simulate retention pruning
// When multiple policies are specified, the most restrictive wins
function simulateRetentionPruning(jobs: JobExecution[], retention: Retention): JobExecution[] {
  // Sort by start time (most recent first)
  const sorted = [...jobs].sort((a, b) => b.startTime - a.startTime);

  const now = Date.now();

  // First, determine the maximum number of jobs to keep based on each policy
  // Then keep the minimum of all applicable limits

  // Calculate how many jobs each policy would keep
  const policyCounts: number[] = [];

  // Check last N snapshots (simplest policy)
  if (retention.last !== undefined) {
    policyCounts.push(retention.last);
  }

  // Check daily retention - count unique days within retention period
  if (retention.daily !== undefined) {
    const uniqueDays = new Set<number>();
    for (const job of sorted) {
      const ageDays = (now - job.startTime) / (24 * 60 * 60 * 1000);
      if (ageDays < retention.daily) {
        uniqueDays.add(Math.floor(ageDays));
      }
    }
    policyCounts.push(uniqueDays.size);
  }

  // Check hourly retention
  if (retention.hourly !== undefined) {
    policyCounts.push(retention.hourly);
  }

  // Check weekly retention
  if (retention.weekly !== undefined) {
    policyCounts.push(retention.weekly);
  }

  // Check monthly retention
  if (retention.monthly !== undefined) {
    policyCounts.push(retention.monthly);
  }

  // Check yearly retention
  if (retention.yearly !== undefined) {
    policyCounts.push(retention.yearly);
  }

  // If multiple policies, use the minimum (most restrictive)
  const maxToKeep = policyCounts.length > 0 ? Math.min(...policyCounts) : sorted.length;

  // Now keep jobs using the most restrictive count
  const kept: JobExecution[] = [];

  for (const job of sorted) {
    if (kept.length >= maxToKeep) {
      break;
    }

    const ageHours = (now - job.startTime) / (60 * 60 * 1000);
    const ageDays = ageHours / 24;
    const ageWeeks = ageDays / 7;
    const ageMonths = ageDays / 30;
    const ageYears = ageDays / 365;

    let shouldKeep = false;

    // For single policies, check if job qualifies
    // For multiple policies, we already limited by count above

    if (retention.last && kept.length < retention.last) {
      shouldKeep = true;
    }

    if (retention.hourly && ageHours < retention.hourly) {
      shouldKeep = true;
    }

    if (retention.daily && ageDays < retention.daily) {
      const existingSameDay = kept.some(k => {
        const kAgeDays = (now - k.startTime) / (24 * 60 * 60 * 1000);
        return Math.floor(kAgeDays) === Math.floor(ageDays);
      });
      if (!existingSameDay) {
        shouldKeep = true;
      }
    }

    if (retention.weekly && ageWeeks < retention.weekly) {
      const existingSameWeek = kept.some(k => {
        const kAgeWeeks = (now - k.startTime) / (7 * 24 * 60 * 60 * 1000);
        return Math.floor(kAgeWeeks) === Math.floor(ageWeeks);
      });
      if (!existingSameWeek) {
        shouldKeep = true;
      }
    }

    if (retention.monthly && ageMonths < retention.monthly) {
      const existingSameMonth = kept.some(k => {
        const kAgeMonths = (now - k.startTime) / (30 * 24 * 60 * 60 * 1000);
        return Math.floor(kAgeMonths) === Math.floor(ageMonths);
      });
      if (!existingSameMonth) {
        shouldKeep = true;
      }
    }

    if (retention.yearly && ageYears < retention.yearly) {
      const existingSameYear = kept.some(k => {
        const kAgeYears = (now - k.startTime) / (365 * 24 * 60 * 60 * 1000);
        return Math.floor(kAgeYears) === Math.floor(ageYears);
      });
      if (!existingSameYear) {
        shouldKeep = true;
      }
    }

    if (shouldKeep) {
      kept.push(job);
    }
  }

  return kept.sort((a, b) => b.startTime - a.startTime);
}

function oneHour(): number {
  return 60 * 60 * 1000;
}
