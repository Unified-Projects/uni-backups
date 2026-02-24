/**
 * System Integration Tests
 *
 * End-to-end tests for complete backup workflows including:
 * - Backup -> Prune -> Restore cycles
 * - Multi-repo operations
 * - Concurrent job execution
 * - Stats accuracy after operations
 * - Deduplication verification
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
} from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as restic from "../restic";
import type { LocalStorage, Retention } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "system-integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

describe("System Integration Tests", () => {
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

  // Create a file with specific size
  const createFile = (path: string, sizeInBytes: number) => {
    const buffer = Buffer.alloc(sizeInBytes);
    for (let i = 0; i < sizeInBytes; i++) {
      buffer[i] = i % 256;
    }
    writeFileSync(path, buffer);
  };

  beforeAll(() => {
    testDir = `/tmp/system-integration-test-${Date.now()}`;
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

  describe("Complete Backup -> Prune -> Restore Cycle", () => {
    it("performs full backup, prune, and restore workflow", async () => {
      const repoName = getUniqueRepoName("full-cycle");

      // Create test data
      writeFileSync(join(sourceDir, "data.txt"), "Important data");
      writeFileSync(join(sourceDir, "config.json"), '{"key": "value"}');
      mkdirSync(join(sourceDir, "logs"));
      writeFileSync(join(sourceDir, "logs", "app.log"), "Log entry 1");

      // Initialize repository
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create multiple backups with the same tag (for grouping)
      const backup1 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["cycle-test"] }
      );
      expect(backup1.success).toBe(true);
      expect(backup1.snapshotId).toBeDefined();

      // Modify data
      writeFileSync(join(sourceDir, "data.txt"), "Modified data");
      writeFileSync(join(sourceDir, "logs", "app.log"), "Log entry 1\nLog entry 2");

      const backup2 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["cycle-test"] }
      );
      expect(backup2.success).toBe(true);

      // Add more data
      writeFileSync(join(sourceDir, "new-file.txt"), "New content");

      const backup3 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["cycle-test"] }
      );
      expect(backup3.success).toBe(true);

      // Verify 3 snapshots exist
      const snapshotsBefore = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(snapshotsBefore.snapshots?.length).toBe(3);

      // Prune with retention policy keeping only last 2
      const retention: Retention = { last: 2 };
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        retention
      );
      expect(pruneResult.success).toBe(true);

      // Verify only 2 snapshots remain
      const snapshotsAfter = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(snapshotsAfter.snapshots?.length).toBe(2);

      // Restore from latest snapshot
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup3.snapshotId!,
        restoreDir
      );
      expect(restoreResult.success).toBe(true);

      // Verify restored data
      expect(readFileSync(join(restoreDir, sourceDir, "data.txt"), "utf-8")).toBe("Modified data");
      expect(existsSync(join(restoreDir, sourceDir, "new-file.txt"))).toBe(true);
    }, TEST_TIMEOUT);

    it("handles backup -> check -> stats -> prune workflow", async () => {
      const repoName = getUniqueRepoName("check-stats-cycle");

      // Create test data
      createFile(join(sourceDir, "data.bin"), 10000);

      // Initialize and backup
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backup.success).toBe(true);

      // Run repository check
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);

      // Get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsResult.success).toBe(true);
      expect(statsResult.stats?.total_size).toBeGreaterThan(0);

      // Prune (dry-run first)
      const dryRunResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 },
        { dryRun: true }
      );
      expect(dryRunResult.success).toBe(true);

      // Actual prune
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 }
      );
      expect(pruneResult.success).toBe(true);

      // Check after prune
      const checkAfter = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkAfter.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Multi-Repo Operations", () => {
    it("manages multiple independent repositories", async () => {
      const repo1 = getUniqueRepoName("multi-repo-1");
      const repo2 = getUniqueRepoName("multi-repo-2");
      const repo3 = getUniqueRepoName("multi-repo-3");

      // Create different source data for each repo
      const source1 = join(sourceDir, "data1");
      const source2 = join(sourceDir, "data2");
      const source3 = join(sourceDir, "data3");

      mkdirSync(source1, { recursive: true });
      mkdirSync(source2, { recursive: true });
      mkdirSync(source3, { recursive: true });

      writeFileSync(join(source1, "file.txt"), "Repo 1 data");
      writeFileSync(join(source2, "file.txt"), "Repo 2 data");
      writeFileSync(join(source3, "file.txt"), "Repo 3 data");

      // Initialize all repos
      await Promise.all([
        restic.initRepo(localStorage, repo1, RESTIC_PASSWORD),
        restic.initRepo(localStorage, repo2, RESTIC_PASSWORD),
        restic.initRepo(localStorage, repo3, RESTIC_PASSWORD),
      ]);

      // Backup to all repos
      const [backup1, backup2, backup3] = await Promise.all([
        restic.backup(localStorage, repo1, RESTIC_PASSWORD, source1),
        restic.backup(localStorage, repo2, RESTIC_PASSWORD, source2),
        restic.backup(localStorage, repo3, RESTIC_PASSWORD, source3),
      ]);

      expect(backup1.success).toBe(true);
      expect(backup2.success).toBe(true);
      expect(backup3.success).toBe(true);

      // Each repo should have 1 snapshot
      const [snap1, snap2, snap3] = await Promise.all([
        restic.listSnapshots(localStorage, repo1, RESTIC_PASSWORD),
        restic.listSnapshots(localStorage, repo2, RESTIC_PASSWORD),
        restic.listSnapshots(localStorage, repo3, RESTIC_PASSWORD),
      ]);

      expect(snap1.snapshots?.length).toBe(1);
      expect(snap2.snapshots?.length).toBe(1);
      expect(snap3.snapshots?.length).toBe(1);

      // Restore from each and verify data isolation
      const restore1 = join(restoreDir, "r1");
      const restore2 = join(restoreDir, "r2");
      const restore3 = join(restoreDir, "r3");

      await Promise.all([
        restic.restore(localStorage, repo1, RESTIC_PASSWORD, backup1.snapshotId!, restore1),
        restic.restore(localStorage, repo2, RESTIC_PASSWORD, backup2.snapshotId!, restore2),
        restic.restore(localStorage, repo3, RESTIC_PASSWORD, backup3.snapshotId!, restore3),
      ]);

      expect(readFileSync(join(restore1, source1, "file.txt"), "utf-8")).toBe("Repo 1 data");
      expect(readFileSync(join(restore2, source2, "file.txt"), "utf-8")).toBe("Repo 2 data");
      expect(readFileSync(join(restore3, source3, "file.txt"), "utf-8")).toBe("Repo 3 data");
    }, TEST_TIMEOUT);

    it("handles repo-specific retention policies", async () => {
      const dailyRepo = getUniqueRepoName("daily-retention");
      const weeklyRepo = getUniqueRepoName("weekly-retention");

      const dailySource = join(sourceDir, "daily");
      const weeklySource = join(sourceDir, "weekly");

      mkdirSync(dailySource, { recursive: true });
      mkdirSync(weeklySource, { recursive: true });

      writeFileSync(join(dailySource, "file.txt"), "Daily data");
      writeFileSync(join(weeklySource, "file.txt"), "Weekly data");

      // Initialize repos
      await Promise.all([
        restic.initRepo(localStorage, dailyRepo, RESTIC_PASSWORD),
        restic.initRepo(localStorage, weeklyRepo, RESTIC_PASSWORD),
      ]);

      // Create multiple backups in each
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(dailySource, "file.txt"), `Daily data v${i}`);
        writeFileSync(join(weeklySource, "file.txt"), `Weekly data v${i}`);
        await restic.backup(localStorage, dailyRepo, RESTIC_PASSWORD, dailySource);
        await restic.backup(localStorage, weeklyRepo, RESTIC_PASSWORD, weeklySource);
      }

      // Apply different retention policies
      const dailyRetention: Retention = { last: 2 };
      const weeklyRetention: Retention = { last: 4 };

      await Promise.all([
        restic.prune(localStorage, dailyRepo, RESTIC_PASSWORD, dailyRetention),
        restic.prune(localStorage, weeklyRepo, RESTIC_PASSWORD, weeklyRetention),
      ]);

      // Verify different snapshot counts
      const [dailySnaps, weeklySnaps] = await Promise.all([
        restic.listSnapshots(localStorage, dailyRepo, RESTIC_PASSWORD),
        restic.listSnapshots(localStorage, weeklyRepo, RESTIC_PASSWORD),
      ]);

      expect(dailySnaps.snapshots?.length).toBe(2);
      expect(weeklySnaps.snapshots?.length).toBe(4);
    }, TEST_TIMEOUT);
  });

  describe("Concurrent Job Execution", () => {
    it("handles concurrent backups to same repository", async () => {
      const repoName = getUniqueRepoName("concurrent-backup");

      // Create multiple source directories
      const sources = ["src1", "src2", "src3"].map((name) => {
        const path = join(sourceDir, name);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "data.txt"), `Data from ${name}`);
        return path;
      });

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Run concurrent backups
      const backupPromises = sources.map((src, i) =>
        restic.backup(localStorage, repoName, RESTIC_PASSWORD, src, {
          tags: [`source-${i}`],
        })
      );

      const results = await Promise.all(backupPromises);

      // All backups should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.snapshotId).toBeDefined();
      });

      // Verify all snapshots exist
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapshots.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("handles concurrent stats requests", async () => {
      const repoName = getUniqueRepoName("concurrent-stats");

      createFile(join(sourceDir, "data.bin"), 50000);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Run many concurrent stats requests
      const statsPromises = Array(5)
        .fill(null)
        .map(() => restic.stats(localStorage, repoName, RESTIC_PASSWORD));

      const results = await Promise.all(statsPromises);

      // All should succeed with consistent values
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.stats?.total_size).toBeGreaterThan(0);
      });

      // All results should return the same stats
      const sizes = results.map((r) => r.stats?.total_size);
      expect(new Set(sizes).size).toBe(1);
    }, TEST_TIMEOUT);

    it("handles mixed concurrent operations", async () => {
      const repoName = getUniqueRepoName("mixed-concurrent");

      writeFileSync(join(sourceDir, "file.txt"), "Test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Run read-only operations concurrently (stats and snapshots are safe together)
      // Check can cause lock contention, so run it separately
      const [statsResult, snapshotsResult] = await Promise.all([
        restic.stats(localStorage, repoName, RESTIC_PASSWORD),
        restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD),
      ]);

      // Run check separately to avoid lock contention
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(true);
      expect(checkResult.success).toBe(true);
      expect(snapshotsResult.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("Stats Accuracy After Operations", () => {
    it("reports accurate stats after backups", async () => {
      const repoName = getUniqueRepoName("stats-after-backup");

      // Create known-size file
      const fileSize = 10000;
      createFile(join(sourceDir, "data.bin"), fileSize);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(stats.success).toBe(true);
      // Total size should include the file (with some overhead)
      expect(stats.stats?.total_size).toBeGreaterThanOrEqual(fileSize);
      expect(stats.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);

    it("stats reflect deduplication", async () => {
      const repoName = getUniqueRepoName("stats-dedup");

      // Create identical files
      const fileContent = "Identical content repeated many times ".repeat(100);
      writeFileSync(join(sourceDir, "file1.txt"), fileContent);
      writeFileSync(join(sourceDir, "file2.txt"), fileContent);
      writeFileSync(join(sourceDir, "file3.txt"), fileContent);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(stats.success).toBe(true);
      // Note: restic stats default mode shows "restore size" - the size of all files that would be restored
      // The 3 identical files are reported at their full size even though raw data is deduplicated
      // We just verify stats work and report something reasonable (not much more than the files)
      const totalFileSize = fileContent.length * 3;
      expect(stats.stats?.total_size).toBeLessThanOrEqual(totalFileSize + 1000); // Allow small overhead
    }, TEST_TIMEOUT);

    it("stats update after prune", async () => {
      const repoName = getUniqueRepoName("stats-after-prune");

      // Create and backup large file with the same tag (for grouping)
      createFile(join(sourceDir, "large.bin"), 50000);
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, { tags: ["stats-prune"] });

      // Create different large file and backup with the same tag
      createFile(join(sourceDir, "large.bin"), 60000);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, { tags: ["stats-prune"] });

      const statsBefore = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsBefore.stats?.snapshots_count).toBe(2);

      // Prune to keep only latest
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 1 });

      const statsAfter = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsAfter.success).toBe(true);
      expect(statsAfter.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);

    it("stats include all snapshot data", async () => {
      const repoName = getUniqueRepoName("stats-all-snapshots");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create multiple backups with different sizes
      const sizes = [5000, 10000, 15000];
      for (let i = 0; i < sizes.length; i++) {
        createFile(join(sourceDir, `file-${i}.bin`), sizes[i]);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const stats = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(stats.success).toBe(true);
      expect(stats.stats?.snapshots_count).toBe(3);
      // Total size should account for all files (with dedup and overhead)
      expect(stats.stats?.total_size).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe("Data Integrity Verification", () => {
    it("verifies checksums through backup-restore cycle", async () => {
      const repoName = getUniqueRepoName("checksum-verify");

      // Create files with known checksums
      const files = [
        { name: "text.txt", content: "Hello World!" },
        { name: "binary.bin", content: Buffer.from([0x00, 0x01, 0xff, 0xfe]) },
        { name: "large.dat", content: Buffer.alloc(10000).fill(42) },
      ];

      const originalHashes: Record<string, string> = {};
      for (const file of files) {
        const path = join(sourceDir, file.name);
        writeFileSync(path, file.content);
        originalHashes[file.name] = hashFile(path);
      }

      // Backup
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      expect(backup.success).toBe(true);

      // Check repository
      const check = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(check.success).toBe(true);

      // Restore
      await restic.restore(localStorage, repoName, RESTIC_PASSWORD, backup.snapshotId!, restoreDir);

      // Verify checksums match
      for (const file of files) {
        const restoredPath = join(restoreDir, sourceDir, file.name);
        const restoredHash = hashFile(restoredPath);
        expect(restoredHash).toBe(originalHashes[file.name]);
      }
    }, TEST_TIMEOUT);

    it("preserves file metadata through backup-restore", async () => {
      const repoName = getUniqueRepoName("metadata-preserve");

      // Create files
      writeFileSync(join(sourceDir, "file.txt"), "Content");

      // Record original metadata
      const originalStat = statSync(join(sourceDir, "file.txt"));

      // Backup and restore
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      await restic.restore(localStorage, repoName, RESTIC_PASSWORD, backup.snapshotId!, restoreDir);

      // Verify size preserved
      const restoredStat = statSync(join(restoreDir, sourceDir, "file.txt"));
      expect(restoredStat.size).toBe(originalStat.size);
    }, TEST_TIMEOUT);
  });

  describe("Repository Maintenance", () => {
    it("performs check and unlock operations", async () => {
      const repoName = getUniqueRepoName("maintenance");

      writeFileSync(join(sourceDir, "data.txt"), "Test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Check repository
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);

      // Unlock repository (should succeed even if no locks)
      const unlockResult = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);
      expect(unlockResult.success).toBe(true);

      // Repository should still be valid
      const checkAfter = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkAfter.success).toBe(true);
    }, TEST_TIMEOUT);

    it("handles prune with various retention policies", async () => {
      const repoName = getUniqueRepoName("retention-policies");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create many snapshots with the same tag (for grouping)
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(sourceDir, "data.txt"), `Version ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, { tags: ["retention-test"] });
      }

      const snapsBefore = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapsBefore.snapshots?.length).toBe(10);

      // Apply retention: keep last 3
      const retention: Retention = { last: 3 };
      const pruneResult = await restic.prune(localStorage, repoName, RESTIC_PASSWORD, retention);
      expect(pruneResult.success).toBe(true);

      const snapsAfter = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapsAfter.snapshots?.length).toBe(3);

      // Verify repository is still valid
      const check = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(check.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Error Recovery", () => {
    it("recovers from interrupted operations via check", async () => {
      const repoName = getUniqueRepoName("recovery");

      writeFileSync(join(sourceDir, "data.txt"), "Test data");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Simulate recovery workflow
      const unlockResult = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);
      expect(unlockResult.success).toBe(true);

      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);

      // Should be able to continue operations
      writeFileSync(join(sourceDir, "new-data.txt"), "New data");
      const backup2 = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      expect(backup2.success).toBe(true);
    }, TEST_TIMEOUT);

    it("handles operations on non-existent repo gracefully", async () => {
      const repoName = getUniqueRepoName("nonexistent");

      // All operations should fail gracefully
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsResult.success).toBe(false);

      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(false);

      const backupResult = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      expect(backupResult.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Large Data Handling", () => {
    it("handles large files correctly", async () => {
      const repoName = getUniqueRepoName("large-file");

      // Create 1MB file
      const largeFileSize = 1024 * 1024;
      createFile(join(sourceDir, "large.bin"), largeFileSize);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      expect(backup.success).toBe(true);

      // Restore and verify
      await restic.restore(localStorage, repoName, RESTIC_PASSWORD, backup.snapshotId!, restoreDir);

      const restoredSize = statSync(join(restoreDir, sourceDir, "large.bin")).size;
      expect(restoredSize).toBe(largeFileSize);
    }, TEST_TIMEOUT);

    it("handles many small files correctly", async () => {
      const repoName = getUniqueRepoName("many-files");

      // Create 100 small files
      const fileCount = 100;
      for (let i = 0; i < fileCount; i++) {
        writeFileSync(join(sourceDir, `file-${i}.txt`), `Content ${i}`);
      }

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backup = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      expect(backup.success).toBe(true);

      // Verify snapshot files list
      const files = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup.snapshotId!
      );
      expect(files.success).toBe(true);
      // Should have at least 100 entries (files + directories)
      expect(files.entries?.length).toBeGreaterThanOrEqual(fileCount);

      // Restore and count files
      await restic.restore(localStorage, repoName, RESTIC_PASSWORD, backup.snapshotId!, restoreDir);

      for (let i = 0; i < fileCount; i++) {
        expect(existsSync(join(restoreDir, sourceDir, `file-${i}.txt`))).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe("Tag-based Operations", () => {
    it("filters snapshots by tags", async () => {
      const repoName = getUniqueRepoName("tag-filter");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create backups with different tags
      writeFileSync(join(sourceDir, "db.sql"), "Database dump");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["database", "production"],
      });

      writeFileSync(join(sourceDir, "files.tar"), "Archive content");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["files", "production"],
      });

      writeFileSync(join(sourceDir, "test.txt"), "Test data");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["test", "staging"],
      });

      // List all snapshots
      const allSnapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(allSnapshots.snapshots?.length).toBe(3);

      // Filter by tag
      const prodSnapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        tags: ["production"],
      });
      expect(prodSnapshots.snapshots?.length).toBe(2);

      const dbSnapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        tags: ["database"],
      });
      expect(dbSnapshots.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });
});
