/**
 * Job Processor Service Unit Tests
 *
 * Tests for backup and prune job processing functionality.
 * Uses mocks for BullMQ, Redis, StateManager, and restic operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Worker from bullmq
const mockBackupWorker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};

const mockPruneWorker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};

let backupProcessorFn: ((job: any) => Promise<any>) | null = null;
let pruneProcessorFn: ((job: any) => Promise<any>) | null = null;

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function (queueName: string, processorFn: (job: any) => Promise<any>) {
    if (queueName === "backup-jobs") {
      backupProcessorFn = processorFn;
      return mockBackupWorker;
    }
    pruneProcessorFn = processorFn;
    return mockPruneWorker;
  }),
  Job: vi.fn(),
}));

// Mock Redis modules
const mockRedis = {};
const mockStateManager = {
  recordJobExecution: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(() => mockRedis),
  getBullMQConnection: vi.fn(() => mockRedis),
  StateManager: vi.fn().mockImplementation(function () { return mockStateManager; }),
}));

// Mock config
vi.mock("@uni-backups/shared/config", () => ({
  getConfig: vi.fn(() => ({
    resticPassword: "test-password",
  })),
}));

// Mock restic service
vi.mock("../restic", () => ({
  initRepo: vi.fn().mockResolvedValue({ success: true, message: "OK" }),
  backup: vi.fn().mockResolvedValue({ success: true, message: "Backup completed", snapshotId: "snap123" }),
  prune: vi.fn().mockResolvedValue({ success: true, message: "Prune completed" }),
}));

// Mock database service
vi.mock("../database", () => ({
  runDatabaseBackup: vi.fn().mockResolvedValue({ success: true, message: "DB backup completed", snapshotId: "dbsnap123" }),
}));

import { JobProcessor } from "../processor";
import * as restic from "../restic";
import { runDatabaseBackup } from "../database";
import { getConfig } from "@uni-backups/shared/config";
import type { WorkerConfig } from "../../config";
import type { HeartbeatService } from "../heartbeat";
import type { BackupJobData, PruneJobData } from "@uni-backups/queue";

describe("JobProcessor", () => {
  let processor: JobProcessor;
  let workerConfig: WorkerConfig;
  let mockHeartbeatService: {
    jobStarted: ReturnType<typeof vi.fn>;
    jobCompleted: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    workerConfig = {
      id: "worker-1",
      name: "test-worker",
      hostname: "test-host.local",
      groups: ["group-1"],
      heartbeatInterval: 5000,
      heartbeatTimeout: 15000,
      concurrency: 2,
    };

    mockHeartbeatService = {
      jobStarted: vi.fn(),
      jobCompleted: vi.fn(),
    };

    processor = new JobProcessor(
      workerConfig,
      mockHeartbeatService as unknown as HeartbeatService,
      {
        stateManager: mockStateManager as any,
        bullmqConnection: mockRedis as any,
      }
    );

    // Reset processor functions
    backupProcessorFn = null;
    pruneProcessorFn = null;
  });

  afterEach(async () => {
    if (processor.isRunning()) {
      await processor.stop();
    }
  });

  describe("initialize()", () => {
    it("creates backup and prune workers", async () => {
      await processor.initialize();

      expect(processor.isRunning()).toBe(true);
      expect(backupProcessorFn).toBeDefined();
      expect(pruneProcessorFn).toBeDefined();
    });

    it("sets up event handlers for workers", async () => {
      await processor.initialize();

      expect(mockBackupWorker.on).toHaveBeenCalledWith("completed", expect.any(Function));
      expect(mockBackupWorker.on).toHaveBeenCalledWith("failed", expect.any(Function));
      expect(mockBackupWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockPruneWorker.on).toHaveBeenCalledWith("completed", expect.any(Function));
    });

    it("does not initialize twice", async () => {
      await processor.initialize();
      const firstBackupFn = backupProcessorFn;

      await processor.initialize();

      expect(backupProcessorFn).toBe(firstBackupFn);
    });
  });

  describe("stop()", () => {
    it("closes both workers", async () => {
      await processor.initialize();
      await processor.stop();

      expect(mockBackupWorker.close).toHaveBeenCalled();
      expect(mockPruneWorker.close).toHaveBeenCalled();
      expect(processor.isRunning()).toBe(false);
    });

    it("does nothing if not running", async () => {
      await processor.stop();

      expect(mockBackupWorker.close).not.toHaveBeenCalled();
    });
  });

  describe("pause()", () => {
    it("pauses both workers", async () => {
      await processor.initialize();
      await processor.pause();

      expect(mockBackupWorker.pause).toHaveBeenCalled();
      expect(mockPruneWorker.pause).toHaveBeenCalled();
    });
  });

  describe("resume()", () => {
    it("resumes both workers", async () => {
      await processor.initialize();
      await processor.resume();

      expect(mockBackupWorker.resume).toHaveBeenCalled();
      expect(mockPruneWorker.resume).toHaveBeenCalled();
    });
  });

  describe("processBackupJob()", () => {
    const localStorage = { type: "local" as const, path: "/backups" };

    beforeEach(async () => {
      await processor.initialize();
    });

    it("processes volume backup job successfully", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "volume-backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await backupProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
      expect(restic.backup).toHaveBeenCalledWith(
        localStorage,
        "volume-backup",
        "test-password",
        "/data",
        expect.any(Object)
      );
    });

    it("processes folder backup job successfully", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "folder-backup",
        jobConfig: {
          type: "folder",
          source: "/home/user",
          storage: "local",
          tags: ["daily"],
          exclude: ["*.tmp"],
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await backupProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(restic.backup).toHaveBeenCalledWith(
        localStorage,
        "folder-backup",
        "test-password",
        "/home/user",
        expect.objectContaining({
          tags: ["daily", "folder-backup"],
          exclude: ["*.tmp"],
        })
      );
    });

    it("processes postgres backup job successfully", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "postgres-backup",
        jobConfig: {
          type: "postgres",
          host: "localhost",
          port: 5432,
          user: "postgres",
          database: "mydb",
          storage: "local",
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await backupProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("dbsnap123");
      expect(runDatabaseBackup).toHaveBeenCalledWith(
        expect.objectContaining({ type: "postgres" }),
        "postgres-backup",
        localStorage,
        "postgres-backup",
        "test-password",
        expect.any(Function)
      );
    });

    it("processes mariadb backup job successfully", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "mariadb-backup",
        jobConfig: {
          type: "mariadb",
          host: "localhost",
          port: 3306,
          user: "root",
          database: "mydb",
          storage: "local",
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await backupProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(runDatabaseBackup).toHaveBeenCalledWith(
        expect.objectContaining({ type: "mariadb" }),
        "mariadb-backup",
        localStorage,
        "mariadb-backup",
        "test-password",
        expect.any(Function)
      );
    });

    it("processes redis backup job successfully", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "redis-backup",
        jobConfig: {
          type: "redis",
          host: "localhost",
          port: 6379,
          rdb_path: "/var/lib/redis/dump.rdb",
          storage: "local",
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await backupProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(runDatabaseBackup).toHaveBeenCalledWith(
        expect.objectContaining({ type: "redis" }),
        "redis-backup",
        localStorage,
        "redis-backup",
        "test-password",
        expect.any(Function)
      );
    });

    it("filters by worker group", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "volume-backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
          worker_group: "other-group",
        },
        storage: localStorage,
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      // Job processor throws an error when worker is not in the correct group
      await expect(backupProcessorFn!(mockJob)).rejects.toThrow("not in group");
      expect(restic.backup).not.toHaveBeenCalled();
    });

    it("marks job as started in heartbeat", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockHeartbeatService.jobStarted).toHaveBeenCalledWith("exec-1");
    });

    it("marks job as completed in heartbeat on success", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-1", true);
    });

    it("marks job as failed in heartbeat on failure", async () => {
      vi.mocked(restic.backup).mockResolvedValueOnce({
        success: false,
        message: "Backup failed",
      });

      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-1", false);
    });

    it("records job execution start and completion", async () => {
      // Capture the execution states at call time (objects are mutated in place)
      const capturedStates: string[] = [];
      mockStateManager.recordJobExecution.mockImplementation((execution: any) => {
        capturedStates.push(execution.status);
        return Promise.resolve(undefined);
      });

      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      // Should record both running (start) and completed states
      expect(capturedStates).toEqual(["running", "completed"]);
      expect(mockStateManager.recordJobExecution).toHaveBeenCalledTimes(2);
    });

    it("records successful execution completion", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockStateManager.recordJobExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: "exec-1",
          status: "completed",
          snapshotId: "snap123",
        })
      );
    });

    it("records failed execution", async () => {
      vi.mocked(restic.backup).mockResolvedValueOnce({
        success: false,
        message: "Storage full",
      });

      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockStateManager.recordJobExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: "exec-1",
          status: "failed",
          error: "Storage full",
        })
      );
    });

    it("runs prune after backup when retention configured", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
          retention: {
            last: 7,
            daily: 30,
          },
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(restic.prune).toHaveBeenCalledWith(
        localStorage,
        "backup",
        "test-password",
        { last: 7, daily: 30 },
        expect.objectContaining({ tags: ["backup"] })
      );
    });

    it("handles repo init failure", async () => {
      vi.mocked(restic.initRepo).mockResolvedValueOnce({
        success: false,
        message: "Permission denied",
      });

      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Permission denied");
    });

    it("handles missing restic password", async () => {
      vi.mocked(getConfig).mockReturnValueOnce({
        resticPassword: undefined,
      } as any);

      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toContain("not configured");
    });

    it("uses custom repo name when specified", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
          repo: "custom-repo-name",
        },
        storage: localStorage,
      };

      await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(restic.initRepo).toHaveBeenCalledWith(
        localStorage,
        "custom-repo-name",
        "test-password"
      );
      expect(restic.backup).toHaveBeenCalledWith(
        localStorage,
        "custom-repo-name",
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
    });

    it("returns duration in result", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-1",
        jobName: "backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("processPruneJob()", () => {
    const localStorage = { type: "local" as const, path: "/backups" };

    beforeEach(async () => {
      await processor.initialize();
    });

    it("processes prune job successfully", async () => {
      const jobData: PruneJobData = {
        executionId: "exec-1",
        jobName: "prune-job",
        storage: localStorage,
        repoName: "test-repo",
        retention: {
          last: 7,
          daily: 30,
        },
        tags: ["daily"],
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      const result = await pruneProcessorFn!(mockJob);

      expect(result.success).toBe(true);
      expect(restic.prune).toHaveBeenCalledWith(
        localStorage,
        "test-repo",
        "test-password",
        { last: 7, daily: 30 },
        expect.objectContaining({
          tags: ["daily"],
        })
      );
    });

    it("marks job in heartbeat", async () => {
      const jobData: PruneJobData = {
        executionId: "exec-1",
        jobName: "prune-job",
        storage: localStorage,
        repoName: "test-repo",
        retention: { last: 7 },
        tags: [],
      };

      await pruneProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(mockHeartbeatService.jobStarted).toHaveBeenCalledWith("exec-1");
      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-1", true);
    });

    it("handles prune failure", async () => {
      vi.mocked(restic.prune).mockResolvedValueOnce({
        success: false,
        message: "Lock timeout",
      });

      const jobData: PruneJobData = {
        executionId: "exec-1",
        jobName: "prune-job",
        storage: localStorage,
        repoName: "test-repo",
        retention: { last: 7 },
        tags: [],
      };

      const result = await pruneProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Lock timeout");
      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-1", false);
    });

    it("calls onProgress callback", async () => {
      const jobData: PruneJobData = {
        executionId: "exec-1",
        jobName: "prune-job",
        storage: localStorage,
        repoName: "test-repo",
        retention: { last: 7 },
        tags: [],
      };

      const mockJob = {
        data: jobData,
        updateProgress: vi.fn(),
      };

      await pruneProcessorFn!(mockJob);

      expect(restic.prune).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          onProgress: expect.any(Function),
        })
      );
    });
  });

  describe("isRunning()", () => {
    it("returns false before initialization", () => {
      expect(processor.isRunning()).toBe(false);
    });

    it("returns true after initialization", async () => {
      await processor.initialize();
      expect(processor.isRunning()).toBe(true);
    });

    it("returns false after stop", async () => {
      await processor.initialize();
      await processor.stop();
      expect(processor.isRunning()).toBe(false);
    });
  });

  describe("event handlers", () => {
    beforeEach(async () => {
      await processor.initialize();
    });

    it("completed handler logs job completion", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Find the completed handler that was registered on mockBackupWorker
      const completedCall = mockBackupWorker.on.mock.calls.find(
        (call: any[]) => call[0] === "completed"
      );
      expect(completedCall).toBeDefined();

      const completedHandler = completedCall![1];
      completedHandler({ id: "job-123" });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("job-123")
      );
      consoleSpy.mockRestore();
    });

    it("failed handler logs job failure with error", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const failedCall = mockBackupWorker.on.mock.calls.find(
        (call: any[]) => call[0] === "failed"
      );
      expect(failedCall).toBeDefined();

      const failedHandler = failedCall![1];
      const testError = new Error("Disk full");
      failedHandler({ id: "job-456" }, testError);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("job-456"),
        testError
      );
      consoleSpy.mockRestore();
    });

    it("error handler logs worker error", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const errorCall = mockBackupWorker.on.mock.calls.find(
        (call: any[]) => call[0] === "error"
      );
      expect(errorCall).toBeDefined();

      const errorHandler = errorCall![1];
      const testError = new Error("Connection lost");
      errorHandler(testError);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("worker error"),
        testError
      );
      consoleSpy.mockRestore();
    });

    it("prune worker also has event handlers registered", () => {
      expect(mockPruneWorker.on).toHaveBeenCalledWith("completed", expect.any(Function));
      expect(mockPruneWorker.on).toHaveBeenCalledWith("failed", expect.any(Function));
      expect(mockPruneWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  describe("exception handling", () => {
    const localStorage = { type: "local" as const, path: "/backups" };

    beforeEach(async () => {
      await processor.initialize();
    });

    it("handles thrown exception in backup processor", async () => {
      vi.mocked(restic.backup).mockRejectedValueOnce(new Error("Segfault"));

      const jobData: BackupJobData = {
        executionId: "exec-crash",
        jobName: "crashing-backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Segfault");
      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-crash", false);
      expect(mockStateManager.recordJobExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Segfault"),
        })
      );
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(restic.backup).mockRejectedValueOnce("string error");

      const jobData: BackupJobData = {
        executionId: "exec-string-err",
        jobName: "string-error-backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Unknown error");
    });

    it("records duration even on failure", async () => {
      vi.mocked(restic.backup).mockRejectedValueOnce(new Error("Timeout"));

      const jobData: BackupJobData = {
        executionId: "exec-duration",
        jobName: "timed-backup",
        jobConfig: {
          type: "volume",
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("handles concurrent backup failures independently", async () => {
      vi.mocked(restic.backup)
        .mockRejectedValueOnce(new Error("Error A"))
        .mockRejectedValueOnce(new Error("Error B"));

      const jobA: BackupJobData = {
        executionId: "exec-a",
        jobName: "backup-a",
        jobConfig: { type: "volume", source: "/data-a", storage: "local" },
        storage: localStorage,
      };

      const jobB: BackupJobData = {
        executionId: "exec-b",
        jobName: "backup-b",
        jobConfig: { type: "volume", source: "/data-b", storage: "local" },
        storage: localStorage,
      };

      const [resultA, resultB] = await Promise.all([
        backupProcessorFn!({ data: jobA, updateProgress: vi.fn() }),
        backupProcessorFn!({ data: jobB, updateProgress: vi.fn() }),
      ]);

      expect(resultA.success).toBe(false);
      expect(resultA.message).toContain("Error A");
      expect(resultB.success).toBe(false);
      expect(resultB.message).toContain("Error B");

      // Both should have been tracked
      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-a", false);
      expect(mockHeartbeatService.jobCompleted).toHaveBeenCalledWith("exec-b", false);
    });

    it("handles unknown job type", async () => {
      const jobData: BackupJobData = {
        executionId: "exec-unknown",
        jobName: "unknown-backup",
        jobConfig: {
          type: "unknown_type" as any,
          source: "/data",
          storage: "local",
        },
        storage: localStorage,
      };

      const result = await backupProcessorFn!({ data: jobData, updateProgress: vi.fn() });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown job type");
    });
  });
});
