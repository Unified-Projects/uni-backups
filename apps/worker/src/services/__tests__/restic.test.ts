/**
 * Restic Service Unit Tests
 *
 * Tests for restic repository operations including backup, restore, prune, and more.
 * Uses mocks for child_process and fs to avoid actual restic command execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { StorageConfig, Retention } from "@uni-backups/shared/config";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import {
  buildRepoUrl,
  buildResticEnv,
  initRepo,
  backup,
  listSnapshots,
  prune,
  check,
  restore,
  unlock,
  stats,
  ensureTempDir,
} from "../restic";

// Helper to create mock spawn process
function createMockProcess(
  stdout: string,
  stderr: string,
  exitCode: number,
  emitError = false
) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (emitError) {
      proc.emit("error", new Error(stderr));
    } else {
      if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", exitCode);
    }
  });

  return proc;
}

describe("Restic Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildRepoUrl", () => {
    it("builds SFTP storage URL correctly", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 22,
        user: "backupuser",
        path: "/data/backups",
        password: "secret",
      };

      const result = buildRepoUrl(storage, "test-repo");
      expect(result).toBe("sftp:backupuser@backup.example.com:/data/backups/test-repo");
    });

    it("builds SFTP URL with custom port", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 2222,
        user: "admin",
        path: "/backups/",
      };

      const result = buildRepoUrl(storage, "my-repo");
      expect(result).toBe("sftp:admin@backup.example.com:/backups/my-repo");
    });

    it("builds SFTP URL with default port when not specified", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        user: "admin",
        path: "/backups",
      };

      const result = buildRepoUrl(storage, "repo");
      expect(result).toBe("sftp:admin@backup.example.com:/backups/repo");
    });

    it("builds S3 storage URL correctly", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "my-backups",
        endpoint: "https://s3.amazonaws.com",
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        path: "restic",
      };

      const result = buildRepoUrl(storage, "test-repo");
      expect(result).toBe("s3:https://s3.amazonaws.com/my-backups/restic/test-repo");
    });

    it("builds S3 URL with custom endpoint (MinIO)", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "backups",
        endpoint: "https://minio.local:9000",
        access_key: "minioadmin",
        secret_key: "minioadmin",
      };

      const result = buildRepoUrl(storage, "repo1");
      expect(result).toBe("s3:https://minio.local:9000/backups/repo1");
    });

    it("builds S3 URL without path", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "my-bucket",
        access_key: "key",
        secret_key: "secret",
      };

      const result = buildRepoUrl(storage, "backup");
      expect(result).toBe("s3:s3.amazonaws.com/my-bucket/backup");
    });

    it("builds REST storage URL correctly", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "https://rest-server.example.com:8000",
        user: "admin",
        password: "secret",
      };

      const result = buildRepoUrl(storage, "test-repo");
      expect(result).toBe("rest:https://rest-server.example.com:8000/test-repo");
    });

    it("builds REST URL trimming trailing slash", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "https://rest.local/",
      };

      const result = buildRepoUrl(storage, "repo");
      expect(result).toBe("rest:https://rest.local/repo");
    });

    it("builds local storage URL correctly", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/data/backups",
      };

      const result = buildRepoUrl(storage, "test-repo");
      expect(result).toBe("/data/backups/test-repo");
    });
  });

  describe("buildResticEnv", () => {
    it("sets RESTIC_PASSWORD and RESTIC_CACHE_DIR for all types", () => {
      const storage: StorageConfig = {
        type: "local",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "my-password");

      expect(env.RESTIC_PASSWORD).toBe("my-password");
      // RESTIC_CACHE_DIR defaults to /tmp/restic-cache when env var is not set.
      expect(typeof env.RESTIC_CACHE_DIR).toBe("string");
      expect(env.RESTIC_CACHE_DIR.length).toBeGreaterThan(0);
      expect(env.RESTIC_CACHE_DIR).toMatch(/restic.?cache/i);
    });

    it("sets internal SFTP command and password when SFTP password is provided", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        user: "admin",
        path: "/backups",
        password: "ssh-password",
      };

      const env = buildResticEnv(storage, "restic-password");

      expect(env.__SFTP_COMMAND).toContain("ssh");
      expect(env.__SFTP_COMMAND).toContain("-p 22");
      expect(env.__SFTP_PASSWORD).toBe("ssh-password");
    });

    it("sets SFTP key auth command when key_file is provided", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 2222,
        user: "admin",
        path: "/backups",
        key_file: "/home/admin/.ssh/id_ed25519",
      };

      const env = buildResticEnv(storage, "restic-password");

      expect(env.__SFTP_COMMAND).toContain("-p 2222");
      expect(env.__SFTP_COMMAND).toContain("-i '/home/admin/.ssh/id_ed25519'");
      expect(env.__SFTP_PASSWORD).toBeUndefined();
    });

    it("sets SFTP command without password when no SFTP credentials are provided", () => {
      const storage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        user: "admin",
        path: "/backups",
      };

      const env = buildResticEnv(storage, "restic-password");

      expect(env.__SFTP_COMMAND).toContain("ssh");
      expect(env.__SFTP_PASSWORD).toBeUndefined();
    });

    it("sets AWS credentials for S3 storage", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "my-bucket",
        endpoint: "https://s3.amazonaws.com",
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      const env = buildResticEnv(storage, "password");

      expect(env.AWS_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(env.AWS_SECRET_ACCESS_KEY).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      expect(env.AWS_S3_ENDPOINT).toBe("https://s3.amazonaws.com");
    });

    it("handles S3 without endpoint", () => {
      const storage: StorageConfig = {
        type: "s3",
        bucket: "my-bucket",
        access_key: "key",
        secret_key: "secret",
      };

      const env = buildResticEnv(storage, "password");

      expect(env.AWS_ACCESS_KEY_ID).toBe("key");
      expect(env.AWS_SECRET_ACCESS_KEY).toBe("secret");
      expect(env.AWS_S3_ENDPOINT).toBeUndefined();
    });

    it("sets REST credentials when provided", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "https://rest.example.com",
        user: "restuser",
        password: "restpass",
      };

      const env = buildResticEnv(storage, "restic-password");

      expect(env.RESTIC_REST_USERNAME).toBe("restuser");
      expect(env.RESTIC_REST_PASSWORD).toBe("restpass");
    });

    it("does not set REST credentials when not provided", () => {
      const storage: StorageConfig = {
        type: "rest",
        url: "https://rest.example.com",
      };

      const env = buildResticEnv(storage, "restic-password");

      expect(env.RESTIC_REST_USERNAME).toBeUndefined();
      expect(env.RESTIC_REST_PASSWORD).toBeUndefined();
    });
  });

  describe("initRepo", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("returns success when repo already exists", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("[]", "", 0) as any
      );

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.alreadyExists).toBe(true);
    });

    it("creates new repo when it doesn't exist", async () => {
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call - snapshots check fails (repo doesn't exist)
          return createMockProcess("", "repository does not exist", 1) as any;
        }
        // Second call - init succeeds
        return createMockProcess("created restic repository", "", 0) as any;
      });

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository initialized");
    });

    it("handles race condition when repo is already initialized", async () => {
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call - snapshots check fails
          return createMockProcess("", "repository does not exist", 1) as any;
        }
        // Second call - init fails because already initialized (race condition)
        return createMockProcess("", "repository is already initialized", 1) as any;
      });

      const result = await initRepo(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
      expect(result.alreadyExists).toBe(true);
    });

    it("returns failure with stderr on error", async () => {
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

    it("runs backup successfully and parses snapshot ID", async () => {
      const backupOutput = JSON.stringify({
        message_type: "summary",
        snapshot_id: "abc123def456",
        files_new: 10,
        files_changed: 5,
      });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data");

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("abc123def456");
      expect(result.message).toBe("Backup completed");
    });

    it("includes tags in backup command and completes successfully", async () => {
      const backupOutput = JSON.stringify({ snapshot_id: "snap123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data", {
        tags: ["daily", "important"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "daily", "--tag", "important"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
    });

    it("includes exclude patterns in backup command and completes successfully", async () => {
      const backupOutput = JSON.stringify({ snapshot_id: "snap123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data", {
        exclude: ["*.tmp", "node_modules"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--exclude", "*.tmp", "--exclude", "node_modules"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
    });

    it("includes hostname option in backup command and completes successfully", async () => {
      const backupOutput = JSON.stringify({ snapshot_id: "snap123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data", {
        hostname: "my-server",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "my-server"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
    });

    it("calls onProgress callback with each output line", async () => {
      // The implementation splits stdout by newline and calls onProgress per line.
      // Emit two progress lines followed by the summary JSON.
      const summaryJson = JSON.stringify({ snapshot_id: "snap123" });
      const rawOutput = "uploading file.txt\nuploading file2.txt\n" + summaryJson;
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(rawOutput, "", 0) as any
      );

      const onProgress = vi.fn();
      const result = await backup(localStorage, "test-repo", "password", "/data", { onProgress });

      expect(result.success).toBe(true);
      // onProgress must be called at least once per non-empty line in stdout.
      expect(onProgress).toHaveBeenCalled();
      // Verify the first two progress lines were delivered individually.
      expect(onProgress).toHaveBeenCalledWith("uploading file.txt");
      expect(onProgress).toHaveBeenCalledWith("uploading file2.txt");
      // The summary JSON line is also a non-empty line so it gets forwarded too.
      expect(onProgress).toHaveBeenCalledWith(summaryJson);
    });

    it("returns failure with stderr on error", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "unable to open repository", 1) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data");

      expect(result.success).toBe(false);
      expect(result.message).toContain("unable to open repository");
    });

    it("handles backup success without snapshot ID in output", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("backup completed", "", 0) as any
      );

      const result = await backup(localStorage, "test-repo", "password", "/data");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Backup completed");
      expect(result.snapshotId).toBeUndefined();
    });

    it("uses sshpass wrapper for SFTP password authentication and succeeds", async () => {
      const sftpStorage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 2222,
        user: "backup",
        path: "/backups",
        password: "sftp-pass",
      };
      const backupOutput = JSON.stringify({ snapshot_id: "snap123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(sftpStorage, "test-repo", "password", "/data");

      expect(spawn).toHaveBeenCalledWith(
        "sshpass",
        expect.arrayContaining([
          "-p",
          "sftp-pass",
          "restic",
          "-o",
          expect.stringContaining("sftp.command=ssh -p 2222"),
        ]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
    });

    it("uses SSH key path for SFTP key authentication and succeeds", async () => {
      const sftpStorage: StorageConfig = {
        type: "sftp",
        host: "backup.example.com",
        port: 2200,
        user: "backup",
        path: "/backups",
        key_file: "/home/backup/.ssh/id_rsa",
      };
      const backupOutput = JSON.stringify({ snapshot_id: "snap123" });
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(backupOutput, "", 0) as any
      );

      const result = await backup(sftpStorage, "test-repo", "password", "/data");

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining([
          "-o",
          expect.stringContaining("sftp.command=ssh -p 2200"),
          expect.stringContaining("-i '/home/backup/.ssh/id_rsa'"),
        ]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("snap123");
    });
  });

  describe("listSnapshots", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("parses JSON output correctly", async () => {
      const snapshot = [{
        id: "abc123",
        short_id: "abc1",
        time: "2024-01-15T10:30:00Z",
        hostname: "server1",
        username: "root",
        paths: ["/data"],
        tags: ["daily"],
        program_version: "0.16.0",
      }];
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(JSON.stringify(snapshot), "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots![0].id).toBe("abc123");
      expect(result.snapshots![0].hostname).toBe("server1");
    });

    it("applies tag filter and returns matching results", async () => {
      const snapshot = [{ id: "snap1", short_id: "s1", time: "2024-01-15T10:30:00Z", hostname: "h1", username: "root", paths: ["/data"], tags: ["daily"], program_version: "0.16.0" }];
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(JSON.stringify(snapshot), "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password", {
        tags: ["daily", "weekly"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "daily", "--tag", "weekly"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshots).toBeDefined();
    });

    it("applies host filter and returns matching results", async () => {
      const snapshot = [{ id: "snap1", short_id: "s1", time: "2024-01-15T10:30:00Z", hostname: "server1", username: "root", paths: ["/data"], tags: null, program_version: "0.16.0" }];
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(JSON.stringify(snapshot), "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password", {
        host: "server1",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "server1"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshots).toBeDefined();
      // All returned snapshots must match the requested host.
      expect(result.snapshots!.every((s) => s.hostname === "server1")).toBe(true);
    });

    it("applies path filter and returns matching results", async () => {
      const snapshot = [{ id: "snap1", short_id: "s1", time: "2024-01-15T10:30:00Z", hostname: "h1", username: "root", paths: ["/data"], tags: null, program_version: "0.16.0" }];
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(JSON.stringify(snapshot), "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password", {
        path: "/data",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--path", "/data"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshots).toBeDefined();
      // All returned snapshots must include the requested path.
      expect(result.snapshots!.every((s) => s.paths.includes("/data"))).toBe(true);
    });

    it("applies latest filter and respects the limit", async () => {
      // Mock returns exactly 5 snapshots matching the --latest 5 flag.
      const snapshots = Array.from({ length: 5 }, (_, i) => ({
        id: `snap${i}`,
        short_id: `s${i}`,
        time: "2024-01-15T10:30:00Z",
        hostname: "h1",
        username: "root",
        paths: ["/data"],
        tags: null,
        program_version: "0.16.0",
      }));
      vi.mocked(spawn).mockReturnValue(
        createMockProcess(JSON.stringify(snapshots), "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password", {
        latest: 5,
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--latest", "5"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.snapshots).toHaveLength(5);
    });

    it("returns empty array when no snapshots exist", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("[]", "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.snapshots).toEqual([]);
    });

    it("returns empty array when JSON parsing fails", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("not valid json", "", 0) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.snapshots).toEqual([]);
    });

    it("returns failure on command error", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "repository not found", 1) as any
      );

      const result = await listSnapshots(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("repository not found");
    });
  });

  describe("prune", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    const retention: Retention = {
      last: 7,
      daily: 30,
      weekly: 12,
      monthly: 12,
      yearly: 5,
    };

    it("applies retention policy flags and completes successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("prune complete", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention);

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining([
          "--keep-last", "7",
          "--keep-daily", "30",
          "--keep-weekly", "12",
          "--keep-monthly", "12",
          "--keep-yearly", "5",
        ]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Prune completed");
    });

    it("applies hourly retention when specified and completes successfully", async () => {
      const retentionWithHourly: Retention = {
        hourly: 24,
      };
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("prune complete", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retentionWithHourly);

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--keep-hourly", "24"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Prune completed");
    });

    it("supports dry-run mode", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("would delete 5 snapshots", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention, {
        dryRun: true,
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--dry-run"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      // When dryRun is true the implementation returns result.stdout as the message.
      expect(result.message).toContain("would delete");
    });

    it("applies tag filter and completes successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("prune complete", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention, {
        tags: ["job-name"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--tag", "job-name"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Prune completed");
    });

    it("applies host filter and completes successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("prune complete", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention, {
        host: "server1",
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--host", "server1"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Prune completed");
    });

    it("returns success message on completion", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("prune completed successfully", "", 0) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Prune completed");
    });

    it("returns failure with stderr on error", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "lock timeout", 1) as any
      );

      const result = await prune(localStorage, "test-repo", "password", retention);

      expect(result.success).toBe(false);
      expect(result.message).toContain("lock timeout");
    });
  });

  describe("check", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("returns success when check passes", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("no errors were found", "", 0) as any
      );

      const result = await check(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository check passed");
    });

    it("supports read-data option and completes successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("check complete", "", 0) as any
      );

      const result = await check(localStorage, "test-repo", "password", { readData: true });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--read-data"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository check passed");
    });

    it("returns failure with error message", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "pack abc123 contains invalid data", 1) as any
      );

      const result = await check(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("invalid data");
    });
  });

  describe("restore", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("creates target directory if needed and completes successfully", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restore complete", "", 0) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "abc123", "/restore/target");

      expect(mkdirSync).toHaveBeenCalledWith("/restore/target", { recursive: true });
      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("does not create directory if it exists and completes successfully", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restore complete", "", 0) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "abc123", "/restore/target");

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("applies include patterns and completes successfully", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restore complete", "", 0) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "abc123", "/target", {
        include: ["/data/*.txt", "/config/*"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--include", "/data/*.txt", "--include", "/config/*"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("applies exclude patterns and completes successfully", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restore complete", "", 0) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "abc123", "/target", {
        exclude: ["*.log", "temp/*"],
      });

      expect(spawn).toHaveBeenCalledWith(
        "restic",
        expect.arrayContaining(["--exclude", "*.log", "--exclude", "temp/*"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("returns success on completion", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("restoring /data/file.txt", "", 0) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "abc123", "/target");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Restore completed");
    });

    it("returns failure with stderr on error", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "snapshot not found", 1) as any
      );

      const result = await restore(localStorage, "test-repo", "password", "invalid", "/target");

      expect(result.success).toBe(false);
      expect(result.message).toContain("snapshot not found");
    });
  });

  describe("unlock", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("returns success when unlock completes", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("successfully removed locks", "", 0) as any
      );

      const result = await unlock(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Repository unlocked");
    });

    it("returns failure on error", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "unable to connect to repository", 1) as any
      );

      const result = await unlock(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("unable to connect");
    });
  });

  describe("stats", () => {
    const localStorage: StorageConfig = {
      type: "local",
      path: "/backups",
    };

    it("returns repository statistics", async () => {
      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Stats call
          return createMockProcess(
            JSON.stringify({
              total_size: 1073741824,
              total_file_count: 500,
            }),
            "",
            0
          ) as any;
        }
        // Snapshots call for count
        return createMockProcess(
          JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]),
          "",
          0
        ) as any;
      });

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBe(1073741824);
      expect(result.stats?.total_file_count).toBe(500);
      expect(result.stats?.snapshots_count).toBe(3);
    });

    it("returns failure when stats parsing fails", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("not valid json", "", 0) as any
      );

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to parse");
    });

    it("returns failure on command error", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "repository corrupted", 1) as any
      );

      const result = await stats(localStorage, "test-repo", "password");

      expect(result.success).toBe(false);
      expect(result.message).toContain("repository corrupted");
    });
  });

  describe("ensureTempDir", () => {
    it("creates temp directory if it does not exist and returns its path", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = ensureTempDir();

      expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      // The path passed to mkdirSync must match what was returned.
      const mkdirArg = vi.mocked(mkdirSync).mock.calls[0][0] as string;
      expect(result).toBe(mkdirArg);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("does not create directory if it exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      ensureTempDir();

      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it("returns the temp directory path", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = ensureTempDir();

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      // The implementation returns the TEMP_DIR constant (/tmp/uni-backups by default).
      expect(result).toMatch(/uni.?backups/i);
    });
  });
});
