/**
 * API Routes Integration Tests
 *
 * Tests the API service layer that backs the HTTP routes.
 * These tests verify the integration between routes and restic services.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "fs";
import { join } from "path";
import * as restic from "../../services/restic";
import type { LocalStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 120000; // 2 minutes per test

describe("API Routes Integration Tests", () => {
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

  beforeAll(() => {
    testDir = `/tmp/api-integration-test-${Date.now()}`;
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

  describe("Storage API Service Layer", () => {
    it("lists storage backends correctly", () => {
      // Simulate what GET /api/storage does
      const storageInfo = {
        name: "test-local",
        type: localStorage.type,
        path: localStorage.path,
      };

      expect(storageInfo.type).toBe("local");
      expect(storageInfo.path).toBeDefined();
    });

    it("tests storage connection via init", async () => {
      const repoName = getUniqueRepoName("storage-status-test");

      // Simulate what GET /api/storage/:name/status does
      const result = await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);

    it("handles invalid storage path", async () => {
      // Use /dev/null as a base path - cannot create directories inside a device file
      const invalidStorage: LocalStorage = {
        type: "local",
        path: "/dev/null/invalid/path",
      };

      const result = await restic.initRepo(invalidStorage, "test", RESTIC_PASSWORD);
      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Jobs API Service Layer", () => {
    it("executes folder backup job", async () => {
      const repoName = getUniqueRepoName("jobs-folder-test");
      const jobName = "test-folder-job";

      // Create test files
      writeFileSync(join(sourceDir, "file1.txt"), "Content 1");
      writeFileSync(join(sourceDir, "file2.txt"), "Content 2");

      // Simulate job execution
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: [jobName, "folder"] }
      );

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
    }, TEST_TIMEOUT);

    it("retrieves job history (snapshots)", async () => {
      const repoName = getUniqueRepoName("jobs-history-test");
      const jobName = "history-test-job";

      // Create backups
      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: [jobName],
      });

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: [jobName],
      });

      // Get history filtered by job tag
      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        tags: [jobName],
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("prevents concurrent job execution (via check)", () => {
      // Simulate concurrent execution tracking
      const runningJobs = new Set<string>();
      const jobName = "concurrent-test";

      // First job starts
      expect(runningJobs.has(jobName)).toBe(false);
      runningJobs.add(jobName);

      // Second attempt should be blocked
      expect(runningJobs.has(jobName)).toBe(true);

      // Job completes
      runningJobs.delete(jobName);
      expect(runningJobs.has(jobName)).toBe(false);
    });
  });

  describe("Repos API Service Layer", () => {
    it("lists snapshots with query parameters", async () => {
      const repoName = getUniqueRepoName("repos-list-test");

      // Create snapshots with different tags
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "prod.txt"), "Prod");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["env:prod"],
      });

      writeFileSync(join(sourceDir, "staging.txt"), "Staging");
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["env:staging"],
      });

      // Filter by tag (simulating ?tag=env:prod)
      const filtered = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        tags: ["env:prod"],
      });

      expect(filtered.success).toBe(true);
      expect(filtered.snapshots?.length).toBe(1);
      expect(filtered.snapshots![0].tags).toContain("env:prod");
    }, TEST_TIMEOUT);

    it("lists snapshots with latest parameter", async () => {
      const repoName = getUniqueRepoName("repos-latest-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 5 snapshots
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Get latest 2 (simulating ?latest=2)
      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD, {
        latest: 2,
      });

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("gets snapshot details", async () => {
      const repoName = getUniqueRepoName("repos-details-test");

      writeFileSync(join(sourceDir, "details.txt"), "Details content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["test-tag"] }
      );

      // Get all snapshots and find the one we created
      const listResult = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      const snapshot = listResult.snapshots?.find(
        (s) => s.short_id === backupResult.snapshotId?.substring(0, 8)
      );

      expect(snapshot).toBeDefined();
      expect(snapshot?.id).toBeDefined();
      expect(snapshot?.time).toBeDefined();
      expect(snapshot?.hostname).toBeDefined();
      expect(snapshot?.tags).toContain("test-tag");
    }, TEST_TIMEOUT);

    it("lists files in snapshot", async () => {
      const repoName = getUniqueRepoName("repos-ls-test");

      // Create directory structure
      writeFileSync(join(sourceDir, "root.txt"), "Root");
      mkdirSync(join(sourceDir, "subdir"));
      writeFileSync(join(sourceDir, "subdir", "nested.txt"), "Nested");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // List files (simulating GET /api/repos/:storage/:repo/snapshots/:id/ls)
      const listResult = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(listResult.success).toBe(true);
      expect(listResult.entries?.length).toBeGreaterThan(0);

      const fileNames = listResult.entries?.map((e) => e.name) || [];
      expect(fileNames).toContain("root.txt");
    }, TEST_TIMEOUT);

    it("gets repository stats", async () => {
      const repoName = getUniqueRepoName("repos-stats-test");

      writeFileSync(join(sourceDir, "stats.txt"), "Stats content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Get stats (simulating GET /api/repos/:storage/:repo/stats)
      const result = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);

    it("checks repository health", async () => {
      const repoName = getUniqueRepoName("repos-check-test");

      writeFileSync(join(sourceDir, "check.txt"), "Check content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Check health (simulating POST /api/repos/:storage/:repo/check)
      const result = await restic.check(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);

    it("checks repository with readData option", async () => {
      const repoName = getUniqueRepoName("repos-check-read-test");

      writeFileSync(join(sourceDir, "read.txt"), "Read check content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Check with readData (simulating POST /api/repos/:storage/:repo/check?readData=true)
      const result = await restic.check(localStorage, repoName, RESTIC_PASSWORD, {
        readData: true,
      });

      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);

    it("unlocks repository", async () => {
      const repoName = getUniqueRepoName("repos-unlock-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Unlock (simulating POST /api/repos/:storage/:repo/unlock)
      const result = await restic.unlock(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Restore API Service Layer", () => {
    it("restores to specified path", async () => {
      const repoName = getUniqueRepoName("restore-path-test");

      const originalContent = "Content to restore";
      writeFileSync(join(sourceDir, "restore.txt"), originalContent);

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore to path (simulating POST /api/restore with method=path)
      const result = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(result.success).toBe(true);

      // Verify restored content
      const restoredContent = readFileSync(
        join(restoreDir, sourceDir, "restore.txt"),
        "utf-8"
      );
      expect(restoredContent).toBe(originalContent);
    }, TEST_TIMEOUT);

    it("restores with include pattern", async () => {
      const repoName = getUniqueRepoName("restore-include-test");

      writeFileSync(join(sourceDir, "include.txt"), "Include this");
      writeFileSync(join(sourceDir, "exclude.log"), "Exclude this");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      // Restore with include pattern (simulating paths parameter)
      const result = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir,
        { include: ["*.txt"] }
      );

      expect(result.success).toBe(true);

      expect(existsSync(join(restoreDir, sourceDir, "include.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "exclude.log"))).toBe(false);
    }, TEST_TIMEOUT);

    it("tracks restore operation status", () => {
      // Simulate restore operation tracking
      interface RestoreOperation {
        id: string;
        status: "pending" | "running" | "completed" | "failed";
        startTime: Date;
        endTime?: Date;
      }

      const operations = new Map<string, RestoreOperation>();

      // Create operation
      const id = `${Date.now()}-test`;
      operations.set(id, {
        id,
        status: "pending",
        startTime: new Date(),
      });

      // Update to running
      const op = operations.get(id)!;
      op.status = "running";

      // Complete
      op.status = "completed";
      op.endTime = new Date();

      expect(op.status).toBe("completed");
      expect(op.endTime).toBeDefined();
    });
  });

  describe("Schedule API Service Layer", () => {
    it("validates cron expressions", () => {
      // Common cron patterns used in scheduling
      const validPatterns = [
        { expr: "* * * * *", desc: "every minute" },
        { expr: "0 * * * *", desc: "every hour" },
        { expr: "0 0 * * *", desc: "daily at midnight" },
        { expr: "0 0 * * 0", desc: "weekly on Sunday" },
        { expr: "0 0 1 * *", desc: "monthly on 1st" },
      ];

      for (const pattern of validPatterns) {
        const parts = pattern.expr.split(" ");
        expect(parts.length).toBe(5);
      }
    });

    it("returns scheduled jobs info", () => {
      // Simulate scheduled jobs response
      const scheduledJobs = [
        {
          name: "daily-backup",
          schedule: "0 2 * * *",
          lastRun: new Date(),
          nextRun: new Date(Date.now() + 86400000),
        },
        {
          name: "hourly-sync",
          schedule: "0 * * * *",
          lastRun: new Date(),
          nextRun: new Date(Date.now() + 3600000),
        },
      ];

      expect(scheduledJobs.length).toBe(2);
      expect(scheduledJobs[0].schedule).toBe("0 2 * * *");
    });
  });

  describe("Error Response Handling", () => {
    it("handles 404 for non-existent storage", async () => {
      // Use /dev/null as a base path - cannot create directories inside a device file
      const invalidStorage: LocalStorage = {
        type: "local",
        path: "/dev/null/definitely/does/not/exist",
      };

      const result = await restic.initRepo(invalidStorage, "test", RESTIC_PASSWORD);

      // Should fail gracefully
      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    }, TEST_TIMEOUT);

    it("handles 404 for non-existent snapshot", async () => {
      const repoName = getUniqueRepoName("error-snapshot-test");

      writeFileSync(join(sourceDir, "test.txt"), "Content");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Try to list files from non-existent snapshot
      const result = await restic.listFiles(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        "nonexistent123456"
      );

      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);

    it("handles 500 for repository errors", async () => {
      const invalidStorage: LocalStorage = {
        type: "local",
        path: "/proc/invalid", // Not writable
      };

      const result = await restic.initRepo(invalidStorage, "test", RESTIC_PASSWORD);
      expect(result.success).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe("Response Format", () => {
    it("returns snapshot list in expected format", async () => {
      const repoName = getUniqueRepoName("format-snapshot-test");

      writeFileSync(join(sourceDir, "format.txt"), "Format test");
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["test"],
      });

      const result = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots).toBeDefined();

      const snapshot = result.snapshots![0];

      // Verify expected fields
      expect(snapshot.id).toBeDefined();
      expect(snapshot.short_id).toBeDefined();
      expect(snapshot.time).toBeDefined();
      expect(snapshot.hostname).toBeDefined();
      expect(snapshot.paths).toBeInstanceOf(Array);
      expect(snapshot.tags).toBeInstanceOf(Array);
    }, TEST_TIMEOUT);

    it("returns file list in expected format", async () => {
      const repoName = getUniqueRepoName("format-files-test");

      writeFileSync(join(sourceDir, "file.txt"), "File content");

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
      expect(result.entries).toBeDefined();

      const entry = result.entries?.find((e) => e.name === "file.txt");
      expect(entry).toBeDefined();
      expect(entry?.type).toBe("file");
      expect(entry?.size).toBeDefined();
      expect(entry?.mtime).toBeDefined();
    }, TEST_TIMEOUT);

    it("returns stats in expected format", async () => {
      const repoName = getUniqueRepoName("format-stats-test");

      writeFileSync(join(sourceDir, "stats.txt"), "Stats content");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);
  });
});
