/**
 * SFTP Storage Backend Integration Tests
 *
 * Tests restic operations against a real SFTP server (atmoz/sftp).
 * Requires Docker Compose services to be running:
 *   docker compose -f tests/compose/services.yml --profile sftp up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as restic from "../restic";
import type { SftpStorage } from "@uni-backups/shared/config";

const execAsync = promisify(exec);

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 120000; // 2 minutes per test

// Detect Docker environment
const isDocker = process.env.SFTP_HOST === "sftp" || process.env.REDIS_HOST === "redis";
const SFTP_HOST = process.env.SFTP_HOST || (isDocker ? "sftp" : "localhost");
const SFTP_PORT = parseInt(process.env.SFTP_PORT || "2222", 10);

// SFTP server configuration (matches docker-compose)
// Using linuxserver/openssh-server, data directory is /config/data (in user's home)
const sftpStorage: SftpStorage = {
  type: "sftp",
  host: SFTP_HOST,
  port: SFTP_PORT,
  user: "testuser",
  password: "testpass123",
  path: "/config/data",
};

describe("SFTP Storage Backend Integration Tests", () => {
  let testDir: string;
  let sourceDir: string;
  let restoreDir: string;
  let testRepoCounter = 0;
  let serviceAvailable = false;

  // Generate unique repo name for each test to avoid conflicts
  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  // Helper to check if SFTP is accessible
  const checkSftpConnection = async (): Promise<boolean> => {
    try {
      await execAsync(`nc -z ${SFTP_HOST} ${SFTP_PORT}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(async () => {
    // Verify SFTP server is accessible
    serviceAvailable = await checkSftpConnection();
    if (!serviceAvailable) {
      console.log(
        "SFTP server is not running. Skipping SFTP tests. Start with: docker compose -f tests/compose/services.yml --profile sftp up -d"
      );
      return;
    }

    // Create local test directories for source/restore data
    testDir = `/tmp/sftp-integration-test-${Date.now()}`;
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });
  }, TEST_TIMEOUT);

  afterAll(() => {
    // Clean up local test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach((ctx) => {
    // Skip all tests if service is not available
    if (!serviceAvailable) {
      ctx.skip();
      return;
    }
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
    it("generates correct SFTP URL format with password", () => {
      const url = restic.buildRepoUrl(sftpStorage, "test-repo");
      expect(url).toContain("sftp:");
      expect(url).toContain("testuser");
      expect(url).toContain(SFTP_HOST);
      expect(url).toContain("test-repo");
    });

    it("handles custom port correctly", () => {
      const storageWithPort: SftpStorage = {
        ...sftpStorage,
        host: "customhost",
        port: 22022,
      };
      const url = restic.buildRepoUrl(storageWithPort, "my-repo");
      // Port is handled via ssh options, not in URL
      expect(url).toContain("customhost");
      expect(url).toContain("my-repo");
      // Verify port is in the env's SSH command
      const env = restic.buildResticEnv(storageWithPort, RESTIC_PASSWORD);
      expect(env.__SFTP_COMMAND).toContain("-p 22022");
    });

    it("handles path prefix correctly", () => {
      const storageWithPath: SftpStorage = {
        ...sftpStorage,
        path: "/data/backups",
      };
      const url = restic.buildRepoUrl(storageWithPath, "backup-repo");
      expect(url).toContain("/data/backups");
      expect(url).toContain("backup-repo");
    });
  });

  describe("buildResticEnv", () => {
    it("sets RESTIC_PASSWORD correctly", () => {
      const env = restic.buildResticEnv(sftpStorage, RESTIC_PASSWORD);

      expect(env.RESTIC_PASSWORD).toBe(RESTIC_PASSWORD);
    });

    it("does not set AWS credentials for SFTP storage", () => {
      const env = restic.buildResticEnv(sftpStorage, RESTIC_PASSWORD);

      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    });
  });

  describe("initRepo", () => {
    it("creates a new repository on SFTP server", async () => {
      const repoName = getUniqueRepoName("init-sftp-test");

      const result = await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized|already exists/i);
    }, TEST_TIMEOUT);

    it("returns alreadyExists for existing repository", async () => {
      const repoName = getUniqueRepoName("existing-sftp-test");

      // First init
      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Second init should return alreadyExists
      const result = await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("backup", () => {
    it("uploads files to SFTP server and returns snapshot ID", async () => {
      const repoName = getUniqueRepoName("backup-sftp-test");

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Hello World from SFTP test");
      writeFileSync(join(sourceDir, "file2.txt"), "Another SFTP test file");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "nested.txt"), "Nested SFTP file content");

      // Init and backup
      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId!.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("applies tags to backup snapshot", async () => {
      const repoName = getUniqueRepoName("tags-sftp-test");

      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged SFTP backup test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["sftp-backup", "hetzner", "storage-box"] }
      );

      expect(backupResult.success).toBe(true);

      // Verify tags are stored
      const listResult = await restic.listSnapshots(sftpStorage, repoName, RESTIC_PASSWORD);
      expect(listResult.success).toBe(true);
      expect(listResult.snapshots![0].tags).toContain("sftp-backup");
      expect(listResult.snapshots![0].tags).toContain("hetzner");
      expect(listResult.snapshots![0].tags).toContain("storage-box");
    }, TEST_TIMEOUT);

    it("respects exclude patterns", async () => {
      const repoName = getUniqueRepoName("exclude-sftp-test");

      // Create files including ones to exclude
      writeFileSync(join(sourceDir, "keep.txt"), "Keep this file");
      writeFileSync(join(sourceDir, "skip.tmp"), "Skip this temp file");
      writeFileSync(join(sourceDir, "skip.bak"), "Skip this backup file");
      mkdirSync(join(sourceDir, ".git"));
      writeFileSync(join(sourceDir, ".git", "config"), "Git config");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { exclude: ["*.tmp", "*.bak", ".git/**"] }
      );

      expect(backupResult.success).toBe(true);

      // List files in snapshot to verify exclusions
      const listResult = await restic.listFiles(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(listResult.success).toBe(true);
      const fileNames = listResult.entries?.map((e) => e.name) || [];
      expect(fileNames).toContain("keep.txt");
      expect(fileNames).not.toContain("skip.tmp");
      expect(fileNames).not.toContain("skip.bak");
    }, TEST_TIMEOUT);
  });

  describe("listSnapshots", () => {
    it("returns all snapshots in repository", async () => {
      const repoName = getUniqueRepoName("list-all-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create multiple snapshots
      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v3.txt"), "Version 3");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(3);
    }, TEST_TIMEOUT);

    it("filters snapshots by tag", async () => {
      const repoName = getUniqueRepoName("filter-tag-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "a.txt"), "File A");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["server-web"],
      });

      writeFileSync(join(sourceDir, "b.txt"), "File B");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["server-db"],
      });

      writeFileSync(join(sourceDir, "c.txt"), "File C");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["server-web"],
      });

      // Filter by server-web tag
      const result = await restic.listSnapshots(sftpStorage, repoName, RESTIC_PASSWORD, {
        tags: ["server-web"],
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
      result.snapshots?.forEach((s) => {
        expect(s.tags).toContain("server-web");
      });
    }, TEST_TIMEOUT);

    it("returns latest N snapshots", async () => {
      const repoName = getUniqueRepoName("latest-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create 4 snapshots
      for (let i = 1; i <= 4; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const result = await restic.listSnapshots(sftpStorage, repoName, RESTIC_PASSWORD, {
        latest: 2,
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("includes snapshot metadata (id, time, hostname, paths)", async () => {
      const repoName = getUniqueRepoName("metadata-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "meta.txt"), "Metadata test");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["sftp-metadata"],
      });

      const result = await restic.listSnapshots(sftpStorage, repoName, RESTIC_PASSWORD);

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
      const repoName = getUniqueRepoName("ls-sftp-test");

      // Create directory structure
      writeFileSync(join(sourceDir, "root.txt"), "Root file");
      mkdirSync(join(sourceDir, "level1"));
      writeFileSync(join(sourceDir, "level1", "nested.txt"), "Nested file");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        sftpStorage,
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
      const repoName = getUniqueRepoName("file-meta-sftp-test");

      const content = "Test file with known content length for SFTP storage";
      writeFileSync(join(sourceDir, "sized.txt"), content);

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        sftpStorage,
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
    it("restores files from SFTP server to local directory", async () => {
      const repoName = getUniqueRepoName("restore-sftp-test");

      // Create unique content
      const uniqueContent = `SFTP restore test ${Date.now()}`;
      writeFileSync(join(sourceDir, "restore-me.txt"), uniqueContent);
      mkdirSync(join(sourceDir, "folder"));
      writeFileSync(join(sourceDir, "folder", "nested.txt"), "Nested SFTP content");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore to new directory
      const result = await restic.restore(
        sftpStorage,
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
      const repoName = getUniqueRepoName("include-restore-sftp-test");

      writeFileSync(join(sourceDir, "include-me.txt"), "Include this");
      writeFileSync(join(sourceDir, "exclude-me.log"), "Exclude this");
      writeFileSync(join(sourceDir, "also-include.txt"), "Also include");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        sftpStorage,
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
      const repoName = getUniqueRepoName("prune-last-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Verify 5 snapshots exist
      const beforePrune = await restic.listSnapshots(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(beforePrune.snapshots?.length).toBe(5);

      // Prune to keep only last 2
      const pruneResult = await restic.prune(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 2 }
      );
      expect(pruneResult.success).toBe(true);

      // Verify only 2 remain
      const afterPrune = await restic.listSnapshots(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("applies daily retention policy", async () => {
      const repoName = getUniqueRepoName("prune-daily-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create 3 snapshots (all same day)
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(sourceDir, `daily${i}.txt`), `Daily ${i}`);
        await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Prune with daily:1 (since all same day, should keep 1)
      const pruneResult = await restic.prune(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        { daily: 1 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(1);
    }, TEST_TIMEOUT);

    it("prunes with tag filter", async () => {
      const repoName = getUniqueRepoName("prune-tag-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create snapshots with different tags
      writeFileSync(join(sourceDir, "a1.txt"), "A1");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["customer-acme"],
      });

      writeFileSync(join(sourceDir, "a2.txt"), "A2");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["customer-acme"],
      });

      writeFileSync(join(sourceDir, "b1.txt"), "B1");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["customer-widgets"],
      });

      // Prune only customer-acme (keep last 1)
      const pruneResult = await restic.prune(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 1 },
        { tags: ["customer-acme"] }
      );
      expect(pruneResult.success).toBe(true);

      // customer-widgets should still have its snapshot, customer-acme should have 1
      const afterPrune = await restic.listSnapshots(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD
      );
      expect(afterPrune.snapshots?.length).toBe(2);

      const acmeSnapshots = afterPrune.snapshots?.filter((s) =>
        s.tags?.includes("customer-acme")
      );
      expect(acmeSnapshots?.length).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("check", () => {
    it("verifies SFTP repository integrity", async () => {
      const repoName = getUniqueRepoName("check-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "check.txt"), "Check SFTP test data");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);

    it("performs thorough check with readData option", async () => {
      const repoName = getUniqueRepoName("check-read-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "thorough.txt"), "Thorough SFTP check data");
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(sftpStorage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("stats", () => {
    it("returns SFTP repository statistics", async () => {
      const repoName = getUniqueRepoName("stats-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Create some data
      writeFileSync(join(sourceDir, "stats1.txt"), "Stats SFTP test data 1");
      writeFileSync(
        join(sourceDir, "stats2.txt"),
        "Stats SFTP test data 2 with more content here"
      );
      await restic.backup(sftpStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("unlock", () => {
    it("removes stale locks from SFTP repository", async () => {
      const repoName = getUniqueRepoName("unlock-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Unlock should succeed even with no locks
      const result = await restic.unlock(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("preserves data integrity through backup and restore", async () => {
      const repoName = getUniqueRepoName("full-cycle-sftp-test");

      // Create files with known content
      const files: Record<string, string | Buffer> = {
        "text.txt": "Hello World from SFTP Storage Box!\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
        "large.txt": "y".repeat(10000),
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600}",
      };

      mkdirSync(join(sourceDir, "nested", "deep"), { recursive: true });
      files["nested/deep/file.txt"] = "Deeply nested SFTP content";

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

      // Backup to SFTP
      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["sftp-full-cycle", "integrity-test"] }
      );
      expect(backupResult.success).toBe(true);

      // Restore from SFTP
      const restoreResult = await restic.restore(
        sftpStorage,
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
      const repoName = getUniqueRepoName("versions-sftp-test");

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      // Version 1
      writeFileSync(join(sourceDir, "version.txt"), "Version 1 SFTP content");
      const backup1 = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v1"] }
      );

      // Version 2
      writeFileSync(join(sourceDir, "version.txt"), "Version 2 SFTP content - modified");
      writeFileSync(join(sourceDir, "new-file.txt"), "New file in v2");
      const backup2 = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["v2"] }
      );

      // Restore version 1
      const restore1Dir = join(restoreDir, "v1");
      await restic.restore(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        backup1.snapshotId!,
        restore1Dir
      );

      // Restore version 2
      const restore2Dir = join(restoreDir, "v2");
      await restic.restore(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        backup2.snapshotId!,
        restore2Dir
      );

      // Verify v1 has original content
      expect(
        readFileSync(join(restore1Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 1 SFTP content");
      expect(existsSync(join(restore1Dir, sourceDir, "new-file.txt"))).toBe(false);

      // Verify v2 has modified content
      expect(
        readFileSync(join(restore2Dir, sourceDir, "version.txt"), "utf-8")
      ).toBe("Version 2 SFTP content - modified");
      expect(existsSync(join(restore2Dir, sourceDir, "new-file.txt"))).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("SFTP-Specific Behaviors", () => {
    it("handles SSH connection correctly with custom port", async () => {
      const repoName = getUniqueRepoName("ssh-port-test");

      // The storage already uses port 2222, verify it works
      const result = await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);

    it("can backup and restore large files efficiently", async () => {
      const repoName = getUniqueRepoName("large-file-sftp-test");

      // Create a large file (1MB)
      const largeContent = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }
      writeFileSync(join(sourceDir, "large.bin"), largeContent);

      await restic.initRepo(sftpStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      expect(backupResult.success).toBe(true);

      // Restore and verify
      const restoreResult = await restic.restore(
        sftpStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(restoreResult.success).toBe(true);

      const restoredContent = readFileSync(join(restoreDir, sourceDir, "large.bin"));
      expect(restoredContent.equals(largeContent)).toBe(true);
    }, TEST_TIMEOUT);
  });
});
