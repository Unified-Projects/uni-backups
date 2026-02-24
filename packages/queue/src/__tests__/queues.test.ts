import { describe, it, expect } from "vitest";
import { QUEUES, QUEUE_CONFIG, getQueueConfig, JOB_PRIORITY } from "../queues";

describe("queue definitions", () => {
  describe("QUEUES constants", () => {
    it("uses queue names compatible with BullMQ", () => {
      Object.values(QUEUES).forEach((name) => {
        expect(name).not.toContain(":");
        expect(name).not.toContain(" ");
      });
    });

    it("defines all expected queue names", () => {
      expect(QUEUES.BACKUP_JOBS).toBe("backup-jobs");
      expect(QUEUES.BACKUP_SCHEDULED).toBe("backup-scheduled");
      expect(QUEUES.PRUNE_JOBS).toBe("prune-jobs");
      expect(QUEUES.HEALTH_CHECKS).toBe("health-checks");
      expect(QUEUES.FAILOVER).toBe("failover-jobs");
    });

    it("has exactly 6 queue types", () => {
      expect(Object.keys(QUEUES)).toHaveLength(6);
    });

    it("uses kebab-case naming convention", () => {
      Object.values(QUEUES).forEach((name) => {
        expect(name).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
      });
    });
  });

  describe("JOB_PRIORITY constants", () => {
    it("defines priority levels in correct order", () => {
      expect(JOB_PRIORITY.CRITICAL).toBeLessThan(JOB_PRIORITY.HIGH);
      expect(JOB_PRIORITY.HIGH).toBeLessThan(JOB_PRIORITY.NORMAL);
      expect(JOB_PRIORITY.NORMAL).toBeLessThan(JOB_PRIORITY.LOW);
    });

    it("has expected priority values", () => {
      expect(JOB_PRIORITY.CRITICAL).toBe(1);
      expect(JOB_PRIORITY.HIGH).toBe(5);
      expect(JOB_PRIORITY.NORMAL).toBe(10);
      expect(JOB_PRIORITY.LOW).toBe(20);
    });

    it("has exactly 4 priority levels", () => {
      expect(Object.keys(JOB_PRIORITY)).toHaveLength(4);
    });

    it("uses positive integer values", () => {
      Object.values(JOB_PRIORITY).forEach((priority) => {
        expect(priority).toBeGreaterThan(0);
        expect(Number.isInteger(priority)).toBe(true);
      });
    });
  });

  describe("QUEUE_CONFIG", () => {
    it("exposes default job options for known queues", () => {
      Object.values(QUEUES).forEach((queueName) => {
        const config = getQueueConfig(queueName);
        expect(config).toBeDefined();
        expect(config).not.toEqual({});
      });
    });

    it("returns empty config for unknown queue", () => {
      expect(QUEUE_CONFIG["non-existent"]).toBeUndefined();
      expect(getQueueConfig("non-existent" as any)).toEqual({});
    });

    describe("BACKUP_JOBS queue config", () => {
      it("has 3 retry attempts", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_JOBS];
        expect(config.defaultJobOptions.attempts).toBe(3);
      });

      it("uses exponential backoff with 30s initial delay", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_JOBS];
        expect(config.defaultJobOptions.backoff).toEqual({
          type: "exponential",
          delay: 30000,
        });
      });

      it("keeps completed jobs for 7 days or 1000 count", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_JOBS];
        expect(config.defaultJobOptions.removeOnComplete).toEqual({
          age: 7 * 24 * 60 * 60,
          count: 1000,
        });
      });

      it("keeps failed jobs for 30 days or 5000 count", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_JOBS];
        expect(config.defaultJobOptions.removeOnFail).toEqual({
          age: 30 * 24 * 60 * 60,
          count: 5000,
        });
      });
    });

    describe("BACKUP_SCHEDULED queue config", () => {
      it("has 1 attempt (no retries)", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_SCHEDULED];
        expect(config.defaultJobOptions.attempts).toBe(1);
      });

      it("keeps completed jobs for 1 day", () => {
        const config = QUEUE_CONFIG[QUEUES.BACKUP_SCHEDULED];
        expect(config.defaultJobOptions.removeOnComplete).toEqual({
          age: 24 * 60 * 60,
          count: 100,
        });
      });
    });

    describe("PRUNE_JOBS queue config", () => {
      it("has 2 retry attempts", () => {
        const config = QUEUE_CONFIG[QUEUES.PRUNE_JOBS];
        expect(config.defaultJobOptions.attempts).toBe(2);
      });

      it("uses fixed backoff with 1 minute delay", () => {
        const config = QUEUE_CONFIG[QUEUES.PRUNE_JOBS];
        expect(config.defaultJobOptions.backoff).toEqual({
          type: "fixed",
          delay: 60000,
        });
      });
    });

    describe("HEALTH_CHECKS queue config", () => {
      it("has 1 attempt (no retries)", () => {
        const config = QUEUE_CONFIG[QUEUES.HEALTH_CHECKS];
        expect(config.defaultJobOptions.attempts).toBe(1);
      });

      it("removes completed jobs immediately", () => {
        const config = QUEUE_CONFIG[QUEUES.HEALTH_CHECKS];
        expect(config.defaultJobOptions.removeOnComplete).toBe(true);
      });

      it("keeps failed health checks for 1 hour", () => {
        const config = QUEUE_CONFIG[QUEUES.HEALTH_CHECKS];
        expect(config.defaultJobOptions.removeOnFail).toEqual({
          age: 60 * 60,
          count: 100,
        });
      });
    });

    describe("FAILOVER queue config", () => {
      it("has 3 retry attempts", () => {
        const config = QUEUE_CONFIG[QUEUES.FAILOVER];
        expect(config.defaultJobOptions.attempts).toBe(3);
      });

      it("uses fixed backoff with 5 second delay", () => {
        const config = QUEUE_CONFIG[QUEUES.FAILOVER];
        expect(config.defaultJobOptions.backoff).toEqual({
          type: "fixed",
          delay: 5000,
        });
      });

      it("keeps completed/failed jobs for 30 days", () => {
        const config = QUEUE_CONFIG[QUEUES.FAILOVER];
        expect(config.defaultJobOptions.removeOnComplete).toEqual({
          age: 30 * 24 * 60 * 60,
          count: 100,
        });
        expect(config.defaultJobOptions.removeOnFail).toEqual({
          age: 30 * 24 * 60 * 60,
          count: 100,
        });
      });
    });
  });

  describe("getQueueConfig function", () => {
    it("returns config for all defined queues", () => {
      Object.values(QUEUES).forEach((queueName) => {
        const config = getQueueConfig(queueName);
        expect(config).toBeDefined();
        expect(typeof config).toBe("object");
      });
    });

    it("returns same config as direct QUEUE_CONFIG access", () => {
      Object.values(QUEUES).forEach((queueName) => {
        const viaFunction = getQueueConfig(queueName);
        const viaDirect = QUEUE_CONFIG[queueName].defaultJobOptions;
        expect(viaFunction).toEqual(viaDirect);
      });
    });

    it("handles null/undefined gracefully", () => {
      expect(getQueueConfig(null as any)).toEqual({});
      expect(getQueueConfig(undefined as any)).toEqual({});
    });

    it("handles empty string gracefully", () => {
      expect(getQueueConfig("" as any)).toEqual({});
    });
  });
});
