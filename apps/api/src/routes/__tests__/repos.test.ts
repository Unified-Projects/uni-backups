import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import repos from "../repos";

// Mock dependencies
vi.mock("@uni-backups/shared/config", () => ({
  getStorage: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../services/restic", () => ({
  listSnapshots: vi.fn(),
  listFiles: vi.fn(),
  stats: vi.fn(),
  check: vi.fn(),
  unlock: vi.fn(),
}));

import { getStorage, getConfig } from "@uni-backups/shared/config";
import * as restic from "../../services/restic";

describe("Repos API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/repos", repos);
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

  describe("GET /repos/:storage/:repo/snapshots", () => {
    it("returns list of snapshots", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123",
            time: "2024-01-01T00:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: ["daily"],
          },
        ],
      });

      const res = await app.request("/repos/local/test-repo/snapshots");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.storage).toBe("local");
      expect(json.repo).toBe("test-repo");
      expect(json.snapshots).toHaveLength(1);
      expect(json.snapshots[0].id).toBe("abc123def456");
    });

    it("filters by tag when provided", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      await app.request("/repos/local/test-repo/snapshots?tag=daily");

      expect(restic.listSnapshots).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        { tags: ["daily"], host: undefined, latest: undefined }
      );
    });

    it("filters by host when provided", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      await app.request("/repos/local/test-repo/snapshots?host=server1");

      expect(restic.listSnapshots).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        { tags: undefined, host: "server1", latest: undefined }
      );
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/repos/nonexistent/test-repo/snapshots");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns 404 when repository is not found", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: false,
        message: "Repository not found",
      });

      const res = await app.request("/repos/local/test-repo/snapshots");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe("Repository not found");
    });
  });

  describe("GET /repos/:storage/:repo/snapshots/:id", () => {
    it("returns snapshot details", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123",
            time: "2024-01-01T00:00:00Z",
            hostname: "server1",
            username: "root",
            paths: ["/data"],
            tags: ["daily"],
            program_version: "0.16.0",
          },
        ],
      });

      const res = await app.request("/repos/local/test-repo/snapshots/abc123def456");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.snapshot.id).toBe("abc123def456");
      expect(json.snapshot.username).toBe("root");
    });

    it("finds snapshot by short_id", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123",
            time: "2024-01-01T00:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: [],
          },
        ],
      });

      const res = await app.request("/repos/local/test-repo/snapshots/abc123");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.snapshot.id).toBe("abc123def456");
    });

    it("returns 404 when snapshot not found", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listSnapshots).mockResolvedValue({
        success: true,
        snapshots: [],
      });

      const res = await app.request("/repos/local/test-repo/snapshots/nonexistent");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });
  });

  describe("GET /repos/:storage/:repo/snapshots/:id/ls", () => {
    it("returns list of files in snapshot", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listFiles).mockResolvedValue({
        success: true,
        entries: [
          { name: "file1.txt", type: "file", path: "/data/file1.txt", size: 1024, mtime: "2024-01-01T00:00:00Z" },
          { name: "dir1", type: "dir", path: "/data/dir1", size: 0, mtime: "2024-01-01T00:00:00Z" },
        ],
      });

      const res = await app.request("/repos/local/test-repo/snapshots/abc123/ls");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toHaveLength(2);
      expect(json.path).toBe("/");
    });

    it("lists files at specific path", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listFiles).mockResolvedValue({
        success: true,
        entries: [],
      });

      await app.request("/repos/local/test-repo/snapshots/abc123/ls?path=/data/subdir");

      expect(restic.listFiles).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        "abc123",
        "/data/subdir"
      );
    });

    it("returns 404 when snapshot path is not found", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.listFiles).mockResolvedValue({
        success: false,
        message: "Path not found in snapshot",
      });

      const res = await app.request("/repos/local/test-repo/snapshots/abc123/ls");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe("Path not found in snapshot");
    });
  });

  describe("GET /repos/:storage/:repo/stats", () => {
    it("returns repository statistics", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: {
          total_size: 1024000000,
          total_file_count: 5000,
          snapshots_count: 10,
        },
      });

      const res = await app.request("/repos/local/test-repo/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.stats.total_size).toBe(1024000000);
      expect(json.stats.total_file_count).toBe(5000);
    });

    it("returns 500 when stats fails", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.stats).mockResolvedValue({
        success: false,
        message: "Repository locked",
      });

      const res = await app.request("/repos/local/test-repo/stats");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Repository locked");
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/repos/nonexistent/test-repo/stats");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("proceeds without a global restic password, passing undefined as fallback", async () => {
      mockStorage();
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: { total_size: 0, total_file_count: 0, snapshots_count: 0 },
      });

      const res = await app.request("/repos/local/test-repo/stats");

      expect(res.status).toBe(200);
      expect(vi.mocked(restic.stats)).toHaveBeenCalledWith(
        expect.any(Object),
        "test-repo",
        undefined
      );
    });

    it("includes all stats fields in response", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.stats).mockResolvedValue({
        success: true,
        stats: {
          total_size: 5000000000,
          total_file_count: 15000,
          snapshots_count: 25,
        },
      });

      const res = await app.request("/repos/local/test-repo/stats");
      const json = await res.json();

      expect(json.storage).toBe("local");
      expect(json.repo).toBe("test-repo");
      expect(json.stats.total_size).toBe(5000000000);
      expect(json.stats.total_file_count).toBe(15000);
      expect(json.stats.snapshots_count).toBe(25);
    });
  });

  describe("POST /repos/:storage/:repo/check", () => {
    it("checks repository health", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.check).mockResolvedValue({
        success: true,
        message: "Repository is healthy",
      });

      const res = await app.request("/repos/local/test-repo/check", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toBe("Repository is healthy");
    });

    it("passes readData option when specified", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.check).mockResolvedValue({
        success: true,
        message: "All data verified",
      });

      await app.request("/repos/local/test-repo/check?readData=true", { method: "POST" });

      expect(restic.check).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        { readData: true }
      );
    });

    it("returns failure status when check fails", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.check).mockResolvedValue({
        success: false,
        message: "Pack file corrupted",
      });

      const res = await app.request("/repos/local/test-repo/check", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(false);
      expect(json.message).toBe("Pack file corrupted");
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/repos/nonexistent/test-repo/check", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("proceeds without a global restic password, passing undefined as fallback", async () => {
      mockStorage();
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.check).mockResolvedValue({
        success: true,
        message: "OK",
      });

      const res = await app.request("/repos/local/test-repo/check", { method: "POST" });

      expect(res.status).toBe(200);
      expect(vi.mocked(restic.check)).toHaveBeenCalledWith(
        expect.any(Object),
        "test-repo",
        undefined,
        expect.any(Object)
      );
    });

    it("includes storage and repo in response", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.check).mockResolvedValue({
        success: true,
        message: "OK",
      });

      const res = await app.request("/repos/my-storage/my-repo/check", { method: "POST" });
      const json = await res.json();

      expect(json.storage).toBe("my-storage");
      expect(json.repo).toBe("my-repo");
    });

    it("does not pass readData option when not specified", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.check).mockResolvedValue({
        success: true,
        message: "OK",
      });

      await app.request("/repos/local/test-repo/check", { method: "POST" });

      expect(restic.check).toHaveBeenCalledWith(
        expect.anything(),
        "test-repo",
        "test-password",
        { readData: false }
      );
    });
  });

  describe("POST /repos/:storage/:repo/unlock", () => {
    it("unlocks repository", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.unlock).mockResolvedValue({
        success: true,
        message: "Repository unlocked",
      });

      const res = await app.request("/repos/local/test-repo/unlock", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it("returns 404 when storage not found", async () => {
      vi.mocked(getStorage).mockReturnValue(undefined);

      const res = await app.request("/repos/nonexistent/test-repo/unlock", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it("proceeds without a global restic password, passing undefined as fallback", async () => {
      mockStorage();
      vi.mocked(getConfig).mockReturnValue({
        resticPassword: undefined,
        jobs: new Map(),
        storage: new Map(),
      });
      vi.mocked(restic.unlock).mockResolvedValue({
        success: true,
        message: "No locks found",
      });

      const res = await app.request("/repos/local/test-repo/unlock", { method: "POST" });

      expect(res.status).toBe(200);
      expect(vi.mocked(restic.unlock)).toHaveBeenCalledWith(
        expect.any(Object),
        "test-repo",
        undefined
      );
    });

    it("includes unlock message in response", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.unlock).mockResolvedValue({
        success: true,
        message: "Successfully removed 3 locks",
      });

      const res = await app.request("/repos/local/test-repo/unlock", { method: "POST" });
      const json = await res.json();

      expect(json.message).toBe("Successfully removed 3 locks");
    });

    it("returns failure status when unlock fails", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.unlock).mockResolvedValue({
        success: false,
        message: "Permission denied",
      });

      const res = await app.request("/repos/local/test-repo/unlock", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(false);
      expect(json.message).toBe("Permission denied");
    });

    it("includes storage and repo in response", async () => {
      mockStorage();
      mockConfig();
      vi.mocked(restic.unlock).mockResolvedValue({
        success: true,
        message: "Unlocked",
      });

      const res = await app.request("/repos/my-storage/my-repo/unlock", { method: "POST" });
      const json = await res.json();

      expect(json.storage).toBe("my-storage");
      expect(json.repo).toBe("my-repo");
    });
  });
});
