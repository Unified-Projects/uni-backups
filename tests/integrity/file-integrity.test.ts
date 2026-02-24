/**
 * File Integrity Tests
 *
 * Thorough verification of file backup and restore integrity
 * using SHA256 checksums and byte-by-byte comparison.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  createLocalTestRepo,
  createTestBackup,
  cleanupTestRepo,
  restoreSnapshot,
  type TestRepo,
} from "../utils/restic-helpers";
import {
  generateTestDataSet,
  generateLargeFile,
  generateDeepNestedStructure,
  generateBinaryWithPattern,
  COMPREHENSIVE_TEST_FILES,
  FILE_SIZES,
  cleanupTestData,
  type TestDataSet,
} from "../utils/test-data-generator";
import {
  computeDirectoryManifest,
  verifyDirectoryIntegrity,
  assertDirectoriesEqual,
  computeFileChecksum,
  compareByteByByte,
  compareByteByByteAsync,
  type DirectoryManifest,
} from "../utils/checksum-helpers";
import * as restic from "../../apps/api/src/services/restic";

// Long timeout for integrity tests with large files
const INTEGRITY_TIMEOUT = 300000; // 5 minutes

describe("File Integrity Tests", () => {
  // ==========================================================================
  // Basic File Type Integrity
  // ==========================================================================

  describe("Basic File Type Integrity", { timeout: INTEGRITY_TIMEOUT }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("integrity-basic");
    });

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("preserves text file integrity through backup/restore", async () => {
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "text/simple.txt", size: 0, type: "text", content: "Simple text content\nWith multiple lines\n" },
        { name: "text/unicode.txt", size: 0, type: "text", content: "Unicode content: Bonjour! Hola! Привет! 你好!" },
        { name: "text/empty.txt", size: 0, type: "empty" },
      ]);

      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await createTestBackup(repo, {});
      await restic.backup(repo.storage, repo.name, repo.password, testData.basePath);

      const snapshots = await restic.listSnapshots(repo.storage, repo.name, repo.password);
      expect(snapshots.snapshots!.length).toBeGreaterThan(0);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        snapshots.snapshots![0].short_id,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
      expect(verification.mismatches).toHaveLength(0);
    });

    it("preserves binary file integrity through backup/restore", async () => {
      // Create binary files with known patterns
      const binaryFile = generateBinaryWithPattern(
        join(repo.tempDir, "binary/pattern.bin"),
        [0xDE, 0xAD, 0xBE, 0xEF],
        4096
      );

      const sourceChecksum = computeFileChecksum(binaryFile.path);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredFile = join(restoreDir, repo.tempDir, "binary/pattern.bin");
      const restoredChecksum = computeFileChecksum(restoredFile);

      expect(restoredChecksum.sha256).toBe(sourceChecksum.sha256);
      expect(restoredChecksum.md5).toBe(sourceChecksum.md5);
      expect(restoredChecksum.size).toBe(sourceChecksum.size);

      // Also do byte-by-byte comparison
      const bytesMatch = compareByteByByte(binaryFile.path, restoredFile);
      expect(bytesMatch).toBe(true);
    });

    it("preserves JSON file structure and content", async () => {
      const jsonContent = JSON.stringify({
        name: "test-config",
        version: "1.0.0",
        settings: {
          debug: true,
          timeout: 5000,
          nested: {
            deep: {
              value: "preserved",
            },
          },
        },
        array: [1, 2, 3, "string", { key: "value" }],
      }, null, 2);

      const testData = generateTestDataSet(repo.tempDir, [
        { name: "json/config.json", size: 0, type: "json", content: jsonContent },
      ]);

      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      // Read and parse restored JSON
      const restoredJsonPath = join(restoreDir, testData.basePath, "json/config.json");
      const restoredContent = readFileSync(restoredJsonPath, "utf-8");
      const restoredJson = JSON.parse(restoredContent);

      expect(restoredJson.name).toBe("test-config");
      expect(restoredJson.settings.nested.deep.value).toBe("preserved");
      expect(restoredJson.array).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Large File Integrity
  // ==========================================================================

  describe("Large File Integrity", { timeout: INTEGRITY_TIMEOUT }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("integrity-large");
    });

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("preserves 1MB file integrity with checksum verification", async () => {
      const largeFile = generateLargeFile(
        join(repo.tempDir, "large-1mb.bin"),
        FILE_SIZES.MEDIUM,
        { seed: 12345, type: "random" }
      );

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredFile = join(restoreDir, repo.tempDir, "large-1mb.bin");
      const restoredChecksum = computeFileChecksum(restoredFile);

      expect(restoredChecksum.sha256).toBe(largeFile.checksums.sha256);
      expect(restoredChecksum.size).toBe(FILE_SIZES.MEDIUM);
    });

    it("preserves 10MB file integrity with async byte-by-byte comparison", async () => {
      const largeFile = generateLargeFile(
        join(repo.tempDir, "large-10mb.bin"),
        FILE_SIZES.LARGE,
        { seed: 54321, type: "random" }
      );

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredFile = join(restoreDir, repo.tempDir, "large-10mb.bin");

      // Use async comparison for large files
      const bytesMatch = await compareByteByByteAsync(largeFile.path, restoredFile);
      expect(bytesMatch).toBe(true);
    });

    it("preserves 100MB file integrity", async () => {
      const largeFile = generateLargeFile(
        join(repo.tempDir, "large-100mb.bin"),
        FILE_SIZES.XLARGE,
        { seed: 99999, type: "pattern", pattern: [0xAB, 0xCD, 0xEF, 0x12] }
      );

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredFile = join(restoreDir, repo.tempDir, "large-100mb.bin");
      const restoredChecksum = computeFileChecksum(restoredFile);

      expect(restoredChecksum.sha256).toBe(largeFile.checksums.sha256);
    });
  });

  // ==========================================================================
  // Directory Structure Integrity
  // ==========================================================================

  describe("Directory Structure Integrity", { timeout: INTEGRITY_TIMEOUT }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("integrity-dir");
    });

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("preserves deeply nested directory structure", async () => {
      const deepData = generateDeepNestedStructure(
        join(repo.tempDir, "deep"),
        10, // 10 levels deep
        3,  // 3 files per level
        { fileSizeRange: [100, 1000], seed: 42 }
      );

      const sourceManifest = computeDirectoryManifest(deepData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        deepData.basePath
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, deepData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
      expect(verification.verified).toBe(sourceManifest.fileCount);
    });

    it("preserves comprehensive test file set integrity", async () => {
      const testData = generateTestDataSet(repo.tempDir, COMPREHENSIVE_TEST_FILES);
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
      expect(verification.mismatches).toHaveLength(0);

      // Log verification stats
      console.log(`Verified ${verification.verified} files`);
      console.log(`Total size: ${sourceManifest.totalSize} bytes`);
    });

    it("preserves special character filenames", async () => {
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "spaces/file with spaces.txt", size: 0, type: "text", content: "Spaces" },
        { name: "dashes/file-with-dashes.txt", size: 0, type: "text", content: "Dashes" },
        { name: "unicode/chinois.txt", size: 0, type: "text", content: "Chinois" },
        { name: "dots/file.multiple.dots.txt", size: 0, type: "text", content: "Dots" },
      ]);

      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backup.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
    });
  });

  // ==========================================================================
  // Incremental Backup Integrity
  // ==========================================================================

  describe("Incremental Backup Integrity", { timeout: INTEGRITY_TIMEOUT }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("integrity-incremental");
    });

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("preserves integrity across multiple incremental backups", async () => {
      // Create initial data
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "file1.txt", size: 0, type: "text", content: "Original content 1" },
        { name: "file2.txt", size: 0, type: "text", content: "Original content 2" },
      ]);

      // First backup
      const backup1 = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );
      expect(backup1.success).toBe(true);

      // Modify one file
      require("fs").writeFileSync(
        join(testData.basePath, "file1.txt"),
        "Modified content 1"
      );

      // Add new file
      require("fs").writeFileSync(
        join(testData.basePath, "file3.txt"),
        "New file content"
      );

      // Second backup (incremental)
      const backup2 = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );
      expect(backup2.success).toBe(true);

      // Get manifest after changes
      const finalManifest = computeDirectoryManifest(testData.basePath);

      // Restore latest snapshot
      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup2.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, finalManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
      expect(verification.verified).toBe(3); // 3 files total
    });

    it("can restore from any point in backup history", async () => {
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "data.txt", size: 0, type: "text", content: "Version 1" },
      ]);

      // Create 3 versions
      const snapshots: string[] = [];

      for (let version = 1; version <= 3; version++) {
        require("fs").writeFileSync(
          join(testData.basePath, "data.txt"),
          `Version ${version}`
        );

        const backup = await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          testData.basePath
        );
        expect(backup.success).toBe(true);
        snapshots.push(backup.snapshotId!);
      }

      // Restore each version and verify content
      for (let i = 0; i < snapshots.length; i++) {
        const restoreDir = join(repo.tempDir, `restored-v${i + 1}`);
        mkdirSync(restoreDir, { recursive: true });

        await restic.restore(
          repo.storage,
          repo.name,
          repo.password,
          snapshots[i],
          restoreDir
        );

        const content = readFileSync(
          join(restoreDir, testData.basePath, "data.txt"),
          "utf-8"
        );

        expect(content).toBe(`Version ${i + 1}`);
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Edge Cases", { timeout: INTEGRITY_TIMEOUT }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("integrity-edge");
    });

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("handles empty files correctly", async () => {
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "empty1.txt", size: 0, type: "empty" },
        { name: "empty2.bin", size: 0, type: "empty" },
        { name: "dir/empty3.txt", size: 0, type: "empty" },
      ]);

      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
    });

    it("handles single-byte files correctly", async () => {
      const testData = generateTestDataSet(repo.tempDir, [
        { name: "1byte-null.bin", size: 1, type: "pattern", pattern: [0x00] },
        { name: "1byte-ff.bin", size: 1, type: "pattern", pattern: [0xFF] },
        { name: "1byte-a.txt", size: 0, type: "text", content: "A" },
      ]);

      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredPath = join(restoreDir, testData.basePath);
      const verification = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verification.match).toBe(true);
    });

    it("handles files with all byte values (0x00-0xFF)", async () => {
      // Create a file containing all 256 byte values
      const allBytesPattern: number[] = [];
      for (let i = 0; i < 256; i++) {
        allBytesPattern.push(i);
      }

      const allBytesFile = generateBinaryWithPattern(
        join(repo.tempDir, "all-bytes.bin"),
        allBytesPattern,
        256 * 4 // Repeat pattern 4 times
      );

      const sourceChecksum = computeFileChecksum(allBytesFile.path);

      const backup = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId!,
        restoreDir
      );

      const restoredFile = join(restoreDir, repo.tempDir, "all-bytes.bin");
      const restoredChecksum = computeFileChecksum(restoredFile);

      expect(restoredChecksum.sha256).toBe(sourceChecksum.sha256);

      // Verify byte-by-byte
      const bytesMatch = compareByteByByte(allBytesFile.path, restoredFile);
      expect(bytesMatch).toBe(true);
    });
  });
});
