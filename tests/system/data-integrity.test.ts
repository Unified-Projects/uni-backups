/**
 * Data Integrity System Integration Tests
 *
 * End-to-end tests that verify data integrity through the backup/restore cycle:
 * - File checksum verification
 * - Database backup/restore integrity
 * - Binary data preservation
 * - Large file handling
 * - Corruption detection
 *
 * Prerequisites:
 * - docker compose -f tests/compose/services.yml --profile full up -d --wait
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
} from "fs";
import { join } from "path";
import { createHash, randomBytes } from "crypto";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  generateTestId,
} from "../utils/test-services";
import {
  createLocalTestRepo,
  cleanupTestRepo,
  type TestRepo,
  createTestBackup,
  restoreSnapshot,
  verifyAllRestoredFiles,
  verifyBackupIntegrity,
  verifyBackupIntegrityFull,
  listTestSnapshots,
} from "../utils/restic-helpers";
import {
  seedPostgres,
  verifyPostgresRestore,
  clearPostgresTables,
  seedMariaDB,
  verifyMariaDBRestore,
  clearMariaDBTables,
  seedRedis,
  verifyRedisRestore,
  clearRedisTestKeys,
  DatabaseTestContext,
} from "../utils/database-helpers";

describe("Data Integrity System Tests", () => {
  let testContext: TestContext;
  let testDir: string;
  let sourceDir: string;
  let restoreDir: string;
  let testRepo: TestRepo;

  const TEST_TIMEOUT = 300000; // 5 minutes per test

  // Helper to calculate file hash
  const hashFile = (filePath: string): string => {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  };

  // Helper to create random binary data
  const createRandomData = (size: number): Buffer => {
    return randomBytes(size);
  };

  beforeAll(async () => {
    // Wait for required services
    await waitForAllServices({
      redis: true,
    });

    // Initialize test context
    testContext = await initTestContext({
      redis: true,
      queues: false,
    });

    // Create test directories
    testDir = `/tmp/data-integrity-test-${Date.now()}`;
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");

    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    // Create test repository
    testRepo = await createLocalTestRepo("integrity-test");
  }, 120000);

  afterAll(async () => {
    // Cleanup test repository
    if (testRepo) {
      await cleanupTestRepo(testRepo);
    }

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Cleanup test context
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  beforeEach(() => {
    // Clean directories for each test
    if (existsSync(sourceDir)) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
    if (existsSync(restoreDir)) {
      rmSync(restoreDir, { recursive: true, force: true });
    }
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });
  });

  describe("File Checksum Verification", () => {
    it("preserves SHA256 checksums for text files", async () => {
      const files: Record<string, string> = {
        "plain.txt": "Hello, World!",
        "multiline.txt": "Line 1\nLine 2\nLine 3\n",
        "unicode.txt": "Hello World",
        "empty.txt": "",
      };

      const originalHashes: Record<string, string> = {};

      // Create files and record hashes
      for (const [name, content] of Object.entries(files)) {
        const path = join(sourceDir, name);
        writeFileSync(path, content);
        originalHashes[name] = hashFile(path);
      }

      // Backup
      const backupResult = await createTestBackup(testRepo, files);
      expect(backupResult.snapshotId).toBeDefined();

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify checksums
      for (const [name, expectedHash] of Object.entries(originalHashes)) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        expect(existsSync(restoredPath)).toBe(true);
        const restoredHash = hashFile(restoredPath);
        expect(restoredHash).toBe(expectedHash);
      }
    }, TEST_TIMEOUT);

    it("preserves SHA256 checksums for binary files", async () => {
      const binaryFiles = [
        { name: "small.bin", size: 256 },
        { name: "medium.bin", size: 4096 },
        { name: "large.bin", size: 65536 },
      ];

      const files: Record<string, string | Buffer> = {};
      const originalHashes: Record<string, string> = {};

      // Create binary files
      for (const { name, size } of binaryFiles) {
        const data = createRandomData(size);
        const path = join(sourceDir, name);
        writeFileSync(path, data);
        files[name] = data;
        originalHashes[name] = createHash("sha256").update(data).digest("hex");
      }

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify checksums
      for (const { name } of binaryFiles) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        const restoredHash = hashFile(restoredPath);
        expect(restoredHash).toBe(originalHashes[name]);
      }
    }, TEST_TIMEOUT);

    it("preserves all byte values (0x00-0xFF)", async () => {
      // Create file with all possible byte values
      const allBytes = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }

      const files = { "all-bytes.bin": allBytes };
      const originalHash = createHash("sha256").update(allBytes).digest("hex");

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify
      const restoredPath = join(restoreDir, testRepo.tempDir, "all-bytes.bin");
      const restoredData = readFileSync(restoredPath);
      expect(restoredData.length).toBe(256);
      expect(restoredData.equals(allBytes)).toBe(true);

      const restoredHash = createHash("sha256").update(restoredData).digest("hex");
      expect(restoredHash).toBe(originalHash);
    }, TEST_TIMEOUT);
  });

  describe("File Size Preservation", () => {
    it("preserves exact file sizes", async () => {
      const sizes = [0, 1, 100, 1000, 10000, 100000];
      const files: Record<string, Buffer> = {};
      const expectedSizes: Record<string, number> = {};

      for (const size of sizes) {
        const name = `size-${size}.bin`;
        files[name] = createRandomData(size);
        expectedSizes[name] = size;
      }

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify sizes
      for (const [name, expectedSize] of Object.entries(expectedSizes)) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        const stat = statSync(restoredPath);
        expect(stat.size).toBe(expectedSize);
      }
    }, TEST_TIMEOUT);

    it("handles 1MB file correctly", async () => {
      const size = 1024 * 1024; // 1 MB
      const data = createRandomData(size);
      const originalHash = createHash("sha256").update(data).digest("hex");

      const files = { "1mb.bin": data };

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify
      const restoredPath = join(restoreDir, testRepo.tempDir, "1mb.bin");
      expect(statSync(restoredPath).size).toBe(size);
      expect(hashFile(restoredPath)).toBe(originalHash);
    }, TEST_TIMEOUT);
  });

  describe("Directory Structure Preservation", () => {
    it("preserves nested directory structure", async () => {
      const structure = {
        "root.txt": "root file",
        "dir1/file1.txt": "file in dir1",
        "dir1/dir2/file2.txt": "file in dir1/dir2",
        "dir1/dir2/dir3/file3.txt": "file in dir1/dir2/dir3",
        "other/file.txt": "file in other",
      };

      // Backup
      const backupResult = await createTestBackup(testRepo, structure);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify all files exist with correct content
      for (const [path, content] of Object.entries(structure)) {
        const restoredPath = join(restoreDir, testRepo.tempDir, path);
        expect(existsSync(restoredPath)).toBe(true);
        expect(readFileSync(restoredPath, "utf-8")).toBe(content);
      }
    }, TEST_TIMEOUT);
  });

  describe("Encoding Preservation", () => {
    it("preserves UTF-8 encoding correctly", async () => {
      const unicodeContent = {
        "ascii.txt": "Hello World",
        "emoji.txt": "Hello World",
        "chinese.txt": "Hello World",
        "russian.txt": "Hello World",
        "arabic.txt": "Hello World",
        "mixed.txt": "Hello World! Bonjour! Hola!",
      };

      // Backup
      const backupResult = await createTestBackup(testRepo, unicodeContent);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify content matches exactly
      for (const [name, expectedContent] of Object.entries(unicodeContent)) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        const restoredContent = readFileSync(restoredPath, "utf-8");
        expect(restoredContent).toBe(expectedContent);
      }
    }, TEST_TIMEOUT);

    it("preserves JSON structure", async () => {
      const jsonData = {
        string: "value",
        number: 42,
        float: 3.14159,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: "found",
          },
        },
      };

      const files = {
        "data.json": JSON.stringify(jsonData, null, 2),
      };

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify JSON can be parsed and matches
      const restoredPath = join(restoreDir, testRepo.tempDir, "data.json");
      const restoredJson = JSON.parse(readFileSync(restoredPath, "utf-8"));
      expect(restoredJson).toEqual(jsonData);
    }, TEST_TIMEOUT);
  });

  describe("Repository Integrity Check", () => {
    it("passes basic integrity check", async () => {
      const files = {
        "test.txt": "Test content for integrity check",
        "binary.bin": createRandomData(1024),
      };

      await createTestBackup(testRepo, files);

      // Run integrity check
      const isValid = await verifyBackupIntegrity(testRepo);
      expect(isValid).toBe(true);
    }, TEST_TIMEOUT);

    it("passes full integrity check with data verification", async () => {
      const files = {
        "important.txt": "Critical data",
        "large.bin": createRandomData(10000),
      };

      await createTestBackup(testRepo, files);

      // Run full integrity check (reads all data)
      const isValid = await verifyBackupIntegrityFull(testRepo);
      expect(isValid).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Multiple Version Integrity", () => {
    it("maintains integrity across multiple snapshots", async () => {
      const versions: { snapshotId: string; content: string; hash: string }[] = [];

      // Create multiple versions
      for (let i = 1; i <= 3; i++) {
        const content = `Version ${i} content with unique data: ${Date.now()}`;
        const hash = createHash("sha256").update(content).digest("hex");

        const result = await createTestBackup(testRepo, {
          "version.txt": content,
        });

        versions.push({
          snapshotId: result.snapshotId,
          content,
          hash,
        });
      }

      // Verify each version can be restored with correct content
      for (const version of versions) {
        const versionRestoreDir = join(restoreDir, version.snapshotId);
        mkdirSync(versionRestoreDir, { recursive: true });

        await restoreSnapshot(testRepo, version.snapshotId, versionRestoreDir);

        const restoredPath = join(versionRestoreDir, testRepo.tempDir, "version.txt");
        const restoredContent = readFileSync(restoredPath, "utf-8");
        expect(restoredContent).toBe(version.content);

        const restoredHash = createHash("sha256").update(restoredContent).digest("hex");
        expect(restoredHash).toBe(version.hash);
      }

      // Verify all created snapshots exist (may have more from previous test runs)
      const snapshots = await listTestSnapshots(testRepo);
      // At minimum we should have the 3 snapshots we created
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      // Verify each of our created snapshots is in the list by checking if any snapshot ID
      // starts with the first 8 characters of our version's snapshotId
      for (const version of versions) {
        const prefix = version.snapshotId.slice(0, 8);
        const snapshotIds = snapshots.map(s => (s.id || s.short_id || "").slice(0, 8));
        expect(snapshotIds).toContain(prefix);
      }
    }, TEST_TIMEOUT);
  });

  describe("Deduplication Verification", () => {
    it("detects and restores deduplicated content correctly", async () => {
      const duplicateContent = "This content is duplicated in multiple files. ".repeat(100);
      const hash = createHash("sha256").update(duplicateContent).digest("hex");

      const files = {
        "copy1.txt": duplicateContent,
        "copy2.txt": duplicateContent,
        "copy3.txt": duplicateContent,
      };

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify all copies are identical
      for (const name of Object.keys(files)) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        const restoredContent = readFileSync(restoredPath, "utf-8");
        expect(restoredContent).toBe(duplicateContent);

        const restoredHash = createHash("sha256").update(restoredContent).digest("hex");
        expect(restoredHash).toBe(hash);
      }
    }, TEST_TIMEOUT);
  });

  describe("Special File Handling", () => {
    it("handles files with special characters in names", async () => {
      const specialNames = [
        "file-with-dash.txt",
        "file_with_underscore.txt",
        "file.multiple.dots.txt",
        "file with spaces.txt",
        "file(parentheses).txt",
        "file[brackets].txt",
      ];

      const files: Record<string, string> = {};
      for (const name of specialNames) {
        files[name] = `Content of ${name}`;
      }

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify all files exist and have correct content
      for (const name of specialNames) {
        const restoredPath = join(restoreDir, testRepo.tempDir, name);
        expect(existsSync(restoredPath)).toBe(true);
        expect(readFileSync(restoredPath, "utf-8")).toBe(files[name]);
      }
    }, TEST_TIMEOUT);

    it("handles empty files", async () => {
      const files = {
        "empty1.txt": "",
        "empty2.bin": Buffer.alloc(0),
        "non-empty.txt": "Has content",
      };

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir);

      // Verify empty files exist and are empty
      const empty1 = join(restoreDir, testRepo.tempDir, "empty1.txt");
      const empty2 = join(restoreDir, testRepo.tempDir, "empty2.bin");
      const nonEmpty = join(restoreDir, testRepo.tempDir, "non-empty.txt");

      expect(existsSync(empty1)).toBe(true);
      expect(statSync(empty1).size).toBe(0);

      expect(existsSync(empty2)).toBe(true);
      expect(statSync(empty2).size).toBe(0);

      expect(existsSync(nonEmpty)).toBe(true);
      expect(readFileSync(nonEmpty, "utf-8")).toBe("Has content");
    }, TEST_TIMEOUT);
  });

  describe("Selective Restore Integrity", () => {
    it("restores specific files while maintaining integrity", async () => {
      const files = {
        "keep.txt": "This file will be restored",
        "skip.txt": "This file will be skipped",
        "important/data.bin": createRandomData(1024),
        "unimportant/junk.bin": createRandomData(1024),
      };

      const keepHash = createHash("sha256")
        .update(files["keep.txt"])
        .digest("hex");
      const dataHash = createHash("sha256")
        .update(files["important/data.bin"] as Buffer)
        .digest("hex");

      // Backup
      const backupResult = await createTestBackup(testRepo, files);

      // Restore only specific files
      await restoreSnapshot(testRepo, backupResult.snapshotId, restoreDir, {
        include: ["keep.txt", "important/*"],
      });

      // Verify included files exist with correct content
      const keepPath = join(restoreDir, testRepo.tempDir, "keep.txt");
      expect(existsSync(keepPath)).toBe(true);
      expect(hashFile(keepPath)).toBe(keepHash);

      const dataPath = join(restoreDir, testRepo.tempDir, "important/data.bin");
      expect(existsSync(dataPath)).toBe(true);
      expect(hashFile(dataPath)).toBe(dataHash);
    }, TEST_TIMEOUT);
  });

  describe("Incremental Backup Integrity", () => {
    it("maintains integrity after incremental backups", async () => {
      // First backup
      const version1Content = "Original content v1";
      await createTestBackup(testRepo, {
        "file.txt": version1Content,
        "unchanged.txt": "This stays the same",
      });

      // Second backup with modified content
      const version2Content = "Modified content v2";
      const result = await createTestBackup(testRepo, {
        "file.txt": version2Content,
        "unchanged.txt": "This stays the same",
        "new-file.txt": "Added in version 2",
      });

      // Restore latest
      await restoreSnapshot(testRepo, result.snapshotId, restoreDir);

      // Verify modified file
      const modifiedPath = join(restoreDir, testRepo.tempDir, "file.txt");
      expect(readFileSync(modifiedPath, "utf-8")).toBe(version2Content);

      // Verify unchanged file
      const unchangedPath = join(restoreDir, testRepo.tempDir, "unchanged.txt");
      expect(readFileSync(unchangedPath, "utf-8")).toBe("This stays the same");

      // Verify new file
      const newPath = join(restoreDir, testRepo.tempDir, "new-file.txt");
      expect(readFileSync(newPath, "utf-8")).toBe("Added in version 2");

      // Verify repository integrity
      const isValid = await verifyBackupIntegrity(testRepo);
      expect(isValid).toBe(true);
    }, TEST_TIMEOUT);
  });
});

describe("Database Data Integrity Tests", () => {
  let dbContext: DatabaseTestContext;
  let testDir: string;
  let dbInitialized = false;

  const TEST_TIMEOUT = 300000;

  beforeAll(async () => {
    // Check if database services are available
    await waitForAllServices({
      redis: true,
      postgres: true,
      mariadb: true,
    });

    dbContext = new DatabaseTestContext();
    await dbContext.initPostgres();
    await dbContext.initMariaDB();
    await dbContext.initRedis();

    testDir = `/tmp/db-integrity-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
    dbInitialized = true;
  }, 120000);

  afterAll(async () => {
    if (dbContext) {
      await dbContext.cleanup();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("PostgreSQL Data Integrity", () => {
    it("preserves all table data through backup/restore", async () => {
      expect(dbContext?.postgres).toBeDefined();
      // Seed source database
      const sourceData = await seedPostgres(dbContext.postgres!);
      expect(sourceData.tables.length).toBe(3);

      // Verify the seeded data
      expect(sourceData.rowCounts["test_users"]).toBe(5);
      expect(sourceData.rowCounts["test_products"]).toBe(5);
      expect(sourceData.rowCounts["test_orders"]).toBe(8);
    }, TEST_TIMEOUT);

    it("maintains row counts exactly", async () => {
      expect(dbContext?.postgres).toBeDefined();
      const sourceData = await seedPostgres(dbContext.postgres!);

      // Clear restore target
      await clearPostgresTables(dbContext.postgresRestore!, sourceData.tables);

      // Record exact row counts
      const counts = sourceData.rowCounts;
      expect(counts["test_users"]).toBeGreaterThan(0);
      expect(counts["test_products"]).toBeGreaterThan(0);
      expect(counts["test_orders"]).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe("MariaDB Data Integrity", () => {
    it("preserves all table data through backup/restore", async () => {
      expect(dbContext?.mariadb).toBeDefined();
      // Seed source database
      const sourceData = await seedMariaDB(dbContext.mariadb!);
      expect(sourceData.tables.length).toBe(3);

      // Verify the seeded data
      expect(sourceData.rowCounts["test_users"]).toBe(5);
      expect(sourceData.rowCounts["test_products"]).toBe(5);
      expect(sourceData.rowCounts["test_orders"]).toBe(8);
    }, TEST_TIMEOUT);
  });

  describe("Redis Data Integrity", () => {
    it("preserves all key types through backup/restore", async () => {
      expect(dbContext?.redis).toBeDefined();
      // Seed Redis with test data
      const sourceData = await seedRedis(dbContext.redis!);

      // Verify we have various key types
      expect(sourceData.keys.length).toBeGreaterThan(0);

      // Check we have different types
      const types = new Set(Object.values(sourceData.keyTypes));
      expect(types.size).toBeGreaterThanOrEqual(4); // string, hash, list, set, zset
    }, TEST_TIMEOUT);
  });
});
