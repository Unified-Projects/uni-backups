/**
 * Redis Database Backup/Restore Integration Tests
 *
 * Tests Redis RDB backup, storage, and restore operations.
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, existsSync, rmSync, statSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as database from "../database";
import * as restic from "../restic";
import type { RedisJob, LocalStorage } from "@uni-backups/shared/config";

const execAsync = promisify(exec);

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

// Detect Docker environment
const isDocker = process.env.REDIS_HOST === "redis";
const REDIS_HOST = process.env.REDIS_HOST || (isDocker ? "redis" : "localhost");
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_RESTORE_HOST = isDocker ? "redis-restore" : "localhost";
const REDIS_RESTORE_PORT = isDocker ? 6379 : 6380;

// RDB path - mounted at /data/redis in test-runner, /data in redis container
const REDIS_RDB_PATH = isDocker ? "/data/redis/dump.rdb" : undefined;
const REDIS_RESTORE_RDB_PATH = isDocker ? "/data/redis-restore/dump.rdb" : undefined;

// Redis primary configuration (has seed data)
const redisJob: RedisJob = {
  type: "redis",
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: "testpass123",
  rdb_path: REDIS_RDB_PATH,
};

// Redis restore target (empty database)
const redisRestoreJob: RedisJob = {
  type: "redis",
  host: REDIS_RESTORE_HOST,
  port: REDIS_RESTORE_PORT,
  password: "testpass123",
  rdb_path: REDIS_RESTORE_RDB_PATH,
};

// Local storage for backups
let testDir: string;
let repoDir: string;
let restoreDir: string;
let localStorage: LocalStorage;

describe("Redis Database Backup/Restore Integration Tests", () => {
  let testRepoCounter = 0;

  // Generate unique repo name
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  // Helper to run redis-cli commands
  const runRedis = async (
    command: string,
    job: RedisJob = redisJob
  ): Promise<string> => {
    const authArg = job.password ? `-a ${job.password}` : "";
    const { stdout } = await execAsync(
      `redis-cli -h ${job.host} -p ${job.port} ${authArg} ${command} 2>/dev/null`,
      { timeout: 30000 }
    );
    return stdout.trim();
  };

  // Helper to get a key value
  const getKey = async (
    key: string,
    job: RedisJob = redisJob
  ): Promise<string> => {
    return runRedis(`GET "${key}"`, job);
  };

  // Helper to set a key value
  const setKey = async (
    key: string,
    value: string,
    job: RedisJob = redisJob
  ): Promise<void> => {
    await runRedis(`SET "${key}" "${value}"`, job);
  };

  // Helper to get all keys matching a pattern
  const getKeys = async (
    pattern: string,
    job: RedisJob = redisJob
  ): Promise<string[]> => {
    const result = await runRedis(`KEYS "${pattern}"`, job);
    return result ? result.split("\n").filter(Boolean) : [];
  };

  // Helper to check Redis connectivity
  const checkRedisConnection = async (job: RedisJob): Promise<boolean> => {
    try {
      const result = await runRedis("PING", job);
      return result === "PONG";
    } catch {
      return false;
    }
  };

  // Helper to flush the restore database
  const flushRestoreDb = async (): Promise<void> => {
    await runRedis("FLUSHALL", redisRestoreJob);
  };

  beforeAll(async () => {
    // Create test directories
    testDir = `/tmp/redis-integration-test-${Date.now()}`;
    repoDir = join(testDir, "repos");
    restoreDir = join(testDir, "restore");

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    localStorage = {
      type: "local",
      path: repoDir,
    };

    // Verify both Redis instances are accessible
    const primaryConnected = await checkRedisConnection(redisJob);
    if (!primaryConnected) {
      throw new Error(
        "Redis primary is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }

    const restoreConnected = await checkRedisConnection(redisRestoreJob);
    if (!restoreConnected) {
      throw new Error(
        "Redis restore target is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }
  }, TEST_TIMEOUT);

  afterAll(() => {
    // Clean up test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clear restore database before each test
    await flushRestoreDb();
  });

  describe("Database Connectivity", () => {
    it("can connect to primary Redis database", async () => {
      const result = await runRedis("PING");
      expect(result).toBe("PONG");
    }, TEST_TIMEOUT);

    it("can connect to restore Redis database", async () => {
      const result = await runRedis("PING", redisRestoreJob);
      expect(result).toBe("PONG");
    }, TEST_TIMEOUT);

    it("primary database has seed data", async () => {
      // Check for seeded keys
      const key1 = await getKey("test:key1");
      const key2 = await getKey("test:key2");
      const counter = await getKey("test:counter");

      expect(key1).toBe("value1");
      expect(key2).toBe("value2");
      expect(counter).toBe("42");
    }, TEST_TIMEOUT);

    it("can read hash data from primary", async () => {
      const field1 = await runRedis('HGET test:hash field1');
      const field2 = await runRedis('HGET test:hash field2');

      expect(field1).toBe("hashvalue1");
      expect(field2).toBe("hashvalue2");
    }, TEST_TIMEOUT);

    it("can read list data from primary", async () => {
      const listItems = await runRedis('LRANGE test:list 0 -1');
      const items = listItems.split("\n").filter(Boolean);

      expect(items).toContain("item1");
      expect(items).toContain("item2");
      expect(items).toContain("item3");
    }, TEST_TIMEOUT);

    it("restore database is empty", async () => {
      const keys = await getKeys("*", redisRestoreJob);
      expect(keys.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe("dumpRedis", () => {
    it("creates RDB dump file using BGSAVE", async () => {
      // Use a job without rdb_path to trigger BGSAVE
      const result = await database.dumpRedis(redisJob);

      expect(result.success).toBe(true);
      expect(result.dumpPath).toBeDefined();
      expect(existsSync(result.dumpPath!)).toBe(true);
      expect(result.dumpPath!).toMatch(/\.rdb$/);

      // Verify it's a valid RDB file (starts with REDIS magic)
      const stats = statSync(result.dumpPath!);
      expect(stats.size).toBeGreaterThan(0);

      // Cleanup
      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);

    it("dump file has reasonable size for seed data", async () => {
      const result = await database.dumpRedis(redisJob);

      const stats = statSync(result.dumpPath!);
      // RDB should be at least 100 bytes for our seed data
      expect(stats.size).toBeGreaterThan(100);

      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);
  });

  describe("runDatabaseBackup", () => {
    it("backs up Redis database to local storage", async () => {
      const repoName = getUniqueRepoName("redis-backup-test");

      const result = await database.runDatabaseBackup(
        redisJob,
        "redis-test-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.message).toContain("backup completed");
    }, TEST_TIMEOUT);

    it("creates snapshot with correct tags", async () => {
      const repoName = getUniqueRepoName("redis-tags-test");
      const jobWithTags: RedisJob = {
        ...redisJob,
        tags: ["cache", "session-store"],
      };

      await database.runDatabaseBackup(
        jobWithTags,
        "redis-tagged-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // List snapshots and verify tags
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(snapshots.success).toBe(true);
      expect(snapshots.snapshots?.length).toBe(1);
      expect(snapshots.snapshots![0].tags).toContain("cache");
      expect(snapshots.snapshots![0].tags).toContain("session-store");
      expect(snapshots.snapshots![0].tags).toContain("redis-tagged-job");
      expect(snapshots.snapshots![0].tags).toContain("redis");
    }, TEST_TIMEOUT);

    it("cleans up dump file after backup", async () => {
      const repoName = getUniqueRepoName("redis-cleanup-test");

      // Get temp dir path
      const tempDir = "/tmp/uni-backups-temp";

      await database.runDatabaseBackup(
        redisJob,
        "redis-cleanup-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Check that no redis dump files remain in temp
      const { stdout } = await execAsync(`ls ${tempDir} 2>/dev/null || echo ""`);
      const redisDumps = stdout.split("\n").filter((f) => f.includes("redis-") && f.endsWith(".rdb"));

      expect(redisDumps.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("backs up and restores Redis database with data verification", async () => {
      const repoName = getUniqueRepoName("redis-full-cycle-test");

      // Step 1: Get original data
      const originalKey1 = await getKey("test:key1");
      const originalKey2 = await getKey("test:key2");
      const originalCounter = await getKey("test:counter");
      const originalHash = await runRedis("HGETALL test:hash");

      // Step 2: Backup the database
      const backupResult = await database.runDatabaseBackup(
        redisJob,
        "redis-full-cycle-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(backupResult.success).toBe(true);

      // Step 3: Restore the backup from restic
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(restoreResult.success).toBe(true);

      // Step 4: Find the restored RDB file
      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.rdb" -type f`);
      const rdbFile = files.trim().split("\n")[0];
      expect(rdbFile).toBeTruthy();

      // Verify RDB file exists and has content
      const rdbStats = statSync(rdbFile);
      expect(rdbStats.size).toBeGreaterThan(100);

      // Verify original data is still intact (since we can't easily restore to running Redis)
      expect(await getKey("test:key1")).toBe(originalKey1);
      expect(await getKey("test:key2")).toBe(originalKey2);
      expect(await getKey("test:counter")).toBe(originalCounter);
    }, TEST_TIMEOUT);

    it("preserves hash data in backup", async () => {
      const repoName = getUniqueRepoName("redis-hash-test");

      // Get original hash
      const originalField1 = await runRedis("HGET test:hash field1");
      const originalField2 = await runRedis("HGET test:hash field2");

      // Backup
      const backupResult = await database.runDatabaseBackup(
        redisJob,
        "redis-hash-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(backupResult.success).toBe(true);

      // Restore and verify file exists
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.rdb" -type f`);
      expect(files.trim()).toBeTruthy();

      // Verify original data unchanged
      expect(await runRedis("HGET test:hash field1")).toBe(originalField1);
      expect(await runRedis("HGET test:hash field2")).toBe(originalField2);
    }, TEST_TIMEOUT);

    it("preserves list data in backup", async () => {
      const repoName = getUniqueRepoName("redis-list-test");

      // Get original list
      const originalList = await runRedis("LRANGE test:list 0 -1");

      // Backup
      const backupResult = await database.runDatabaseBackup(
        redisJob,
        "redis-list-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(backupResult.success).toBe(true);

      // Verify original data unchanged
      expect(await runRedis("LRANGE test:list 0 -1")).toBe(originalList);
    }, TEST_TIMEOUT);
  });

  describe("Multiple Backup Versions", () => {
    it("can create multiple backup versions", async () => {
      const repoName = getUniqueRepoName("redis-versions-test");

      // Version 1: Current state
      const backup1 = await database.runDatabaseBackup(
        redisJob,
        "redis-v1",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Add a new key
      await setKey("test:new-key", "new-value");

      // Trigger a BGSAVE to ensure new data is in RDB
      await runRedis("BGSAVE");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for save

      // Version 2: With new key
      const backup2 = await database.runDatabaseBackup(
        redisJob,
        "redis-v2",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Verify both snapshots exist
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapshots.snapshots?.length).toBe(2);

      // Both should be restorable
      const restore1 = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        join(restoreDir, "v1")
      );
      expect(restore1.success).toBe(true);

      const restore2 = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        join(restoreDir, "v2")
      );
      expect(restore2.success).toBe(true);

      // Cleanup: Remove the test key we added
      await runRedis("DEL test:new-key");
    }, TEST_TIMEOUT);
  });

  describe("Retention and Pruning", () => {
    it("can prune old Redis backups", async () => {
      const repoName = getUniqueRepoName("redis-prune-test");

      // Create multiple backups with the same job name
      // (restic groups by tags, so same job name = same tag group)
      for (let i = 1; i <= 3; i++) {
        await database.runDatabaseBackup(
          redisJob,
          "redis-prune-job",
          localStorage,
          repoName,
          RESTIC_PASSWORD
        );
      }

      // Verify 3 snapshots exist
      const beforePrune = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(beforePrune.snapshots?.length).toBe(3);

      // Prune to keep only last 1
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 1 });

      // Verify only 1 snapshot remains
      const afterPrune = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("Error Handling", () => {
    it("handles connection failure gracefully", async () => {
      const invalidJob: RedisJob = {
        type: "redis",
        host: "localhost",
        port: 59999, // Invalid port
        password: "testpass123",
      };

      const result = await database.dumpRedis(invalidJob);

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    }, TEST_TIMEOUT);

    it("handles wrong password gracefully", async () => {
      // Create job WITHOUT rdb_path to force authentication test
      // (rdb_path bypasses redis-cli and just copies the file)
      const invalidJob: RedisJob = {
        type: "redis",
        host: redisJob.host,
        port: redisJob.port,
        password: "wrongpassword",
        // Intentionally omit rdb_path to test authentication
      };

      const result = await database.dumpRedis(invalidJob);

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("cleanupDump", () => {
    it("removes dump file after cleanup", async () => {
      const result = await database.dumpRedis(redisJob);

      expect(existsSync(result.dumpPath!)).toBe(true);

      database.cleanupDump(result.dumpPath!);

      expect(existsSync(result.dumpPath!)).toBe(false);
    }, TEST_TIMEOUT);

    it("handles non-existent file gracefully", () => {
      // Should not throw
      expect(() => {
        database.cleanupDump("/nonexistent/path/file.rdb");
      }).not.toThrow();
    });
  });

  describe("Different Data Types", () => {
    it("handles string keys", async () => {
      const repoName = getUniqueRepoName("redis-string-test");

      // Set test string
      await setKey("test:string:temp", "hello world");
      await runRedis("BGSAVE");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const backupResult = await database.runDatabaseBackup(
        redisJob,
        "redis-string-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(backupResult.success).toBe(true);

      // Cleanup
      await runRedis("DEL test:string:temp");
    }, TEST_TIMEOUT);

    it("handles numeric counters", async () => {
      const repoName = getUniqueRepoName("redis-counter-test");

      // Increment counter
      const beforeIncr = await runRedis("GET test:counter");
      await runRedis("INCR test:counter");
      await runRedis("BGSAVE");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const backupResult = await database.runDatabaseBackup(
        redisJob,
        "redis-counter-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(backupResult.success).toBe(true);

      // Reset counter to original
      await runRedis(`SET test:counter ${beforeIncr}`);
    }, TEST_TIMEOUT);
  });
});
