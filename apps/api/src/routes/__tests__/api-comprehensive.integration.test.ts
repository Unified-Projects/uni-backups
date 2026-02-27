/**
 * API Routes Comprehensive Tests
 *
 * Tests all API endpoints including:
 * - Storage CRUD operations
 * - Job management and manual trigger
 * - Job history retrieval
 * - Restore operations
 * - Repository statistics
 * - Concurrent request handling
 * - Error responses
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import * as configModule from "@uni-backups/shared/config";
import * as schedulerModule from "../../services/scheduler";
import * as resticModule from "../../services/restic";
import jobsRouter from "../jobs";
import storageRouter from "../storage";
import restoreRouter from "../restore";
import reposRouter from "../repos";

// Mock modules
vi.mock("@uni-backups/shared/config", async (importOriginal) => {
  const original = await importOriginal() as typeof configModule;
  return {
    ...original,
    getAllJobs: vi.fn(),
    getJob: vi.fn(),
    getAllStorage: vi.fn(),
    getStorage: vi.fn(),
    getConfig: vi.fn(),
    getTempDir: () => "/tmp/test-api",
  };
});

vi.mock("../../services/scheduler", async (importOriginal) => {
  const original = await importOriginal() as typeof schedulerModule;
  return {
    ...original,
    queueJob: vi.fn(),
    getRecentRuns: vi.fn(),
    isJobActive: vi.fn(),
    getRunningJobs: vi.fn(),
    getQueueStats: vi.fn(),
    getScheduledJobs: vi.fn(),
  };
});

vi.mock("../../services/restic", async (importOriginal) => {
  const original = await importOriginal() as typeof resticModule;
  return {
    ...original,
    listSnapshots: vi.fn(),
    restore: vi.fn(),
    stats: vi.fn(),
    check: vi.fn(),
    initRepo: vi.fn(),
  };
});

// Test Redis configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
};

// Helper to create test app
function createTestApp() {
  const app = new Hono();
  app.route("/jobs", jobsRouter);
  app.route("/storage", storageRouter);
  app.route("/restore", restoreRouter);
  app.route("/repos", reposRouter);
  return app;
}

// Mock data helpers
function createMockJobConfig(name: string, overrides = {}) {
  return {
    name,
    config: {
      type: "folder" as const,
      source: "/data",
      storage: "test-storage",
      schedule: "0 0 * * *",
      worker_group: "default",
      ...overrides,
    },
  };
}

function createMockStorageConfig(name: string, type: "local" | "s3" | "sftp" | "rest" = "local") {
  const configs = {
    local: { type: "local" as const, path: "/backup" },
    s3: {
      type: "s3" as const,
      bucket: "test-bucket",
      endpoint: "http://minio:9000",
      access_key: "minioadmin",
      secret_key: "minioadmin",
    },
    sftp: {
      type: "sftp" as const,
      host: "sftp.example.com",
      port: 22,
      user: "backup",
      path: "/backups",
    },
    rest: {
      type: "rest" as const,
      url: "http://rest-server:8000",
    },
  };
  return { name, config: configs[type] };
}

describe("API Routes Comprehensive Tests", { timeout: 60000 }, () => {
  let app: Hono;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    await redis.ping();

    // Ensure temp directory exists
    mkdirSync("/tmp/test-api", { recursive: true });
  });

  afterAll(async () => {
    await redis.quit();

    // Cleanup temp directory
    if (existsSync("/tmp/test-api")) {
      rmSync("/tmp/test-api", { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await redis.flushdb();
    app = createTestApp();

    // Reset all mocks
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(configModule.getConfig).mockReturnValue({
      jobs: new Map(),
      storage: new Map(),
      resticPassword: "test-password",
    } as any);

    vi.mocked(schedulerModule.getRunningJobs).mockResolvedValue([]);
    vi.mocked(schedulerModule.getRecentRuns).mockResolvedValue([]);
    vi.mocked(schedulerModule.isJobActive).mockResolvedValue(false);
    vi.mocked(schedulerModule.getQueueStats).mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    });
  });

  // ==========================================================================
  // Storage Route Tests
  // ==========================================================================

  describe("GET /storage - List All Storage", () => {
    it("returns empty list when no storage configured", async () => {
      vi.mocked(configModule.getAllStorage).mockReturnValue([]);

      const res = await app.request("/storage");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.storage).toEqual([]);
    });

    it("returns all configured storage backends", async () => {
      vi.mocked(configModule.getAllStorage).mockReturnValue([
        createMockStorageConfig("local-storage", "local"),
        createMockStorageConfig("s3-storage", "s3"),
        createMockStorageConfig("sftp-storage", "sftp"),
      ]);

      const res = await app.request("/storage");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.storage).toHaveLength(3);

      const local = data.storage.find((s: any) => s.name === "local-storage");
      expect(local.type).toBe("local");
      expect(local.path).toBe("/backup");

      const s3 = data.storage.find((s: any) => s.name === "s3-storage");
      expect(s3.type).toBe("s3");
      expect(s3.bucket).toBe("test-bucket");
      // Should not expose secrets
      expect(s3.secret_key).toBeUndefined();
    });
  });

  describe("GET /storage/:name/status - Check Storage Status", () => {
    it("returns 404 for non-existent storage", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue(undefined);

      const res = await app.request("/storage/non-existent/status");

      expect(res.status).toBe(404);
    });

    it("returns connected status when storage is accessible", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(resticModule.initRepo).mockResolvedValue({
        success: true,
        message: "Repository already exists",
        alreadyExists: true,
      });

      const res = await app.request("/storage/local-storage/status");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("connected");
    });

    it("returns error status when storage connection fails", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "sftp",
        host: "bad-host",
        user: "user",
        path: "/backup",
      });

      vi.mocked(resticModule.initRepo).mockResolvedValue({
        success: false,
        message: "Connection refused",
      });

      const res = await app.request("/storage/sftp-storage/status");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("error");
      expect(data.message).toContain("Connection");
    });
  });

  // ==========================================================================
  // Jobs Route Tests
  // ==========================================================================

  describe("GET /jobs - List All Jobs", () => {
    it("returns empty list when no jobs configured", async () => {
      vi.mocked(configModule.getAllJobs).mockReturnValue([]);

      const res = await app.request("/jobs");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.jobs).toEqual([]);
    });

    it("returns all configured jobs with status", async () => {
      vi.mocked(configModule.getAllJobs).mockReturnValue([
        createMockJobConfig("backup-job"),
        createMockJobConfig("db-backup", { type: "postgres", database: "mydb", host: "localhost" }),
      ]);

      const res = await app.request("/jobs");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.jobs).toHaveLength(2);

      const folderJob = data.jobs.find((j: any) => j.name === "backup-job");
      expect(folderJob.type).toBe("folder");
      expect(folderJob.source).toBe("/data");

      const dbJob = data.jobs.find((j: any) => j.name === "db-backup");
      expect(dbJob.type).toBe("postgres");
      expect(dbJob.database).toBe("mydb");
    });

    it("includes running status for active jobs", async () => {
      vi.mocked(configModule.getAllJobs).mockReturnValue([
        createMockJobConfig("running-job"),
      ]);

      vi.mocked(schedulerModule.getRunningJobs).mockResolvedValue([
        { jobName: "running-job", executionId: "exec-123", queuedAt: Date.now() },
      ]);

      const res = await app.request("/jobs");
      const data = await res.json();

      expect(data.jobs[0].isRunning).toBe(true);
    });
  });

  describe("POST /jobs/:name/run - Manual Job Trigger", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(configModule.getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/non-existent/run", { method: "POST" });

      expect(res.status).toBe(404);
    });

    it("returns 409 when job is already running", async () => {
      vi.mocked(configModule.getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "test-storage",
      } as any);

      vi.mocked(schedulerModule.isJobActive).mockResolvedValue(true);

      const res = await app.request("/jobs/active-job/run", { method: "POST" });

      expect(res.status).toBe(409);
    });

    it("queues job successfully", async () => {
      vi.mocked(configModule.getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "test-storage",
      } as any);

      vi.mocked(schedulerModule.isJobActive).mockResolvedValue(false);
      vi.mocked(schedulerModule.queueJob).mockResolvedValue({
        executionId: "exec-456",
        queued: true,
        message: "Job queued successfully",
      });

      const res = await app.request("/jobs/test-job/run", { method: "POST" });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("queued");
      expect(data.executionId).toBe("exec-456");
    });
  });

  describe("GET /jobs/:name/history - Job History", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(configModule.getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/non-existent/history");

      expect(res.status).toBe(404);
    });

    it("returns snapshots for existing job", async () => {
      vi.mocked(configModule.getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "test-storage",
      } as any);

      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(resticModule.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "abc123",
            short_id: "abc123",
            time: "2024-01-15T10:00:00Z",
            hostname: "backup-host",
            username: "root",
            paths: ["/data"],
            tags: ["test-job"],
            program_version: "restic 0.16.0",
          },
        ],
      });

      const res = await app.request("/jobs/test-job/history");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.snapshots).toHaveLength(1);
      expect(data.snapshots[0].id).toBe("abc123");
    });
  });

  // ==========================================================================
  // Restore Route Tests
  // ==========================================================================

  describe("POST /restore - Initiate Restore", () => {
    it("returns 404 for non-existent storage", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue(undefined);

      const res = await app.request("/restore", {
        method: "POST",
        body: JSON.stringify({
          storage: "non-existent",
          repo: "test-repo",
          snapshotId: "abc123",
          method: "download",
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 when path method missing target", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      const res = await app.request("/restore", {
        method: "POST",
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc123",
          method: "path",
          // Missing target
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(400);
    });

    it("initiates restore operation for download method", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(resticModule.restore).mockResolvedValue({
        success: true,
        message: "Restore completed",
      });

      const res = await app.request("/restore", {
        method: "POST",
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBeDefined();
      expect(data.status).toBe("pending");
    });

    it("initiates restore operation for path method", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(resticModule.restore).mockResolvedValue({
        success: true,
        message: "Restore completed",
      });

      const res = await app.request("/restore", {
        method: "POST",
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/tmp/restore-target",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBeDefined();
    });
  });

  describe("GET /restore/:id - Get Restore Status", () => {
    it("returns 404 for non-existent operation", async () => {
      const res = await app.request("/restore/non-existent-id");

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Repository Stats Tests
  // ==========================================================================

  describe("GET /storage/:name/stats - Repository Stats", () => {
    it("returns 404 for non-existent storage", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue(undefined);

      const res = await app.request("/storage/non-existent/stats");

      expect(res.status).toBe(404);
    });

    it("returns aggregated stats for all repos", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      const jobsMap = new Map([
        ["job-1", { storage: "local-storage", repo: "repo-1" }],
        ["job-2", { storage: "local-storage", repo: "repo-2" }],
      ]);

      vi.mocked(configModule.getConfig).mockReturnValue({
        jobs: jobsMap,
        storage: new Map(),
        resticPassword: "test-password",
      } as any);

      vi.mocked(resticModule.stats).mockResolvedValue({
        success: true,
        stats: {
          total_size: 1000000,
          total_file_count: 100,
        },
      });

      vi.mocked(resticModule.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [{ id: "1" }, { id: "2" }] as any,
      });

      const res = await app.request("/storage/local-storage/stats");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.repoCount).toBe(2);
      expect(data.repos).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Concurrent Request Tests
  // ==========================================================================

  describe("Concurrent Requests", () => {
    it("handles multiple concurrent job list requests", async () => {
      vi.mocked(configModule.getAllJobs).mockReturnValue([
        createMockJobConfig("job-1"),
        createMockJobConfig("job-2"),
        createMockJobConfig("job-3"),
      ]);

      // Fire 10 concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        app.request("/jobs")
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const res of responses) {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.jobs).toHaveLength(3);
      }
    });

    it("handles concurrent storage status checks", async () => {
      const storages = ["storage-1", "storage-2", "storage-3"];

      vi.mocked(configModule.getStorage).mockImplementation((name: string) => ({
        type: "local",
        path: `/backup/${name}`,
      }));

      vi.mocked(resticModule.initRepo).mockResolvedValue({
        success: true,
        message: "OK",
      });

      const requests = storages.map((name) =>
        app.request(`/storage/${name}/status`)
      );

      const responses = await Promise.all(requests);

      for (const res of responses) {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("connected");
      }
    });

    it("handles concurrent restore requests", async () => {
      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(resticModule.restore).mockResolvedValue({
        success: true,
        message: "Restore completed",
      });

      const concurrentSnapIds = ["aabb0000", "aabb0001", "aabb0002", "aabb0003", "aabb0004"];
      const requests = Array.from({ length: 5 }, (_, i) =>
        app.request("/restore", {
          method: "POST",
          body: JSON.stringify({
            storage: "local-storage",
            repo: "test-repo",
            snapshotId: concurrentSnapIds[i],
            method: "download",
          }),
          headers: { "Content-Type": "application/json" },
        })
      );

      const responses = await Promise.all(requests);

      const ids = new Set<string>();
      for (const res of responses) {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.id).toBeDefined();
        ids.add(data.id);
      }

      // Each restore should have unique ID
      expect(ids.size).toBe(5);
    });
  });

  // ==========================================================================
  // Error Response Tests
  // ==========================================================================

  describe("Error Response Format", () => {
    it("returns proper error format for 404", async () => {
      vi.mocked(configModule.getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/non-existent");
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBeDefined();
      expect(typeof data.error).toBe("string");
    });

    it("proceeds without a global restic password, passing null as fallback", async () => {
      vi.mocked(configModule.getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "test-storage",
      } as any);

      vi.mocked(configModule.getStorage).mockReturnValue({
        type: "local",
        path: "/backup",
      });

      vi.mocked(configModule.getConfig).mockReturnValue({
        jobs: new Map(),
        storage: new Map(),
        resticPassword: null, // No global password — per-storage password used instead
      } as any);

      vi.mocked(resticModule.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      const res = await app.request("/jobs/test-job/history");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.snapshots).toBeDefined();
    });

    it("returns 400 for invalid restore parameters (malformed JSON body)", async () => {
      // The restore route calls c.req.json() without a try/catch. Hono intercepts
      // the JSON parse error and returns a 400 Bad Request.
      const res = await app.request("/restore", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // Queue Stats Tests
  // ==========================================================================

  describe("GET /jobs/queue/stats - Queue Statistics", () => {
    it("returns queue statistics", async () => {
      vi.mocked(schedulerModule.getQueueStats).mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: 0,
      });

      const res = await app.request("/jobs/queue/stats");
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.waiting).toBe(5);
      expect(data.active).toBe(2);
      expect(data.completed).toBe(100);
      expect(data.failed).toBe(3);
    });
  });
});
