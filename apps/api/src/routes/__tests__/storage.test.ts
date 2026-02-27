import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import storage from "../storage";

// Mock dependencies
vi.mock("@uni-backups/shared/config", () => ({
  getAllStorage: vi.fn(),
  getStorage: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../services/restic", () => ({
  initRepo: vi.fn(),
  stats: vi.fn(),
  listSnapshots: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { getAllStorage, getStorage, getConfig } from "@uni-backups/shared/config";
import * as restic from "../../services/restic";

describe("Storage API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/storage", storage);
  });

  describe("GET /storage", () => {
    it("returns list of all storage backends", async () => {
      vi.mocked(getAllStorage).mockReturnValue([
        {
          name: "local-storage",
          config: { type: "local", path: "/backups" },
        },
        {
          name: "s3-storage",
          config: {
            type: "s3",
            endpoint: "https://s3.amazonaws.com",
            bucket: "my-bucket",
            region: "us-east-1",
            path: "backups",
          },
        },
      ]);

      const res = await app.request("/storage");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.storage).toHaveLength(2);
    });

    it("includes local storage config without sensitive data", async () => {
      vi.mocked(getAllStorage).mockReturnValue([
        {
          name: "local-storage",
          config: { type: "local", path: "/backups" },
        },
      ]);

      const res = await app.request("/storage");
      const json = await res.json();

      expect(json.storage[0].type).toBe("local");
      expect(json.storage[0].path).toBe("/backups");
    });

    it("includes S3 storage config without credentials", async () => {
      vi.mocked(getAllStorage).mockReturnValue([
        {
          name: "s3-storage",
          config: {
            type: "s3",
            endpoint: "https://s3.amazonaws.com",
            bucket: "my-bucket",
            region: "us-east-1",
            path: "backups",
            access_key_id: "SECRET_KEY",
            secret_access_key: "SECRET_VALUE",
          },
        },
      ]);

      const res = await app.request("/storage");
      const json = await res.json();

      expect(json.storage[0].type).toBe("s3");
      expect(json.storage[0].endpoint).toBe("https://s3.amazonaws.com");
      expect(json.storage[0].bucket).toBe("my-bucket");
      // Should NOT include credentials
      expect(json.storage[0].access_key_id).toBeUndefined();
      expect(json.storage[0].secret_access_key).toBeUndefined();
    });

    it("includes SFTP storage config without password", async () => {
      vi.mocked(getAllStorage).mockReturnValue([
        {
          name: "sftp-storage",
          config: {
            type: "sftp",
            host: "backup.example.com",
            port: 22,
            path: "/backups",
            user: "backup-user",
            password: "SECRET_PASSWORD",
          },
        },
      ]);

      const res = await app.request("/storage");
      const json = await res.json();

      expect(json.storage[0].type).toBe("sftp");
      expect(json.storage[0].host).toBe("backup.example.com");
      // Should NOT include password
      expect(json.storage[0].password).toBeUndefined();
      expect(json.storage[0].user).toBeUndefined();
    });

    it("includes REST storage config", async () => {
      vi.mocked(getAllStorage).mockReturnValue([
        {
          name: "rest-storage",
          config: {
            type: "rest",
            url: "https://rest.example.com",
          },
        },
      ]);

      const res = await app.request("/storage");
      const json = await res.json();

      expect(json.storage[0].type).toBe("rest");
      expect(json.storage[0].url).toBe("https://rest.example.com");
    });
  });

  describe("GET /storage/:name/status", () => {
    it("returns connected status when storage is accessible", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.initRepo).mockResolvedValue({
        success: true,
        message: "Repository already initialized",
      });

      const res = await app.request("/storage/local-storage/status");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("connected");
      expect(json.name).toBe("local-storage");
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/storage/nonexistent/status");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("proceeds without a global restic password, passing undefined as fallback", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.initRepo).mockResolvedValue({
        success: true,
        message: "Repository already initialized",
      });

      const res = await app.request("/storage/local-storage/status");

      expect(res.status).toBe(200);
      expect(vi.mocked(restic.initRepo)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        undefined
      );
    });

    it("returns error status when connection fails", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.initRepo).mockRejectedValue(new Error("Connection refused"));

      const res = await app.request("/storage/local-storage/status");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("error");
      expect(json.message).toBe("Connection refused");
    });
  });

  describe("GET /storage/:name/repos", () => {
    it("returns list of repos on storage", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
          ["job2", { storage: "local-storage", repo: "repo2", type: "folder", source: "/data2" }],
          ["job3", { storage: "other-storage", repo: "repo3", type: "folder", source: "/data3" }],
        ]),
        storage: new Map(),
      });

      const res = await app.request("/storage/local-storage/repos");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.storage).toBe("local-storage");
      expect(json.repos).toContain("repo1");
      expect(json.repos).toContain("repo2");
      expect(json.repos).not.toContain("repo3");
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/storage/nonexistent/repos");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("uses job name as repo name when repo not specified", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["my-backup-job", { storage: "local-storage", type: "folder", source: "/data" }],
        ]),
        storage: new Map(),
      });

      const res = await app.request("/storage/local-storage/repos");
      const json = await res.json();

      expect(json.repos).toContain("my-backup-job");
    });
  });

  describe("GET /storage/:name/stats", () => {
    it("returns aggregated stats for all repos", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
          ["job2", { storage: "local-storage", repo: "repo2", type: "folder", source: "/data2" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: { total_size: 1000, total_file_count: 50 },
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [{ id: "a" }, { id: "b" }] as any,
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.storage).toBe("local-storage");
      expect(json.totalSize).toBe(2000); // 1000 * 2 repos
      expect(json.totalFileCount).toBe(100); // 50 * 2 repos
      expect(json.totalSnapshots).toBe(4); // 2 * 2 repos
      expect(json.repoCount).toBe(2);
      expect(json.repos).toHaveLength(2);
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/storage/nonexistent/stats");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("proceeds without a global restic password, passing undefined as fallback", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });

      const res = await app.request("/storage/local-storage/stats");

      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
    });

    it("handles repo not initialized error gracefully", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: false,
        message: "repository does not exist",
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: false,
        message: "repository does not exist",
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.repos[0].error).toContain("not initialized");
      expect(json.totalSize).toBe(0);
    });

    it("handles partial failures (some repos succeed, some fail)", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
          ["job2", { storage: "local-storage", repo: "repo2", type: "folder", source: "/data2" }],
        ]),
        storage: new Map(),
      });

      let statsCallCount = 0;
      vi.mocked(restic.stats).mockImplementation(async () => {
        statsCallCount++;
        if (statsCallCount === 1) {
          return { success: true, stats: { total_size: 500, total_file_count: 25 } };
        }
        return { success: false, message: "connection timeout" };
      });

      let snapshotsCallCount = 0;
      vi.mocked(restic.listSnapshots).mockImplementation(async () => {
        snapshotsCallCount++;
        if (snapshotsCallCount === 1) {
          return { success: true, snapshots: [{ id: "a" }] as any };
        }
        return { success: false, message: "connection timeout" };
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.totalSize).toBe(500);
      expect(json.totalFileCount).toBe(25);
      expect(json.totalSnapshots).toBe(1);
      expect(json.repos.some((r: any) => r.error)).toBe(true);
      expect(json.repos.some((r: any) => !r.error)).toBe(true);
    });

    it("returns empty stats when no jobs use this storage", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "other-storage", repo: "repo1", type: "folder", source: "/data1" }],
        ]),
        storage: new Map(),
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.repoCount).toBe(0);
      expect(json.totalSize).toBe(0);
      expect(json.repos).toHaveLength(0);
    });

    it("uses job name as repo name when repo not specified", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["my-backup-job", { storage: "local-storage", type: "folder", source: "/data" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: { total_size: 100, total_file_count: 5 },
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [{ id: "a" }] as any,
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(json.repos[0].repo).toBe("my-backup-job");
    });

    it("handles timeout errors gracefully", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockRejectedValue(new Error("Stats request timed out"));
      vi.mocked(restic.listSnapshots).mockRejectedValue(new Error("Snapshots request timed out"));

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.repos[0].error).toContain("timed out");
      expect(json.totalSize).toBe(0);
    });

    it("de-duplicates repos from multiple jobs", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "shared-repo", type: "folder", source: "/data1" }],
          ["job2", { storage: "local-storage", repo: "shared-repo", type: "folder", source: "/data2" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: { total_size: 1000, total_file_count: 50 },
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [{ id: "a" }] as any,
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(json.repoCount).toBe(1);
      expect(json.repos).toHaveLength(1);
      expect(json.repos[0].repo).toBe("shared-repo");
    });

    it("includes detailed per-repo statistics", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "local",
        path: "/backups",
      });
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: "test-password",
        jobs: new Map([
          ["job1", { storage: "local-storage", repo: "repo1", type: "folder", source: "/data1" }],
        ]),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: { total_size: 2048, total_file_count: 100 },
      });
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [{ id: "a" }, { id: "b" }, { id: "c" }] as any,
      });

      const res = await app.request("/storage/local-storage/stats");
      const json = await res.json();

      expect(json.repos[0].repo).toBe("repo1");
      expect(json.repos[0].totalSize).toBe(2048);
      expect(json.repos[0].totalFileCount).toBe(100);
      expect(json.repos[0].snapshotsCount).toBe(3);
      expect(json.repos[0].error).toBeUndefined();
    });
  });
});
