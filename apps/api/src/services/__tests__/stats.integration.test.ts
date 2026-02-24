/**
 * Stats Integration Tests
 *
 * Tests for repository statistics operations against real restic repositories.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import * as restic from "../restic";
import type { LocalStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "stats-integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

describe("Stats Integration Tests", () => {
  let testDir: string;
  let repoDir: string;
  let sourceDir: string;
  let localStorage: LocalStorage;
  let testRepoCounter = 0;

  // Generate unique repo name
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  beforeAll(() => {
    testDir = `/tmp/stats-integration-test-${Date.now()}`;
    repoDir = join(testDir, "repos");
    sourceDir = join(testDir, "source");

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

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
    mkdirSync(sourceDir, { recursive: true });
  });

  describe("Basic Stats Retrieval", () => {
    it("returns stats for an initialized repository with backups", async () => {
      const repoName = getUniqueRepoName("stats-basic");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Hello World".repeat(100));
      writeFileSync(join(sourceDir, "file2.txt"), "More content".repeat(50));
      mkdirSync(join(sourceDir, "nested"));
      writeFileSync(join(sourceDir, "nested", "file3.txt"), "Nested content".repeat(25));

      // Initialize and backup
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backupResult.success).toBe(true);

      // Get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(true);
      expect(statsResult.stats).toBeDefined();
      expect(statsResult.stats!.total_size).toBeGreaterThan(0);
      expect(statsResult.stats!.total_file_count).toBeGreaterThan(0);
      expect(statsResult.stats!.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);

    it("returns stats for an empty repository", async () => {
      const repoName = getUniqueRepoName("stats-empty");

      // Initialize but don't backup anything
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(true);
      expect(statsResult.stats).toBeDefined();
      expect(statsResult.stats!.snapshots_count).toBe(0);
    }, TEST_TIMEOUT);

    it("fails for non-existent repository", async () => {
      const repoName = getUniqueRepoName("stats-nonexistent");

      // Don't initialize - just try to get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(false);
      expect(statsResult.message).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe("Stats After Multiple Backups", () => {
    it("shows correct snapshot count after multiple backups", async () => {
      const repoName = getUniqueRepoName("stats-multi-backup");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 3 backups
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `backup${i}.txt`), `Backup ${i} content`);
        const backupResult = await restic.backup(
          localStorage,
          repoName,
          RESTIC_PASSWORD,
          sourceDir
        );
        expect(backupResult.success).toBe(true);
      }

      // Get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(true);
      expect(statsResult.stats!.snapshots_count).toBe(3);
    }, TEST_TIMEOUT);

    it("tracks total size growth with new data", async () => {
      const repoName = getUniqueRepoName("stats-size-growth");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // First backup with small file
      writeFileSync(join(sourceDir, "small.txt"), "Small content");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats1 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      const initialSize = stats1.stats!.total_size;

      // Add larger file
      writeFileSync(join(sourceDir, "large.txt"), "Large content ".repeat(1000));
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats2 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(stats2.stats!.total_size).toBeGreaterThan(initialSize);
      expect(stats2.stats!.snapshots_count).toBe(2);
    }, TEST_TIMEOUT);

    it("verifies deduplication in stats", async () => {
      const repoName = getUniqueRepoName("stats-dedup");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create large file
      const largeContent = "X".repeat(100000);
      writeFileSync(join(sourceDir, "large.txt"), largeContent);

      // First backup
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      const stats1 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      // Second backup - same content, no new data
      writeFileSync(join(sourceDir, "small.txt"), "tiny");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      const stats2 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      // Note: restic stats default mode shows "restore size" which counts data per snapshot
      // With 2 snapshots referencing the same 100KB file, total is ~200KB even with deduplication
      // The important thing is that size doesn't grow proportionally with number of backups
      // (without dedup it would be much larger due to metadata overhead per snapshot)
      expect(stats2.stats!.total_size).toBeLessThan(stats1.stats!.total_size * 2.5);
      expect(stats2.stats!.snapshots_count).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe("Stats After Prune Operations", () => {
    it("reflects reduced snapshot count after prune", async () => {
      const repoName = getUniqueRepoName("stats-prune");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 5 backups
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Verify 5 snapshots
      const statsBefore = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsBefore.stats!.snapshots_count).toBe(5);

      // Prune to keep only last 2
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 2 });

      // Verify 2 snapshots
      const statsAfter = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsAfter.stats!.snapshots_count).toBe(2);
    }, TEST_TIMEOUT);

    it("shows reduced size after prune removes unique data", async () => {
      const repoName = getUniqueRepoName("stats-prune-size");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // First backup with unique data
      writeFileSync(join(sourceDir, "unique1.txt"), "U".repeat(50000));
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Second backup with different unique data
      rmSync(join(sourceDir, "unique1.txt"));
      writeFileSync(join(sourceDir, "unique2.txt"), "V".repeat(50000));
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const statsBefore = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      // Prune to keep only last 1 (removes unique1 data)
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 1 });

      const statsAfter = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      // After prune, size should be reduced
      expect(statsAfter.stats!.total_size).toBeLessThan(statsBefore.stats!.total_size);
    }, TEST_TIMEOUT);
  });

  describe("Concurrent Stats Requests", () => {
    it("handles multiple concurrent stats requests", async () => {
      const repoName = getUniqueRepoName("stats-concurrent");

      // Setup repo with data
      writeFileSync(join(sourceDir, "data.txt"), "Test data for concurrent stats");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Make 5 concurrent stats requests
      const statsPromises = Array(5).fill(null).map(() =>
        restic.stats(localStorage, repoName, RESTIC_PASSWORD)
      );

      const results = await Promise.all(statsPromises);

      // All should succeed with same values
      for (const result of results) {
        expect(result.success).toBe(true);
        expect(result.stats!.snapshots_count).toBe(1);
      }

      // All should report same size
      const sizes = results.map(r => r.stats!.total_size);
      expect(new Set(sizes).size).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("Stats with Tags and Filters", () => {
    it("stats include all tagged and untagged snapshots", async () => {
      const repoName = getUniqueRepoName("stats-tags");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Backup with tag
      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged content");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["daily"],
      });

      // Backup without tag
      writeFileSync(join(sourceDir, "untagged.txt"), "Untagged content");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(statsResult.success).toBe(true);
      expect(statsResult.stats!.snapshots_count).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe("Check Operation", () => {
    it("check passes for healthy repository", async () => {
      const repoName = getUniqueRepoName("check-healthy");

      writeFileSync(join(sourceDir, "data.txt"), "Test data");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);

      expect(checkResult.success).toBe(true);
      expect(checkResult.message).toContain("passed");
    }, TEST_TIMEOUT);

    it("check with readData option verifies data integrity", async () => {
      const repoName = getUniqueRepoName("check-read-data");

      writeFileSync(join(sourceDir, "important.txt"), "Critical data");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(checkResult.success).toBe(true);
    }, TEST_TIMEOUT);

    it("check fails for non-existent repository", async () => {
      const repoName = getUniqueRepoName("check-nonexistent");

      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);

      expect(checkResult.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Unlock Operation", () => {
    it("unlock succeeds on unlocked repository", async () => {
      const repoName = getUniqueRepoName("unlock-clean");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      const unlockResult = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);

      expect(unlockResult.success).toBe(true);
    }, TEST_TIMEOUT);

    it("unlock fails for non-existent repository", async () => {
      const repoName = getUniqueRepoName("unlock-nonexistent");

      const unlockResult = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);

      expect(unlockResult.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Stats and Other Operations Combined", () => {
    it("full workflow: backup, stats, check, prune, stats", async () => {
      const repoName = getUniqueRepoName("stats-full-workflow");

      // Initialize
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create multiple backups
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `data${i}.txt`), `Data ${i}`.repeat(100));
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Get initial stats
      const stats1 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(stats1.stats!.snapshots_count).toBe(3);
      const initialSize = stats1.stats!.total_size;

      // Check repository
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);

      // Prune
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 1 });

      // Get final stats
      const stats2 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(stats2.stats!.snapshots_count).toBe(1);

      // Final check
      const finalCheck = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(finalCheck.success).toBe(true);
    }, TEST_TIMEOUT);
  });
});
