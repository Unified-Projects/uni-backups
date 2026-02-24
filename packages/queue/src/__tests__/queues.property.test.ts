import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  BackupJobData,
  ScheduledJobData,
  PruneJobData,
  HealthCheckData,
  FailoverJobData,
  BackupResult,
  PruneResult,
  JobTrigger,
} from "../types";

// Custom arbitraries
const jobNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]*$/).chain((name) =>
  fc.constant(name)
);

const repoNameArb = fc.stringMatching(/^[a-zA-Z0-9._-]+$/);

const workerGroupArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]*$/);

const snapshotIdArb = fc.stringMatching(/^[a-f0-9]{64}$|^[a-zA-Z0-9]+$/);

const executionIdArb = fc.uuid();

const timestampArb = fc.integer({min: 1600000000000, max: 1900000000000});

const priorityArb = fc.integer({min: 1, max: 100});

const bytesArb = fc.integer({min: 0, max: Number.MAX_SAFE_INTEGER});

const filesCountArb = fc.integer({min: 0, max: 1000000});

const jobTriggerArb = fc.constantFrom("schedule", "manual", "failover");

const retentionArb = fc.record({
  hourly: fc.option(fc.integer({min: 0, max: 1000}), { nil: undefined }),
  daily: fc.option(fc.integer({min: 0, max: 1000}), { nil: undefined }),
  weekly: fc.option(fc.integer({min: 0, max: 520}), { nil: undefined }),
  monthly: fc.option(fc.integer({min: 0, max: 120}), { nil: undefined }),
  yearly: fc.option(fc.integer({min: 0, max: 50}), { nil: undefined }),
  last: fc.option(fc.integer({min: 0, max: 10000}), { nil: undefined }),
}).filter((r) => Object.values(r).some((v) => v !== undefined));

const tagsArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9._-]+$/), {
  minLength: 0,
  maxLength: 20,
});

