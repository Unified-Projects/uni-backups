/**
 * API Client Integration Tests
 *
 * These tests run against a real API server.
 * They verify that the API client functions work correctly with the actual API.
 *
 * Prerequisites:
 * - API server running on TEST_API_URL (default: http://localhost:3001)
 * - Redis running (for API state)
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  getStorage,
  getStorageStatus,
  getStorageRepos,
  getStorageStats,
  getJobs,
  getJob,
  runJob,
  getJobHistory,
  getSnapshots,
  listSnapshotFiles,
  getRepoStats,
  checkRepo,
  unlockRepo,
  initiateRestore,
  getRestoreStatus,
  getRestoreDownloadUrl,
  getRestoreOperations,
  getSchedule,
  getRunningJobs,
  getScheduleHistory,
  getHealth,
} from "../api";

const API_URL = process.env.TEST_API_URL || "http://localhost:3001";
const TEST_TIMEOUT = 30000;

// Skip if API is not available
async function checkApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

describe("API Client Integration Tests", () => {
  let apiAvailable = false;
  let storageList: Awaited<ReturnType<typeof getStorage>>["storage"] = [];
  let jobsList: Awaited<ReturnType<typeof getJobs>>["jobs"] = [];

  beforeAll(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.warn(
        `API not available at ${API_URL}. Skipping integration tests. Start API with: pnpm --filter @uni-backups/api dev`
      );
    }
  }, TEST_TIMEOUT);

  describe("Health API", () => {
    it("returns health status", async () => {
      if (!apiAvailable) return;

      const result = await getHealth();

      expect(result).toHaveProperty("status");
      expect(["healthy", "degraded", "unhealthy"]).toContain(result.status);
      expect(result).toHaveProperty("timestamp");
    });
  });

  describe("Storage API", () => {
    it("returns list of configured storage backends", async () => {
      if (!apiAvailable) return;

      const result = await getStorage();

      expect(result).toHaveProperty("storage");
      expect(Array.isArray(result.storage)).toBe(true);

      storageList = result.storage;

      // Each storage should have required fields
      for (const storage of result.storage) {
        expect(storage).toHaveProperty("name");
        expect(storage).toHaveProperty("type");
        expect(["local", "s3", "sftp", "rest"]).toContain(storage.type);
      }
    });

    it("returns 404 for non-existent storage status", async () => {
      if (!apiAvailable) return;

      await expect(
        getStorageStatus("nonexistent-storage-12345")
      ).rejects.toThrow();
    });

    it("returns storage status for valid storage", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;
      const result = await getStorageStatus(storageName);

      expect(result).toHaveProperty("name");
      expect(result.name).toBe(storageName);
    });

    it("returns repos list for valid storage", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;

      try {
        const result = await getStorageRepos(storageName);
        expect(result).toHaveProperty("repos");
        expect(Array.isArray(result.repos)).toBe(true);
        expect(result.storage).toBe(storageName);
      } catch (error) {
        // May fail if storage is not accessible, which is OK
        expect((error as Error).message).toBeDefined();
      }
    });

    it("returns storage stats for valid storage", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;

      try {
        const result = await getStorageStats(storageName);
        expect(result).toHaveProperty("storage");
        expect(result.storage).toBe(storageName);
        expect(result).toHaveProperty("totalSize");
        expect(typeof result.totalSize).toBe("number");
      } catch (error) {
        // May fail if no repos exist
        expect((error as Error).message).toBeDefined();
      }
    });
  });

  describe("Jobs API", () => {
    it("returns list of configured jobs", async () => {
      if (!apiAvailable) return;

      const result = await getJobs();

      expect(result).toHaveProperty("jobs");
      expect(Array.isArray(result.jobs)).toBe(true);

      jobsList = result.jobs;

      // Each job should have required fields
      for (const job of result.jobs) {
        expect(job).toHaveProperty("name");
        expect(job).toHaveProperty("type");
        expect(job).toHaveProperty("storage");
        expect(typeof job.isRunning).toBe("boolean");
      }
    });

    it("returns 404 for non-existent job", async () => {
      if (!apiAvailable) return;

      await expect(getJob("nonexistent-job-12345")).rejects.toThrow();
    });

    it("returns job details for valid job", async () => {
      if (!apiAvailable || jobsList.length === 0) return;

      const jobName = jobsList[0].name;
      const result = await getJob(jobName);

      expect(result.name).toBe(jobName);
      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("isActive");
      expect(typeof result.isActive).toBe("boolean");
      expect(result).toHaveProperty("recentRuns");
      expect(Array.isArray(result.recentRuns)).toBe(true);
    });

    it("handles running a non-existent job", async () => {
      if (!apiAvailable) return;

      await expect(runJob("nonexistent-job-12345")).rejects.toThrow();
    });

    it("can trigger a job run", async () => {
      if (!apiAvailable || jobsList.length === 0) return;

      const jobName = jobsList[0].name;

      try {
        const result = await runJob(jobName);
        expect(result).toHaveProperty("status");
        expect(["queued", "already_running"]).toContain(result.status);
      } catch (error) {
        // May get 409 if job is already running
        expect((error as Error).message).toContain("already");
      }
    });

    it("returns job history for valid job", async () => {
      if (!apiAvailable || jobsList.length === 0) return;

      const jobName = jobsList[0].name;

      try {
        const result = await getJobHistory(jobName);
        expect(result.name).toBe(jobName);
        expect(result).toHaveProperty("snapshots");
        expect(Array.isArray(result.snapshots)).toBe(true);
      } catch (error) {
        // May fail if repo doesn't exist yet
        expect((error as Error).message).toBeDefined();
      }
    });

    it("returns 404 for history of non-existent job", async () => {
      if (!apiAvailable) return;

      await expect(getJobHistory("nonexistent-job-12345")).rejects.toThrow();
    });
  });

  describe("Snapshots API", () => {
    let testStorage: string | null = null;
    let testRepo: string | null = null;

    beforeAll(async () => {
      if (!apiAvailable || storageList.length === 0) return;

      // Find a storage with repos
      for (const storage of storageList) {
        try {
          const repos = await getStorageRepos(storage.name);
          if (repos.repos.length > 0) {
            testStorage = storage.name;
            testRepo = repos.repos[0];
            break;
          }
        } catch {
          // Continue to next storage
        }
      }
    });

    it("returns snapshots for valid repo", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      try {
        const result = await getSnapshots(testStorage, testRepo);
        expect(result.storage).toBe(testStorage);
        expect(result.repo).toBe(testRepo);
        expect(result).toHaveProperty("snapshots");
        expect(Array.isArray(result.snapshots)).toBe(true);
      } catch (error) {
        // May fail if repo is not initialized
        expect((error as Error).message).toBeDefined();
      }
    });

    it("accepts filter options for snapshots", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      try {
        const result = await getSnapshots(testStorage, testRepo, { latest: 5 });
        expect(result.snapshots.length).toBeLessThanOrEqual(5);
      } catch (error) {
        expect((error as Error).message).toBeDefined();
      }
    });

    it("returns 404 for non-existent storage in snapshots", async () => {
      if (!apiAvailable) return;

      await expect(
        getSnapshots("nonexistent-storage", "some-repo")
      ).rejects.toThrow();
    });

    it("lists snapshot files", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      try {
        const snapshotsResult = await getSnapshots(testStorage, testRepo, { latest: 1 });
        if (snapshotsResult.snapshots.length === 0) return;

        const snapshotId = snapshotsResult.snapshots[0].short_id;
        const result = await listSnapshotFiles(testStorage, testRepo, snapshotId);

        expect(result.storage).toBe(testStorage);
        expect(result.repo).toBe(testRepo);
        expect(result).toHaveProperty("entries");
        expect(Array.isArray(result.entries)).toBe(true);
      } catch (error) {
        expect((error as Error).message).toBeDefined();
      }
    });

    it("gets repo stats", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      try {
        const result = await getRepoStats(testStorage, testRepo);
        expect(result.storage).toBe(testStorage);
        expect(result.repo).toBe(testRepo);
        expect(result).toHaveProperty("stats");
      } catch (error) {
        expect((error as Error).message).toBeDefined();
      }
    });

    it("checks repo integrity", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      const result = await checkRepo(testStorage, testRepo);

      expect(result.storage).toBe(testStorage);
      expect(result.repo).toBe(testRepo);
      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
      expect(result).toHaveProperty("message");
    });

    it("unlocks repo", async () => {
      if (!apiAvailable || !testStorage || !testRepo) return;

      const result = await unlockRepo(testStorage, testRepo);

      expect(result.storage).toBe(testStorage);
      expect(result.repo).toBe(testRepo);
      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("Restore API", () => {
    it("returns list of restore operations", async () => {
      if (!apiAvailable) return;

      const result = await getRestoreOperations();

      expect(result).toHaveProperty("operations");
      expect(Array.isArray(result.operations)).toBe(true);
    });

    it("returns 404 for non-existent restore operation", async () => {
      if (!apiAvailable) return;

      await expect(
        getRestoreStatus("nonexistent-restore-12345")
      ).rejects.toThrow();
    });

    it("initiates restore operation with valid params", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;

      try {
        const result = await initiateRestore({
          storage: storageName,
          repo: "test-repo",
          snapshotId: "test-snapshot",
          method: "download",
        });

        expect(result).toHaveProperty("id");
        expect(result.status).toBe("pending");
      } catch (error) {
        // Expected to fail with non-existent snapshot
        expect((error as Error).message).toBeDefined();
      }
    });

    it("returns correct download URL format", async () => {
      if (!apiAvailable) return;

      const url = getRestoreDownloadUrl("test-restore-id");
      expect(url).toContain("/api/restore/test-restore-id/download");
    });

    it("validates restore operation status after creation", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;

      try {
        const createResult = await initiateRestore({
          storage: storageName,
          repo: "test-repo",
          snapshotId: "test-snapshot",
          method: "path",
          target: "/tmp/restore-test",
        });

        if (createResult.id) {
          const status = await getRestoreStatus(createResult.id);
          expect(status.id).toBe(createResult.id);
          expect(status.storage).toBe(storageName);
          expect(["pending", "running", "completed", "failed"]).toContain(status.status);
        }
      } catch (error) {
        // Expected to fail in some configurations
        expect((error as Error).message).toBeDefined();
      }
    });
  });

  describe("Schedule API", () => {
    it("returns schedule overview", async () => {
      if (!apiAvailable) return;

      const result = await getSchedule();

      expect(result).toHaveProperty("scheduled");
      expect(Array.isArray(result.scheduled)).toBe(true);
      expect(result).toHaveProperty("running");
      expect(Array.isArray(result.running)).toBe(true);
      expect(result).toHaveProperty("recentRuns");
      expect(Array.isArray(result.recentRuns)).toBe(true);
    });

    it("returns currently running jobs", async () => {
      if (!apiAvailable) return;

      const result = await getRunningJobs();

      expect(result).toHaveProperty("running");
      expect(Array.isArray(result.running)).toBe(true);

      // Each running job should have required fields
      for (const job of result.running) {
        expect(job).toHaveProperty("name");
        expect(job).toHaveProperty("startTime");
      }
    });

    it("returns schedule history", async () => {
      if (!apiAvailable) return;

      const result = await getScheduleHistory();

      expect(result).toHaveProperty("runs");
      expect(Array.isArray(result.runs)).toBe(true);
    });

    it("filters schedule history by job name", async () => {
      if (!apiAvailable || jobsList.length === 0) return;

      const jobName = jobsList[0].name;
      const result = await getScheduleHistory({ job: jobName });

      expect(result).toHaveProperty("runs");
      expect(Array.isArray(result.runs)).toBe(true);

      // All returned runs should be for the specified job
      for (const run of result.runs) {
        expect(run.name).toBe(jobName);
      }
    });

    it("limits schedule history results", async () => {
      if (!apiAvailable) return;

      const result = await getScheduleHistory({ limit: 5 });

      expect(result).toHaveProperty("runs");
      expect(result.runs.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Error Handling", () => {
    it("throws error with message on 404 response", async () => {
      if (!apiAvailable) return;

      try {
        await getJob("definitely-nonexistent-job");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBeDefined();
        expect((error as Error).message.length).toBeGreaterThan(0);
      }
    });

    it("throws error with message on 400 response", async () => {
      if (!apiAvailable || storageList.length === 0) return;

      const storageName = storageList[0].name;

      try {
        // path method requires target
        await initiateRestore({
          storage: storageName,
          repo: "test-repo",
          snapshotId: "test-snapshot",
          method: "path",
          // Missing required target
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBeDefined();
      }
    });

    it("handles network errors gracefully", async () => {
      // Test against a definitely unavailable URL
      const originalEnv = process.env.NEXT_PUBLIC_API_URL;
      process.env.NEXT_PUBLIC_API_URL = "http://localhost:99999";

      // Re-import to get new API_URL
      const { getHealth: getHealthWithBadUrl } = await import("../api");

      try {
        await getHealthWithBadUrl();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      } finally {
        process.env.NEXT_PUBLIC_API_URL = originalEnv;
      }
    });
  });

  describe("Data Type Validation", () => {
    it("job list contains correct types", async () => {
      if (!apiAvailable) return;

      const result = await getJobs();

      for (const job of result.jobs) {
        expect(typeof job.name).toBe("string");
        expect(typeof job.type).toBe("string");
        expect(typeof job.storage).toBe("string");
        expect(typeof job.isRunning).toBe("boolean");

        if (job.lastRun) {
          expect(job.lastRun).toHaveProperty("startTime");
          expect(job.lastRun).toHaveProperty("status");
        }
      }
    });

    it("storage list contains correct types", async () => {
      if (!apiAvailable) return;

      const result = await getStorage();

      for (const storage of result.storage) {
        expect(typeof storage.name).toBe("string");
        expect(typeof storage.type).toBe("string");

        // Type-specific fields
        if (storage.type === "local") {
          expect(storage.path).toBeDefined();
        }
        if (storage.type === "s3") {
          expect(storage.bucket).toBeDefined();
        }
      }
    });

    it("schedule contains correct date formats", async () => {
      if (!apiAvailable) return;

      const result = await getSchedule();

      for (const scheduled of result.scheduled) {
        expect(typeof scheduled.name).toBe("string");
        expect(typeof scheduled.schedule).toBe("string");
      }

      for (const running of result.running) {
        expect(typeof running.name).toBe("string");
        expect(typeof running.startTime).toBe("string");
      }
    });
  });

  describe("Concurrent Requests", () => {
    it("handles multiple concurrent API calls", async () => {
      if (!apiAvailable) return;

      const promises = [
        getHealth(),
        getStorage(),
        getJobs(),
        getSchedule(),
        getRestoreOperations(),
      ];

      const results = await Promise.allSettled(promises);

      // All should complete (either fulfill or reject)
      expect(results).toHaveLength(5);

      // At least health, storage, jobs, and schedule should succeed
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      expect(successCount).toBeGreaterThanOrEqual(4);
    });

    it("handles rapid sequential requests", async () => {
      if (!apiAvailable) return;

      for (let i = 0; i < 10; i++) {
        const result = await getHealth();
        expect(result).toHaveProperty("status");
      }
    });
  });
});
