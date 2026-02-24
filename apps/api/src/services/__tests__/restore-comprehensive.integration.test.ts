/**
 * Restore Operations Comprehensive Tests
 *
 * Tests restore functionality including:
 * - Full restore with SHA256 verification
 * - Partial restore by path
 * - Partial restore by glob pattern
 * - Permissions and timestamps preservation
 * - Concurrent restores
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, chmodSync, utimesSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  createLocalTestRepo,
  cleanupTestRepo,
  restoreSnapshot,
  listTestSnapshots,
  createTestBackup,
  verifyAllRestoredFiles,
  type TestRepo,
} from "../../../../../tests/utils/restic-helpers";
import {
  computeFileChecksum,
  computeDirectoryManifest,
  verifyDirectoryIntegrity,
  assertDirectoriesEqual,
} from "../../../../../tests/utils/checksum-helpers";
import {
  generateTestDataSet,
  generateLargeFile,
  STANDARD_TEST_FILES,
} from "../../../../../tests/utils/test-data-generator";
import * as restic from "../restic";

describe("Restore Operations Comprehensive Tests", { timeout: 180000 }, () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await createLocalTestRepo("restore-test");
  });

  afterEach(async () => {
    if (repo) {
      await cleanupTestRepo(repo);
    }
  });

  // ==========================================================================
  // Full Restore with Verification
  // ==========================================================================

  describe("Full Restore with SHA256 Verification", () => {
    it("restores all files and verifies SHA256 checksums", async () => {
      // Create test files
      const testFiles: Record<string, string | Buffer> = {
        "document.txt": "This is a text document with multiple lines.\nLine 2.\nLine 3.",
        "data.json": JSON.stringify({ key: "value", numbers: [1, 2, 3] }),
        "nested/config.yaml": "setting: value\nother: 123\n",
        "nested/deep/file.log": "Log entry 1\nLog entry 2\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]),
      };

      // Create files via backup
      const backup = await createTestBackup(repo, testFiles);
      expect(backup.snapshotId).toBeDefined();

      // Compute original checksums after files are created
      const originalManifest = await computeDirectoryManifest(repo.tempDir);

      // Clear the temp directory
      for (const file of Object.keys(testFiles)) {
        const path = join(repo.tempDir, file);
        if (existsSync(path)) {
          rmSync(path, { force: true });
        }
      }

      // Restore
      const restoreDir = `/tmp/restore-full-${Date.now()}`;
      await restoreSnapshot(repo, backup.snapshotId, restoreDir);

      // Compute restored checksums
      const restoredManifest = await computeDirectoryManifest(join(restoreDir, repo.tempDir));

      // Verify all files match using the files Map
      for (const [path, entry] of originalManifest.files.entries()) {
        const restoredEntry = restoredManifest.files.get(path);
        expect(restoredEntry).toBeDefined();
        expect(restoredEntry!.checksums.sha256).toBe(entry.checksums.sha256);
        expect(restoredEntry!.checksums.size).toBe(entry.checksums.size);
      }

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });

    it("restores large files with correct checksums", async () => {
      // Generate 10MB file
      const { checksums: originalChecksums } = await generateLargeFile(
        join(repo.tempDir, "large-file.bin"),
        10 * 1024 * 1024
      );

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-large-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify
      const restoredPath = join(restoreDir, repo.tempDir, "large-file.bin");
      const restoredChecksums = await computeFileChecksum(restoredPath);

      expect(restoredChecksums.sha256).toBe(originalChecksums.sha256);
      expect(restoredChecksums.size).toBe(originalChecksums.size);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Partial Restore Tests
  // ==========================================================================

  describe("Partial File Restore by Path", () => {
    it("restores only specified files", async () => {
      // Create multiple files
      const testFiles: Record<string, string> = {
        "keep.txt": "Keep this file",
        "ignore.txt": "Ignore this file",
        "nested/keep.txt": "Keep nested file",
        "nested/ignore.txt": "Ignore nested file",
      };

      const backup = await createTestBackup(repo, testFiles);

      // Restore only specific files
      const restoreDir = `/tmp/restore-partial-${Date.now()}`;
      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir,
        { include: ["**/keep.txt"] }
      );

      // Verify only keep.txt files exist
      expect(existsSync(join(restoreDir, repo.tempDir, "keep.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "nested/keep.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "ignore.txt"))).toBe(false);
      expect(existsSync(join(restoreDir, repo.tempDir, "nested/ignore.txt"))).toBe(false);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });

    it("restores single file from nested path", async () => {
      const testFiles: Record<string, string> = {
        "a/b/c/target.txt": "Target content",
        "a/b/other.txt": "Other content",
        "x/y/different.txt": "Different content",
      };

      const backup = await createTestBackup(repo, testFiles);

      const restoreDir = `/tmp/restore-single-${Date.now()}`;
      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir,
        { include: ["**/c/target.txt"] }
      );

      expect(existsSync(join(restoreDir, repo.tempDir, "a/b/c/target.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "a/b/other.txt"))).toBe(false);

      const content = readFileSync(join(restoreDir, repo.tempDir, "a/b/c/target.txt"), "utf-8");
      expect(content).toBe("Target content");

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Partial Restore by Glob Pattern", () => {
    it("restores files matching glob pattern", async () => {
      const testFiles: Record<string, string> = {
        "src/index.ts": "export const a = 1;",
        "src/utils/helpers.ts": "export const helper = () => {};",
        "src/utils/helpers.test.ts": "test('helper', () => {});",
        "docs/readme.md": "# Readme",
        "package.json": "{}",
      };

      const backup = await createTestBackup(repo, testFiles);

      const restoreDir = `/tmp/restore-glob-${Date.now()}`;
      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir,
        { include: ["**/*.ts"] }
      );

      // TypeScript files should be restored
      expect(existsSync(join(restoreDir, repo.tempDir, "src/index.ts"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "src/utils/helpers.ts"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "src/utils/helpers.test.ts"))).toBe(true);

      // Non-TS files should not be restored
      expect(existsSync(join(restoreDir, repo.tempDir, "docs/readme.md"))).toBe(false);
      expect(existsSync(join(restoreDir, repo.tempDir, "package.json"))).toBe(false);

      rmSync(restoreDir, { recursive: true, force: true });
    });

    it("excludes files matching exclude pattern", async () => {
      const testFiles: Record<string, string> = {
        "src/app.ts": "const app = 1;",
        "src/app.test.ts": "test('app', () => {});",
        "src/main.ts": "const main = 1;",
        "src/main.test.ts": "test('main', () => {});",
      };

      const backup = await createTestBackup(repo, testFiles);

      const restoreDir = `/tmp/restore-exclude-${Date.now()}`;
      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir,
        { exclude: ["**/*.test.ts"] }
      );

      // Non-test files should be restored
      expect(existsSync(join(restoreDir, repo.tempDir, "src/app.ts"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "src/main.ts"))).toBe(true);

      // Test files should be excluded
      expect(existsSync(join(restoreDir, repo.tempDir, "src/app.test.ts"))).toBe(false);
      expect(existsSync(join(restoreDir, repo.tempDir, "src/main.test.ts"))).toBe(false);

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Permissions and Timestamps
  // ==========================================================================

  describe("Permissions Preserved", () => {
    it("preserves file permissions after restore", async () => {
      const filePath = join(repo.tempDir, "executable.sh");
      writeFileSync(filePath, "#!/bin/bash\necho hello\n");
      chmodSync(filePath, 0o755);

      const originalStat = statSync(filePath);
      const originalMode = originalStat.mode & 0o777;

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = `/tmp/restore-perms-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, repo.tempDir, "executable.sh");
      const restoredStat = statSync(restoredPath);
      const restoredMode = restoredStat.mode & 0o777;

      // Mode should be preserved (may vary slightly based on umask)
      expect(restoredMode).toBe(originalMode);

      rmSync(restoreDir, { recursive: true, force: true });
    });

    it("preserves read-only permissions", async () => {
      const filePath = join(repo.tempDir, "readonly.txt");
      writeFileSync(filePath, "Read-only content");
      chmodSync(filePath, 0o444);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = `/tmp/restore-readonly-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, repo.tempDir, "readonly.txt");
      const restoredStat = statSync(restoredPath);
      const restoredMode = restoredStat.mode & 0o777;

      expect(restoredMode).toBe(0o444);

      // Cleanup (need to make writable to delete)
      chmodSync(restoredPath, 0o644);
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Timestamps Preserved", () => {
    it("preserves file modification timestamps", async () => {
      const filePath = join(repo.tempDir, "timestamped.txt");
      writeFileSync(filePath, "Timestamped content");

      // Set a specific mtime
      const specificTime = new Date("2024-01-15T10:30:00Z");
      utimesSync(filePath, specificTime, specificTime);

      const originalStat = statSync(filePath);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = `/tmp/restore-time-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredPath = join(restoreDir, repo.tempDir, "timestamped.txt");
      const restoredStat = statSync(restoredPath);

      // mtime should be preserved
      expect(restoredStat.mtime.getTime()).toBe(originalStat.mtime.getTime());

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Target Directory Handling
  // ==========================================================================

  describe("Non-existent Target Directory", () => {
    it("creates target directory if it does not exist", async () => {
      const backup = await createTestBackup(repo, { "test.txt": "content" });

      const restoreDir = `/tmp/new-restore-dir-${Date.now()}/nested/path`;
      expect(existsSync(restoreDir)).toBe(false);

      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir
      );

      expect(existsSync(restoreDir)).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "test.txt"))).toBe(true);

      rmSync(restoreDir.split("/nested")[0], { recursive: true, force: true });
    });
  });

  describe("Overwrite Existing Files", () => {
    it("overwrites existing files on restore", async () => {
      const originalContent = "Original content";
      const backupContent = "Backup content";

      // Create and backup original file
      writeFileSync(join(repo.tempDir, "overwrite.txt"), backupContent);
      const backup = await createTestBackup(repo, { "overwrite.txt": backupContent });

      // Create restore dir with different content
      const restoreDir = `/tmp/restore-overwrite-${Date.now()}`;
      mkdirSync(join(restoreDir, repo.tempDir), { recursive: true });
      writeFileSync(join(restoreDir, repo.tempDir, "overwrite.txt"), originalContent);

      // Verify original content
      let content = readFileSync(join(restoreDir, repo.tempDir, "overwrite.txt"), "utf-8");
      expect(content).toBe(originalContent);

      // Restore should overwrite
      await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        restoreDir
      );

      // Verify overwritten with backup content
      content = readFileSync(join(restoreDir, repo.tempDir, "overwrite.txt"), "utf-8");
      expect(content).toBe(backupContent);

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Concurrent Restores
  // ==========================================================================

  describe("Concurrent Restores", () => {
    it("handles multiple concurrent restores to different directories", async () => {
      const testFiles: Record<string, string> = {
        "file1.txt": "Content 1",
        "file2.txt": "Content 2",
        "file3.txt": "Content 3",
      };

      const backup = await createTestBackup(repo, testFiles);
      const restoreDirs: string[] = [];

      // Start 5 concurrent restores
      const restorePromises = [];
      for (let i = 0; i < 5; i++) {
        const restoreDir = `/tmp/restore-concurrent-${i}-${Date.now()}`;
        restoreDirs.push(restoreDir);

        restorePromises.push(
          restic.restore(
            repo.storage,
            repo.name,
            repo.password,
            backup.snapshotId,
            restoreDir
          )
        );
      }

      const results = await Promise.all(restorePromises);

      // All should succeed
      for (const result of results) {
        expect(result.success).toBe(true);
      }

      // Verify each restore directory has correct content
      for (const restoreDir of restoreDirs) {
        for (const [filename, content] of Object.entries(testFiles)) {
          const restoredContent = readFileSync(
            join(restoreDir, repo.tempDir, filename),
            "utf-8"
          );
          expect(restoredContent).toBe(content);
        }
      }

      // Cleanup
      for (const restoreDir of restoreDirs) {
        rmSync(restoreDir, { recursive: true, force: true });
      }
    });

    it("handles restore from different snapshots concurrently", async () => {
      // Create multiple backups
      const snapshots: string[] = [];
      const contents: string[] = [];

      for (let i = 0; i < 3; i++) {
        const content = `Backup ${i} content`;
        contents.push(content);
        writeFileSync(join(repo.tempDir, "version.txt"), content);

        const backup = await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          repo.tempDir
        );
        snapshots.push(backup.snapshotId!);
      }

      // Restore all snapshots concurrently
      const restoreDirs = snapshots.map((_, i) => `/tmp/restore-multi-snap-${i}-${Date.now()}`);

      const restorePromises = snapshots.map((snapshotId, i) =>
        restic.restore(
          repo.storage,
          repo.name,
          repo.password,
          snapshotId,
          restoreDirs[i]
        )
      );

      const results = await Promise.all(restorePromises);

      // All should succeed
      for (const result of results) {
        expect(result.success).toBe(true);
      }

      // Each restore should have correct content for that snapshot
      for (let i = 0; i < snapshots.length; i++) {
        const restoredContent = readFileSync(
          join(restoreDirs[i], repo.tempDir, "version.txt"),
          "utf-8"
        );
        expect(restoredContent).toBe(contents[i]);
      }

      // Cleanup
      for (const restoreDir of restoreDirs) {
        rmSync(restoreDir, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe("Error Handling", () => {
    it("fails gracefully for non-existent snapshot", async () => {
      const restoreDir = `/tmp/restore-bad-snap-${Date.now()}`;

      const result = await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        "nonexistent-snapshot-id",
        restoreDir
      );

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();

      // Cleanup if dir was created
      if (existsSync(restoreDir)) {
        rmSync(restoreDir, { recursive: true, force: true });
      }
    });

    it("returns error for invalid repository", async () => {
      const restoreDir = `/tmp/restore-bad-repo-${Date.now()}`;

      const result = await restic.restore(
        { type: "local", path: "/nonexistent/repo/path" },
        "fake-repo",
        repo.password,
        "some-snapshot",
        restoreDir
      );

      expect(result.success).toBe(false);

      if (existsSync(restoreDir)) {
        rmSync(restoreDir, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Symlink Handling
  // ==========================================================================

  describe("Symlink Restoration", () => {
    it("restores symbolic links correctly", async () => {
      const targetPath = join(repo.tempDir, "target.txt");
      const linkPath = join(repo.tempDir, "link.txt");

      writeFileSync(targetPath, "Target content");

      // Create symlink using require instead of import
      const fs = require("fs");
      fs.symlinkSync("target.txt", linkPath);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = `/tmp/restore-symlink-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      const restoredLinkPath = join(restoreDir, repo.tempDir, "link.txt");
      const restoredTargetPath = join(restoreDir, repo.tempDir, "target.txt");

      // Both should exist
      expect(existsSync(restoredTargetPath)).toBe(true);
      expect(existsSync(restoredLinkPath)).toBe(true);

      // Reading through link should give target content
      const content = readFileSync(restoredLinkPath, "utf-8");
      expect(content).toBe("Target content");

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Empty Directory Handling
  // ==========================================================================

  describe("Empty Directory Restoration", () => {
    it.skip("restores empty directories", async () => {
      // Create empty directories
      mkdirSync(join(repo.tempDir, "empty1"), { recursive: true });
      mkdirSync(join(repo.tempDir, "nested/empty2"), { recursive: true });

      // Need at least one file for backup
      writeFileSync(join(repo.tempDir, "marker.txt"), "marker");

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const restoreDir = `/tmp/restore-empty-dirs-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify empty directories exist
      expect(existsSync(join(restoreDir, repo.tempDir, "empty1"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "nested/empty2"))).toBe(true);

      rmSync(restoreDir, { recursive: true, force: true });
    });
  });
});
