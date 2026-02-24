/**
 * PostgreSQL Database Backup/Restore Integration Tests
 *
 * Tests PostgreSQL dump, backup to storage, and restore operations.
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile postgres up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as database from "../database";
import * as restic from "../restic";
import type { PostgresJob, LocalStorage } from "@uni-backups/shared/config";

const execAsync = promisify(exec);

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

// Detect Docker environment
const isDocker = process.env.POSTGRES_HOST || process.env.REDIS_HOST === "redis";
const POSTGRES_HOST = process.env.POSTGRES_HOST || (isDocker ? "postgres" : "localhost");
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || "5432", 10);
const POSTGRES_RESTORE_HOST = isDocker ? "postgres-restore" : "localhost";
const POSTGRES_RESTORE_PORT = isDocker ? 5432 : 5433;

// PostgreSQL primary configuration (has seed data)
const postgresJob: PostgresJob = {
  type: "postgres",
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  user: "testuser",
  password: "testpass123",
  database: "testdb",
};

// PostgreSQL restore target (empty database)
const postgresRestoreJob: PostgresJob = {
  type: "postgres",
  host: POSTGRES_RESTORE_HOST,
  port: POSTGRES_RESTORE_PORT,
  user: "testuser",
  password: "testpass123",
  database: "restoredb",
};

// Local storage for backups
let testDir: string;
let repoDir: string;
let restoreDir: string;
let localStorage: LocalStorage;

describe("PostgreSQL Database Backup/Restore Integration Tests", () => {
  let testRepoCounter = 0;

  // Generate unique repo name
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  // Helper to run psql commands on primary database
  const runPsql = async (
    sql: string,
    job: PostgresJob = postgresJob
  ): Promise<string> => {
    const env = { ...process.env, PGPASSWORD: job.password };
    const { stdout } = await execAsync(
      `psql -h ${job.host} -p ${job.port} -U ${job.user} -d ${job.database} -t -c "${sql}"`,
      { env, timeout: 30000 }
    );
    return stdout.trim();
  };

  // Helper to get row count from a table
  const getRowCount = async (
    table: string,
    job: PostgresJob = postgresJob
  ): Promise<number> => {
    const result = await runPsql(`SELECT COUNT(*) FROM ${table}`, job);
    return parseInt(result, 10);
  };

  // Helper to restore a SQL dump to the restore database
  const restoreDump = async (dumpPath: string): Promise<void> => {
    const env = { ...process.env, PGPASSWORD: postgresRestoreJob.password };
    await execAsync(
      `psql -h ${postgresRestoreJob.host} -p ${postgresRestoreJob.port} -U ${postgresRestoreJob.user} -d ${postgresRestoreJob.database} -f "${dumpPath}"`,
      { env, timeout: 120000 }
    );
  };

  // Helper to clear the restore database
  const clearRestoreDb = async (): Promise<void> => {
    try {
      const env = { ...process.env, PGPASSWORD: postgresRestoreJob.password };
      // Drop all tables in the restore database
      await execAsync(
        `psql -h ${postgresRestoreJob.host} -p ${postgresRestoreJob.port} -U ${postgresRestoreJob.user} -d ${postgresRestoreJob.database} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
        { env, timeout: 30000 }
      );
    } catch {
      // Ignore errors if schema doesn't exist
    }
  };

  // Helper to check PostgreSQL connectivity
  const checkPostgresConnection = async (job: PostgresJob): Promise<boolean> => {
    try {
      await runPsql("SELECT 1", job);
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(async () => {
    // Create test directories
    testDir = `/tmp/postgres-integration-test-${Date.now()}`;
    repoDir = join(testDir, "repos");
    restoreDir = join(testDir, "restore");

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    localStorage = {
      type: "local",
      path: repoDir,
    };

    // Verify both PostgreSQL instances are accessible
    const primaryConnected = await checkPostgresConnection(postgresJob);
    if (!primaryConnected) {
      throw new Error(
        "PostgreSQL primary is not running. Start with: docker compose -f tests/compose/services.yml --profile postgres up -d"
      );
    }

    const restoreConnected = await checkPostgresConnection(postgresRestoreJob);
    if (!restoreConnected) {
      throw new Error(
        "PostgreSQL restore target is not running. Start with: docker compose -f tests/compose/services.yml --profile postgres up -d"
      );
    }

    // Clean up any leftover test data from previous runs
    try {
      await runPsql("DELETE FROM users WHERE username = 'david'");
    } catch {
      // Ignore errors if user doesn't exist
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
    await clearRestoreDb();
  });

  describe("Database Connectivity", () => {
    it("can connect to primary PostgreSQL database", async () => {
      const result = await runPsql("SELECT 1");
      expect(result).toBe("1");
    }, TEST_TIMEOUT);

    it("can connect to restore PostgreSQL database", async () => {
      const result = await runPsql("SELECT 1", postgresRestoreJob);
      expect(result).toBe("1");
    }, TEST_TIMEOUT);

    it("primary database has seed data", async () => {
      const userCount = await getRowCount("users");
      const orderCount = await getRowCount("orders");
      const productCount = await getRowCount("products");

      expect(userCount).toBe(3);
      expect(orderCount).toBe(5);
      expect(productCount).toBe(4);
    }, TEST_TIMEOUT);

    it("restore database is empty", async () => {
      // Should throw because tables don't exist
      try {
        await getRowCount("users", postgresRestoreJob);
        throw new Error("Expected table to not exist");
      } catch (error: any) {
        expect(error.message).toContain("does not exist");
      }
    }, TEST_TIMEOUT);
  });

  describe("dumpPostgres", () => {
    it("creates SQL dump file for single database", async () => {
      const result = await database.dumpPostgres(postgresJob);

      expect(result.success).toBe(true);
      expect(result.dumpPath).toBeDefined();
      expect(existsSync(result.dumpPath!)).toBe(true);

      // Verify dump contains expected SQL
      const dumpContent = readFileSync(result.dumpPath!, "utf-8");
      expect(dumpContent).toContain("CREATE TABLE");
      expect(dumpContent).toContain("users");
      expect(dumpContent).toContain("orders");
      expect(dumpContent).toContain("products");

      // Cleanup
      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);

    it("dump contains data inserts", async () => {
      const result = await database.dumpPostgres(postgresJob);

      const dumpContent = readFileSync(result.dumpPath!, "utf-8");

      // Should contain the seed data
      expect(dumpContent).toContain("alice");
      expect(dumpContent).toContain("bob");
      expect(dumpContent).toContain("charlie");
      expect(dumpContent).toContain("Widget A");

      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);

    it("dump file is valid and can be restored", async () => {
      const result = await database.dumpPostgres(postgresJob);

      // Restore to the restore database
      await restoreDump(result.dumpPath!);

      // Verify data was restored
      const userCount = await getRowCount("users", postgresRestoreJob);
      const orderCount = await getRowCount("orders", postgresRestoreJob);
      const productCount = await getRowCount("products", postgresRestoreJob);

      expect(userCount).toBe(3);
      expect(orderCount).toBe(5);
      expect(productCount).toBe(4);

      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);
  });

  describe("runDatabaseBackup", () => {
    it("backs up PostgreSQL database to local storage", async () => {
      const repoName = getUniqueRepoName("pg-backup-test");

      const result = await database.runDatabaseBackup(
        postgresJob,
        "pg-test-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.message).toContain("backup completed");
    }, TEST_TIMEOUT);

    it("creates snapshot with correct tags", async () => {
      const repoName = getUniqueRepoName("pg-tags-test");
      const jobWithTags: PostgresJob = {
        ...postgresJob,
        tags: ["production", "daily"],
      };

      await database.runDatabaseBackup(
        jobWithTags,
        "pg-tagged-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // List snapshots and verify tags
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(snapshots.success).toBe(true);
      expect(snapshots.snapshots?.length).toBe(1);
      expect(snapshots.snapshots![0].tags).toContain("production");
      expect(snapshots.snapshots![0].tags).toContain("daily");
      expect(snapshots.snapshots![0].tags).toContain("pg-tagged-job");
      expect(snapshots.snapshots![0].tags).toContain("postgres");
    }, TEST_TIMEOUT);

    it("cleans up dump file after backup", async () => {
      const repoName = getUniqueRepoName("pg-cleanup-test");

      // Get temp dir path
      const tempDir = "/tmp/uni-backups-temp";

      await database.runDatabaseBackup(
        postgresJob,
        "pg-cleanup-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Check that no postgres dump files remain in temp
      const { stdout } = await execAsync(`ls ${tempDir} 2>/dev/null || echo ""`);
      const pgDumps = stdout.split("\n").filter((f) => f.includes("postgres-testdb"));

      expect(pgDumps.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("backs up and restores PostgreSQL database with data verification", async () => {
      const repoName = getUniqueRepoName("pg-full-cycle-test");

      // Step 1: Get original data counts
      const originalUsers = await getRowCount("users");
      const originalOrders = await getRowCount("orders");
      const originalProducts = await getRowCount("products");

      // Get specific user data for verification
      const aliceEmail = await runPsql("SELECT email FROM users WHERE username = 'alice'");

      // Step 2: Backup the database
      const backupResult = await database.runDatabaseBackup(
        postgresJob,
        "pg-full-cycle-job",
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

      // Step 4: Find and apply the restored SQL dump
      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.sql" -type f`);
      const sqlFile = files.trim().split("\n")[0];
      expect(sqlFile).toBeTruthy();

      // Step 5: Import to restore database
      await restoreDump(sqlFile);

      // Step 6: Verify data integrity
      const restoredUsers = await getRowCount("users", postgresRestoreJob);
      const restoredOrders = await getRowCount("orders", postgresRestoreJob);
      const restoredProducts = await getRowCount("products", postgresRestoreJob);

      expect(restoredUsers).toBe(originalUsers);
      expect(restoredOrders).toBe(originalOrders);
      expect(restoredProducts).toBe(originalProducts);

      // Verify specific data
      const restoredAliceEmail = await runPsql(
        "SELECT email FROM users WHERE username = 'alice'",
        postgresRestoreJob
      );
      expect(restoredAliceEmail).toBe(aliceEmail);
    }, TEST_TIMEOUT);

    it("preserves JSONB data through backup/restore", async () => {
      const repoName = getUniqueRepoName("pg-jsonb-test");

      // Get original JSONB data
      const originalData = await runPsql(
        "SELECT data::text FROM users WHERE username = 'alice'"
      );

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        postgresJob,
        "pg-jsonb-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.sql" -type f`);
      await restoreDump(files.trim().split("\n")[0]);

      // Verify JSONB preserved
      const restoredData = await runPsql(
        "SELECT data::text FROM users WHERE username = 'alice'",
        postgresRestoreJob
      );

      expect(JSON.parse(restoredData)).toEqual(JSON.parse(originalData));
    }, TEST_TIMEOUT);

    it("preserves decimal precision through backup/restore", async () => {
      const repoName = getUniqueRepoName("pg-decimal-test");

      // Get original decimal data
      const originalAmount = await runPsql(
        "SELECT amount FROM orders WHERE id = 1"
      );

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        postgresJob,
        "pg-decimal-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.sql" -type f`);
      await restoreDump(files.trim().split("\n")[0]);

      const restoredAmount = await runPsql(
        "SELECT amount FROM orders WHERE id = 1",
        postgresRestoreJob
      );

      expect(restoredAmount).toBe(originalAmount);
    }, TEST_TIMEOUT);

    it("preserves indexes through backup/restore", async () => {
      const repoName = getUniqueRepoName("pg-index-test");

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        postgresJob,
        "pg-index-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      const { stdout: files } = await execAsync(`find ${restoreDir} -name "*.sql" -type f`);
      await restoreDump(files.trim().split("\n")[0]);

      // Check indexes exist
      const indexCount = await runPsql(
        "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'",
        postgresRestoreJob
      );

      expect(parseInt(indexCount, 10)).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe("Multiple Backup Versions", () => {
    it("can restore different versions of database", async () => {
      const repoName = getUniqueRepoName("pg-versions-test");

      // Version 1: Current state
      const backup1 = await database.runDatabaseBackup(
        postgresJob,
        "pg-v1",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Add a new user to the primary database
      // Escape double quotes for shell: \" in JS becomes \\" to produce \" in shell
      await runPsql(
        `INSERT INTO users (username, email, data) VALUES ('david', 'david@example.com', '{\\\"role\\\": \\\"user\\\"}'::jsonb) ON CONFLICT DO NOTHING`
      );

      // Version 2: With new user
      const backup2 = await database.runDatabaseBackup(
        postgresJob,
        "pg-v2",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Restore version 1
      const restore1Dir = join(restoreDir, "v1");
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );

      const { stdout: files1 } = await execAsync(`find ${restore1Dir} -name "*.sql" -type f`);
      await clearRestoreDb();
      await restoreDump(files1.trim().split("\n")[0]);

      const v1UserCount = await getRowCount("users", postgresRestoreJob);

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      const { stdout: files2 } = await execAsync(`find ${restore2Dir} -name "*.sql" -type f`);
      await clearRestoreDb();
      await restoreDump(files2.trim().split("\n")[0]);

      const v2UserCount = await getRowCount("users", postgresRestoreJob);

      // Version 2 should have one more user
      expect(v2UserCount).toBe(v1UserCount + 1);

      // Cleanup: Remove the test user we added
      await runPsql("DELETE FROM users WHERE username = 'david'");
    }, TEST_TIMEOUT);
  });

  describe("Retention and Pruning", () => {
    it("can prune old PostgreSQL backups", async () => {
      const repoName = getUniqueRepoName("pg-prune-test");

      // Create multiple backups with the same job name
      // (restic groups by tags, so same job name = same tag group)
      for (let i = 1; i <= 3; i++) {
        await database.runDatabaseBackup(
          postgresJob,
          "pg-prune-job",
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
      const invalidJob: PostgresJob = {
        type: "postgres",
        host: "localhost",
        port: 59999, // Invalid port
        user: "testuser",
        password: "testpass123",
        database: "testdb",
      };

      const result = await database.dumpPostgres(invalidJob);

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    }, TEST_TIMEOUT);

    it("handles wrong password gracefully", async () => {
      const invalidJob: PostgresJob = {
        ...postgresJob,
        password: "wrongpassword",
      };

      const result = await database.dumpPostgres(invalidJob);

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);

    it("handles non-existent database gracefully", async () => {
      const invalidJob: PostgresJob = {
        ...postgresJob,
        database: "nonexistent_database",
      };

      const result = await database.dumpPostgres(invalidJob);

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("cleanupDump", () => {
    it("removes dump file after cleanup", async () => {
      const result = await database.dumpPostgres(postgresJob);

      expect(existsSync(result.dumpPath!)).toBe(true);

      database.cleanupDump(result.dumpPath!);

      expect(existsSync(result.dumpPath!)).toBe(false);
    }, TEST_TIMEOUT);

    it("handles non-existent file gracefully", () => {
      // Should not throw
      expect(() => {
        database.cleanupDump("/nonexistent/path/file.sql");
      }).not.toThrow();
    });
  });
});
