/**
 * Restore Integration Tests
 *
 * Tests for restore operations with real restic repositories.
 * Tests path restoration, selective file restoration, and various restore scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as restic from "../restic";
import type { LocalStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "restore-integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

describe("Restore Integration Tests", () => {
  let testDir: string;
  let repoDir: string;
  let sourceDir: string;
  let restoreDir: string;
  let localStorage: LocalStorage;
  let testRepoCounter = 0;

  // Generate unique repo name
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  // Calculate SHA256 hash of file
  const hashFile = (filePath: string): string => {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  };

  beforeAll(() => {
    testDir = `/tmp/restore-integration-test-${Date.now()}`;
    repoDir = join(testDir, "repos");
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    localStorage = {
      type: "local",
      path: repoDir,
    };
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (existsSync(sourceDir)) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
    if (existsSync(restoreDir)) {
      rmSync(restoreDir, { recursive: true, force: true });
    }
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });
  });

  describe("Full Path Restore", () => {
    it("restores all files to target path", async () => {
      const repoName = getUniqueRepoName("restore-full");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Content 1");
      writeFileSync(join(sourceDir, "file2.txt"), "Content 2");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "file3.txt"), "Content 3");

      // Backup
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backupResult.success).toBe(true);

      // Restore
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );
      expect(restoreResult.success).toBe(true);

      // Verify all files restored
      expect(existsSync(join(restoreDir, sourceDir, "file1.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "file2.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "subdir", "file3.txt"))).toBe(true);

      // Verify content
      expect(readFileSync(join(restoreDir, sourceDir, "file1.txt"), "utf-8")).toBe("Content 1");
      expect(readFileSync(join(restoreDir, sourceDir, "file2.txt"), "utf-8")).toBe("Content 2");
      expect(readFileSync(join(restoreDir, sourceDir, "subdir", "file3.txt"), "utf-8")).toBe("Content 3");
    }, TEST_TIMEOUT);

    it("restores to non-existent target directory (auto-creates)", async () => {
      const repoName = getUniqueRepoName("restore-create-dir");

      writeFileSync(join(sourceDir, "data.txt"), "Test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const newTargetDir = join(restoreDir, "new", "nested", "target");
      expect(existsSync(newTargetDir)).toBe(false);

      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        newTargetDir
      );

      expect(restoreResult.success).toBe(true);
      expect(existsSync(join(newTargetDir, sourceDir, "data.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Selective File Restore", () => {
    it("restores only specified files using include pattern", async () => {
      const repoName = getUniqueRepoName("restore-selective");

      // Create multiple files
      writeFileSync(join(sourceDir, "important.txt"), "Important data");
      writeFileSync(join(sourceDir, "ignore.txt"), "Ignore this");
      mkdirSync(join(sourceDir, "data"));
      writeFileSync(join(sourceDir, "data", "needed.txt"), "Needed data");
      writeFileSync(join(sourceDir, "data", "skip.txt"), "Skip this");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore only important.txt
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { include: [join(sourceDir, "important.txt")] }
      );

      expect(restoreResult.success).toBe(true);
      // Only important.txt should be restored
      expect(existsSync(join(restoreDir, sourceDir, "important.txt"))).toBe(true);
    }, TEST_TIMEOUT);

    it("restores directory with include pattern", async () => {
      const repoName = getUniqueRepoName("restore-dir-include");

      mkdirSync(join(sourceDir, "include-me"));
      writeFileSync(join(sourceDir, "include-me", "file1.txt"), "File 1");
      writeFileSync(join(sourceDir, "include-me", "file2.txt"), "File 2");
      mkdirSync(join(sourceDir, "skip-me"));
      writeFileSync(join(sourceDir, "skip-me", "file3.txt"), "File 3");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { include: [join(sourceDir, "include-me")] }
      );

      expect(restoreResult.success).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "include-me", "file1.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "include-me", "file2.txt"))).toBe(true);
    }, TEST_TIMEOUT);

    it("restores with exclude pattern", async () => {
      const repoName = getUniqueRepoName("restore-exclude");

      writeFileSync(join(sourceDir, "keep.txt"), "Keep me");
      writeFileSync(join(sourceDir, "exclude.log"), "Exclude me");
      writeFileSync(join(sourceDir, "important.dat"), "Important");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { exclude: ["*.log"] }
      );

      expect(restoreResult.success).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "keep.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "important.dat"))).toBe(true);
      // .log file should be excluded
      expect(existsSync(join(restoreDir, sourceDir, "exclude.log"))).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Restore from Multiple Snapshots", () => {
    it("can restore different versions of the same file", async () => {
      const repoName = getUniqueRepoName("restore-versions");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Version 1
      writeFileSync(join(sourceDir, "file.txt"), "Version 1");
      const backup1 = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Version 2
      writeFileSync(join(sourceDir, "file.txt"), "Version 2");
      const backup2 = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Restore version 1
      const restore1Dir = join(restoreDir, "v1");
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );
      expect(readFileSync(join(restore1Dir, sourceDir, "file.txt"), "utf-8")).toBe("Version 1");

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );
      expect(readFileSync(join(restore2Dir, sourceDir, "file.txt"), "utf-8")).toBe("Version 2");
    }, TEST_TIMEOUT);

    it("restores from snapshot by short_id", async () => {
      const repoName = getUniqueRepoName("restore-short-id");

      writeFileSync(join(sourceDir, "data.txt"), "Test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Get the short_id from snapshots list
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      const shortId = snapshots.snapshots![0].short_id;

      // Restore using short_id
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        shortId,
        restoreDir
      );

      expect(restoreResult.success).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "data.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("File Integrity After Restore", () => {
    it("preserves file checksums", async () => {
      const repoName = getUniqueRepoName("restore-checksum");

      // Create files with known checksums
      writeFileSync(join(sourceDir, "text.txt"), "Hello World!");
      writeFileSync(join(sourceDir, "binary.bin"), Buffer.from([0x00, 0x01, 0xff, 0xfe]));

      const textHash = hashFile(join(sourceDir, "text.txt"));
      const binaryHash = hashFile(join(sourceDir, "binary.bin"));

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(hashFile(join(restoreDir, sourceDir, "text.txt"))).toBe(textHash);
      expect(hashFile(join(restoreDir, sourceDir, "binary.bin"))).toBe(binaryHash);
    }, TEST_TIMEOUT);

    it("preserves file sizes", async () => {
      const repoName = getUniqueRepoName("restore-sizes");

      const sizes = [0, 1, 100, 1000, 10000];
      for (const size of sizes) {
        writeFileSync(join(sourceDir, `file-${size}.bin`), Buffer.alloc(size));
      }

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      for (const size of sizes) {
        const restoredPath = join(restoreDir, sourceDir, `file-${size}.bin`);
        expect(statSync(restoredPath).size).toBe(size);
      }
    }, TEST_TIMEOUT);

    it("preserves file permissions", async () => {
      const repoName = getUniqueRepoName("restore-permissions");

      writeFileSync(join(sourceDir, "executable.sh"), "#!/bin/bash\necho hello");
      chmodSync(join(sourceDir, "executable.sh"), 0o755);

      writeFileSync(join(sourceDir, "readonly.txt"), "Read only");
      chmodSync(join(sourceDir, "readonly.txt"), 0o444);

      const execMode = statSync(join(sourceDir, "executable.sh")).mode;
      const readMode = statSync(join(sourceDir, "readonly.txt")).mode;

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(statSync(join(restoreDir, sourceDir, "executable.sh")).mode & 0o777).toBe(execMode & 0o777);
      expect(statSync(join(restoreDir, sourceDir, "readonly.txt")).mode & 0o777).toBe(readMode & 0o777);
    }, TEST_TIMEOUT);
  });

  describe("Directory Structure Preservation", () => {
    it("preserves nested directory structure", async () => {
      const repoName = getUniqueRepoName("restore-nested");

      // Create deep nested structure
      const dirs = [
        "a",
        "a/b",
        "a/b/c",
        "a/b/c/d",
        "x/y/z",
      ];

      for (const dir of dirs) {
        mkdirSync(join(sourceDir, dir), { recursive: true });
        writeFileSync(join(sourceDir, dir, "file.txt"), `In ${dir}`);
      }

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      for (const dir of dirs) {
        expect(existsSync(join(restoreDir, sourceDir, dir, "file.txt"))).toBe(true);
        expect(readFileSync(join(restoreDir, sourceDir, dir, "file.txt"), "utf-8")).toBe(`In ${dir}`);
      }
    }, TEST_TIMEOUT);

    it.skip("preserves empty directories", async () => {
      const repoName = getUniqueRepoName("restore-empty-dirs");

      mkdirSync(join(sourceDir, "empty1"));
      mkdirSync(join(sourceDir, "empty2/nested"), { recursive: true });
      writeFileSync(join(sourceDir, "file.txt"), "Content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(existsSync(join(restoreDir, sourceDir, "empty1"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "empty2/nested"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Error Handling", () => {
    it("fails gracefully for non-existent snapshot", async () => {
      const repoName = getUniqueRepoName("restore-no-snapshot");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        "nonexistent-snapshot-id",
        restoreDir
      );

      expect(restoreResult.success).toBe(false);
    }, TEST_TIMEOUT);

    it("fails gracefully for non-existent repository", async () => {
      const repoName = getUniqueRepoName("restore-no-repo");

      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        "some-snapshot-id",
        restoreDir
      );

      expect(restoreResult.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Concurrent Restore Operations", () => {
    it("handles multiple concurrent restores from same snapshot", async () => {
      const repoName = getUniqueRepoName("restore-concurrent");

      writeFileSync(join(sourceDir, "data.txt"), "Concurrent test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Start 3 concurrent restores
      const targets = [
        join(restoreDir, "t1"),
        join(restoreDir, "t2"),
        join(restoreDir, "t3"),
      ];

      const restorePromises = targets.map((target) =>
        restic.restore(localStorage, repoName, RESTIC_PASSWORD, backupResult.snapshotId!, target)
      );

      const results = await Promise.all(restorePromises);

      // All should succeed
      for (let i = 0; i < results.length; i++) {
        expect(results[i].success).toBe(true);
        expect(existsSync(join(targets[i], sourceDir, "data.txt"))).toBe(true);
      }
    }, TEST_TIMEOUT);
  });
});
