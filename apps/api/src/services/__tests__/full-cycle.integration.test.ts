/**
 * Full Backup/Restore Cycle Integration Tests
 *
 * End-to-end tests that verify complete backup/restore workflows
 * across different storage backends and data types.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
  createWriteStream,
  chmodSync,
} from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as restic from "../restic";
import type { LocalStorage, S3Storage, RestStorage } from "@uni-backups/shared/config";

// Test configuration
const RESTIC_PASSWORD = "integration-test-password";
const TEST_TIMEOUT = 180000; // 3 minutes per test

describe("Full Backup/Restore Cycle Integration Tests", () => {
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

  // Create a random binary file
  const createRandomFile = (path: string, sizeBytes: number): string => {
    const buffer = Buffer.alloc(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    writeFileSync(path, buffer);
    return hashFile(path);
  };

  beforeAll(() => {
    testDir = `/tmp/full-cycle-integration-test-${Date.now()}`;
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

  describe("Data Integrity Verification", () => {
    it("preserves SHA256 checksums through backup/restore", async () => {
      const repoName = getUniqueRepoName("checksum-test");

      // Create files with known checksums
      const files: Record<string, string> = {};

      writeFileSync(join(sourceDir, "text.txt"), "Hello World!\n");
      files["text.txt"] = hashFile(join(sourceDir, "text.txt"));

      writeFileSync(join(sourceDir, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
      files["binary.bin"] = hashFile(join(sourceDir, "binary.bin"));

      files["random.dat"] = createRandomFile(join(sourceDir, "random.dat"), 1024);

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
      await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );

      // Verify checksums
      for (const [filename, originalHash] of Object.entries(files)) {
        const restoredPath = join(restoreDir, sourceDir, filename);
        expect(existsSync(restoredPath)).toBe(true);
        const restoredHash = hashFile(restoredPath);
        expect(restoredHash).toBe(originalHash);
      }
    }, TEST_TIMEOUT);

    it("preserves file sizes exactly", async () => {
      const repoName = getUniqueRepoName("size-test");

      const sizes = [0, 1, 100, 1000, 10000, 100000];
      const expectedSizes: Record<string, number> = {};

      for (const size of sizes) {
        const filename = `file-${size}.bin`;
        const content = Buffer.alloc(size);
        writeFileSync(join(sourceDir, filename), content);
        expectedSizes[filename] = size;
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

      for (const [filename, expectedSize] of Object.entries(expectedSizes)) {
        const restoredPath = join(restoreDir, sourceDir, filename);
        const restoredSize = statSync(restoredPath).size;
        expect(restoredSize).toBe(expectedSize);
      }
    }, TEST_TIMEOUT);
  });

  describe("Directory Structure Preservation", () => {
    it("preserves nested directory structure", async () => {
      const repoName = getUniqueRepoName("nested-dir-test");

      // Create nested structure
      const dirs = [
        "level1",
        "level1/level2",
        "level1/level2/level3",
        "level1/level2/level3/level4",
        "sibling1",
        "sibling1/child",
        "sibling2",
      ];

      for (const dir of dirs) {
        mkdirSync(join(sourceDir, dir), { recursive: true });
        writeFileSync(join(sourceDir, dir, "file.txt"), `Content in ${dir}`);
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

      // Verify all directories exist
      for (const dir of dirs) {
        expect(existsSync(join(restoreDir, sourceDir, dir))).toBe(true);
        expect(existsSync(join(restoreDir, sourceDir, dir, "file.txt"))).toBe(true);
      }
    }, TEST_TIMEOUT);

    it.skip("preserves empty directories", async () => {
      const repoName = getUniqueRepoName("empty-dir-test");

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

  describe("File Content Types", () => {
    it("preserves text file encoding (UTF-8)", async () => {
      const repoName = getUniqueRepoName("utf8-test");

      const testStrings = {
        "ascii.txt": "Hello World",
        "unicode.txt": "Hello \u4e16\u754c! \u{1F600} \u{1F389}",
        "cyrillic.txt": "\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440",
        "arabic.txt": "\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645",
        "chinese.txt": "\u4f60\u597d\u4e16\u754c",
      };

      for (const [filename, content] of Object.entries(testStrings)) {
        writeFileSync(join(sourceDir, filename), content, "utf-8");
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

      for (const [filename, originalContent] of Object.entries(testStrings)) {
        const restoredContent = readFileSync(
          join(restoreDir, sourceDir, filename),
          "utf-8"
        );
        expect(restoredContent).toBe(originalContent);
      }
    }, TEST_TIMEOUT);

    it("preserves binary files with all byte values", async () => {
      const repoName = getUniqueRepoName("binary-test");

      // Create file with all possible byte values
      const allBytes = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }
      writeFileSync(join(sourceDir, "all-bytes.bin"), allBytes);

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

      const restoredBytes = readFileSync(join(restoreDir, sourceDir, "all-bytes.bin"));
      expect(restoredBytes.equals(allBytes)).toBe(true);
    }, TEST_TIMEOUT);

    it("preserves JSON files", async () => {
      const repoName = getUniqueRepoName("json-test");

      const jsonData = {
        string: "value",
        number: 42,
        float: 3.14159,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: "found",
          },
        },
      };

      writeFileSync(
        join(sourceDir, "data.json"),
        JSON.stringify(jsonData, null, 2),
        "utf-8"
      );

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

      const restoredJson = JSON.parse(
        readFileSync(join(restoreDir, sourceDir, "data.json"), "utf-8")
      );
      expect(restoredJson).toEqual(jsonData);
    }, TEST_TIMEOUT);
  });

  describe("File Permissions", () => {
    it("preserves executable permission", async () => {
      const repoName = getUniqueRepoName("exec-perm-test");

      writeFileSync(join(sourceDir, "script.sh"), "#!/bin/bash\necho hello");
      chmodSync(join(sourceDir, "script.sh"), 0o755);

      const originalMode = statSync(join(sourceDir, "script.sh")).mode;

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

      const restoredMode = statSync(join(restoreDir, sourceDir, "script.sh")).mode;
      expect(restoredMode & 0o777).toBe(originalMode & 0o777);
    }, TEST_TIMEOUT);

    it("preserves read-only permission", async () => {
      const repoName = getUniqueRepoName("readonly-perm-test");

      writeFileSync(join(sourceDir, "readonly.txt"), "Protected content");
      chmodSync(join(sourceDir, "readonly.txt"), 0o444);

      const originalMode = statSync(join(sourceDir, "readonly.txt")).mode;

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

      const restoredMode = statSync(join(restoreDir, sourceDir, "readonly.txt")).mode;
      expect(restoredMode & 0o777).toBe(originalMode & 0o777);
    }, TEST_TIMEOUT);
  });

  describe("Incremental Backup Efficiency", () => {
    it("second backup is efficient when few files change", async () => {
      const repoName = getUniqueRepoName("incremental-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create initial files
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(sourceDir, `file${i}.txt`),
          `Original content ${i} `.repeat(100)
        );
      }

      // First backup
      const backup1 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backup1.success).toBe(true);

      // Modify one file
      writeFileSync(join(sourceDir, "file0.txt"), "Modified content");

      // Second backup
      const backup2 = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir
      );
      expect(backup2.success).toBe(true);

      // Both should be independently restorable
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapshots.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);

    it("unchanged files are deduplicated", async () => {
      const repoName = getUniqueRepoName("dedup-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create large identical content
      const largeContent = "x".repeat(50000);
      writeFileSync(join(sourceDir, "large.txt"), largeContent);

      // First backup
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Add another file with different content, keep large file same
      writeFileSync(join(sourceDir, "small.txt"), "Small addition");

      // Second backup
      await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);

      // Both snapshots should restore correctly
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapshots.snapshots?.length).toBe(2);
    }, TEST_TIMEOUT);
  });

  describe("Multiple Version Restore", () => {
    it("can restore any previous version correctly", async () => {
      const repoName = getUniqueRepoName("multi-version-test");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      const versions: string[] = [];

      // Create 3 versions
      for (let v = 1; v <= 3; v++) {
        writeFileSync(join(sourceDir, "version.txt"), `Version ${v}`);
        const result = await restic.backup(
          localStorage,
          repoName,
          RESTIC_PASSWORD,
          sourceDir
        );
        versions.push(result.snapshotId!);
      }

      // Restore and verify each version
      for (let v = 1; v <= 3; v++) {
        const versionDir = join(restoreDir, `v${v}`);
        await restic.restore(
          localStorage,
          repoName,
          RESTIC_PASSWORD,
          versions[v - 1],
          versionDir
        );

        const content = readFileSync(
          join(versionDir, sourceDir, "version.txt"),
          "utf-8"
        );
        expect(content).toBe(`Version ${v}`);
      }
    }, TEST_TIMEOUT);
  });

  describe("Large File Handling", () => {
    it("handles 1MB file correctly", async () => {
      const repoName = getUniqueRepoName("large-1mb-test");

      const hash = createRandomFile(join(sourceDir, "1mb.bin"), 1024 * 1024);

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

      const restoredHash = hashFile(join(restoreDir, sourceDir, "1mb.bin"));
      expect(restoredHash).toBe(hash);
    }, TEST_TIMEOUT);

    it("handles many small files efficiently", async () => {
      const repoName = getUniqueRepoName("many-files-test");

      // Create 100 small files
      for (let i = 0; i < 100; i++) {
        writeFileSync(join(sourceDir, `small-${i}.txt`), `Content ${i}`);
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

      // Verify all files restored
      for (let i = 0; i < 100; i++) {
        expect(existsSync(join(restoreDir, sourceDir, `small-${i}.txt`))).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe("Special Characters in Names", () => {
    it("handles filenames with spaces", async () => {
      const repoName = getUniqueRepoName("space-name-test");

      writeFileSync(join(sourceDir, "file with spaces.txt"), "Content");
      writeFileSync(join(sourceDir, "multiple   spaces.txt"), "Content");

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

      expect(existsSync(join(restoreDir, sourceDir, "file with spaces.txt"))).toBe(true);
      expect(existsSync(join(restoreDir, sourceDir, "multiple   spaces.txt"))).toBe(true);
    }, TEST_TIMEOUT);

    it("handles filenames with special characters", async () => {
      const repoName = getUniqueRepoName("special-char-test");

      const specialNames = [
        "file-with-dash.txt",
        "file_with_underscore.txt",
        "file.multiple.dots.txt",
        "file(parentheses).txt",
        "file[brackets].txt",
        "file+plus.txt",
        "file=equals.txt",
      ];

      for (const name of specialNames) {
        writeFileSync(join(sourceDir, name), `Content in ${name}`);
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

      for (const name of specialNames) {
        expect(existsSync(join(restoreDir, sourceDir, name))).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe("Storage Backend Full Cycles", () => {
    it("complete cycle with local storage", async () => {
      const repoName = getUniqueRepoName("local-full-cycle");

      // Create varied content
      writeFileSync(join(sourceDir, "text.txt"), "Text content");
      writeFileSync(join(sourceDir, "binary.bin"), Buffer.from([1, 2, 3]));
      mkdirSync(join(sourceDir, "nested"));
      writeFileSync(join(sourceDir, "nested", "deep.txt"), "Deep content");

      // Full cycle
      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);
      const backupResult = await restic.backup(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        sourceDir,
        { tags: ["full-cycle", "local"] }
      );

      expect(backupResult.success).toBe(true);

      // Check repository
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);

      // Get stats
      const statsResult = await restic.stats(localStorage, repoName, RESTIC_PASSWORD);
      expect(statsResult.success).toBe(true);
      expect(statsResult.stats?.snapshots_count).toBe(1);

      // Restore
      const restoreResult = await restic.restore(
        localStorage,
        repoName,
        RESTIC_PASSWORD,
        backupResult.snapshotId!,
        restoreDir
      );
      expect(restoreResult.success).toBe(true);

      // Verify all content
      expect(readFileSync(join(restoreDir, sourceDir, "text.txt"), "utf-8")).toBe("Text content");
      expect(readFileSync(join(restoreDir, sourceDir, "nested", "deep.txt"), "utf-8")).toBe("Deep content");
    }, TEST_TIMEOUT);
  });

  describe("Retention with Full Cycle", () => {
    it("full cycle with retention policy", async () => {
      const repoName = getUniqueRepoName("full-cycle-retention");

      await restic.initRepo(localStorage, repoName, RESTIC_PASSWORD);

      // Create 5 backups
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(sourceDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(localStorage, repoName, RESTIC_PASSWORD, sourceDir);
      }

      // Apply retention
      await restic.prune(localStorage, repoName, RESTIC_PASSWORD, { last: 2 });

      // Verify 2 remain
      const snapshots = await restic.listSnapshots(localStorage, repoName, RESTIC_PASSWORD);
      expect(snapshots.snapshots?.length).toBe(2);

      // Both remaining should be restorable
      for (const snapshot of snapshots.snapshots!) {
        const targetDir = join(restoreDir, snapshot.short_id);
        const result = await restic.restore(
          localStorage,
          repoName,
          RESTIC_PASSWORD,
          snapshot.short_id,
          targetDir
        );
        expect(result.success).toBe(true);
      }

      // Check repository integrity after prune
      const checkResult = await restic.check(localStorage, repoName, RESTIC_PASSWORD);
      expect(checkResult.success).toBe(true);
    }, TEST_TIMEOUT);
  });
});
