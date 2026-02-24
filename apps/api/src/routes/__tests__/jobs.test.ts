import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import jobs from "../jobs";

// Mock dependencies
vi.mock("@uni-backups/shared/config", () => ({
  getAllJobs: vi.fn(),
  getJob: vi.fn(),
  getStorage: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../services/scheduler", () => ({
  queueJob: vi.fn(),
  getRecentRuns: vi.fn(),
  isJobActive: vi.fn(),
  getRunningJobs: vi.fn(),
  getQueueStats: vi.fn(),
}));

vi.mock("../../services/restic", () => ({
  listSnapshots: vi.fn(),
}));

import { getAllJobs, getJob, getStorage, getConfig } from "@uni-backups/shared/config";
import { queueJob, getRecentRuns, isJobActive, getRunningJobs, getQueueStats } from "../../services/scheduler";
import * as restic from "../../services/restic";

describe("Jobs API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/jobs", jobs);
  });

  describe("GET /jobs", () => {
    it("returns list of all jobs with status", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "test-job",
          config: {
            type: "folder",
            source: "/data",
            storage: "local",
            repo: "test-repo",
            schedule: "0 * * * *",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.jobs).toHaveLength(1);
      expect(json.jobs[0].name).toBe("test-job");
      expect(json.jobs[0].type).toBe("folder");
    });

    it("marks running jobs correctly", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "running-job",
          config: { type: "folder", source: "/data", storage: "local" },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "running-job", queuedAt: Date.now(), executionId: "exec-1" },
      ]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].isRunning).toBe(true);
    });

    it("includes last run information when available", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "completed-job",
          config: { type: "folder", source: "/data", storage: "local" },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "completed-job",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          status: "completed",
          duration: 10000,
          snapshotId: "snap-123",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].lastRun).toBeDefined();
      expect(json.jobs[0].lastRun.status).toBe("completed");
      expect(json.jobs[0].lastRun.snapshotId).toBe("snap-123");
    });
  });

  describe("GET /jobs/:name", () => {
    it("returns job details when found", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "test-repo",
        schedule: "0 * * * *",
        retention: { last: 5 },
        tags: ["test"],
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/test-job");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.name).toBe("test-job");
      expect(json.config.type).toBe("folder");
      expect(json.config.source).toBe("/data");
    });

    it("returns 404 when job not found", async () => {
      vi.mocked(getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/nonexistent");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("includes recent runs in response", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(false);
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "test-job",
          startTime: Date.now(),
          status: "completed",
          workerId: "worker-1",
        },
        {
          id: "run-2",
          jobName: "test-job",
          startTime: Date.now() - 10000,
          status: "completed",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/jobs/test-job");
      const json = await res.json();

      expect(json.recentRuns).toHaveLength(2);
    });
  });

  describe("POST /jobs/:name/run", () => {
    it("queues job for execution", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(false);
      vi.mocked(queueJob).mockResolvedValue({
        queued: true,
        executionId: "exec-123",
        message: "Job queued successfully",
      });

      const res = await app.request("/jobs/test-job/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("queued");
      expect(json.executionId).toBe("exec-123");
    });

    it("returns 404 when job not found", async () => {
      vi.mocked(getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/nonexistent/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns 409 when job is already running", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(true);

      const res = await app.request("/jobs/test-job/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.error).toContain("already");
    });

    it("returns 500 when queue fails", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(false);
      vi.mocked(queueJob).mockResolvedValue({
        queued: false,
        message: "Queue is full",
      });

      const res = await app.request("/jobs/test-job/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Queue is full");
    });
  });

  describe("GET /jobs/:name/history", () => {
    it("returns job history/snapshots", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "test-repo",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "snap-1",
            short_id: "snap1",
            time: "2024-01-01T00:00:00Z",
            hostname: "host1",
            paths: ["/data"],
            tags: ["test-job"],
          },
        ],
      });

      const res = await app.request("/jobs/test-job/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.snapshots).toHaveLength(1);
      expect(json.snapshots[0].id).toBe("snap-1");
    });

    it("returns 404 when job not found", async () => {
      vi.mocked(getJob).mockReturnValue(undefined);

      const res = await app.request("/jobs/nonexistent/history");
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it("returns 500 when storage not found", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "missing-storage",
      });
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/jobs/test-job/history");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain("Storage");
    });

    it("returns 500 when restic password not configured", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });

      const res = await app.request("/jobs/test-job/history");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain("password");
    });
  });

  describe("GET /jobs/queue/stats", () => {
    it("returns queue statistics", async () => {
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      });

      const res = await app.request("/jobs/queue/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.waiting).toBe(5);
      expect(json.active).toBe(2);
      expect(json.completed).toBe(100);
    });

    it("includes all queue stat fields", async () => {
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 10,
        active: 5,
        completed: 500,
        failed: 25,
        delayed: 3,
      });

      const res = await app.request("/jobs/queue/stats");
      const json = await res.json();

      expect(json.failed).toBe(25);
      expect(json.delayed).toBe(3);
    });
  });

  describe("GET /jobs - Different Job Types", () => {
    it("returns volume job with source", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "volume-backup",
          config: {
            type: "volume",
            source: "/var/lib/docker/volumes/myapp_data",
            storage: "local",
            repo: "volumes",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].type).toBe("volume");
      expect(json.jobs[0].source).toBe("/var/lib/docker/volumes/myapp_data");
    });

    it("returns postgres job with database info", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "postgres-backup",
          config: {
            type: "postgres",
            host: "db.example.com",
            database: "myapp_production",
            storage: "s3",
            repo: "databases",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].type).toBe("postgres");
      expect(json.jobs[0].database).toBe("myapp_production");
      expect(json.jobs[0].host).toBe("db.example.com");
    });

    it("returns mariadb job with database info", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "mariadb-backup",
          config: {
            type: "mariadb",
            host: "mariadb.example.com",
            database: "wordpress",
            storage: "sftp",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].type).toBe("mariadb");
      expect(json.jobs[0].database).toBe("wordpress");
    });

    it("returns redis job with host", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "redis-backup",
          config: {
            type: "redis",
            host: "redis.example.com",
            storage: "local",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].type).toBe("redis");
      expect(json.jobs[0].host).toBe("redis.example.com");
    });

    it("handles jobs without schedule", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "manual-job",
          config: {
            type: "folder",
            source: "/data",
            storage: "local",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].schedule).toBeNull();
    });

    it("uses job name as default repo", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "my-backup-job",
          config: {
            type: "folder",
            source: "/data",
            storage: "local",
            // No repo specified
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].repo).toBe("my-backup-job");
    });

    it("includes worker group when specified", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "grouped-job",
          config: {
            type: "folder",
            source: "/data",
            storage: "local",
            worker_group: "database-workers",
          },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs[0].workerGroup).toBe("database-workers");
    });
  });

  describe("GET /jobs/:name - Different Job Types", () => {
    it("returns postgres job with all config fields", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "postgres",
        host: "db.example.com",
        port: 5432,
        database: "production",
        user: "backup_user",
        all_databases: false,
        storage: "s3",
        repo: "pg-backups",
        schedule: "0 2 * * *",
        retention: { last: 30, daily: 7, weekly: 4 },
        tags: ["production", "database"],
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/postgres-backup");
      const json = await res.json();

      expect(json.config.type).toBe("postgres");
      expect(json.config.host).toBe("db.example.com");
      expect(json.config.port).toBe(5432);
      expect(json.config.database).toBe("production");
      expect(json.config.user).toBe("backup_user");
      expect(json.config.all_databases).toBe(false);
    });

    it("returns mariadb job with all config fields", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "mariadb",
        host: "mariadb.local",
        port: 3306,
        database: "wordpress",
        user: "root",
        all_databases: true,
        storage: "local",
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/mariadb-backup");
      const json = await res.json();

      expect(json.config.type).toBe("mariadb");
      expect(json.config.all_databases).toBe(true);
    });

    it("returns redis job with all config fields", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "redis",
        host: "redis.local",
        port: 6379,
        storage: "local",
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/redis-backup");
      const json = await res.json();

      expect(json.config.type).toBe("redis");
      expect(json.config.host).toBe("redis.local");
      expect(json.config.port).toBe(6379);
    });

    it("includes all optional config fields", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "my-repo",
        schedule: "0 * * * *",
        retention: { last: 10 },
        tags: ["hourly", "important"],
        exclude: ["*.log", "temp/*"],
        worker_group: "default",
        priority: 5,
        timeout: 3600000,
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/full-config-job");
      const json = await res.json();

      expect(json.config.exclude).toEqual(["*.log", "temp/*"]);
      expect(json.config.priority).toBe(5);
      expect(json.config.timeout).toBe(3600000);
      expect(json.config.workerGroup).toBe("default");
    });

    it("returns isActive true when job is running", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(getRecentRuns).mockResolvedValue([]);
      vi.mocked(isJobActive).mockResolvedValue(true);

      const res = await app.request("/jobs/running-job");
      const json = await res.json();

      expect(json.isActive).toBe(true);
    });

    it("includes error in recent runs for failed jobs", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "failed-job",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          status: "failed",
          error: "Repository locked by another process",
          workerId: "worker-1",
        },
      ]);
      vi.mocked(isJobActive).mockResolvedValue(false);

      const res = await app.request("/jobs/failed-job");
      const json = await res.json();

      expect(json.recentRuns[0].status).toBe("failed");
      expect(json.recentRuns[0].error).toBe("Repository locked by another process");
    });
  });

  describe("GET /jobs/:name/history - Additional Cases", () => {
    it("returns empty snapshots array when repo has no snapshots", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "empty-repo",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      const res = await app.request("/jobs/new-job/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.snapshots).toEqual([]);
    });

    it("returns 500 when restic list fails", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "test-repo",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: false,
        message: "Repository not initialized",
      });

      const res = await app.request("/jobs/uninit-job/history");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Repository not initialized");
    });

    it("includes all snapshot fields in response", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "test-repo",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123",
            time: "2024-01-15T10:30:00Z",
            hostname: "backup-server",
            paths: ["/data/important", "/data/config"],
            tags: ["test-job", "daily"],
          },
        ],
      });

      const res = await app.request("/jobs/test-job/history");
      const json = await res.json();

      expect(json.snapshots[0].id).toBe("abc123def456");
      expect(json.snapshots[0].short_id).toBe("abc123");
      expect(json.snapshots[0].hostname).toBe("backup-server");
      expect(json.snapshots[0].paths).toEqual(["/data/important", "/data/config"]);
      expect(json.snapshots[0].tags).toEqual(["test-job", "daily"]);
    });

    it("queries snapshots with job name as tag", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
        repo: "test-repo",
      });
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      await app.request("/jobs/my-tagged-job/history");

      expect(restic.listSnapshots).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        { tags: ["my-tagged-job"] }
      );
    });
  });

  describe("POST /jobs/:name/run - Additional Cases", () => {
    it("includes execution ID in response", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(false);
      vi.mocked(queueJob).mockResolvedValue({
        queued: true,
        executionId: "exec-uuid-12345",
        message: "Job queued successfully",
      });

      const res = await app.request("/jobs/test-job/run", { method: "POST" });
      const json = await res.json();

      expect(json.executionId).toBe("exec-uuid-12345");
      expect(json.message).toContain("queued");
    });

    it("calls queueJob with manual trigger", async () => {
      vi.mocked(getJob).mockReturnValue({
        type: "folder",
        source: "/data",
        storage: "local",
      });
      vi.mocked(isJobActive).mockResolvedValue(false);
      vi.mocked(queueJob).mockResolvedValue({
        queued: true,
        executionId: "exec-1",
        message: "OK",
      });

      await app.request("/jobs/test-job/run", { method: "POST" });

      expect(queueJob).toHaveBeenCalledWith("test-job", "manual");
    });
  });

  describe("GET /jobs - Multiple Jobs", () => {
    it("returns multiple jobs with mixed statuses", async () => {
      vi.mocked(getAllJobs).mockReturnValue([
        {
          name: "running-backup",
          config: { type: "folder", source: "/data1", storage: "local" },
        },
        {
          name: "completed-backup",
          config: { type: "postgres", host: "db.local", database: "app", storage: "s3" },
        },
        {
          name: "failed-backup",
          config: { type: "redis", host: "redis.local", storage: "local" },
        },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "running-backup", queuedAt: Date.now(), executionId: "e1" },
      ]);
      vi.mocked(getRecentRuns)
        .mockResolvedValueOnce([]) // running-backup has no completed runs
        .mockResolvedValueOnce([{
          id: "run-1",
          jobName: "completed-backup",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          status: "completed",
          duration: 10000,
          snapshotId: "snap-1",
          workerId: "worker-1",
        }])
        .mockResolvedValueOnce([{
          id: "run-2",
          jobName: "failed-backup",
          startTime: Date.now() - 5000,
          endTime: Date.now(),
          status: "failed",
          error: "Connection refused",
          workerId: "worker-1",
        }]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs).toHaveLength(3);
      expect(json.jobs.find((j: any) => j.name === "running-backup").isRunning).toBe(true);
      expect(json.jobs.find((j: any) => j.name === "completed-backup").lastRun.status).toBe("completed");
      expect(json.jobs.find((j: any) => j.name === "failed-backup").lastRun.status).toBe("failed");
    });

    it("handles empty job list", async () => {
      vi.mocked(getAllJobs).mockReturnValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.jobs).toEqual([]);
    });
  });
});
