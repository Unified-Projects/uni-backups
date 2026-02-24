/**
 * Local Filesystem Storage Backend Integration Tests
 *
 * Tests restic operations against the local filesystem.
 * This is the simplest storage backend, no Docker required.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, chmodSync } from "fs";
import { join } from "path";
import * as restic from "../restic";
import type { LocalStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 60000; // 1 minute per test (local is faster)

describe("Local Filesystem Storage Backend Integration Tests", () => {
  let testDir: string;
  let repoDir: string;
  let sourceDir: string;
  let restoreDir: string;
  let localStorage: LocalStorage;
  let testRepoCounter = 0;

  // Generate unique repo name for each test to avoid conflicts
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  beforeAll(() => {
    // Create test directories
    testDir = `/tmp/local-integration-test-${Date.now()}`;
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
    // Clean up test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clean source and restore directories between tests
    if (existsSync(sourceDir)) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
    if (existsSync(restoreDir)) {
      rmSync(restoreDir, { recursive: true, force: true });
    }
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });
  });

  describe("buildRepoUrl", () => {
    it("generates correct local path format", () => {
      const url = restic.buildRepoUrl(localStorage, "test-repo");
      expect(url).toBe(`${repoDir}/test-repo`);
    });

    it("handles repo names with special characters", () => {
      const url = restic.buildRepoUrl(localStorage, "my-backup-repo-2024");
      expect(url).toBe(`${repoDir}/my-backup-repo-2024`);
    });
  });

  describe("buildResticEnv", () => {
    it("sets RESTIC_PASSWORD correctly", () => {
      const env = restic.buildResticEnv(localStorage, RESTIC_PASSWORD);

      expect(env.RESTIC_PASSWORD).toBe(RESTIC_PASSWORD);
    });

    it("does not set AWS credentials for local storage", () => {
      const env = restic.buildResticEnv(localStorage, RESTIC_PASSWORD);

      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    });
  });

  describe("initRepo", () => {
    it("creates a new repository in local filesystem", async () => {
      const repoName = getUniqueRepoName("init-local-test");

      const result = await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized|already exists/i);

      // Verify repo directory was created
      expect(existsSync(join(repoDir, repoName))).toBe(true);
    }, TEST_TIMEOUT);

    it("returns alreadyExists for existing repository", async () => {
      const repoName = getUniqueRepoName("existing-local-test");

      // First init
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Second init should return alreadyExists
      const result = await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    }, TEST_TIMEOUT);

    it("creates repository with correct structure", async () => {
      const repoName = getUniqueRepoName("structure-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      const repoPath = join(repoDir, repoName);
      // Restic creates config, data, index, keys, locks, snapshots directories
      expect(existsSync(join(repoPath, "config"))).toBe(true);
      expect(existsSync(join(repoPath, "keys"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("backup", () => {
    it("creates backup in local filesystem and returns snapshot ID", async () => {
      const repoName = getUniqueRepoName("backup-local-test");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Hello World from local test");
      writeFileSync(join(sourceDir, "file2.txt"), "Another local test file");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "nested.txt"), "Nested local file content");

      // Init and backup
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId!.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("applies tags to backup snapshot", async () => {
      const repoName = getUniqueRepoName("tags-local-test");

      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged local backup test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["local-test", "development", "quick-backup"] }
      );

      expect(backupResult.success).toBe(true);

      // Verify tags are stored
      const listResult = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(listResult.success).toBe(true);
      expect(listResult.snapshots![0].tags).toContain("local-test");
      expect(listResult.snapshots![0].tags).toContain("development");
      expect(listResult.snapshots![0].tags).toContain("quick-backup");
    }, TEST_TIMEOUT);

    it("respects exclude patterns", async () => {
      const repoName = getUniqueRepoName("exclude-local-test");

      // Create files including ones to exclude
      writeFileSync(join(sourceDir, "keep.txt"), "Keep this file");
      writeFileSync(join(sourceDir, "skip.tmp"), "Skip this temp file");
      writeFileSync(join(sourceDir, "skip.swp"), "Skip this swap file");
      mkdirSync(join(sourceDir, "__pycache__"));
      writeFileSync(join(sourceDir, "__pycache__", "module.pyc"), "Python cache");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { exclude: ["*.tmp", "*.swp", "__pycache__/**"] }
      );

      expect(backupResult.success).toBe(true);

      // List files in snapshot to verify exclusions
      const listResult = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(listResult.success).toBe(true);
      const fileNames = listResult.entries?.map((e) => e.name) || [];
      expect(fileNames).toContain("keep.txt");
      expect(fileNames).not.toContain("skip.tmp");
      expect(fileNames).not.toContain("skip.swp");
    }, TEST_TIMEOUT);

    it.skip("backs up empty directories", async () => {
      const repoName = getUniqueRepoName("empty-dir-test");

      writeFileSync(join(sourceDir, "file.txt"), "File content");
      mkdirSync(join(sourceDir, "empty-folder"));

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      expect(backupResult.success).toBe(true);

      // Restore and verify empty directory exists
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(existsSync(join(restoreDir, sourceDir, "empty-folder"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("listSnapshots", () => {
    it("returns all snapshots in repository", async () => {
      const repoName = getUniqueRepoName("list-all-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create multiple snapshots
      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v3.txt"), "Version 3");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("filters snapshots by tag", async () => {
      const repoName = getUniqueRepoName("filter-tag-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "a.txt"), "File A");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["env-dev"],
      });

      writeFileSync(join(sourceDir, "b.txt"), "File B");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["env-prod"],
      });

      writeFileSync(join(sourceDir, "c.txt"), "File C");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["env-dev"],
      });

      // Filter by env-dev tag
      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        tags: ["env-dev"],
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
      result.snapshots?.forEach((s) => {
        expect(s.tags).toContain("env-dev");
      });
    }, TEST_TIMEOUT);

    it("returns latest N snapshots", async () => {
      const repoName = getUniqueRepoName("latest-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 6 snapshots
      for (let i = 1; i <= 6; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        latest: 3,
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("includes snapshot metadata (id, time, hostname, paths)", async () => {
      const repoName = getUniqueRepoName("metadata-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "meta.txt"), "Metadata test");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["local-metadata"],
      });

      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      const snapshot = result.snapshots![0];

      expect(snapshot.id).toBeDefined();
      expect(snapshot.short_id).toBeDefined();
      expect(snapshot.time).toBeDefined();
      expect(snapshot.hostname).toBeDefined();
      expect(snapshot.paths).toBeInstanceOf(Array);
      expect(snapshot.paths.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe("listFiles", () => {
    it("returns file listing from snapshot", async () => {
      const repoName = getUniqueRepoName("ls-local-test");

      // Create directory structure
      writeFileSync(join(sourceDir, "root.txt"), "Root file");
      mkdirSync(join(sourceDir, "level1"));
      writeFileSync(join(sourceDir, "level1", "nested.txt"), "Nested file");
      mkdirSync(join(sourceDir, "level1", "level2"));
      writeFileSync(join(sourceDir, "level1", "level2", "deep.txt"), "Deep file");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(result.success).toBe(true);
      expect(result.entries?.length).toBeGreaterThan(0);

      // Check for expected files
      const fileNames = result.entries?.map((e) => e.name);
      expect(fileNames).toContain("root.txt");
    }, TEST_TIMEOUT);

    it("includes file metadata (size, type, mtime)", async () => {
      const repoName = getUniqueRepoName("file-meta-local-test");

      const content = "Test file with known content length for local storage testing";
      writeFileSync(join(sourceDir, "sized.txt"), content);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(result.success).toBe(true);

      const file = result.entries?.find((e) => e.name === "sized.txt");
      expect(file).toBeDefined();
      expect(file!.type).toBe("file");
      expect(file!.size).toBe(content.length);
      expect(file!.mtime).toBeDefined();
    }, TEST_TIMEOUT);

    it("lists directory entries with correct types", async () => {
      const repoName = getUniqueRepoName("dir-type-test");

      writeFileSync(join(sourceDir, "file.txt"), "File content");
      mkdirSync(join(sourceDir, "directory"));
      writeFileSync(join(sourceDir, "directory", "inside.txt"), "Inside content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(result.success).toBe(true);

      const fileEntry = result.entries?.find((e) => e.name === "file.txt");
      const dirEntry = result.entries?.find((e) => e.name === "directory");

      expect(fileEntry?.type).toBe("file");
      expect(dirEntry?.type).toBe("dir");
    }, TEST_TIMEOUT);
  });

  describe("restore", () => {
    it("restores files from local repository to target directory", async () => {
      const repoName = getUniqueRepoName("restore-local-test");

      // Create unique content
      const uniqueContent = `Local restore test ${Date.now()}`;
      writeFileSync(join(sourceDir, "restore-me.txt"), uniqueContent);
      mkdirSync(join(sourceDir, "folder"));
      writeFileSync(join(sourceDir, "folder", "nested.txt"), "Nested local content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore to new directory
      const result = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(result.success).toBe(true);

      // Verify restored files
      const restoredPath = join(restoreDir, sourceDir, "restore-me.txt");
      expect(existsSync(restoredPath)).toBe(true);
      expect(readFileSync(restoredPath, "utf-8")).toBe(uniqueContent);

      const nestedPath = join(restoreDir, sourceDir, "folder", "nested.txt");
      expect(existsSync(nestedPath)).toBe(true);
    }, TEST_TIMEOUT);

    it("restores only matching files with include pattern", async () => {
      const repoName = getUniqueRepoName("include-restore-local-test");

      writeFileSync(join(sourceDir, "include-me.txt"), "Include this");
      writeFileSync(join(sourceDir, "exclude-me.log"), "Exclude this");
      writeFileSync(join(sourceDir, "also-include.txt"), "Also include");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { include: ["*.txt"] }
      );

      expect(result.success).toBe(true);

      // Verify only .txt files restored
      expect(existsSync(join(restoreDir, sourceDir, "include-me.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "also-include.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "exclude-me.log"))).toBe(false);
    }, TEST_TIMEOUT);

    it("excludes files with exclude pattern", async () => {
      const repoName = getUniqueRepoName("exclude-restore-local-test");

      writeFileSync(join(sourceDir, "keep.txt"), "Keep this");
      writeFileSync(join(sourceDir, "skip.tmp"), "Skip this");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { exclude: ["*.tmp"] }
      );

      expect(result.success).toBe(true);

      expect(existsSync(join(restoreDir, sourceDir, "keep.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "skip.tmp"))).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("prune", () => {
    it("removes old snapshots based on keep-last policy", async () => {
      const repoName = getUniqueRepoName("prune-last-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Verify 5 snapshots exist
      const beforePrune = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(beforePrune.snapshots?.length).toBe(5);

      // Prune to keep only last 2
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 2 }
      );
      expect(pruneResult.success).toBe(true);

      // Verify only 2 remain
      const afterPrune = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("applies daily retention policy", async () => {
      const repoName = getUniqueRepoName("prune-daily-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 3 snapshots (all same day)
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `daily${i}.txt`), `Daily ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Prune with daily:1 (since all same day, should keep 1)
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { daily: 1 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);

    it("prunes with tag filter", async () => {
      const repoName = getUniqueRepoName("prune-tag-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create snapshots with different tags
      writeFileSync(join(sourceDir, "a1.txt"), "A1");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["project-alpha"],
      });

      writeFileSync(join(sourceDir, "a2.txt"), "A2");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["project-alpha"],
      });

      writeFileSync(join(sourceDir, "b1.txt"), "B1");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["project-beta"],
      });

      // Prune only project-alpha (keep last 1)
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 },
        { tags: ["project-alpha"] }
      );
      expect(pruneResult.success).toBe(true);

      // project-beta should still have its snapshot, project-alpha should have 1
      const afterPrune = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);

      const alphaSnapshots = afterPrune.snapshots?.filter((s) =>
        s.tags?.includes("project-alpha")
      );
      expect(alphaSnapshots?.length).toBe(1);
    }, TEST_TIMEOUT);

    it("applies weekly retention policy", async () => {
      const repoName = getUniqueRepoName("prune-weekly-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 3 snapshots
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `weekly${i}.txt`), `Weekly ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Prune with weekly:1
      const pruneResult = await restic.prune(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        { weekly: 1 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      // All snapshots are from same week, so should keep 1
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("check", () => {
    it("verifies local repository integrity", async () => {
      const repoName = getUniqueRepoName("check-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "check.txt"), "Check local test data");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);

    it("performs thorough check with readData option", async () => {
      const repoName = getUniqueRepoName("check-read-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "thorough.txt"), "Thorough local check data");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(localStorage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("stats", () => {
    it("returns local repository statistics", async () => {
      const repoName = getUniqueRepoName("stats-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create some data
      writeFileSync(join(sourceDir, "stats1.txt"), "Stats local test data 1");
      writeFileSync(
        join(sourceDir, "stats2.txt"),
        "Stats local test data 2 with more content here"
      );
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);

    it("updates stats after multiple backups", async () => {
      const repoName = getUniqueRepoName("stats-multi-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "file1.txt"), "Content 1");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats1 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(stats1.stats?.snapshots_count).toBe(1);

      writeFileSync(join(sourceDir, "file2.txt"), "Content 2");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const stats2 = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(stats2.stats?.snapshots_count).toBe(2);
      expect(stats2.stats?.total_file_count).toBeGreaterThanOrEqual(
        stats1.stats?.total_file_count || 0
      );
    }, TEST_TIMEOUT);
  });

  describe("unlock", () => {
    it("removes stale locks from local repository", async () => {
      const repoName = getUniqueRepoName("unlock-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Unlock should succeed even with no locks
      const result = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("preserves data integrity through backup and restore", async () => {
      const repoName = getUniqueRepoName("full-cycle-local-test");

      // Create files with known content
      const files: Record<string, string | Buffer> = {
        "text.txt": "Hello World from Local Storage!\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
        "large.txt": "z".repeat(10000),
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600}",
        "json.json": JSON.stringify({ key: "value", nested: { arr: [1, 2, 3] } }),
      };

      mkdirSync(join(sourceDir, "nested", "deep"), { recursive: true });
      files["nested/deep/file.txt"] = "Deeply nested local content";

      for (const [path, content] of Object.entries(files)) {
        const fullPath = join(sourceDir, path);
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        if (Buffer.isBuffer(content)) {
          writeFileSync(fullPath, content);
        } else {
          writeFileSync(fullPath, content, "utf-8");
        }
      }

      // Backup to local storage
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["local-full-cycle", "integrity-test"] }
      );
      expect(backupResult.success).toBe(true);

      // Restore from local storage
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );
      expect(restoreResult.success).toBe(true);

      // Verify all files match exactly
      for (const [path, originalContent] of Object.entries(files)) {
        const restoredPath = join(restoreDir, sourceDir, path);
        expect(existsSync(restoredPath)).toBe(true);

        const restoredContent = readFileSync(restoredPath);
        if (Buffer.isBuffer(originalContent)) {
          expect(restoredContent.equals(originalContent)).toBe(true);
        } else {
          expect(restoredContent.toString("utf-8")).toBe(originalContent);
        }
      }
    }, TEST_TIMEOUT);

    it("handles multiple backup versions correctly", async () => {
      const repoName = getUniqueRepoName("versions-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Version 1
      writeFileSync(join(sourceDir, "version.txt"), "Version 1 local content");
      const backup1 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v1"] }
      );

      // Version 2
      writeFileSync(join(sourceDir, "version.txt"), "Version 2 local content - modified");
      writeFileSync(join(sourceDir, "new-file.txt"), "New file in v2");
      const backup2 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v2"] }
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

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      // Verify v1 has original content
      expect(
        readFileSync(join(restore1Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 1 local content");
      expect(existsSync(join(restore1Dir, sourceDir, "new-file.txt"))).toBe(false);

      // Verify v2 has modified content
      expect(
        readFileSync(join(restore2Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 2 local content - modified");
      expect(existsSync(join(restore2Dir, sourceDir, "new-file.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Incremental Backup Efficiency", () => {
    it("efficiently handles unchanged files in incremental backups", async () => {
      const repoName = getUniqueRepoName("incremental-local-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create initial dataset
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(sourceDir, `file${i}.txt`),
          `File content ${i} `.repeat(50)
        );
      }

      // First backup (full)
      const backup1 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backup1.success).toBe(true);

      // Modify only one file
      writeFileSync(join(sourceDir, "file0.txt"), "Modified content");

      // Second backup (incremental)
      const backup2 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backup2.success).toBe(true);

      // Both snapshots should be independently restorable
      const snapshots = await restic.listSnapshots(
        localStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(snapshots.snapshots?.length).toBe(2);

      // Verify both versions can be restored correctly
      const restore1Dir = join(restoreDir, "backup1");
      const restore2Dir = join(restoreDir, "backup2");

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );

      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      // Original version
      expect(
        readFileSync(join(restore1Dir, sourceDir, "file0.txt"), "utf-8")
      ).toContain("File content 0");

      // Modified version
      expect(
        readFileSync(join(restore2Dir, sourceDir, "file0.txt"), "utf-8")
      ).toBe("Modified content");
    }, TEST_TIMEOUT);
  });

  describe("File Permission Handling", () => {
    it("preserves file permissions through backup and restore", async () => {
      const repoName = getUniqueRepoName("permissions-local-test");

      writeFileSync(join(sourceDir, "executable.sh"), "#!/bin/bash\necho hello");
      chmodSync(join(sourceDir, "executable.sh"), 0o755);

      writeFileSync(join(sourceDir, "readonly.txt"), "Read only content");
      chmodSync(join(sourceDir, "readonly.txt"), 0o444);

      const originalExecMode = statSync(join(sourceDir, "executable.sh")).mode;
      const originalReadMode = statSync(join(sourceDir, "readonly.txt")).mode;

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

      const restoredExecMode = statSync(
        join(restoreDir, sourceDir, "executable.sh")
      ).mode;
      const restoredReadMode = statSync(
        join(restoreDir, sourceDir, "readonly.txt")
      ).mode;

      // Permissions should be preserved (at least the permission bits)
      expect(restoredExecMode & 0o777).toBe(originalExecMode & 0o777);
      expect(restoredReadMode & 0o777).toBe(originalReadMode & 0o777);
    }, TEST_TIMEOUT);
  });
});
