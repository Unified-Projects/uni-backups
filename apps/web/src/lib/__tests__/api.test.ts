import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getStorage,
  getStorageStatus,
  getStorageRepos,
  getJobs,
  getJob,
  runJob,
  getJobHistory,
  getSnapshots,
  getSnapshot,
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

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("API Client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockSuccessResponse = (data: unknown) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });
  };

  const mockErrorResponse = (status: number, error: string) => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve({ error }),
    });
  };

  describe("fetchApi helper", () => {
    it("includes Content-Type header", async () => {
      mockSuccessResponse({ storage: [] });

      await getStorage();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("throws error on non-ok response", async () => {
      mockErrorResponse(404, "Not found");

      await expect(getStorage()).rejects.toThrow("Not found");
    });

    it("handles response without error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(getStorage()).rejects.toThrow("Request failed");
    });
  });

  describe("Storage API", () => {
    describe("getStorage", () => {
      it("fetches storage list", async () => {
        const data = {
          storage: [
            { name: "local", type: "local", path: "/backups" },
            { name: "s3", type: "s3", bucket: "my-bucket" },
          ],
        };
        mockSuccessResponse(data);

        const result = await getStorage();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/storage",
          expect.any(Object)
        );
        expect(result.storage).toHaveLength(2);
      });
    });

    describe("getStorageStatus", () => {
      it("fetches storage status", async () => {
        mockSuccessResponse({ name: "local", status: "connected" });

        const result = await getStorageStatus("local");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/storage/local/status",
          expect.any(Object)
        );
        expect(result.status).toBe("connected");
      });
    });

    describe("getStorageRepos", () => {
      it("fetches repos on storage", async () => {
        mockSuccessResponse({ storage: "local", repos: ["repo1", "repo2"] });

        const result = await getStorageRepos("local");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/storage/local/repos",
          expect.any(Object)
        );
        expect(result.repos).toContain("repo1");
      });
    });
  });

  describe("Jobs API", () => {
    describe("getJobs", () => {
      it("fetches all jobs", async () => {
        const jobs = [
          { name: "job1", type: "folder", storage: "local" },
          { name: "job2", type: "postgres", storage: "local" },
        ];
        mockSuccessResponse({ jobs });

        const result = await getJobs();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/jobs",
          expect.any(Object)
        );
        expect(result.jobs).toHaveLength(2);
      });
    });

    describe("getJob", () => {
      it("fetches specific job", async () => {
        mockSuccessResponse({
          name: "test-job",
          config: { type: "folder" },
          isRunning: false,
          recentRuns: [],
        });

        const result = await getJob("test-job");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/jobs/test-job",
          expect.any(Object)
        );
        expect(result.name).toBe("test-job");
      });
    });

    describe("runJob", () => {
      it("triggers job execution", async () => {
        mockSuccessResponse({ name: "test-job", status: "queued", message: "Job queued" });

        const result = await runJob("test-job");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/jobs/test-job/run",
          expect.objectContaining({ method: "POST" })
        );
        expect(result.status).toBe("queued");
      });
    });

    describe("getJobHistory", () => {
      it("fetches job history/snapshots", async () => {
        mockSuccessResponse({
          name: "test-job",
          repo: "test-repo",
          storage: "local",
          snapshots: [{ id: "snap1", time: "2024-01-01" }],
        });

        const result = await getJobHistory("test-job");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/jobs/test-job/history",
          expect.any(Object)
        );
        expect(result.snapshots).toHaveLength(1);
      });
    });
  });

  describe("Snapshots API", () => {
    describe("getSnapshots", () => {
      it("fetches snapshots without filters", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          snapshots: [],
        });

        await getSnapshots("local", "test-repo");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/snapshots",
          expect.any(Object)
        );
      });

      it("includes tag filter in query", async () => {
        mockSuccessResponse({ storage: "local", repo: "test-repo", snapshots: [] });

        await getSnapshots("local", "test-repo", { tag: "daily" });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/snapshots?tag=daily",
          expect.any(Object)
        );
      });

      it("includes latest filter in query", async () => {
        mockSuccessResponse({ storage: "local", repo: "test-repo", snapshots: [] });

        await getSnapshots("local", "test-repo", { latest: 5 });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/snapshots?latest=5",
          expect.any(Object)
        );
      });

      it("combines multiple filters", async () => {
        mockSuccessResponse({ storage: "local", repo: "test-repo", snapshots: [] });

        await getSnapshots("local", "test-repo", { tag: "daily", latest: 10 });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("tag=daily"),
          expect.any(Object)
        );
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("latest=10"),
          expect.any(Object)
        );
      });
    });

    describe("getSnapshot", () => {
      it("fetches snapshot details", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          snapshot: { id: "abc123", hostname: "server1" },
        });

        const result = await getSnapshot("local", "test-repo", "abc123");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/snapshots/abc123",
          expect.any(Object)
        );
        expect(result.snapshot.id).toBe("abc123");
      });
    });

    describe("listSnapshotFiles", () => {
      it("lists files without path", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc123",
          path: "/",
          entries: [],
        });

        await listSnapshotFiles("local", "test-repo", "abc123");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/snapshots/abc123/ls",
          expect.any(Object)
        );
      });

      it("includes path in query when provided", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc123",
          path: "/data/subdir",
          entries: [],
        });

        await listSnapshotFiles("local", "test-repo", "abc123", "/data/subdir");

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("path=%2Fdata%2Fsubdir"),
          expect.any(Object)
        );
      });
    });

    describe("getRepoStats", () => {
      it("fetches repository stats", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          stats: { total_size: 1024, total_file_count: 100 },
        });

        const result = await getRepoStats("local", "test-repo");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/stats",
          expect.any(Object)
        );
        expect(result.stats.total_size).toBe(1024);
      });
    });

    describe("checkRepo", () => {
      it("checks repository without readData", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          success: true,
          message: "Repository healthy",
        });

        await checkRepo("local", "test-repo");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/check",
          expect.objectContaining({ method: "POST" })
        );
      });

      it("includes readData query when true", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          success: true,
          message: "All data verified",
        });

        await checkRepo("local", "test-repo", true);

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/check?readData=true",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("unlockRepo", () => {
      it("unlocks repository", async () => {
        mockSuccessResponse({
          storage: "local",
          repo: "test-repo",
          success: true,
          message: "Unlocked",
        });

        const result = await unlockRepo("local", "test-repo");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/repos/local/test-repo/unlock",
          expect.objectContaining({ method: "POST" })
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe("Restore API", () => {
    describe("initiateRestore", () => {
      it("initiates restore with download method", async () => {
        mockSuccessResponse({ id: "restore-1", status: "pending", message: "Started" });

        const result = await initiateRestore({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc123",
          method: "download",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/restore",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"method":"download"'),
          })
        );
        expect(result.id).toBe("restore-1");
      });

      it("initiates restore with path method", async () => {
        mockSuccessResponse({ id: "restore-2", status: "pending", message: "Started" });

        await initiateRestore({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc123",
          method: "path",
          target: "/restore/target",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/restore",
          expect.objectContaining({
            body: expect.stringContaining('"target":"/restore/target"'),
          })
        );
      });

      it("includes paths filter when provided", async () => {
        mockSuccessResponse({ id: "restore-3", status: "pending", message: "Started" });

        await initiateRestore({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc123",
          method: "download",
          paths: ["/data/important"],
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/restore",
          expect.objectContaining({
            body: expect.stringContaining('"/data/important"'),
          })
        );
      });
    });

    describe("getRestoreStatus", () => {
      it("fetches restore operation status", async () => {
        mockSuccessResponse({
          id: "restore-1",
          status: "completed",
          downloadReady: true,
        });

        const result = await getRestoreStatus("restore-1");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/restore/restore-1",
          expect.any(Object)
        );
        expect(result.status).toBe("completed");
      });
    });

    describe("getRestoreDownloadUrl", () => {
      it("returns correct download URL", async () => {
        const url = await getRestoreDownloadUrl("restore-1");

        expect(url).toBe("http://localhost:3001/api/restore/restore-1/download");
      });
    });

    describe("getRestoreOperations", () => {
      it("fetches all restore operations", async () => {
        mockSuccessResponse({
          operations: [
            { id: "restore-1", status: "completed" },
            { id: "restore-2", status: "running" },
          ],
        });

        const result = await getRestoreOperations();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/restore",
          expect.any(Object)
        );
        expect(result.operations).toHaveLength(2);
      });
    });
  });

  describe("Schedule API", () => {
    describe("getSchedule", () => {
      it("fetches full schedule info", async () => {
        mockSuccessResponse({
          scheduled: [{ name: "job1", schedule: "0 * * * *" }],
          running: [],
          recentRuns: [],
        });

        const result = await getSchedule();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/schedule",
          expect.any(Object)
        );
        expect(result.scheduled).toHaveLength(1);
      });
    });

    describe("getRunningJobs", () => {
      it("fetches currently running jobs", async () => {
        mockSuccessResponse({
          running: [{ name: "job1", startTime: "2024-01-01T00:00:00Z" }],
        });

        const result = await getRunningJobs();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/schedule/running",
          expect.any(Object)
        );
        expect(result.running).toHaveLength(1);
      });
    });

    describe("getScheduleHistory", () => {
      it("fetches history without filters", async () => {
        mockSuccessResponse({ runs: [] });

        await getScheduleHistory();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/schedule/history",
          expect.any(Object)
        );
      });

      it("includes job filter", async () => {
        mockSuccessResponse({ runs: [] });

        await getScheduleHistory({ job: "test-job" });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/schedule/history?job=test-job",
          expect.any(Object)
        );
      });

      it("includes limit filter", async () => {
        mockSuccessResponse({ runs: [] });

        await getScheduleHistory({ limit: 10 });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/api/schedule/history?limit=10",
          expect.any(Object)
        );
      });

      it("combines filters", async () => {
        mockSuccessResponse({ runs: [] });

        await getScheduleHistory({ job: "test-job", limit: 25 });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("job=test-job"),
          expect.any(Object)
        );
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("limit=25"),
          expect.any(Object)
        );
      });
    });
  });

  describe("Health API", () => {
    describe("getHealth", () => {
      it("fetches health status", async () => {
        mockSuccessResponse({ status: "healthy", timestamp: "2024-01-01T00:00:00Z" });

        const result = await getHealth();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3001/health",
          expect.any(Object)
        );
        expect(result.status).toBe("healthy");
      });
    });
  });
});
