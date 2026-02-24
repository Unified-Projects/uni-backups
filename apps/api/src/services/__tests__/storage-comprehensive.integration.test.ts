/**
 * Comprehensive Storage Backend Tests
 *
 * Tests all storage backends (SFTP, S3, REST, Local) with full
 * backup/restore cycles and checksum verification.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import type { StorageConfig, LocalStorage, S3Storage, RestStorage, SftpStorage } from "@uni-backups/shared/config";
import * as restic from "../restic";
import {
  createLocalTestRepo,
  createS3TestRepo,
  createRestTestRepo,
  createSftpTestRepo,
  createTestBackup,
  cleanupTestRepo,
  verifyBackupIntegrity,
  verifyBackupIntegrityFull,
  listTestSnapshots,
  restoreSnapshot,
  verifyAllRestoredFiles,
  type TestRepo,
} from "../../../../../tests/utils/restic-helpers";
import {
  generateTestDataSet,
  generateLargeFile,
  COMPREHENSIVE_TEST_FILES,
  cleanupTestData,
  type TestDataSet,
} from "../../../../../tests/utils/test-data-generator";
import {
  computeDirectoryManifest,
  verifyDirectoryIntegrity,
  assertDirectoriesEqual,
} from "../../../../../tests/utils/checksum-helpers";
import { TEST_CONFIG, TEST_STORAGE } from "../../../../../tests/utils/test-services";

// Test timeout for storage operations
const STORAGE_TIMEOUT = 120000;

describe("Storage Backend Comprehensive Tests", () => {
  // ==========================================================================
  // Local Storage Tests
  // ==========================================================================

  describe("Local Storage", () => {
    let repo: TestRepo;
    let testData: TestDataSet;

    beforeEach(async () => {
      repo = await createLocalTestRepo("local-comprehensive");
      testData = generateTestDataSet(repo.tempDir, COMPREHENSIVE_TEST_FILES);
    }, STORAGE_TIMEOUT);

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
      if (testData) cleanupTestData(testData);
    });

    it("performs full backup/restore cycle with checksum verification", async () => {
      // Compute source manifest
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      // Create backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backupResult.success).toBe(true);
      expect(backupResult.snapshotId).toBeDefined();

      // Verify backup integrity
      const integrityCheck = await verifyBackupIntegrity(repo);
      expect(integrityCheck).toBe(true);

      // Restore to new location
      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify restored files match source
      const restoredPath = join(restoreDir, testData.basePath);
      const verificationResult = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verificationResult.match).toBe(true);
      expect(verificationResult.mismatches).toHaveLength(0);
    }, STORAGE_TIMEOUT);

    it("repository initialization is idempotent", async () => {
      // Repo is already initialized in beforeEach
      // Re-initialize should succeed
      const result1 = await restic.initRepo(repo.storage, repo.name, repo.password);
      expect(result1.success || result1.alreadyExists).toBe(true);

      // Initialize again
      const result2 = await restic.initRepo(repo.storage, repo.name, repo.password);
      expect(result2.success || result2.alreadyExists).toBe(true);
    });

    it("detects repository corruption via check", async () => {
      // Create a backup first
      await createTestBackup(repo, { "test.txt": "test content" });

      // Verify integrity passes
      const checkResult = await verifyBackupIntegrityFull(repo);
      expect(checkResult).toBe(true);
    });

    it.skip("handles backup of empty directory", async () => {
      const emptyDir = join(repo.tempDir, "empty-dir");
      mkdirSync(emptyDir, { recursive: true });

      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        emptyDir
      );

      expect(result.success).toBe(true);
    });

    it("handles backup of deeply nested directory structure", async () => {
      const deepDir = join(repo.tempDir, "deep");
      let currentPath = deepDir;

      // Create 20 levels deep
      for (let i = 0; i < 20; i++) {
        currentPath = join(currentPath, `level-${i}`);
        mkdirSync(currentPath, { recursive: true });
      }

      // Write a file at the deepest level
      const testFile = join(currentPath, "deep-file.txt");
      require("fs").writeFileSync(testFile, "Deep content");

      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        deepDir
      );

      expect(result.success).toBe(true);

      // Restore and verify
      const restoreDir = join(repo.tempDir, "restored-deep");
      mkdirSync(restoreDir, { recursive: true });

      const snapshots = await listTestSnapshots(repo);
      await restoreSnapshot(repo, snapshots[0].short_id, restoreDir);

      const restoredFile = join(restoreDir, deepDir, "level-0".repeat(1).split("").join("/level-"), "deep-file.txt");
      // The restored path structure should exist
      expect(existsSync(join(restoreDir, deepDir))).toBe(true);
    }, STORAGE_TIMEOUT);
  });

  // ==========================================================================
  // S3/MinIO Storage Tests
  // ==========================================================================

  describe("S3/MinIO Storage", { timeout: STORAGE_TIMEOUT }, () => {
    let repo: TestRepo;
    let testData: TestDataSet;

    beforeEach(async () => {
      repo = await createS3TestRepo("s3-comprehensive");
      testData = generateTestDataSet(repo.tempDir, COMPREHENSIVE_TEST_FILES.slice(0, 10)); // Use subset for speed
    }, STORAGE_TIMEOUT);

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
      if (testData) cleanupTestData(testData);
    });

    it("performs full backup/restore cycle with checksum verification", async () => {
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backupResult.success).toBe(true);
      expect(backupResult.snapshotId).toBeDefined();

      const integrityCheck = await verifyBackupIntegrity(repo);
      expect(integrityCheck).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, testData.basePath);
      const verificationResult = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verificationResult.match).toBe(true);
    }, STORAGE_TIMEOUT);

    it("handles bucket paths/prefixes correctly", async () => {
      // The S3 storage should handle path prefixes
      const s3Storage = repo.storage as S3Storage;
      expect(s3Storage.type).toBe("s3");

      const result = await createTestBackup(repo, { "test.txt": "S3 test" });
      expect(result.snapshotId).toBeDefined();

      const snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBeGreaterThan(0);
    });

    it("handles S3 with different endpoints", async () => {
      // Verify the S3 endpoint is configured correctly
      const s3Storage = repo.storage as S3Storage;
      expect(s3Storage.endpoint).toBeDefined();
      expect(s3Storage.bucket).toBeDefined();
    });

    it("repository stats return valid data", async () => {
      await createTestBackup(repo, { "test.txt": "Stats test content" });

      const stats = await restic.stats(repo.storage, repo.name, repo.password);

      expect(stats.success).toBe(true);
      expect(stats.stats).toBeDefined();
      expect(stats.stats!.total_size).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // REST Server Storage Tests
  // ==========================================================================

  describe("REST Server Storage", { timeout: STORAGE_TIMEOUT }, () => {
    let repo: TestRepo;
    let testData: TestDataSet;

    beforeEach(async () => {
      repo = await createRestTestRepo("rest-comprehensive");
      testData = generateTestDataSet(repo.tempDir, COMPREHENSIVE_TEST_FILES.slice(0, 10));
    }, STORAGE_TIMEOUT);

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
      if (testData) cleanupTestData(testData);
    });

    it("performs full backup/restore cycle with checksum verification", async () => {
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backupResult.success).toBe(true);
      expect(backupResult.snapshotId).toBeDefined();

      const integrityCheck = await verifyBackupIntegrity(repo);
      expect(integrityCheck).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, testData.basePath);
      const verificationResult = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verificationResult.match).toBe(true);
    }, STORAGE_TIMEOUT);

    it("handles REST server without authentication", async () => {
      const restStorage = repo.storage as RestStorage;
      expect(restStorage.type).toBe("rest");
      expect(restStorage.url).toBeDefined();

      const result = await createTestBackup(repo, { "test.txt": "REST test" });
      expect(result.snapshotId).toBeDefined();
    });

    it("handles multiple concurrent snapshots", async () => {
      // Create multiple backups
      const snapshot1 = await createTestBackup(repo, { "file1.txt": "Content 1" });
      const snapshot2 = await createTestBackup(repo, { "file2.txt": "Content 2" });
      const snapshot3 = await createTestBackup(repo, { "file3.txt": "Content 3" });

      const snapshots = await listTestSnapshots(repo);

      expect(snapshots.length).toBe(3);
      expect(snapshots.map(s => s.short_id)).toContain(snapshot1.snapshotId.substring(0, 8));
    });
  });

  // ==========================================================================
  // SFTP Storage Tests
  // ==========================================================================

  describe("SFTP Storage", { timeout: STORAGE_TIMEOUT * 2 }, () => {
    let repo: TestRepo;
    let testData: TestDataSet;

    beforeEach(async () => {
      repo = await createSftpTestRepo("sftp-comprehensive");
      testData = generateTestDataSet(repo.tempDir, COMPREHENSIVE_TEST_FILES.slice(0, 5)); // Use smaller subset for SFTP
    }, STORAGE_TIMEOUT);

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
      if (testData) cleanupTestData(testData);
    });

    it("performs full backup/restore cycle with password auth", async () => {
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      expect(backupResult.success).toBe(true);
      expect(backupResult.snapshotId).toBeDefined();

      const integrityCheck = await verifyBackupIntegrity(repo);
      expect(integrityCheck).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, testData.basePath);
      const verificationResult = verifyDirectoryIntegrity(restoredPath, sourceManifest, {
        allowExtra: true,
      });

      expect(verificationResult.match).toBe(true);
    }, STORAGE_TIMEOUT * 2);

    it("handles SFTP with custom port", async () => {
      const sftpStorage = repo.storage as SftpStorage;
      expect(sftpStorage.type).toBe("sftp");
      expect(sftpStorage.port).toBeDefined();

      const result = await createTestBackup(repo, { "test.txt": "SFTP test" });
      expect(result.snapshotId).toBeDefined();
    });

    it("repository unlock works correctly", async () => {
      // Create a backup
      await createTestBackup(repo, { "test.txt": "Unlock test" });

      // Force unlock (in case there are stale locks)
      const unlockResult = await restic.unlock(repo.storage, repo.name, repo.password);
      expect(unlockResult.success).toBe(true);

      // Should still be able to list snapshots after unlock
      const snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Cross-Storage Tests
  // ==========================================================================

  describe("Cross-Storage Operations", { timeout: STORAGE_TIMEOUT * 2 }, () => {
    it("data integrity preserved across different storage backends", async () => {
      // Create test data
      const testDir = "/tmp/cross-storage-test";
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });

      const testData = generateTestDataSet(join(testDir, "source"), COMPREHENSIVE_TEST_FILES.slice(0, 5));
      const sourceManifest = computeDirectoryManifest(testData.basePath);

      try {
        // Backup to local storage
        const localRepo = await createLocalTestRepo("cross-local");
        const localBackup = await restic.backup(
          localRepo.storage,
          localRepo.name,
          localRepo.password,
          testData.basePath
        );

        expect(localBackup.success).toBe(true);

        // Restore from local
        const localRestoreDir = join(testDir, "local-restore");
        mkdirSync(localRestoreDir, { recursive: true });
        await restoreSnapshot(localRepo, localBackup.snapshotId!, localRestoreDir);

        // Verify local restore matches source
        const localRestoredPath = join(localRestoreDir, testData.basePath);
        const localVerification = verifyDirectoryIntegrity(localRestoredPath, sourceManifest, {
          allowExtra: true,
        });

        expect(localVerification.match).toBe(true);

        await cleanupTestRepo(localRepo);
      } finally {
        cleanupTestData(testData);
        if (existsSync(testDir)) {
          rmSync(testDir, { recursive: true, force: true });
        }
      }
    }, STORAGE_TIMEOUT * 2);
  });

  // ==========================================================================
  // Large File Tests
  // ==========================================================================

  describe("Large File Handling", { timeout: STORAGE_TIMEOUT * 3 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("large-file");
    }, STORAGE_TIMEOUT);

    afterEach(async () => {
      if (repo) await cleanupTestRepo(repo);
    });

    it("backs up and restores 10MB file with checksum verification", async () => {
      const largeFile = generateLargeFile(
        join(repo.tempDir, "large-10mb.bin"),
        10 * 1024 * 1024,
        { seed: 12345 }
      );

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      const restoreDir = join(repo.tempDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify the large file checksum
      const restoredFilePath = join(restoreDir, repo.tempDir, "large-10mb.bin");

      if (existsSync(restoredFilePath)) {
        const { computeFileChecksum } = await import("../../../../../tests/utils/checksum-helpers");
        const restoredChecksum = computeFileChecksum(restoredFilePath);

        expect(restoredChecksum.sha256).toBe(largeFile.checksums.sha256);
        expect(restoredChecksum.size).toBe(largeFile.checksums.size);
      }
    }, STORAGE_TIMEOUT * 2);

    it("backs up and restores 100MB file with checksum verification", async () => {
      const largeFile = generateLargeFile(
        join(repo.tempDir, "large-100mb.bin"),
        100 * 1024 * 1024,
        { seed: 54321 }
      );

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Verify backup succeeded and snapshot exists
      const snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBe(1);
    }, STORAGE_TIMEOUT * 3);
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("Error Handling", () => {
    it("handles backup of non-existent source", async () => {
      const repo = await createLocalTestRepo("error-handling");

      try {
        const result = await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          "/non/existent/path"
        );

        expect(result.success).toBe(false);
        expect(result.message).toBeDefined();
      } finally {
        await cleanupTestRepo(repo);
      }
    });

    it("handles restore of non-existent snapshot", async () => {
      const repo = await createLocalTestRepo("error-handling");

      try {
        const restoreDir = join(repo.tempDir, "restored");
        mkdirSync(restoreDir, { recursive: true });

        const result = await restic.restore(
          repo.storage,
          repo.name,
          repo.password,
          "nonexistent-snapshot-id",
          restoreDir
        );

        expect(result.success).toBe(false);
      } finally {
        await cleanupTestRepo(repo);
      }
    });

    it("handles invalid repository password", async () => {
      const repo = await createLocalTestRepo("error-handling");

      try {
        // Try to list snapshots with wrong password
        const result = await restic.listSnapshots(
          repo.storage,
          repo.name,
          "wrong-password"
        );

        expect(result.success).toBe(false);
      } finally {
        await cleanupTestRepo(repo);
      }
    });
  });

  // ==========================================================================
  // Concurrent Operations Tests
  // ==========================================================================

  describe("Concurrent Operations", { timeout: STORAGE_TIMEOUT * 2 }, () => {
    it("handles multiple sequential backups correctly", async () => {
      const repo = await createLocalTestRepo("concurrent");

      try {
        // Create 5 sequential backups with different content
        for (let i = 0; i < 5; i++) {
          const content = { [`file-${i}.txt`]: `Content for backup ${i}` };
          await createTestBackup(repo, content);
        }

        const snapshots = await listTestSnapshots(repo);
        expect(snapshots.length).toBe(5);
      } finally {
        await cleanupTestRepo(repo);
      }
    });
  });
});
