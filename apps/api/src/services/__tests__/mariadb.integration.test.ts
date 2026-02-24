/**
 * MariaDB Database Backup/Restore Integration Tests
 *
 * Tests MariaDB dump, backup to storage, and restore operations.
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile mariadb up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as database from "../database";
import * as restic from "../restic";
import type { MariadbJob, LocalStorage } from "@uni-backups/shared/config";

const execAsync = promisify(exec);

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

// Detect Docker environment
const isDocker = process.env.MARIADB_HOST || process.env.REDIS_HOST === "redis";
const MARIADB_HOST = process.env.MARIADB_HOST || (isDocker ? "mariadb" : "localhost");
const MARIADB_PORT = parseInt(process.env.MARIADB_PORT || (isDocker ? "3306" : "3306"), 10);
const MARIADB_RESTORE_HOST = isDocker ? "mariadb-restore" : "localhost";
const MARIADB_RESTORE_PORT = isDocker ? 3306 : 3307;

// MariaDB primary configuration (has seed data)
const mariadbJob: MariadbJob = {
  type: "mariadb",
  host: MARIADB_HOST,
  port: MARIADB_PORT,
  user: "testuser",
  password: "testpass123",
  database: "testdb",
};

// MariaDB restore target (empty database)
const mariadbRestoreJob: MariadbJob = {
  type: "mariadb",
  host: MARIADB_RESTORE_HOST,
  port: MARIADB_RESTORE_PORT,
  user: "testuser",
  password: "testpass123",
  database: "restoredb",
};

// Local storage for backups
let testDir: string;
let repoDir: string;
let restoreDir: string;
let localStorage: LocalStorage;

describe("MariaDB Database Backup/Restore Integration Tests", () => {
  let testRepoCounter = 0;

  // Generate unique repo name
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  // Helper to run MySQL commands on database
  // Note: Use --skip-ssl for Alpine mariadb-client which defaults to SSL
  const runMysql = async (
    sql: string,
    job: MariadbJob = mariadbJob
  ): Promise<string> => {
    const { stdout } = await execAsync(
      `mariadb -h ${job.host} -P ${job.port} -u ${job.user} -p${job.password} --skip-ssl ${job.database} -N -e "${sql}"`,
      { timeout: 30000 }
    );
    return stdout.trim();
  };

  // Helper to get row count from a table
  const getRowCount = async (
    table: string,
    job: MariadbJob = mariadbJob
  ): Promise<number> => {
    const result = await runMysql(`SELECT COUNT(*) FROM ${table}`, job);
    return parseInt(result, 10);
  };

  // Helper to restore a SQL dump to the restore database
  // Note: Use --skip-ssl for Alpine mariadb-client which defaults to SSL
  const restoreDump = async (dumpPath: string): Promise<void> => {
    await execAsync(
      `mariadb -h ${mariadbRestoreJob.host} -P ${mariadbRestoreJob.port} -u ${mariadbRestoreJob.user} -p${mariadbRestoreJob.password} --skip-ssl ${mariadbRestoreJob.database} < "${dumpPath}"`,
      { timeout: 120000 }
    );
  };

  // Helper to clear the restore database
  const clearRestoreDb = async (): Promise<void> => {
    try {
      // Get all tables and drop them
      const tables = await runMysql("SHOW TABLES", mariadbRestoreJob);
      if (tables) {
        const tableList = tables.split("\n").filter(Boolean);
        if (tableList.length > 0) {
          // Build a single command that disables FK checks, drops all tables, then re-enables
          // This ensures FK checks are disabled in the same session as the DROP commands
          // Note: Table names don't need quoting if they're simple identifiers
          const dropStatements = tableList.map(t => `DROP TABLE IF EXISTS ${t}`).join("; ");
          const fullCommand = `SET FOREIGN_KEY_CHECKS = 0; ${dropStatements}; SET FOREIGN_KEY_CHECKS = 1`;
          await runMysql(fullCommand, mariadbRestoreJob);
        }
      }
    } catch {
      // Ignore errors if tables don't exist
    }
  };

  // Helper to check MariaDB connectivity with retry
  const checkMariadbConnection = async (job: MariadbJob, retries = 10): Promise<boolean> => {
    for (let i = 0; i < retries; i++) {
      try {
        await runMysql("SELECT 1", job);
        return true;
      } catch {
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }
    return false;
  };

  beforeAll(async () => {
    // Create test directories
    testDir = `/tmp/mariadb-integration-test-${Date.now()}`;
    repoDir = join(testDir, "repos");
    restoreDir = join(testDir, "restore");

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    localStorage = {
      type: "local",
      path: repoDir,
    };

    // Verify both MariaDB instances are accessible
    const primaryConnected = await checkMariadbConnection(mariadbJob);
    if (!primaryConnected) {
      throw new Error(
        "MariaDB primary is not running. Start with: docker compose -f tests/compose/services.yml --profile mariadb up -d"
      );
    }

    const restoreConnected = await checkMariadbConnection(mariadbRestoreJob);
    if (!restoreConnected) {
      throw new Error(
        "MariaDB restore target is not running. Start with: docker compose -f tests/compose/services.yml --profile mariadb up -d"
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
    await clearRestoreDb();
  });

  describe("Database Connectivity", () => {
    it("can connect to primary MariaDB database", async () => {
      const result = await runMysql("SELECT 1");
      expect(result).toBe("1");
    }, TEST_TIMEOUT);

    it("can connect to restore MariaDB database", async () => {
      const result = await runMysql("SELECT 1", mariadbRestoreJob);
      expect(result).toBe("1");
    }, TEST_TIMEOUT);

    it("primary database has seed data", async () => {
      const productCount = await getRowCount("products");
      const inventoryCount = await getRowCount("inventory");
      const customerCount = await getRowCount("customers");
      const salesCount = await getRowCount("sales");

      expect(productCount).toBe(5);
      expect(inventoryCount).toBe(5);
      expect(customerCount).toBe(3);
      expect(salesCount).toBe(5);
    }, TEST_TIMEOUT);

    it("restore database is empty after cleanup", async () => {
      // Explicitly clear restore database to ensure clean state
      // Use single command with FK checks disabled in same session
      const existingTables = await runMysql("SHOW TABLES", mariadbRestoreJob);
      if (existingTables) {
        const tableList = existingTables.split("\n").filter(Boolean);
        if (tableList.length > 0) {
          // Build a single command that disables FK checks, drops all tables, then re-enables
          // Note: Table names don't need quoting if they're simple identifiers
          const dropStatements = tableList.map(t => `DROP TABLE IF EXISTS ${t}`).join("; ");
          const fullCommand = `SET FOREIGN_KEY_CHECKS = 0; ${dropStatements}; SET FOREIGN_KEY_CHECKS = 1`;
          await runMysql(fullCommand, mariadbRestoreJob);
        }
      }

      // Now verify it's empty
      const tables = await runMysql("SHOW TABLES", mariadbRestoreJob);
      expect(tables).toBe("");
    }, TEST_TIMEOUT);
  });

  describe("dumpMariadb", () => {
    it("creates SQL dump file for single database", async () => {
      const result = await database.dumpMariadb(mariadbJob);

      expect(result.success).toBe(true);
      expect(result.dumpPath).toBeDefined();
      expect(existsSync(result.dumpPath!)).toBe(true);

      // Verify dump contains expected SQL
      const dumpContent = readFileSync(result.dumpPath!, "utf-8");
      expect(dumpContent).toContain("CREATE TABLE");
      expect(dumpContent).toContain("products");
      expect(dumpContent).toContain("inventory");
      expect(dumpContent).toContain("customers");
      expect(dumpContent).toContain("sales");

      // Cleanup
      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);

    it("dump contains data inserts", async () => {
      const result = await database.dumpMariadb(mariadbJob);

      const dumpContent = readFileSync(result.dumpPath!, "utf-8");

      // Should contain the seed data
      expect(dumpContent).toContain("Widget A");
      expect(dumpContent).toContain("John Doe");
      expect(dumpContent).toContain("warehouse-1");

      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);

    it("dump file is valid and can be restored", async () => {
      const result = await database.dumpMariadb(mariadbJob);

      // Restore to the restore database
      await restoreDump(result.dumpPath!);

      // Verify data was restored
      const productCount = await getRowCount("products", mariadbRestoreJob);
      const inventoryCount = await getRowCount("inventory", mariadbRestoreJob);
      const customerCount = await getRowCount("customers", mariadbRestoreJob);
      const salesCount = await getRowCount("sales", mariadbRestoreJob);

      expect(productCount).toBe(5);
      expect(inventoryCount).toBe(5);
      expect(customerCount).toBe(3);
      expect(salesCount).toBe(5);

      database.cleanupDump(result.dumpPath!);
    }, TEST_TIMEOUT);
  });

  describe("runDatabaseBackup", () => {
    it("backs up MariaDB database to local storage", async () => {
      const repoName = getUniqueRepoName("maria-backup-test");

      const result = await database.runDatabaseBackup(
        mariadbJob,
        "maria-test-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.message).toContain("backup completed");
    }, TEST_TIMEOUT);

    it("creates snapshot with correct tags", async () => {
      const repoName = getUniqueRepoName("maria-tags-test");
      const jobWithTags: MariadbJob = {
        ...mariadbJob,
        tags: ["staging", "hourly"],
      };

      await database.runDatabaseBackup(
        jobWithTags,
        "maria-tagged-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // List snapshots and verify tags
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(snapshots.success).toBe(true);
      expect(snapshots.snapshots?.length).toBe(1);
      expect(snapshots.snapshots![0].tags).toContain("staging");
      expect(snapshots.snapshots![0].tags).toContain("hourly");
      expect(snapshots.snapshots![0].tags).toContain("maria-tagged-job");
      expect(snapshots.snapshots![0].tags).toContain("mariadb");
    }, TEST_TIMEOUT);

    it("cleans up dump file after backup", async () => {
      const repoName = getUniqueRepoName("maria-cleanup-test");

      // Get temp dir path
      const tempDir = "/tmp/uni-backups-temp";

      await database.runDatabaseBackup(
        mariadbJob,
        "maria-cleanup-job",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Check that no mariadb dump files remain in temp
      const { stdout } = await execAsync(`ls ${tempDir} 2>/dev/null || echo ""`);
      const mariaDumps = stdout.split("\n").filter((f) => f.includes("mariadb-testdb"));

      expect(mariaDumps.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("backs up and restores MariaDB database with data verification", async () => {
      const repoName = getUniqueRepoName("maria-full-cycle-test");

      // Step 1: Get original data counts
      const originalProducts = await getRowCount("products");
      const originalInventory = await getRowCount("inventory");
      const originalCustomers = await getRowCount("customers");
      const originalSales = await getRowCount("sales");

      // Get specific data for verification
      const widgetAPrice = await runMysql(
        "SELECT price FROM products WHERE name = 'Widget A'"
      );

      // Step 2: Backup the database
      const backupResult = await database.runDatabaseBackup(
        mariadbJob,
        "maria-full-cycle-job",
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
      const restoredProducts = await getRowCount("products", mariadbRestoreJob);
      const restoredInventory = await getRowCount("inventory", mariadbRestoreJob);
      const restoredCustomers = await getRowCount("customers", mariadbRestoreJob);
      const restoredSales = await getRowCount("sales", mariadbRestoreJob);

      expect(restoredProducts).toBe(originalProducts);
      expect(restoredInventory).toBe(originalInventory);
      expect(restoredCustomers).toBe(originalCustomers);
      expect(restoredSales).toBe(originalSales);

      // Verify specific data
      const restoredWidgetAPrice = await runMysql(
        "SELECT price FROM products WHERE name = 'Widget A'",
        mariadbRestoreJob
      );
      expect(restoredWidgetAPrice).toBe(widgetAPrice);
    }, TEST_TIMEOUT);

    it("preserves decimal precision through backup/restore", async () => {
      const repoName = getUniqueRepoName("maria-decimal-test");

      // Get original decimal data
      const originalPrice = await runMysql(
        "SELECT price FROM products WHERE name = 'Gadget X'"
      );

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        mariadbJob,
        "maria-decimal-job",
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

      const restoredPrice = await runMysql(
        "SELECT price FROM products WHERE name = 'Gadget X'",
        mariadbRestoreJob
      );

      expect(restoredPrice).toBe(originalPrice);
    }, TEST_TIMEOUT);

    it("preserves foreign key relationships through backup/restore", async () => {
      const repoName = getUniqueRepoName("maria-fk-test");

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        mariadbJob,
        "maria-fk-job",
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

      // Verify FK relationship still works by joining tables
      const joinResult = await runMysql(
        "SELECT COUNT(*) FROM sales s JOIN customers c ON s.customer_id = c.id",
        mariadbRestoreJob
      );

      expect(parseInt(joinResult, 10)).toBe(5);
    }, TEST_TIMEOUT);

    it("preserves indexes through backup/restore", async () => {
      const repoName = getUniqueRepoName("maria-index-test");

      // Backup and restore
      const backupResult = await database.runDatabaseBackup(
        mariadbJob,
        "maria-index-job",
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
      const indexCount = await runMysql(
        "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = 'restoredb' AND index_name LIKE 'idx_%'",
        mariadbRestoreJob
      );

      expect(parseInt(indexCount, 10)).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe("Multiple Backup Versions", () => {
    it("can restore different versions of database", async () => {
      const repoName = getUniqueRepoName("maria-versions-test");

      // Version 1: Current state
      const backup1 = await database.runDatabaseBackup(
        mariadbJob,
        "maria-v1",
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );

      // Add a new customer to the primary database
      await runMysql(
        "INSERT INTO customers (name, email, phone) VALUES ('New Customer', 'new@example.com', '555-9999')"
      );

      // Version 2: With new customer
      const backup2 = await database.runDatabaseBackup(
        mariadbJob,
        "maria-v2",
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

      const v1CustomerCount = await getRowCount("customers", mariadbRestoreJob);

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

      const v2CustomerCount = await getRowCount("customers", mariadbRestoreJob);

      // Version 2 should have one more customer
      expect(v2CustomerCount).toBe(v1CustomerCount + 1);

      // Cleanup: Remove the test customer we added
      await runMysql("DELETE FROM customers WHERE email = 'new@example.com'");
    }, TEST_TIMEOUT);
  });

  describe("Retention and Pruning", () => {
    it("can prune old MariaDB backups", async () => {
      const repoName = getUniqueRepoName("maria-prune-test");

      // Create multiple backups with CONSISTENT job name (for tag grouping)
      for (let i = 1; i <= 3; i++) {
        await database.runDatabaseBackup(
          mariadbJob,
          "maria-prune-job", // Same job name = same tag for all backups
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
      const invalidJob: MariadbJob = {
        type: "mariadb",
        host: "localhost",
        port: 59999, // Invalid port
        user: "testuser",
        password: "testpass123",
        database: "testdb",
      };

      const result = await database.dumpMariadb(invalidJob);

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    }, TEST_TIMEOUT);

    it("handles wrong password gracefully", async () => {
      const invalidJob: MariadbJob = {
        ...mariadbJob,
        password: "wrongpassword",
      };

      const result = await database.dumpMariadb(invalidJob);

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);

    it("handles non-existent database gracefully", async () => {
      const invalidJob: MariadbJob = {
        ...mariadbJob,
        database: "nonexistent_database",
      };

      const result = await database.dumpMariadb(invalidJob);

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("cleanupDump", () => {
    it("removes dump file after cleanup", async () => {
      const result = await database.dumpMariadb(mariadbJob);

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
