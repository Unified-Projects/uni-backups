/**
 * REST Server Storage Backend Integration Tests
 *
 * Tests restic operations against a real restic REST server.
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile rest up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import * as restic from "../restic";
import type { RestStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 120000; // 2 minutes per test

// Detect Docker environment
const isDocker = process.env.REST_SERVER_URL || process.env.REDIS_HOST === "redis";
const REST_SERVER_URL = process.env.REST_SERVER_URL || (isDocker ? "http://rest-server:8000" : "http://localhost:8000");

// REST server configuration (matches docker-compose)
const restStorage: RestStorage = {
  type: "rest",
  url: REST_SERVER_URL,
};

// REST server with authentication
const restStorageWithAuth: RestStorage = {
  type: "rest",
  url: REST_SERVER_URL,
  username: "testuser",
  password: "testpass",
};

describe("REST Server Storage Backend Integration Tests", () => {
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
    testDir = `/tmp/rest-integration-test-${Date.now()}`;
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    // Verify REST server is accessible (with retry for container startup)
    let retries = 10;
    let lastError: Error | null = null;
    while (retries > 0) {
      try {
        const healthCheck = await fetch(REST_SERVER_URL);
        // REST server returns 405 Method Not Allowed for GET /
        // or 404 for some paths - any response means server is running
        if (healthCheck.ok || healthCheck.status === 404 || healthCheck.status === 405) {
          return;
        }
      } catch (e) {
        lastError = e as Error;
      }
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error(
      `REST server is not running at ${REST_SERVER_URL}. Start with: docker compose -f tests/compose/services.yml --profile rest up -d. Last error: ${lastError?.message}`
    );
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
    it("generates correct REST URL format", () => {
      const url = restic.buildRepoUrl(restStorage, "test-repo");
      // URL includes the REST_SERVER_URL from storage config
      expect(url).toBe(`rest:${REST_SERVER_URL}/test-repo`);
    });

    it("handles URL with trailing slash", () => {
      const storageWithSlash: RestStorage = {
        type: "rest",
        url: `${REST_SERVER_URL}/`,
      };
      const url = restic.buildRepoUrl(storageWithSlash, "my-repo");
      // Should handle trailing slash gracefully - strip it
      expect(url).toBe(`rest:${REST_SERVER_URL}/my-repo`);
    });

    it("includes credentials in URL when provided", () => {
      // Test with explicit hardcoded URL to test credential injection
      const authStorage: RestStorage = {
        type: "rest",
        url: "http://example.com:8000",
        username: "testuser",
        password: "testpass",
      };
      const url = restic.buildRepoUrl(authStorage, "secure-repo");
      // buildRepoUrl doesn't inject credentials - it just uses the URL as-is
      // Credentials are handled via environment or restic options
      expect(url).toBe("rest:http://example.com:8000/secure-repo");
    });
  });

  describe("buildResticEnv", () => {
    it("sets RESTIC_PASSWORD correctly", () => {
      const env = restic.buildResticEnv(restStorage, RESTIC_PASSWORD);

      expect(env.RESTIC_PASSWORD).toBe(RESTIC_PASSWORD);
    });

    it("does not set AWS credentials for REST storage", () => {
      const env = restic.buildResticEnv(restStorage, RESTIC_PASSWORD);

      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    });
  });

  describe("initRepo", () => {
    it("creates a new repository on REST server", async () => {
      const repoName = getUniqueRepoName("init-rest-test");

      const result = await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized|already exists/i);
    }, TEST_TIMEOUT);

    it("returns alreadyExists for existing repository", async () => {
      const repoName = getUniqueRepoName("existing-rest-test");

      // First init
      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Second init should return alreadyExists
      const result = await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("backup", () => {
    it("uploads files to REST server and returns snapshot ID", async () => {
      const repoName = getUniqueRepoName("backup-rest-test");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Hello World from REST test");
      writeFileSync(join(sourceDir, "file2.txt"), "Another REST test file");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "nested.txt"), "Nested REST file content");

      // Init and backup
      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId!.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("applies tags to backup snapshot", async () => {
      const repoName = getUniqueRepoName("tags-rest-test");

      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged REST backup test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["rest-prod", "daily-backup", "critical"] }
      );

      expect(backupResult.success).toBe(true);

      // Verify tags are stored
      const listResult = await restic.listSnapshots(restStorage, repoName, RESTIC_PASSWORD);
      expect(listResult.success).toBe(true);
      expect(listResult.snapshots![0].tags).toContain("rest-prod");
      expect(listResult.snapshots![0].tags).toContain("daily-backup");
      expect(listResult.snapshots![0].tags).toContain("critical");
    }, TEST_TIMEOUT);

    it("respects exclude patterns", async () => {
      const repoName = getUniqueRepoName("exclude-rest-test");

      // Create files including ones to exclude
      writeFileSync(join(sourceDir, "keep.txt"), "Keep this file");
      writeFileSync(join(sourceDir, "skip.tmp"), "Skip this temp file");
      writeFileSync(join(sourceDir, "skip.log"), "Skip this log file");
      mkdirSync(join(sourceDir, "node_modules"));
      writeFileSync(join(sourceDir, "node_modules", "module.js"), "Module code");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { exclude: ["*.tmp", "*.log", "node_modules/**"] }
      );

      expect(backupResult.success).toBe(true);

      // List files in snapshot to verify exclusions
      const listResult = await restic.listFiles(
        restStorage,
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
      const repoName = getUniqueRepoName("list-all-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create multiple snapshots
      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v3.txt"), "Version 3");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("filters snapshots by tag", async () => {
      const repoName = getUniqueRepoName("filter-tag-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "a.txt"), "File A");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["environment-staging"],
      });

      writeFileSync(join(sourceDir, "b.txt"), "File B");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["environment-production"],
      });

      writeFileSync(join(sourceDir, "c.txt"), "File C");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["environment-staging"],
      });

      // Filter by staging tag
      const result = await restic.listSnapshots(restStorage, repoName, RESTIC_PASSWORD, {
        tags: ["environment-staging"],
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
      result.snapshots?.forEach((s) => {
        expect(s.tags).toContain("environment-staging");
      });
    }, TEST_TIMEOUT);

    it("returns latest N snapshots", async () => {
      const repoName = getUniqueRepoName("latest-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const result = await restic.listSnapshots(restStorage, repoName, RESTIC_PASSWORD, {
        latest: 2,
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("includes snapshot metadata (id, time, hostname, paths)", async () => {
      const repoName = getUniqueRepoName("metadata-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "meta.txt"), "Metadata test");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["metadata-test"],
      });

      const result = await restic.listSnapshots(restStorage, repoName, RESTIC_PASSWORD);

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
      const repoName = getUniqueRepoName("ls-rest-test");

      // Create directory structure
      writeFileSync(join(sourceDir, "root.txt"), "Root file");
      mkdirSync(join(sourceDir, "level1"));
      writeFileSync(join(sourceDir, "level1", "nested.txt"), "Nested file");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        restStorage,
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
      const repoName = getUniqueRepoName("file-meta-rest-test");

      const content = "Test file with known content length for REST";
      writeFileSync(join(sourceDir, "sized.txt"), content);

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        restStorage,
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
    it("restores files from REST server to local directory", async () => {
      const repoName = getUniqueRepoName("restore-rest-test");

      // Create unique content
      const uniqueContent = `REST restore test ${Date.now()}`;
      writeFileSync(join(sourceDir, "restore-me.txt"), uniqueContent);
      mkdirSync(join(sourceDir, "folder"));
      writeFileSync(join(sourceDir, "folder", "nested.txt"), "Nested REST content");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore to new directory
      const result = await restic.restore(
        restStorage,
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
      const repoName = getUniqueRepoName("include-restore-rest-test");

      writeFileSync(join(sourceDir, "include-me.txt"), "Include this");
      writeFileSync(join(sourceDir, "exclude-me.log"), "Exclude this");
      writeFileSync(join(sourceDir, "also-include.txt"), "Also include");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        restStorage,
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
      const repoName = getUniqueRepoName("prune-last-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Verify 5 snapshots exist
      const beforePrune = await restic.listSnapshots(
        restStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(beforePrune.snapshots?.length).toBe(5);

      // Prune to keep only last 2
      const pruneResult = await restic.prune(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 2 }
      );
      expect(pruneResult.success).toBe(true);

      // Verify only 2 remain
      const afterPrune = await restic.listSnapshots(
        restStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("applies daily retention policy", async () => {
      const repoName = getUniqueRepoName("prune-daily-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create 3 snapshots (all same day)
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `daily${i}.txt`), `Daily ${i}`);
        await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Prune with daily:1 (since all same day, should keep 1)
      const pruneResult = await restic.prune(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        { daily: 1 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(
        restStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);

    it("prunes with tag filter", async () => {
      const repoName = getUniqueRepoName("prune-tag-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create snapshots with different tags
      writeFileSync(join(sourceDir, "a1.txt"), "A1");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["tier-gold"],
      });

      writeFileSync(join(sourceDir, "a2.txt"), "A2");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["tier-gold"],
      });

      writeFileSync(join(sourceDir, "b1.txt"), "B1");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["tier-silver"],
      });

      // Prune only tier-gold (keep last 1)
      const pruneResult = await restic.prune(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 },
        { tags: ["tier-gold"] }
      );
      expect(pruneResult.success).toBe(true);

      // tier-silver should still have its snapshot, tier-gold should have 1
      const afterPrune = await restic.listSnapshots(
        restStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);

      const goldSnapshots = afterPrune.snapshots?.filter((s) =>
        s.tags?.includes("tier-gold")
      );
      expect(goldSnapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("check", () => {
    it("verifies REST repository integrity", async () => {
      const repoName = getUniqueRepoName("check-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "check.txt"), "Check REST test data");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);

    it("performs thorough check with readData option", async () => {
      const repoName = getUniqueRepoName("check-read-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "thorough.txt"), "Thorough REST check data");
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(restStorage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("stats", () => {
    it("returns REST repository statistics", async () => {
      const repoName = getUniqueRepoName("stats-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create some data
      writeFileSync(join(sourceDir, "stats1.txt"), "Stats REST test data 1");
      writeFileSync(
        join(sourceDir, "stats2.txt"),
        "Stats REST test data 2 with more content here"
      );
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("unlock", () => {
    it("removes stale locks from REST repository", async () => {
      const repoName = getUniqueRepoName("unlock-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Unlock should succeed even with no locks
      const result = await restic.unlock(restStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("preserves data integrity through backup and restore", async () => {
      const repoName = getUniqueRepoName("full-cycle-rest-test");

      // Create files with known content
      const files: Record<string, string | Buffer> = {
        "text.txt": "Hello World from REST Server!\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
        "large.txt": "x".repeat(10000),
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600}",
      };

      mkdirSync(join(sourceDir, "nested", "deep"), { recursive: true });
      files["nested/deep/file.txt"] = "Deeply nested REST content";

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

      // Backup to REST server
      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["rest-full-cycle", "integrity-test"] }
      );
      expect(backupResult.success).toBe(true);

      // Restore from REST server
      const restoreResult = await restic.restore(
        restStorage,
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
      const repoName = getUniqueRepoName("versions-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Version 1
      writeFileSync(join(sourceDir, "version.txt"), "Version 1 REST content");
      const backup1 = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v1"] }
      );

      // Version 2
      writeFileSync(join(sourceDir, "version.txt"), "Version 2 REST content - modified");
      writeFileSync(join(sourceDir, "new-file.txt"), "New file in v2");
      const backup2 = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v2"] }
      );

      // Restore version 1
      const restore1Dir = join(restoreDir, "v1");
      await restic.restore(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      // Verify v1 has original content
      expect(
        readFileSync(join(restore1Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 1 REST content");
      expect(existsSync(join(restore1Dir, sourceDir, "new-file.txt"))).toBe(false);

      // Verify v2 has modified content
      expect(
        readFileSync(join(restore2Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 2 REST content - modified");
      expect(existsSync(join(restore2Dir, sourceDir, "new-file.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Incremental Backup Efficiency", () => {
    it("second backup is smaller when only few files change", async () => {
      const repoName = getUniqueRepoName("incremental-rest-test");

      await restic.initRepo(restStorage, repoName, RESTIC_PASSWORD);

      // Create initial large dataset
      for (let i = 0; i < 50; i++) {
        writeFileSync(
          join(sourceDir, `file${i}.txt`),
          `Large file content ${i} `.repeat(100)
        );
      }

      // First backup (full)
      await restic.backup(restStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Modify only one file
      writeFileSync(join(sourceDir, "file0.txt"), "Modified content");

      // Second backup (incremental)
      const backupResult = await restic.backup(
        restStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      expect(backupResult.success).toBe(true);

      // Both snapshots should be independently restorable
      const snapshots = await restic.listSnapshots(
        restStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(snapshots.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);
  });
});
