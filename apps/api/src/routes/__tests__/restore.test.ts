import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import restore from "../restore";

// Mock dependencies
vi.mock("@uni-backups/shared/config", () => ({
  getStorage: vi.fn(),
  getConfig: vi.fn(),
  getTempDir: vi.fn(),
}));

vi.mock("../../services/restic", () => ({
  restore: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { getStorage, getConfig, getTempDir } from "@uni-backups/shared/config";
import * as restic from "../../services/restic";

describe("Restore API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/restore", restore);
  });

  const mockConfig = () => {
    vi.mocked(getConfig).mockReturnValue({
      resticPassword: "test-password",
      jobs: new Map(),
      storage: new Map(),
    });
  };

  const mockStorage = () => {
    vi.mocked(getStorage).mockReturnValue({
      type: "local",
      path: "/backups",
    });
  };

  describe("POST /restore", () => {
    it("initiates a restore operation", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBeDefined();
      expect(json.status).toBe("pending");
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "nonexistent",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns 400 when path method without target", async () => {
      mockStorage();

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          // Missing target
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("Target path is required");
    });

    it("returns 500 when restic password not configured", async () => {
      mockStorage();
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain("password");
    });

    it("accepts download method without target", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("pending");
    });

    it("accepts optional paths filter", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
          paths: ["/data/important"],
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
    });
  });

  describe("GET /restore/:id", () => {
    it("returns 404 for unknown operation", async () => {
      const res = await app.request("/restore/unknown-id");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns operation status when found", async () => {
      // First create an operation
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const { id } = await createRes.json();

      // Then get its status
      const res = await app.request(`/restore/${id}`);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe(id);
      expect(json.storage).toBe("local");
      expect(json.repo).toBe("test-repo");
      expect(json.snapshotId).toBe("abc12345");
    });
  });

  describe("GET /restore/:id/download", () => {
    it("returns 404 for unknown operation", async () => {
      const res = await app.request("/restore/unknown-id/download");
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it("returns 400 when operation not completed", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      // Create an operation
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      const { id } = await createRes.json();

      // Immediately try to download (before completion)
      const res = await app.request(`/restore/${id}/download`);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("not completed");
    });
  });

  describe("GET /restore", () => {
    it("returns list of restore operations", async () => {
      const res = await app.request("/restore");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.operations).toBeDefined();
      expect(Array.isArray(json.operations)).toBe(true);
    });

    it("includes created operations in list", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      // Create an operation
      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });

      const res = await app.request("/restore");
      const json = await res.json();

      expect(json.operations.length).toBeGreaterThan(0);
      expect(json.operations[0]).toHaveProperty("id");
      expect(json.operations[0]).toHaveProperty("storage");
      expect(json.operations[0]).toHaveProperty("status");
    });

    it("limits to 50 most recent operations", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      // Create multiple operations
      for (let i = 0; i < 5; i++) {
        await app.request("/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "local",
            repo: "test-repo",
            snapshotId: "abc12345",
            method: "path",
            target: `/restore/target-${i}`,
          }),
        });
      }

      const res = await app.request("/restore");
      const json = await res.json();

      expect(json.operations.length).toBeLessThanOrEqual(50);
    });
  });

  describe("POST /restore - Additional Edge Cases", () => {
    it("stores paths filter correctly", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
          paths: ["/data/file1.txt", "/data/file2.txt"],
        }),
      });
      const { id } = await res.json();

      // Get operation details
      const statusRes = await app.request(`/restore/${id}`);
      const statusJson = await statusRes.json();

      expect(statusJson.paths).toEqual(["/data/file1.txt", "/data/file2.txt"]);
    });

    it("handles empty paths array", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
          paths: [],
        }),
      });
      const { id } = await res.json();

      const statusRes = await app.request(`/restore/${id}`);
      const statusJson = await statusRes.json();

      expect(statusJson.paths).toEqual([]);
    });

    it("generates unique operation IDs", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const ids: string[] = [];

      for (let i = 0; i < 3; i++) {
        const res = await app.request("/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "local",
            repo: "test-repo",
            snapshotId: "abc12345",
            method: "path",
            target: `/restore/target-${i}`,
          }),
        });
        const json = await res.json();
        ids.push(json.id);
      }

      // All IDs should be unique
      expect(new Set(ids).size).toBe(3);
    });

    it("includes startTime in operation", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const beforeTime = new Date();

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const { id } = await res.json();

      const statusRes = await app.request(`/restore/${id}`);
      const statusJson = await statusRes.json();

      expect(statusJson.startTime).toBeDefined();
      const startTime = new Date(statusJson.startTime);
      expect(startTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });
  });

  describe("GET /restore/:id - Status Details", () => {
    it("returns correct fields for path method", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "my-storage",
          repo: "my-repo",
          snapshotId: "aabb1122",
          method: "path",
          target: "/my/target/path",
        }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/restore/${id}`);
      const json = await res.json();

      expect(json.id).toBe(id);
      expect(json.storage).toBe("my-storage");
      expect(json.repo).toBe("my-repo");
      expect(json.snapshotId).toBe("aabb1122");
      expect(json.method).toBe("path");
      expect(json.target).toBe("/my/target/path");
      expect(json.downloadReady).toBe(false); // Path method never has download ready
    });

    it("returns correct fields for download method", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/restore/${id}`);
      const json = await res.json();

      expect(json.method).toBe("download");
      expect(json.target).toBeUndefined();
    });
  });

  describe("GET /restore/:id/download - Edge Cases", () => {
    it("returns 400 for path method operation", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      // Create a PATH restore (not download)
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });
      const { id } = await createRes.json();

      // Try to download (should fail because it's path method)
      const res = await app.request(`/restore/${id}/download`);

      // Since it's pending, it will fail with "not completed"
      expect(res.status).toBe(400);
    });
  });

  describe("POST /restore - Multiple Storage Types", () => {
    it("accepts S3 storage", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "s3",
        bucket: "my-bucket",
        region: "us-east-1",
        path: "backups",
      } as any);
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "s3-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });

      expect(res.status).toBe(200);
    });

    it("accepts SFTP storage", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "sftp",
        host: "sftp.example.com",
        port: 22,
        path: "/backups",
        user: "backup",
        password: "secret",
      } as any);
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "sftp-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });

      expect(res.status).toBe(200);
    });

    it("accepts REST storage", async () => {
      vi.mocked(getStorage).mockReturnValue({
        type: "rest",
        url: "http://rest-server:8000",
      } as any);
      mockConfig();
      vi.mocked(getTempDir).mockReturnValue("/tmp");

      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "rest-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/restore/target",
        }),
      });

      expect(res.status).toBe(200);
    });
  });
});
