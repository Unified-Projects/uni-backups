/**
 * Database Dump Service Unit Tests
 *
 * Tests for PostgreSQL, MariaDB, and Redis dump functions.
 * Uses mocks for child_process and fs to avoid actual database connections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { PostgresJob, MariadbJob, RedisJob } from "@uni-backups/shared/config";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock restic service - must use correct relative path from test file
vi.mock("../restic", () => ({
  ensureTempDir: vi.fn(() => "/tmp/uni-backups"),
  initRepo: vi.fn(),
  backup: vi.fn(),
}));

import { spawn } from "child_process";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import * as restic from "../restic";
import {
  dumpPostgres,
  dumpMariadb,
  dumpRedis,
  cleanupDump,
  runDatabaseBackup,
} from "../database";

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

  setImmediate(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });

  return proc;
}

describe("Database Dump Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dumpPostgres", () => {
    const baseJob: PostgresJob = {
      type: "postgres",
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "secret",
      database: "mydb",
      storage: "local",
    };

    it("dumps single database successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await dumpPostgres(baseJob);

      expect(result.success).toBe(true);
      expect(result.dumpPath).toContain("postgres-mydb-");
      expect(result.dumpPath).toMatch(/\.sql$/);
      expect(spawn).toHaveBeenCalledWith(
        "pg_dump",
        expect.arrayContaining(["-h", "localhost", "-p", "5432", "-U", "postgres", "-d", "mydb"]),
        expect.any(Object)
      );
    });

    it("dumps all databases when all_databases is true", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await dumpPostgres({ ...baseJob, all_databases: true });

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "pg_dumpall",
        expect.arrayContaining(["-h", "localhost", "-p", "5432", "-U", "postgres"]),
        expect.any(Object)
      );
    });

    it("sets PGPASSWORD environment variable when password provided", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await dumpPostgres(baseJob);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: "secret" }),
        })
      );
    });

    it("handles dump failure", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "pg_dump: connection refused", 1) as any
      );

      const result = await dumpPostgres(baseJob);

      expect(result.success).toBe(false);
      expect(result.message).toContain("connection refused");
    });

    it("works without password", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      const jobWithoutPass = { ...baseJob, password: undefined };

      const result = await dumpPostgres(jobWithoutPass);

      expect(result.success).toBe(true);
    });

    it("uses custom port", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      const jobCustomPort = { ...baseJob, port: 5433 };

      await dumpPostgres(jobCustomPort);

      expect(spawn).toHaveBeenCalledWith(
        "pg_dump",
        expect.arrayContaining(["-p", "5433"]),
        expect.any(Object)
      );
    });
  });

  describe("dumpMariadb", () => {
    const baseJob: MariadbJob = {
      type: "mariadb",
      host: "localhost",
      port: 3306,
      user: "root",
      password: "secret",
      database: "mydb",
      storage: "local",
    };

    it("dumps single database successfully", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await dumpMariadb(baseJob);

      expect(result.success).toBe(true);
      expect(result.dumpPath).toContain("mariadb-mydb-");
      expect(result.dumpPath).toMatch(/\.sql$/);
      expect(spawn).toHaveBeenCalledWith(
        "mariadb-dump",
        expect.arrayContaining(["-h", "localhost", "-P", "3306", "-u", "root", "mydb"]),
        expect.any(Object)
      );
    });

    it("dumps all databases when all_databases is true", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const result = await dumpMariadb({ ...baseJob, all_databases: true });

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "mariadb-dump",
        expect.arrayContaining(["--all-databases"]),
        expect.any(Object)
      );
    });

    it("includes password flag when password provided", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await dumpMariadb(baseJob);

      expect(spawn).toHaveBeenCalledWith(
        "mariadb-dump",
        expect.arrayContaining(["-psecret"]),
        expect.any(Object)
      );
    });

    it("handles dump failure", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "mysqldump: Access denied", 1) as any
      );

      const result = await dumpMariadb(baseJob);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Access denied");
    });

    it("works without password", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      const jobWithoutPass = { ...baseJob, password: undefined };

      const result = await dumpMariadb(jobWithoutPass);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "mariadb-dump",
        expect.not.arrayContaining([expect.stringMatching(/^-p/)]),
        expect.any(Object)
      );
    });

    it("includes result-file flag", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      await dumpMariadb(baseJob);

      expect(spawn).toHaveBeenCalledWith(
        "mariadb-dump",
        expect.arrayContaining([expect.stringMatching(/--result-file=/)]),
        expect.any(Object)
      );
    });
  });

  describe("dumpRedis", () => {
    const baseJob: RedisJob = {
      type: "redis",
      host: "localhost",
      port: 6379,
      password: "secret",
      storage: "local",
    };

    it("copies RDB file when rdb_path exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from("RDB DATA"));

      const result = await dumpRedis({ ...baseJob, rdb_path: "/var/lib/redis/dump.rdb" });

      expect(result.success).toBe(true);
      expect(result.message).toBe("Redis RDB copied");
      expect(readFileSync).toHaveBeenCalledWith("/var/lib/redis/dump.rdb");
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("triggers BGSAVE when no rdb_path provided", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.includes("dump.rdb")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(Buffer.from("RDB DATA"));

      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // BGSAVE
          return createMockProcess("Background saving started", "", 0) as any;
        } else if (callCount === 2) {
          // Initial LASTSAVE
          return createMockProcess("1234567890", "", 0) as any;
        } else if (callCount === 3) {
          // Second LASTSAVE (changed)
          return createMockProcess("1234567891", "", 0) as any;
        } else if (callCount === 4) {
          // CONFIG GET dir
          return createMockProcess("dir\n/var/lib/redis", "", 0) as any;
        } else {
          // CONFIG GET dbfilename
          return createMockProcess("dbfilename\ndump.rdb", "", 0) as any;
        }
      });

      const result = await dumpRedis(baseJob);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "redis-cli",
        expect.arrayContaining(["BGSAVE"]),
        expect.any(Object)
      );
    });

    it("includes password in redis-cli args when provided", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from("RDB"));
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("OK", "", 0) as any
      );

      // Use rdb_path to trigger the copy path
      await dumpRedis({ ...baseJob, rdb_path: "/var/lib/redis/dump.rdb" });

      // Password should be used when triggering BGSAVE (not copy path)
      // Let's test the BGSAVE path
      vi.mocked(existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.includes("/var/lib/redis")) return true;
        return false;
      });

      let callCount = 0;
      vi.mocked(spawn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // redis-cli --rdb (network dump attempt - produces no file since existsSync returns false for temp path)
          return createMockProcess("", "", 0) as any;
        } else if (callCount === 2) {
          // BGSAVE
          return createMockProcess("Background saving started", "", 0) as any;
        } else if (callCount === 3) {
          // Initial LASTSAVE
          return createMockProcess("1234567890", "", 0) as any;
        } else if (callCount === 4) {
          // Second LASTSAVE (changed - triggers loop exit)
          return createMockProcess("1234567891", "", 0) as any;
        } else if (callCount === 5) {
          // CONFIG GET dir
          return createMockProcess("dir\n/var/lib/redis", "", 0) as any;
        } else {
          // CONFIG GET dbfilename
          return createMockProcess("dbfilename\ndump.rdb", "", 0) as any;
        }
      });

      await dumpRedis(baseJob);

      expect(spawn).toHaveBeenCalledWith(
        "redis-cli",
        expect.arrayContaining(["-a", "secret"]),
        expect.any(Object)
      );
    });

    it("handles BGSAVE failure", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      // Use mockImplementation so each spawn call gets a fresh process object.
      // mockReturnValue reuses the same object whose close event has already fired,
      // causing the second runCommand to never resolve.
      vi.mocked(spawn).mockImplementation(() =>
        createMockProcess("", "NOAUTH Authentication required", 1) as any
      );

      const result = await dumpRedis(baseJob);

      expect(result.success).toBe(false);
      expect(result.message).toContain("NOAUTH");
    });

    it("uses custom port and host", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from("RDB"));

      const customJob = { ...baseJob, host: "redis.example.com", port: 6380, rdb_path: "/data/redis.rdb" };
      await dumpRedis(customJob);

      // Just verify it doesn't error with custom config
      expect(readFileSync).toHaveBeenCalledWith("/data/redis.rdb");
    });
  });

  describe("cleanupDump", () => {
    it("removes dump file if it exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      cleanupDump("/tmp/dump.sql");

      expect(unlinkSync).toHaveBeenCalledWith("/tmp/dump.sql");
    });

    it("does nothing if file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      cleanupDump("/tmp/nonexistent.sql");

      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(unlinkSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      // Should not throw
      expect(() => cleanupDump("/tmp/dump.sql")).not.toThrow();
    });
  });

  describe("runDatabaseBackup", () => {
    const localStorage = { type: "local" as const, path: "/backups" };
    const resticPassword = "test-password";

    beforeEach(() => {
      vi.mocked(restic.initRepo).mockResolvedValue({ success: true, message: "OK" });
      vi.mocked(restic.backup).mockResolvedValue({
        success: true,
        snapshotId: "abc123",
        message: "Backup completed",
      });
    });

    it("runs full postgres backup workflow", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(existsSync).mockReturnValue(true);

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("abc123");
      expect(restic.initRepo).toHaveBeenCalled();
      expect(restic.backup).toHaveBeenCalled();
    });

    it("runs full mariadb backup workflow", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(existsSync).mockReturnValue(true);

      const job: MariadbJob = {
        type: "mariadb",
        host: "localhost",
        port: 3306,
        user: "root",
        database: "mydb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("abc123");
    });

    it("runs full redis backup workflow", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from("RDB DATA"));

      const job: RedisJob = {
        type: "redis",
        host: "localhost",
        port: 6379,
        rdb_path: "/var/lib/redis/dump.rdb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe("abc123");
    });

    it("includes job name and type as tags", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(existsSync).mockReturnValue(true);

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
        tags: ["production"],
      };

      await runDatabaseBackup(job, "my-backup-job", localStorage, "test-repo", resticPassword);

      expect(restic.backup).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          tags: expect.arrayContaining(["production", "my-backup-job", "postgres"]),
        })
      );
    });

    it("handles dump failure", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "Connection refused", 1) as any
      );

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection refused");
      expect(restic.backup).not.toHaveBeenCalled();
    });

    it("handles repo init failure", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(restic.initRepo).mockResolvedValue({
        success: false,
        message: "Permission denied",
      });

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Permission denied");
    });

    it("handles backup failure", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(restic.backup).mockResolvedValue({
        success: false,
        message: "Storage full",
      });

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      const result = await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Storage full");
    });

    it("cleans up dump file after successful backup", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(existsSync).mockReturnValue(true);

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(unlinkSync).toHaveBeenCalled();
    });

    it("cleans up dump file after failed backup", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(restic.backup).mockResolvedValue({
        success: false,
        message: "Backup failed",
      });

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword);

      expect(unlinkSync).toHaveBeenCalled();
    });

    it("calls onProgress callback when provided", async () => {
      vi.mocked(spawn).mockReturnValue(
        createMockProcess("", "", 0) as any
      );

      const job: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "mydb",
        storage: "local",
      };

      const onProgress = vi.fn();

      await runDatabaseBackup(job, "test-job", localStorage, "test-repo", resticPassword, onProgress);

      expect(restic.backup).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          onProgress,
        })
      );
    });
  });
});
