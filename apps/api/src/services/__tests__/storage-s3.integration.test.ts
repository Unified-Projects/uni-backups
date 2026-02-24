/**
 * S3 Storage Backend Integration Tests
 *
 * Tests restic operations against a real MinIO S3-compatible storage.
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile s3 up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import * as restic from "../restic";
import type { S3Storage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 120000; // 2 minutes per test

// Detect Docker environment
const isDocker = process.env.MINIO_ENDPOINT || process.env.REDIS_HOST === "redis";
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || (isDocker ? "minio:9000" : "localhost:9000");

// MinIO configuration (matches docker-compose)
const s3Storage: S3Storage = {
  type: "s3",
  endpoint: `http://${MINIO_ENDPOINT}`,
  bucket: "integration-test",
  region: "us-east-1",
  access_key: "minioadmin",
  secret_key: "minioadmin123",
  path: "",
};

describe("S3 Storage Backend Integration Tests", () => {
  let testDir: string;
  let sourceDir: string;
  let restoreDir: string;
  let testRepoCounter = 0;

  // Generate unique repo name for each test to avoid conflicts
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  beforeAll(async () => {
    // Create local test directories for source/restore data
    testDir = `/tmp/s3-integration-test-${Date.now()}`;
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    // Verify MinIO is accessible
    const healthCheck = await fetch(`http://${MINIO_ENDPOINT}/minio/health/live`);
    if (!healthCheck.ok) {
      throw new Error(
        "MinIO is not running. Start with: docker compose -f tests/compose/services.yml --profile s3 up -d"
      );
    }
  }, TEST_TIMEOUT);

  afterAll(() => {
    // Clean up local test directories
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
    it("generates correct S3 URL format", () => {
      const url = restic.buildRepoUrl(s3Storage, "test-repo");
      // URL includes full endpoint with http:// protocol
      expect(url).toBe(`s3:http://${MINIO_ENDPOINT}/integration-test/test-repo`);
    });

    it("handles bucket with path prefix", () => {
      const storageWithPath: S3Storage = {
        ...s3Storage,
        path: "backups/prod",
      };
      const url = restic.buildRepoUrl(storageWithPath, "my-repo");
      expect(url).toBe(`s3:http://${MINIO_ENDPOINT}/integration-test/backups/prod/my-repo`);
    });
  });

  describe("buildResticEnv", () => {
    it("sets AWS credentials correctly", () => {
      const env = restic.buildResticEnv(s3Storage, RESTIC_PASSWORD);

      expect(env.RESTIC_PASSWORD).toBe(RESTIC_PASSWORD);
      expect(env.AWS_ACCESS_KEY_ID).toBe("minioadmin");
      expect(env.AWS_SECRET_ACCESS_KEY).toBe("minioadmin123");
      // Region is not set by buildResticEnv - only endpoint for S3-compatible storage
      expect(env.AWS_S3_ENDPOINT).toBe(`http://${MINIO_ENDPOINT}`);
    });
  });

  describe("initRepo", () => {
    it("creates a new repository in S3", async () => {
      const repoName = getUniqueRepoName("init-test");

      const result = await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized|already exists/i);
    }, TEST_TIMEOUT);

    it("returns alreadyExists for existing repository", async () => {
      const repoName = getUniqueRepoName("existing-test");

      // First init
      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Second init should return alreadyExists
      const result = await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("backup", () => {
    it("uploads files to S3 and returns snapshot ID", async () => {
      const repoName = getUniqueRepoName("backup-test");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Hello World from S3 test");
      writeFileSync(join(sourceDir, "file2.txt"), "Another test file");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "nested.txt"), "Nested file content");

      // Init and backup
      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId!.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("applies tags to backup snapshot", async () => {
      const repoName = getUniqueRepoName("tags-test");

      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged backup test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["production", "daily", "important"] }
      );

      expect(backupResult.success).toBe(true);

      // Verify tags are stored
      const listResult = await restic.listSnapshots(s3Storage, repoName, RESTIC_PASSWORD);
      expect(listResult.success).toBe(true);
      expect(listResult.snapshots![0].tags).toContain("production");
      expect(listResult.snapshots![0].tags).toContain("daily");
      expect(listResult.snapshots![0].tags).toContain("important");
    }, TEST_TIMEOUT);

    it("respects exclude patterns", async () => {
      const repoName = getUniqueRepoName("exclude-test");

      // Create files including ones to exclude
      writeFileSync(join(sourceDir, "keep.txt"), "Keep this file");
      writeFileSync(join(sourceDir, "skip.tmp"), "Skip this temp file");
      writeFileSync(join(sourceDir, "skip.log"), "Skip this log file");
      mkdirSync(join(sourceDir, "cache"));
      writeFileSync(join(sourceDir, "cache", "cached.dat"), "Cached data");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { exclude: ["*.tmp", "*.log", "cache/**"] }
      );

      expect(backupResult.success).toBe(true);

      // List files in snapshot to verify exclusions
      const listResult = await restic.listFiles(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(listResult.success).toBe(true);
      const fileNames = listResult.entries?.map((e) => e.name) || [];
      expect(fileNames).toContain("keep.txt");
      expect(fileNames).not.toContain("skip.tmp");
      expect(fileNames).not.toContain("skip.log");
    }, TEST_TIMEOUT);
  });

  describe("listSnapshots", () => {
    it("returns all snapshots in repository", async () => {
      const repoName = getUniqueRepoName("list-all-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create multiple snapshots
      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v3.txt"), "Version 3");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("filters snapshots by tag", async () => {
      const repoName = getUniqueRepoName("filter-tag-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "a.txt"), "File A");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-a"],
      });

      writeFileSync(join(sourceDir, "b.txt"), "File B");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-b"],
      });

      writeFileSync(join(sourceDir, "c.txt"), "File C");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-a"],
      });

      // Filter by group-a tag
      const result = await restic.listSnapshots(s3Storage, repoName, RESTIC_PASSWORD, {
        tags: ["group-a"],
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
      result.snapshots?.forEach((s) => {
        expect(s.tags).toContain("group-a");
      });
    }, TEST_TIMEOUT);

    it("returns latest N snapshots", async () => {
      const repoName = getUniqueRepoName("latest-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const result = await restic.listSnapshots(s3Storage, repoName, RESTIC_PASSWORD, {
        latest: 2,
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("includes snapshot metadata (id, time, hostname, paths)", async () => {
      const repoName = getUniqueRepoName("metadata-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "meta.txt"), "Metadata test");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["test"],
      });

      const result = await restic.listSnapshots(s3Storage, repoName, RESTIC_PASSWORD);

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
      const repoName = getUniqueRepoName("ls-test");

      // Create directory structure
      writeFileSync(join(sourceDir, "root.txt"), "Root file");
      mkdirSync(join(sourceDir, "level1"));
      writeFileSync(join(sourceDir, "level1", "nested.txt"), "Nested file");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        s3Storage,
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
      const repoName = getUniqueRepoName("file-meta-test");

      const content = "Test file with known content length";
      writeFileSync(join(sourceDir, "sized.txt"), content);

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        s3Storage,
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
  });

  describe("restore", () => {
    it("restores files from S3 to local directory", async () => {
      const repoName = getUniqueRepoName("restore-test");

      // Create unique content
      const uniqueContent = `S3 restore test ${Date.now()}`;
      writeFileSync(join(sourceDir, "restore-me.txt"), uniqueContent);
      mkdirSync(join(sourceDir, "folder"));
      writeFileSync(join(sourceDir, "folder", "nested.txt"), "Nested content");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore to new directory
      const result = await restic.restore(
        s3Storage,
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
      const repoName = getUniqueRepoName("include-restore-test");

      writeFileSync(join(sourceDir, "include-me.txt"), "Include this");
      writeFileSync(join(sourceDir, "exclude-me.log"), "Exclude this");
      writeFileSync(join(sourceDir, "also-include.txt"), "Also include");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        s3Storage,
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
  });

  describe("prune", () => {
    it("removes old snapshots based on keep-last policy", async () => {
      const repoName = getUniqueRepoName("prune-last-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Verify 5 snapshots exist
      const beforePrune = await restic.listSnapshots(
        s3Storage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(beforePrune.snapshots?.length).toBe(5);

      // Prune to keep only last 2
      const pruneResult = await restic.prune(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        { last: 2 }
      );
      expect(pruneResult.success).toBe(true);

      // Verify only 2 remain
      const afterPrune = await restic.listSnapshots(
        s3Storage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("applies daily retention policy", async () => {
      const repoName = getUniqueRepoName("prune-daily-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create 3 snapshots (all same day)
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `daily${i}.txt`), `Daily ${i}`);
        await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Prune with daily:1 (since all same day, should keep 1)
      const pruneResult = await restic.prune(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        { daily: 1 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(
        s3Storage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);

    it("prunes with tag filter", async () => {
      const repoName = getUniqueRepoName("prune-tag-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create snapshots with different tags
      writeFileSync(join(sourceDir, "a1.txt"), "A1");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-a"],
      });

      writeFileSync(join(sourceDir, "a2.txt"), "A2");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-a"],
      });

      writeFileSync(join(sourceDir, "b1.txt"), "B1");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["group-b"],
      });

      // Prune only group-a (keep last 1)
      const pruneResult = await restic.prune(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 },
        { tags: ["group-a"] }
      );
      expect(pruneResult.success).toBe(true);

      // group-b should still have its snapshot, group-a should have 1
      const afterPrune = await restic.listSnapshots(
        s3Storage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);

      const groupASnapshots = afterPrune.snapshots?.filter((s) =>
        s.tags?.includes("group-a")
      );
      expect(groupASnapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("check", () => {
    it("verifies S3 repository integrity", async () => {
      const repoName = getUniqueRepoName("check-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "check.txt"), "Check test data");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);

    it("performs thorough check with readData option", async () => {
      const repoName = getUniqueRepoName("check-read-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "thorough.txt"), "Thorough check data");
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(s3Storage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("stats", () => {
    it("returns S3 repository statistics", async () => {
      const repoName = getUniqueRepoName("stats-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Create some data
      writeFileSync(join(sourceDir, "stats1.txt"), "Stats test data 1");
      writeFileSync(
        join(sourceDir, "stats2.txt"),
        "Stats test data 2 with more content here"
      );
      await restic.backup(s3Storage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("unlock", () => {
    it("removes stale locks from S3 repository", async () => {
      const repoName = getUniqueRepoName("unlock-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Unlock should succeed even with no locks
      const result = await restic.unlock(s3Storage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("preserves data integrity through backup and restore", async () => {
      const repoName = getUniqueRepoName("full-cycle-test");

      // Create files with known content
      const files: Record<string, string | Buffer> = {
        "text.txt": "Hello World from S3!\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
        "large.txt": "x".repeat(10000),
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600}",
      };

      mkdirSync(join(sourceDir, "nested", "deep"), { recursive: true });
      files["nested/deep/file.txt"] = "Deeply nested content";

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

      // Backup to S3
      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["full-cycle", "integrity-test"] }
      );
      expect(backupResult.success).toBe(true);

      // Restore from S3
      const restoreResult = await restic.restore(
        s3Storage,
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
      const repoName = getUniqueRepoName("versions-test");

      await restic.initRepo(s3Storage, repoName, RESTIC_PASSWORD);

      // Version 1
      writeFileSync(join(sourceDir, "version.txt"), "Version 1 content");
      const backup1 = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v1"] }
      );

      // Version 2
      writeFileSync(join(sourceDir, "version.txt"), "Version 2 content - modified");
      writeFileSync(join(sourceDir, "new-file.txt"), "New file in v2");
      const backup2 = await restic.backup(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v2"] }
      );

      // Restore version 1
      const restore1Dir = join(restoreDir, "v1");
      await restic.restore(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        s3Storage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      // Verify v1 has original content
      expect(
        readFileSync(join(restore1Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 1 content");
      expect(existsSync(join(restore1Dir, sourceDir, "new-file.txt"))).toBe(false);

      // Verify v2 has modified content
      expect(
        readFileSync(join(restore2Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 2 content - modified");
      expect(existsSync(join(restore2Dir, sourceDir, "new-file.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });
});
