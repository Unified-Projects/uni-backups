
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import * as restic from "../restic";
import type { RCloneStorage } from "@uni-backups/shared/config";

const RESTIC_PASSWORD = "integration-test-rclone-password";
const TEST_TIMEOUT = 120000; // 2 minutes per test
const REMOTE_NAME = "rclonetest";

function isRcloneAvailable(): boolean {
  try {
    execSync("rclone version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("RClone Storage Backend Integration Tests", () => {
  let testDir: string;
  let rcloneRoot: string;
  let sourceDir: string;
  let restoreDir: string;
  let rcloneStorage: RCloneStorage;
  let testRepoCounter = 0;

  const getUniqueRepoName = (base: string) => {
    testRepoCounter++;
    return `${base}-${Date.now()}-${testRepoCounter}`;
  };

  beforeAll(() => {
    if (!isRcloneAvailable()) {
      throw new Error(
        "rclone is not installed or not in PATH. Install rclone to run this test suite."
      );
    }

    testDir = `/tmp/rclone-integration-test-${Date.now()}`;
    rcloneRoot = join(testDir, "rclone-root");
    sourceDir = join(testDir, "source");
    restoreDir = join(testDir, "restore");

    mkdirSync(rcloneRoot, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(restoreDir, { recursive: true });

    rcloneStorage = {
      type: "rclone",
      remote: REMOTE_NAME,
      path: "",
      config: {
        type: "local",
        root: rcloneRoot,
      },
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

  describe("buildRepoUrl", () => {
    it("generates correct rclone URL format without path", () => {
      const storage: RCloneStorage = {
        type: "rclone",
        remote: "myremote",
        path: "",
      };
      const url = restic.buildRepoUrl(storage, "test-repo");
      expect(url).toBe("rclone:myremote:test-repo");
    });

    it("generates correct rclone URL format with path", () => {
      const storage: RCloneStorage = {
        type: "rclone",
        remote: "myremote",
        path: "backups",
      };
      const url = restic.buildRepoUrl(storage, "test-repo");
      expect(url).toBe("rclone:myremote:backups/test-repo");
    });

    it("strips trailing slash from path", () => {
      const storage: RCloneStorage = {
        type: "rclone",
        remote: "myremote",
        path: "backups/",
      };
      const url = restic.buildRepoUrl(storage, "test-repo");
      expect(url).toBe("rclone:myremote:backups/test-repo");
    });
  });

  describe("buildResticEnv", () => {
    it("sets RCLONE_CONFIG when config_file is provided", () => {
      const storage: RCloneStorage = {
        type: "rclone",
        remote: "gdrive",
        path: "",
        config_file: "/path/to/rclone.conf",
      };
      const env = restic.buildResticEnv(storage, RESTIC_PASSWORD);
      expect(env.RCLONE_CONFIG).toBe("/path/to/rclone.conf");
      expect(env.RESTIC_PASSWORD).toBe(RESTIC_PASSWORD);
    });

    it("sets RCLONE_CONFIG_<REMOTE>_<KEY> env vars for inline config", () => {
      const env = restic.buildResticEnv(rcloneStorage, RESTIC_PASSWORD);
      expect(env[`RCLONE_CONFIG_${REMOTE_NAME.toUpperCase()}_TYPE`]).toBe("local");
      expect(env[`RCLONE_CONFIG_${REMOTE_NAME.toUpperCase()}_ROOT`]).toBe(rcloneRoot);
      expect(env.RCLONE_CONFIG).toBeUndefined();
    });

    it("does not set rclone env vars when no config is provided", () => {
      const storage: RCloneStorage = {
        type: "rclone",
        remote: "myremote",
        path: "",
      };
      const env = restic.buildResticEnv(storage, RESTIC_PASSWORD);
      expect(env.RCLONE_CONFIG).toBeUndefined();
      const rcloneConfigKeys = Object.keys(env).filter((k) =>
        k.startsWith("RCLONE_CONFIG_")
      );
      expect(rcloneConfigKeys).toHaveLength(0);
    });
  });

  describe("initRepo", () => {
    it("creates a new repository via rclone", async () => {
      const repoName = getUniqueRepoName("init-rclone-test");
      const result = await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized|already exists/i);
    }, TEST_TIMEOUT);

    it("returns alreadyExists for existing repository", async () => {
      const repoName = getUniqueRepoName("existing-rclone-test");
      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("backup", () => {
    it("backs up files via rclone and returns snapshot ID", async () => {
      const repoName = getUniqueRepoName("backup-rclone-test");

      writeFileSync(join(sourceDir, "file1.txt"), "Hello rclone backup");
      writeFileSync(join(sourceDir, "file2.txt"), "Another rclone file");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const result = await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotId!.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("applies tags to the snapshot", async () => {
      const repoName = getUniqueRepoName("tags-rclone-test");

      writeFileSync(join(sourceDir, "tagged.txt"), "Tagged rclone test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir, {
        tags: ["rclone-test", "daily"],
      });

      const listResult = await restic.listSnapshots(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(listResult.success).toBe(true);
      expect(listResult.snapshots![0].tags).toContain("rclone-test");
      expect(listResult.snapshots![0].tags).toContain("daily");
    }, TEST_TIMEOUT);

    it("respects exclude patterns", async () => {
      const repoName = getUniqueRepoName("exclude-rclone-test");

      writeFileSync(join(sourceDir, "keep.txt"), "Keep this file");
      writeFileSync(join(sourceDir, "skip.log"), "Skip this log file");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { exclude: ["*.log"] }
      );

      expect(backupResult.success).toBe(true);

      const listResult = await restic.listFiles(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(listResult.success).toBe(true);
      const fileNames = listResult.entries?.map((e) => e.name) || [];
      expect(fileNames).toContain("keep.txt");
      expect(fileNames).not.toContain("skip.log");
    }, TEST_TIMEOUT);
  });

  describe("listSnapshots", () => {
    it("returns all snapshots in repository", async () => {
      const repoName = getUniqueRepoName("list-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);

      writeFileSync(join(sourceDir, "v1.txt"), "Version 1");
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      writeFileSync(join(sourceDir, "v2.txt"), "Version 2");
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(rcloneStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("includes snapshot metadata", async () => {
      const repoName = getUniqueRepoName("meta-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      writeFileSync(join(sourceDir, "meta.txt"), "Metadata test");
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.listSnapshots(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(result.success).toBe(true);

      const snapshot = result.snapshots![0];
      expect(snapshot.id).toBeDefined();
      expect(snapshot.short_id).toBeDefined();
      expect(snapshot.time).toBeDefined();
      expect(snapshot.hostname).toBeDefined();
      expect(snapshot.paths).toBeInstanceOf(Array);
    }, TEST_TIMEOUT);
  });

  describe("listFiles", () => {
    it("returns file listing from snapshot", async () => {
      const repoName = getUniqueRepoName("ls-rclone-test");

      writeFileSync(join(sourceDir, "root.txt"), "Root file");
      mkdirSync(join(sourceDir, "level1"));
      writeFileSync(join(sourceDir, "level1", "nested.txt"), "Nested file");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.listFiles(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!
      );

      expect(result.success).toBe(true);
      expect(result.entries?.length).toBeGreaterThan(0);

      const fileNames = result.entries?.map((e) => e.name);
      expect(fileNames).toContain("root.txt");
    }, TEST_TIMEOUT);
  });

  describe("restore", () => {
    it("restores files from rclone backend to local directory", async () => {
      const repoName = getUniqueRepoName("restore-rclone-test");

      const uniqueContent = `rclone restore test ${Date.now()}`;
      writeFileSync(join(sourceDir, "restore-me.txt"), uniqueContent);

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );

      const result = await restic.restore(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      expect(result.success).toBe(true);

      const restoredPath = join(restoreDir, sourceDir, "restore-me.txt");
      expect(existsSync(restoredPath)).toBe(true);
      expect(readFileSync(restoredPath, "utf-8")).toBe(uniqueContent);
    }, TEST_TIMEOUT);
  });

  describe("prune", () => {
    it("removes old snapshots based on keep-last policy", async () => {
      const repoName = getUniqueRepoName("prune-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);

      for (let i = 1; i <= 4; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      const beforePrune = await restic.listSnapshots(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(beforePrune.snapshots?.length).toBe(4);

      const pruneResult = await restic.prune(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        { last: 2 }
      );
      expect(pruneResult.success).toBe(true);

      const afterPrune = await restic.listSnapshots(rcloneStorage, repoName, RESTIC_PASSWORD);
      expect(afterPrune.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe("check", () => {
    it("verifies rclone repository integrity", async () => {
      const repoName = getUniqueRepoName("check-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      writeFileSync(join(sourceDir, "check.txt"), "Check test data");
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.check(rcloneStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("check passed");
    }, TEST_TIMEOUT);
  });

  describe("stats", () => {
    it("returns rclone repository statistics", async () => {
      const repoName = getUniqueRepoName("stats-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      writeFileSync(join(sourceDir, "stats.txt"), "Stats test data with some content");
      await restic.backup(rcloneStorage, repoName, RESTIC_PASSWORD, sourceDir);

      const result = await restic.stats(rcloneStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.stats?.total_size).toBeGreaterThan(0);
      expect(result.stats?.total_file_count).toBeGreaterThan(0);
      expect(result.stats?.snapshots_count).toBe(1);
    }, TEST_TIMEOUT);
  });

  describe("unlock", () => {
    it("removes stale locks from rclone repository", async () => {
      const repoName = getUniqueRepoName("unlock-rclone-test");

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);

      const result = await restic.unlock(rcloneStorage, repoName, RESTIC_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.message).toContain("unlocked");
    }, TEST_TIMEOUT);
  });

  describe("Full Backup/Restore Cycle", () => {
    it("preserves data integrity through backup and restore via rclone", async () => {
      const repoName = getUniqueRepoName("full-cycle-rclone-test");

      const files: Record<string, string | Buffer> = {
        "text.txt": "Hello World via rclone!\n",
        "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
        "large.txt": "x".repeat(10000),
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600}",
      };

      mkdirSync(join(sourceDir, "nested", "deep"), { recursive: true });
      files["nested/deep/file.txt"] = "Deeply nested rclone content";

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

      await restic.initRepo(rcloneStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["rclone-full-cycle"] }
      );
      expect(backupResult.success).toBe(true);

      const restoreResult = await restic.restore(
        rcloneStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );
      expect(restoreResult.success).toBe(true);

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
  });
});