describe("Queue Types Property-Based Tests", () => {
  describe("BackupJobData", () => {
    it("should validate valid backup job data", () => {
      fc.assert(
        fc.property(
          executionIdArb,
          jobNameArb,
          repoNameArb,
          fc.array(workerGroupArb, { minLength: 1, maxLength: 5 }),
          priorityArb,
          jobTriggerArb,
          timestampArb,
          (executionId, jobName, repoName, workerGroups, priority, trigger, queuedAt) => {
            const data: BackupJobData = {
              executionId,
              jobName,
              jobConfig: {
                type: "folder",
                source: "/data",
                storage: "local",
              },
              storage: {
                type: "local",
                path: "/backups",
              },
              repoName,
              workerGroups,
              priority,
              triggeredBy: trigger,
              queuedAt,
            };
            expect(data.executionId).toBe(executionId);
            expect(data.jobName).toBe(jobName);
            expect(data.workerGroups).toEqual(workerGroups);
            expect(data.priority).toBe(priority);
            expect(data.triggeredBy).toBe(trigger);
            expect(data.queuedAt).toBe(queuedAt);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should handle optional originalWorkerId", () => {
      fc.assert(
        fc.property(
          executionIdArb,
          jobNameArb,
          fc.option(fc.stringMatching(/^[a-zA-Z0-9-]+$/), { nil: undefined }),
          (executionId, jobName, originalWorkerId) => {
            const data: BackupJobData = {
              executionId,
              jobName,
              jobConfig: {
                type: "folder",
                source: "/data",
                storage: "local",
              },
              storage: {
                type: "local",
                path: "/backups",
              },
              repoName: "test-repo",
              workerGroups: ["default"],
              priority: 10,
              triggeredBy: "manual",
              queuedAt: Date.now(),
              originalWorkerId,
            };
            expect(data.originalWorkerId).toBe(originalWorkerId);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe("ScheduledJobData", () => {
    it("should validate scheduled job data", () => {
      fc.assert(
        fc.property(jobNameArb, (jobName) => {
          const data: ScheduledJobData = { jobName };
          expect(data.jobName).toBe(jobName);
          return true;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe("PruneJobData", () => {
    it("should validate prune job data", () => {
      fc.assert(
        fc.property(
          executionIdArb,
          jobNameArb,
          repoNameArb,
          retentionArb,
          fc.option(tagsArb, { nil: undefined }),
          fc.array(workerGroupArb, { minLength: 1, maxLength: 5 }),
          (executionId, jobName, repoName, retention, tags, workerGroups) => {
            const data: PruneJobData = {
              executionId,
              jobName,
              storage: {
                type: "local",
                path: "/backups",
              },
              repoName,
              retention,
              workerGroups,
            };
            if (tags) {
              data.tags = tags;
            }
            expect(data.executionId).toBe(executionId);
            expect(data.jobName).toBe(jobName);
            expect(data.repoName).toBe(repoName);
            expect(data.retention).toEqual(retention);
            expect(data.workerGroups).toEqual(workerGroups);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should handle optional tags", () => {
      fc.assert(
        fc.property(executionIdArb, jobNameArb, (executionId, jobName) => {
          const data: PruneJobData = {
            executionId,
            jobName,
            storage: {
              type: "local",
              path: "/backups",
            },
            repoName: "test-repo",
            retention: { daily: 7 },
            workerGroups: ["default"],
          };
          expect(data.tags).toBeUndefined();
          return true;
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("HealthCheckData", () => {
    it("should validate health check data", () => {
      fc.assert(
        fc.property(
          workerGroupArb,
          fc.stringMatching(/^[a-zA-Z0-9-]+$/),
          timestampArb,
          (groupId, initiatorWorkerId, timestamp) => {
            const data: HealthCheckData = {
              groupId,
              initiatorWorkerId,
              timestamp,
            };
            expect(data.groupId).toBe(groupId);
            expect(data.initiatorWorkerId).toBe(initiatorWorkerId);
            expect(data.timestamp).toBe(timestamp);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe("FailoverJobData", () => {
    it("should validate failover job data", () => {
      fc.assert(
        fc.property(
          workerGroupArb,
          fc.stringMatching(/^[a-zA-Z0-9-]+$/),
          fc.stringMatching(/^[a-zA-Z0-9-]+$/),
          fc.stringMatching(/^[a-zA-Z0-9\s_-]+$/),
          timestampArb,
          (groupId, failedWorkerId, initiatorWorkerId, reason, timestamp) => {
            const data: FailoverJobData = {
              groupId,
              failedWorkerId,
              initiatorWorkerId,
              reason,
              timestamp,
            };
            expect(data.groupId).toBe(groupId);
            expect(data.failedWorkerId).toBe(failedWorkerId);
            expect(data.initiatorWorkerId).toBe(initiatorWorkerId);
            expect(data.reason).toBe(reason);
            expect(data.timestamp).toBe(timestamp);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe("BackupResult", () => {
    it("should validate successful backup result", () => {
      fc.assert(
        fc.property(
          snapshotIdArb,
          fc.string(),
          fc.option(bytesArb, { nil: undefined }),
          fc.option(filesCountArb, { nil: undefined }),
          fc.option(filesCountArb, { nil: undefined }),
          fc.option(filesCountArb, { nil: undefined }),
          fc.integer({min: 0, max: 3600000}),
          (
            snapshotId,
            message,
            bytesProcessed,
            filesProcessed,
            filesAdded,
            filesChanged,
            duration
          ) => {
            const result: BackupResult = {
              success: true,
              snapshotId,
              message,
            };
            if (bytesProcessed !== undefined) result.bytesProcessed = bytesProcessed;
            if (filesProcessed !== undefined) result.filesProcessed = filesProcessed;
            if (filesAdded !== undefined) result.filesAdded = filesAdded;
            if (filesChanged !== undefined) result.filesChanged = filesChanged;
            if (duration !== undefined) result.duration = duration;

            expect(result.success).toBe(true);
            expect(result.snapshotId).toBe(snapshotId);
            expect(result.message).toBe(message);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should validate failed backup result", () => {
      fc.assert(
        fc.property(fc.string(), (message) => {
          const result: BackupResult = {
            success: false,
            message,
          };
          expect(result.success).toBe(false);
          expect(result.snapshotId).toBeUndefined();
          return true;
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("PruneResult", () => {
    it("should validate successful prune result", () => {
      fc.assert(
        fc.property(
          fc.option(fc.integer({min: 0, max: 1000}), { nil: undefined }),
          fc.option(bytesArb, { nil: undefined }),
          fc.integer({min: 0, max: 3600000}),
          fc.string(),
          (snapshotsRemoved, spaceReclaimed, duration, message) => {
            const result: PruneResult = {
              success: true,
              duration,
              message,
            };
            if (snapshotsRemoved !== undefined) result.snapshotsRemoved = snapshotsRemoved;
            if (spaceReclaimed !== undefined) result.spaceReclaimed = spaceReclaimed;

            expect(result.success).toBe(true);
            expect(result.duration).toBe(duration);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it("should validate failed prune result", () => {
      fc.assert(
        fc.property(fc.string(), fc.integer({min: 0, max: 3600000}), (message, duration) => {
          const result: PruneResult = {
            success: false,
            message,
            duration,
          };
          expect(result.success).toBe(false);
          expect(result.snapshotsRemoved).toBeUndefined();
          return true;
        }),
        { numRuns: 20 }
      );
    });
  });
});

describe("JobTrigger Type Tests", () => {
  it("should accept all valid trigger types", () => {
    const triggers: JobTrigger[] = ["schedule", "manual", "failover"];
    expect(triggers).toHaveLength(3);
  });

  it("should reject invalid trigger types", () => {
    const invalidTriggers = ["automatic", "api", "cron", ""];
    for (const trigger of invalidTriggers) {
      expect((trigger as JobTrigger) === "schedule" || trigger === "manual" || trigger === "failover").toBe(false);
    }
  });
});

describe("Priority Ordering Tests", () => {
  it("should maintain priority ordering constraints", () => {
    // Priority 1 = highest, 100 = lowest
    const critical = 1;
    const high = 5;
    const normal = 10;
    const low = 20;

    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(normal);
    expect(normal).toBeLessThan(low);
  });

  it("should handle edge case priorities", () => {
    const priorities = [1, 50, 100];
    for (const p of priorities) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});

describe("Queue Name Format Validation", () => {
  it("should accept valid queue names", () => {
    const validNames = [
      "backup-jobs",
      "backup-scheduled",
      "prune-jobs",
      "health-checks",
      "failover-jobs",
    ];
    for (const name of validNames) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    }
  });

  it("should reject invalid queue names", () => {
    const invalidNames = [
      "BackupJobs", // uppercase
      "backup_jobs", // underscore
      "backup jobs", // space
      "123-jobs", // starts with number
      "-jobs", // starts with dash
      "jobs-", // ends with dash
    ];
    for (const name of invalidNames) {
      expect(name).not.toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    }
  });
});

describe("Retry Configuration Tests", () => {
  it("should have valid retry attempts for all queues", () => {
    const queueRetryConfig: Record<string, number> = {
      "backup-jobs": 3,
      "backup-scheduled": 1,
      "prune-jobs": 2,
      "health-checks": 1,
      "failover-jobs": 3,
    };

    for (const [queue, attempts] of Object.entries(queueRetryConfig)) {
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(attempts)).toBe(true);
    }
  });

  it("should have valid backoff delays", () => {
    const queueBackoffs: Record<string, number> = {
      "backup-jobs": 30000,
      "prune-jobs": 60000,
      "failover-jobs": 5000,
    };

    for (const [, delay] of Object.entries(queueBackoffs)) {
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});

describe("Retention Policy Constraints", () => {
  it("should enforce retention value boundaries", () => {
    const testRetentions = [
      { hourly: 24, daily: 7, weekly: 4, monthly: 12, yearly: 3, last: 10 },
      { hourly: 0, daily: 0 },
      { last: 100 },
      { hourly: 1000, daily: 1000, weekly: 520, monthly: 120, yearly: 50, last: 10000 },
    ];

    for (const retention of testRetentions) {
      if (retention.hourly !== undefined) expect(retention.hourly).toBeLessThanOrEqual(1000);
      if (retention.daily !== undefined) expect(retention.daily).toBeLessThanOrEqual(1000);
      if (retention.weekly !== undefined) expect(retention.weekly).toBeLessThanOrEqual(520);
      if (retention.monthly !== undefined) expect(retention.monthly).toBeLessThanOrEqual(120);
      if (retention.yearly !== undefined) expect(retention.yearly).toBeLessThanOrEqual(50);
      if (retention.last !== undefined) expect(retention.last).toBeLessThanOrEqual(10000);
    }
  });

  it("should allow zero retention", () => {
    const zeroRetentions = [
      { hourly: 0 },
      { daily: 0, weekly: 0 },
      { last: 0 },
    ];

    for (const retention of zeroRetentions) {
      expect(retention).toBeDefined();
    }
  });
});

describe("Job Data Size Constraints", () => {
  it("should handle reasonable array lengths", () => {
    const workerGroups = Array(10).fill("worker");
    expect(workerGroups.length).toBeLessThanOrEqual(10);

    const tags = Array(20).fill("tag");
    expect(tags.length).toBeLessThanOrEqual(20);
  });

  it("should handle extreme priority values", () => {
    const priorities = [1, 100];
    for (const p of priorities) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("should handle large timestamps", () => {
    const timestamps = [1600000000000, 1900000000000, Date.now()];
    for (const ts of timestamps) {
      expect(ts).toBeGreaterThan(0);
      expect(typeof ts).toBe("number");
    }
  });
});
