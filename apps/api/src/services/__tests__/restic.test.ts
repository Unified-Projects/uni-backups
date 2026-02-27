import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRepoUrl, buildResticEnv, ensureTempDir } from "../restic";
import type { StorageConfig } from "@uni-backups/shared/config";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock config
vi.mock("@uni-backups/shared/config", () => ({
  getResticCacheDir: vi.fn(() => "/tmp/restic-cache"),
  getTempDir: vi.fn(() => "/tmp/uni-backups"),
}));

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { getTempDir } from "@uni-backups/shared/config";

// Helper to create mock spawn process
function createMockProcess(
  stdout: string,
  stderr: string,
  exitCode: number
) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Emit data after a tick to simulate async behavior
  setImmediate(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });

  return proc;
}

describe("restic service", () => {
  describe("buildRepoUrl", () => {
    it("builds S3 URL correctly with custom endpoint", () => {
      const storage: StorageConfig = {
        type: "s3",
        endpoint: "http://minio:9000",
        bucket: "test-bucket",
        region: "us-east-1",
        access_key: "access",
        secret_key: "secret",
        path: "",
      };

      const url = buildRepoUrl(storage, "my-repo");
      // Restic S3 URL preserves the protocol for custom endpoints
      expect(url).toBe("s3:http://minio:9000/test-bucket/my-repo");
    });

    it("builds S3 URL with path prefix", () => {
      const storage: StorageConfig = {
        type: "s3",
        endpoint: "http://minio:9000",
        bucket: "test-bucket",
        region: "us-east-1",
        access_key: "access",
        secret_key: "secret",
        path: "backups/daily",
      };

      const url = buildRepoUrl(storage, "my-repo");
      // Restic S3 URL preserves the protocol for custom endpoints
      expect(url).toBe("s3:http://minio:9000/test-bucket/backups/daily/my-repo");
    });

    it("builds S3 URL with default AWS endpoint when none specified", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "test-bucket",
        region: "us-east-1",
        access_key: "access",
        secret_key: "secret",
        path: "",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("s3:s3.amazonaws.com/test-bucket/my-repo");
    });

    it("builds SFTP URL correctly", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "sftp.example.com",
        port: 22,
        user: "backup",
        password: "secret",
        path: "/backups",
      };

      const url = buildRepoUrl(storage, "my-repo");
      // SFTP URL format: sftp:user@host:path (port handled via ssh options, not in URL)
      expect(url).toBe("sftp:backup@sftp.example.com:/backups/my-repo");
    });

    it("builds SFTP URL with custom port", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "sftp.example.com",
        port: 2222,
        user: "backup",
        password: "secret",
        path: "/data/backups",
      };

      const url = buildRepoUrl(storage, "my-repo");
      // SFTP URL format: sftp:user@host:path (port handled via ssh options, not in URL)
      expect(url).toBe("sftp:backup@sftp.example.com:/data/backups/my-repo");
    });

    it("builds REST URL correctly", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "http://rest-server:8000",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("rest:http://rest-server:8000/my-repo");
    });

    it("builds REST URL and strips trailing slash", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "http://rest-server:8000/",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("rest:http://rest-server:8000/my-repo");
    });

    it("builds local path correctly", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups/repos",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("/backups/repos/my-repo");
    });

    it("builds rclone URL with path", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "myremote",
        path: "backups",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("rclone:myremote:backups/my-repo");
    });

    it("builds rclone URL without path", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "myremote",
        path: "",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("rclone:myremote:my-repo");
    });

    it("builds rclone URL and strips trailing slash from path", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "myremote",
        path: "backups/",
      };

      const url = buildRepoUrl(storage, "my-repo");
      expect(url).toBe("rclone:myremote:backups/my-repo");
    });
  });

  describe("buildResticEnv", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("sets RESTIC_PASSWORD", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "my-secret-password");
      expect(env.RESTIC_PASSWORD).toBe("my-secret-password");
    });

    it("sets AWS credentials for S3 storage", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "test-bucket",
        region: "us-east-1",
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        endpoint: "http://minio:9000",
        path: "",
      };

      const env = buildResticEnv(storage, "password");
      expect(env.AWS_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(env.AWS_SECRET_ACCESS_KEY).toBe(
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      );
      expect(env.AWS_S3_ENDPOINT).toBe("http://minio:9000");
    });

    it("sets SFTP command with password for SFTP storage", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "sftp.example.com",
        port: 22,
        user: "backup",
        password: "secret-password",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "restic-password");
      // Implementation stores SFTP command and password in internal vars
      expect(env.__SFTP_COMMAND).toContain("ssh");
      expect(env.__SFTP_COMMAND).toContain("-p 22");
      expect(env.__SFTP_PASSWORD).toBe("secret-password");
    });

    it("sets REST credentials for REST storage with auth", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "http://rest-server:8000",
        user: "admin",
        password: "secret",
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RESTIC_REST_USERNAME).toBe("admin");
      expect(env.RESTIC_REST_PASSWORD).toBe("secret");
    });

    it("does not set REST credentials when not provided", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "http://rest-server:8000",
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RESTIC_REST_USERNAME).toBeUndefined();
      expect(env.RESTIC_REST_PASSWORD).toBeUndefined();
    });

    it("sets RCLONE_CONFIG when config_file is provided", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "gdrive",
        path: "",
        config_file: "/run/secrets/rclone.conf",
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RCLONE_CONFIG).toBe("/run/secrets/rclone.conf");
    });

    it("sets RCLONE_CONFIG_<REMOTE>_<KEY> vars when inline config is provided", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "b2",
        path: "",
        config: {
          type: "b2",
          account: "my-account",
          key: "my-key",
        },
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RCLONE_CONFIG_B2_TYPE).toBe("b2");
      expect(env.RCLONE_CONFIG_B2_ACCOUNT).toBe("my-account");
      expect(env.RCLONE_CONFIG_B2_KEY).toBe("my-key");
    });

    it("handles remote names with hyphens (converts to underscores)", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "my-remote",
        path: "",
        config: {
          type: "drive",
          client_id: "xxx",
        },
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RCLONE_CONFIG_MY_REMOTE_TYPE).toBe("drive");
      expect(env.RCLONE_CONFIG_MY_REMOTE_CLIENT_ID).toBe("xxx");
    });

    it("does not set rclone env vars when no config is provided", () => {
      const storage: StorageConfig = {
        type: "rclone",
        remote: "myremote",
        path: "",
      };

      const env = buildResticEnv(storage, "restic-password");
      expect(env.RCLONE_CONFIG).toBeUndefined();
      const rcloneConfigKeys = Object.keys(env).filter(
        (k) => k.startsWith("RCLONE_CONFIG_")
      );
      expect(rcloneConfigKeys).toHaveLength(0);
    });

    it("sets RESTIC_CACHE_DIR", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "password");
      expect(env.RESTIC_CACHE_DIR).toBeDefined();
    });

    it("uses storage-level restic_password over fallback", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
        restic_password: "per-storage-password",
      };

      const env = buildResticEnv(storage, "global-fallback-password");
      expect(env.RESTIC_PASSWORD).toBe("per-storage-password");
    });

    it("falls back to passed resticPassword when storage has no restic_password", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "global-fallback-password");
      expect(env.RESTIC_PASSWORD).toBe("global-fallback-password");
    });

    it("uses storage-level cache_dir over default", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
        cache_dir: "/custom/cache",
      };

      const env = buildResticEnv(storage);
      expect(env.RESTIC_CACHE_DIR).toBe("/custom/cache");
    });

    it("works with no resticPassword arg when storage provides restic_password", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 22,
        user: "backup",
        path: "/backups",
        restic_password: "storage-own-password",
      };

      const env = buildResticEnv(storage);
      expect(env.RESTIC_PASSWORD).toBe("storage-own-password");
    });
  });

  describe("ensureTempDir", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates directory if it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = ensureTempDir();

      expect(existsSync).toHaveBeenCalledWith("/tmp/uni-backups");
      expect(mkdirSync).toHaveBeenCalledWith("/tmp/uni-backups", { recursive: true });
      expect(result).toBe("/tmp/uni-backups");
    });

    it("does not create directory if it already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = ensureTempDir();

      expect(existsSync).toHaveBeenCalledWith("/tmp/uni-backups");
      expect(mkdirSync).not.toHaveBeenCalled();
      expect(result).toBe("/tmp/uni-backups");
    });
  });

  describe("initRepo", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns success when repository already exists", async () => {
      const { initRepo } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess('[{"id":"abc123"}]', "", 0) as any
      );

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.alreadyExists).toBe(true);
    });

    it("initializes new repository when it does not exist", async () => {
      const { initRepo } = await import("../restic");
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: snapshots check fails (repo doesn't exist)
          return createMockProcess("", "repository does not exist", 1) as any;
        }
        // Second call: init succeeds
        return createMockProcess("created new repository", "", 0) as any;
      });

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository initialized");
    });

    it("handles already initialized race condition", async () => {
      const { initRepo } = await import("../restic");
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockProcess("", "repository does not exist", 1) as any;
        }
        return createMockProcess("", "already initialized", 1) as any;
      });

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    });

    it("returns error when initialization fails", async () => {
      const { initRepo } = await import("../restic");
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockProcess("", "repository does not exist", 1) as any;
        }
        return createMockProcess("", "permission denied", 1) as any;
      });

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("permission denied");
    });
  });

  describe("backup", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("runs backup successfully and returns snapshot ID", async () => {
      const { backup } = await import("../restic");
      const summaryJson = JSON.stringify({
        snapshot_id: "abc123def456",
        files_new: 10,
        files_changed: 0,
      });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(`{"message_type":"status"}\n${summaryJson}`, "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/source");

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("abc123def456");
    });

    it("runs backup with tags", async () => {
      const { backup } = await import("../restic");
      const summaryJson = JSON.stringify({ snapshot_id: "abc123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(summaryJson, "", 0) as any
      );

      await backup(localStorage, "test-repo", "password", "/source", {
        tags: ["daily", "important"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "daily", "--tag", "important"]),
        expect.any(Object)
      );
    });

    it("runs backup with exclude patterns", async () => {
      const { backup } = await import("../restic");
      const summaryJson = JSON.stringify({ snapshot_id: "abc123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(summaryJson, "", 0) as any
      );

      await backup(localStorage, "test-repo", "password", "/source", {
        exclude: ["*.log", "node_modules"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--exclude", "*.log", "--exclude", "node_modules"]),
        expect.any(Object)
      );
    });

    it("runs backup with custom hostname", async () => {
      const { backup } = await import("../restic");
      const summaryJson = JSON.stringify({ snapshot_id: "abc123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(summaryJson, "", 0) as any
      );

      await backup(localStorage, "test-repo", "password", "/source", {
        hostname: "my-server",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "my-server"]),
        expect.any(Object)
      );
    });

    it("handles backup failure", async () => {
      const { backup } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "backup failed: disk full", 1) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/source");

      expect(result.success).toBe(false);
      expect(result.message).toContain("disk full");
    });

    it("handles invalid JSON output gracefully", async () => {
      const { backup } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("not valid json", "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/source");

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeUndefined();
    });
  });

  describe("listSnapshots", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns snapshots list from JSON array (single snapshot)", async () => {
      const { listSnapshots } = await import("../restic");
      const jsonOutput = JSON.stringify([{ id: "abc123", short_id: "abc123", time: "2024-01-01T00:00:00Z", hostname: "server1", username: "root", paths: ["/data"], tags: ["daily"], program_version: "0.16.4" }]);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(jsonOutput, "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots![0].id).toBe("abc123");
    });

    it("returns snapshots list from JSON array (multiple snapshots)", async () => {
      const { listSnapshots } = await import("../restic");
      const snapshot1 = { id: "abc123", short_id: "abc123", time: "2024-01-01T00:00:00Z", hostname: "server1", username: "root", paths: ["/data"], tags: ["daily"], program_version: "0.16.4" };
      const snapshot2 = { id: "def456", short_id: "def456", time: "2024-01-02T00:00:00Z", hostname: "server2", username: "root", paths: ["/var"], tags: ["weekly"], program_version: "0.16.4" };
      const jsonOutput = JSON.stringify([snapshot1, snapshot2]);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(jsonOutput, "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots![0].id).toBe("abc123");
      expect(result.snapshots![1].id).toBe("def456");
    });

    it("filters by tags", async () => {
      const { listSnapshots } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("[]", "", 0) as any
      );

      await listSnapshots(localStorage, "test-repo", "password", {
        tags: ["daily"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "daily"]),
        expect.any(Object)
      );
    });

    it("filters by host", async () => {
      const { listSnapshots } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("[]", "", 0) as any
      );

      await listSnapshots(localStorage, "test-repo", "password", {
        host: "server1",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "server1"]),
        expect.any(Object)
      );
    });

    it("filters by latest N", async () => {
      const { listSnapshots } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("[]", "", 0) as any
      );

      await listSnapshots(localStorage, "test-repo", "password", {
        latest: 5,
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--latest", "5"]),
        expect.any(Object)
      );
    });

    it("handles empty repository", async () => {
      const { listSnapshots } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        // Restic returns null for empty snapshot list
        createMockProcess("null", "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      // Restic returns the literal "null" for empty repositories, which we convert to an empty array
      expect(result.snapshots).toEqual([]);
    });

    it("handles failure", async () => {
      const { listSnapshots } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "repository not found", 1) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("repository not found");
    });
  });

  describe("listFiles", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns file entries", async () => {
      const { listFiles } = await import("../restic");
      const entries = [
        '{"name":"file1.txt","type":"file","path":"/file1.txt","size":100}',
        '{"name":"dir1","type":"dir","path":"/dir1","size":0}',
      ].join("\n");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(entries, "", 0) as any
      );

      const result = await listFiles(localStorage, "test-repo", "password", "abc123");

      expect(result.success).toBe(true);
      expect(result.entries).toHaveLength(2);
      expect(result.entries![0].name).toBe("file1.txt");
    });

    it("lists files with path filter", async () => {
      const { listFiles } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await listFiles(localStorage, "test-repo", "password", "abc123", "/data");

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["ls", "--json", "abc123", "/data"]),
        expect.any(Object)
      );
    });

    it("handles empty result", async () => {
      const { listFiles } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await listFiles(localStorage, "test-repo", "password", "abc123");

      expect(result.success).toBe(true);
      expect(result.entries).toEqual([]);
    });
  });

  describe("restore", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it("restores successfully", async () => {
      const { restore } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restoring...", "", 0) as any
      );

      const result = await restore(
        localStorage,
        "test-repo",
        "password",
        "abc123",
        "/restore/target"
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("creates target directory if it does not exist", async () => {
      const { restore } = await import("../restic");
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await restore(localStorage, "test-repo", "password", "abc123", "/restore/target");

      expect(mkdirSync).toHaveBeenCalledWith("/restore/target", { recursive: true });
    });

    it("restores with include patterns", async () => {
      const { restore } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await restore(localStorage, "test-repo", "password", "abc123", "/target", {
        include: ["/data/*.txt"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--include", "/data/*.txt"]),
        expect.any(Object)
      );
    });

    it("restores with exclude patterns", async () => {
      const { restore } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await restore(localStorage, "test-repo", "password", "abc123", "/target", {
        exclude: ["*.log"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--exclude", "*.log"]),
        expect.any(Object)
      );
    });

    it("handles restore failure", async () => {
      const { restore } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "permission denied", 1) as any
      );

      const result = await restore(
        localStorage,
        "test-repo",
        "password",
        "abc123",
        "/target"
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("permission denied");
    });
  });

  describe("prune", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("prunes with retention policy", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("pruned 5 snapshots", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", {
        last: 5,
        daily: 7,
        weekly: 4,
      });

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining([
          "--keep-last", "5",
          "--keep-daily", "7",
          "--keep-weekly", "4",
        ]),
        expect.any(Object)
      );
    });

    it("prunes with tag filter", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await prune(localStorage, "test-repo", "password", { last: 3 }, {
        tags: ["daily"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "daily"]),
        expect.any(Object)
      );
    });

    it("prunes with host filter", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await prune(localStorage, "test-repo", "password", { last: 3 }, {
        host: "server1",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "server1"]),
        expect.any(Object)
      );
    });

    it("runs dry-run mode", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("would remove 3 snapshots", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", { last: 2 }, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("would remove");
      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--dry-run"]),
        expect.any(Object)
      );
    });

    it("applies all retention policies", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await prune(localStorage, "test-repo", "password", {
        last: 10,
        hourly: 24,
        daily: 7,
        weekly: 4,
        monthly: 12,
        yearly: 3,
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining([
          "--keep-last", "10",
          "--keep-hourly", "24",
          "--keep-daily", "7",
          "--keep-weekly", "4",
          "--keep-monthly", "12",
          "--keep-yearly", "3",
        ]),
        expect.any(Object)
      );
    });

    it("handles prune failure", async () => {
      const { prune } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "lock file exists", 1) as any
      );

      const result = await prune(localStorage, "test-repo", "password", { last: 5 });

      expect(result.success).toBe(false);
      expect(result.message).toContain("lock file");
    });
  });

  describe("check", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("checks repository successfully", async () => {
      const { check } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("no errors were found", "", 0) as any
      );

      const result = await check(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository check passed");
    });

    it("checks with read-data option", async () => {
      const { check } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await check(localStorage, "test-repo", "password", { readData: true });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--read-data"]),
        expect.any(Object)
      );
    });

    it("handles check failure", async () => {
      const { check } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "pack abc123 is damaged", 1) as any
      );

      const result = await check(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("damaged");
    });
  });

  describe("stats", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns repository statistics", async () => {
      const { stats } = await import("../restic");
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: stats command
          return createMockProcess(
            JSON.stringify({ total_size: 1024000, total_file_count: 50 }),
            "",
            0
          ) as any;
        }
        // Second call: snapshots for count
        return createMockProcess(
          JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]),
          "",
          0
        ) as any;
      });

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBe(1024000);
      expect(result.stats?.total_file_count).toBe(50);
      expect(result.stats?.snapshots_count).toBe(3);
    });

    it("handles parse error", async () => {
      const { stats } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("not valid json", "", 0) as any
      );

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("parse");
    });

    it("handles repository not found", async () => {
      const { stats } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "repository does not exist", 1) as any
      );

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("does not exist");
    });

    it("handles stats without snapshot count", async () => {
      const { stats } = await import("../restic");
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockProcess(
            JSON.stringify({ total_size: 500, total_file_count: 10 }),
            "",
            0
          ) as any;
        }
        // Snapshots call fails
        return createMockProcess("", "failed", 1) as any;
      });

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBe(500);
      expect(result.stats?.snapshots_count).toBeUndefined();
    });
  });

  describe("unlock", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("unlocks repository successfully", async () => {
      const { unlock } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("successfully removed locks", "", 0) as any
      );

      const result = await unlock(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository unlocked");
    });

    it("handles unlock when no locks exist", async () => {
      const { unlock } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await unlock(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
    });

    it("handles unlock failure", async () => {
      const { unlock } = await import("../restic");
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "permission denied", 1) as any
      );

      const result = await unlock(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("permission denied");
    });
  });
});
