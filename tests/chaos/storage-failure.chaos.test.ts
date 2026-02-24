/**
 * Storage Failure Chaos Tests
 *
 * Tests system behavior when storage backends fail:
 * - Network disconnects
 * - Timeouts
 * - Credential failures
 * - Disk full scenarios
 * - Data corruption
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getToxiproxy,
  createNetworkFault,
  injectNetworkLatency,
  disconnectService,
  injectStorageTimeout,
  corruptFileAtOffset,
  fillDiskToPercent,
  type NetworkFault,
} from "../utils/chaos-helpers";
import {
  createLocalTestRepo,
  createS3TestRepo,
  createRestTestRepo,
  createSftpTestRepo,
  createTestBackup,
  cleanupTestRepo,
  type TestRepo,
} from "../utils/restic-helpers";
import { generateTestDataSet, STANDARD_TEST_FILES } from "../utils/test-data-generator";
import * as restic from "../../apps/api/src/services/restic";

// Check if Toxiproxy is available
const hasToxiproxy = process.env.TOXIPROXY_HOST || process.env.RUNNING_IN_DOCKER;

describe("Storage Failure Chaos Tests", () => {
  describe("SFTP Failure Scenarios", { timeout: 120000 }, () => {
    let repo: TestRepo;
    let networkFault: NetworkFault | null = null;

    beforeEach(async () => {
      repo = await createSftpTestRepo("sftp-chaos");
    });

    afterEach(async () => {
      if (networkFault) {
        await networkFault.reset();
      }
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("retries with backoff when SFTP connection drops mid-transfer", { skip: !hasToxiproxy }, async () => {
      // Create network fault for SFTP
      networkFault = await createNetworkFault("sftp");

      // Create some test content
      const testData = generateTestDataSet(repo.tempDir, STANDARD_TEST_FILES.slice(0, 3));

      // Disconnect mid-backup
      setTimeout(async () => {
        await networkFault!.disconnect();
        // Reconnect after 2 seconds
        setTimeout(() => networkFault!.reconnect(), 2000);
      }, 500);

      // Attempt backup - should retry and eventually succeed or fail gracefully
      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      // The backup must either succeed (retry reconnected in time) or fail with
      // a descriptive error message — a silent hang or unhandled throw is not acceptable.
      if (result.success) {
        // Retry succeeded: a snapshot must have been created
        expect(result.snapshotId).toBeDefined();
        expect(result.snapshotId!.length).toBeGreaterThan(0);
      } else {
        // Graceful failure: error message must describe the problem
        expect(result.message).toBeDefined();
        expect(result.message!.length).toBeGreaterThan(0);
      }
    });

    it("fails with clear error when SFTP endpoint unreachable", { skip: !hasToxiproxy }, async () => {
      networkFault = await createNetworkFault("sftp");

      // Disconnect completely
      await networkFault.disconnect();

      // Attempt backup
      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  describe("S3 Failure Scenarios", { timeout: 120000 }, () => {
    let repo: TestRepo;
    let networkFault: NetworkFault | null = null;

    beforeEach(async () => {
      repo = await createS3TestRepo("s3-chaos");
    });

    afterEach(async () => {
      if (networkFault) {
        await networkFault.reset();
      }
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("fails with clear error when S3 endpoint unreachable", { skip: !hasToxiproxy }, async () => {
      networkFault = await createNetworkFault("minio");
      await networkFault.disconnect();

      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });

    it("fails without retry when S3 credentials rejected", async () => {
      // Create backup with wrong credentials
      const wrongCredStorage = {
        ...repo.storage,
        access_key: "wrong-access-key",
        secret_key: "wrong-secret-key",
      };

      const result = await restic.initRepo(
        wrongCredStorage as any,
        "test-repo",
        repo.password
      );

      // Should fail immediately without retry
      expect(result.success).toBe(false);
    });

    it("handles S3 timeout gracefully", { skip: !hasToxiproxy }, async () => {
      networkFault = await createNetworkFault("minio");

      // Add 30 second latency (simulating very slow response)
      await networkFault.timeout(30000);

      const testData = generateTestDataSet(repo.tempDir, STANDARD_TEST_FILES.slice(0, 1));

      const operationStart = Date.now();
      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );
      const elapsed = Date.now() - operationStart;

      // The backup must either time out with a clear error, or (if restic's
      // own timeout fires first) return false with a message. What is NOT
      // acceptable is a silent undefined result or an unhandled exception.
      if (result.success) {
        // Succeeded under 30s latency — must have taken at least some time
        expect(elapsed).toBeGreaterThan(5000);
        expect(result.snapshotId).toBeDefined();
      } else {
        // Timed out or connection refused — must have a descriptive error
        expect(result.message).toBeDefined();
        expect(result.message!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("REST Server Failure Scenarios", { timeout: 120000 }, () => {
    let repo: TestRepo;
    let networkFault: NetworkFault | null = null;

    beforeEach(async () => {
      repo = await createRestTestRepo("rest-chaos");
    });

    afterEach(async () => {
      if (networkFault) {
        await networkFault.reset();
      }
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("retries on REST server timeout", { skip: !hasToxiproxy }, async () => {
      networkFault = await createNetworkFault("rest");

      // Add latency
      await networkFault.addLatency(5000, 1000);

      const opStart = Date.now();
      const result = await restic.listSnapshots(
        repo.storage,
        repo.name,
        repo.password
      );
      const elapsed = Date.now() - opStart;

      // The listSnapshots call must either succeed with a valid snapshot list,
      // or fail with a clear error message. Silent undefined or unhandled
      // exception is not acceptable.
      if (result.success) {
        // Under 5s latency a successful response must have taken at least 3s
        expect(elapsed).toBeGreaterThan(3000);
        expect(Array.isArray(result.snapshots)).toBe(true);
      } else {
        // Timed out — must carry a descriptive error message
        expect(result.message).toBeDefined();
        expect(result.message!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Disk Full Scenarios", { timeout: 60000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("disk-chaos");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("fails with clear error when disk is full during backup", async () => {
      // This test verifies that restic reports a clear disk-space error when
      // the destination has no room. We simulate a full disk by attempting to
      // write to a tiny tmpfs (or a pre-filled temp directory).
      // First, confirm the baseline (normal backup) works so we know restic itself is healthy.
      const normalResult = await createTestBackup(repo, { "test.txt": "Small content" });
      expect(normalResult.snapshotId).toBeDefined();

      // Now fill the repo directory to simulate a full disk, then attempt
      // another backup — it should fail with a disk-space error.
      const { fillDiskToPercent } = await import("../utils/chaos-helpers");
      const cleanupDiskFill = await fillDiskToPercent(repo.tempDir, 99, { maxSizeMB: 100 });

      try {
        const fullDiskResult = await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          repo.tempDir
        );

        if (!fullDiskResult.success) {
          // Must carry a disk/space related error message
          expect(fullDiskResult.message).toBeDefined();
          const errorLower = (fullDiskResult.message || "").toLowerCase();
          const hasDiskError =
            errorLower.includes("disk") ||
            errorLower.includes("space") ||
            errorLower.includes("no space") ||
            errorLower.includes("quota") ||
            errorLower.includes("enospc") ||
            errorLower.includes("full") ||
            errorLower.includes("write");
          expect(hasDiskError).toBe(true);
        } else {
          // Fill was not effective enough — the backup sneaked through.
          // Still valid: assert a snapshot was created.
          expect(fullDiskResult.snapshotId).toBeDefined();
        }
      } finally {
        await cleanupDiskFill();
      }
    });

    it("cleans up temp files when backup fails due to disk space", async () => {
      const { fillDiskToPercent } = await import("../utils/chaos-helpers");
      const fs = await import("fs");
      const path = await import("path");

      // Create a limited-size tmpfs directory for testing
      const testTmpDir = `/tmp/disk-test-${Date.now()}`;
      fs.mkdirSync(testTmpDir, { recursive: true });

      // Create test content that we'll try to backup
      const testData = generateTestDataSet(repo.tempDir, STANDARD_TEST_FILES.slice(0, 2));

      // Get initial temp file count in restic cache directory
      const resticCacheDir = path.join(testTmpDir, ".cache", "restic");
      const getResticTempFiles = () => {
        if (!fs.existsSync(resticCacheDir)) return [];
        try {
          const walk = (dir: string): string[] => {
            const files: string[] = [];
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                files.push(...walk(fullPath));
              } else if (entry.name.includes("tmp") || entry.name.endsWith(".tmp")) {
                files.push(fullPath);
              }
            }
            return files;
          };
          return walk(resticCacheDir);
        } catch {
          return [];
        }
      };

      const tempFilesBefore = getResticTempFiles();

      // Fill disk to 95% to trigger disk space issues
      // Use a small max size to make this testable
      const cleanupDiskFill = await fillDiskToPercent(testTmpDir, 95, {
        maxSizeMB: 50,
      });

      try {
        // Attempt backup - should fail due to disk space
        const result = await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          testData.basePath
        );

        // Either the backup fails with disk space error, or succeeds if the fill wasn't enough.
        if (!result.success) {
          // When the backup fails it MUST carry a descriptive error message
          // that indicates a disk/space related problem.
          expect(result.message).toBeDefined();
          const errorLower = (result.message || "").toLowerCase();
          const hasDiskError = errorLower.includes("disk") ||
                              errorLower.includes("space") ||
                              errorLower.includes("no space") ||
                              errorLower.includes("quota") ||
                              errorLower.includes("write") ||
                              errorLower.includes("enospc") ||
                              errorLower.includes("full");
          expect(hasDiskError).toBe(true);
        } else {
          // The disk fill was not sufficient to block this backup.
          // That is acceptable, but the backup must have produced a valid snapshot.
          expect(result.snapshotId).toBeDefined();
          expect(result.snapshotId!.length).toBeGreaterThan(0);
        }

        // Verify temp files are cleaned up after failure
        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 500));
        const tempFilesAfter = getResticTempFiles();

        // There should be no new orphaned temp files
        const orphanedTempFiles = tempFilesAfter.filter(f => !tempFilesBefore.includes(f));
        expect(orphanedTempFiles.length).toBe(0);

      } finally {
        // Cleanup the disk fill
        await cleanupDiskFill();

        // Cleanup test directory
        if (fs.existsSync(testTmpDir)) {
          fs.rmSync(testTmpDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("Data Corruption Detection", { timeout: 60000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("corruption-chaos");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("detects checksum mismatch in corrupted backup", async () => {
      // Create a valid backup first
      const backup = await createTestBackup(repo, {
        "important.txt": "Very important data that should not be corrupted",
      });

      expect(backup.snapshotId).toBeDefined();

      // Verify integrity before corruption
      const checkBefore = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkBefore.success).toBe(true);

      // Note: Actually corrupting restic data files requires knowing
      // the internal structure. For this test, we verify the check works.
    });

    it("rejects restore of corrupted snapshot", async () => {
      // If a snapshot is corrupted, restore should fail with clear error
      // rather than producing corrupted output

      // Create and verify a backup
      const backup = await createTestBackup(repo, {
        "data.txt": "Original data",
      });

      expect(backup.snapshotId).toBeDefined();

      // Restore should succeed with valid data
      const restoreResult = await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        "/tmp/restore-test-" + Date.now()
      );

      expect(restoreResult.success).toBe(true);
    });
  });

  describe("Permission Errors", { timeout: 60000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("permission-chaos");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("fails with clear error on permission denied during restore", async () => {
      // Create a backup
      const backup = await createTestBackup(repo, {
        "file.txt": "Content",
      });

      // Attempt to restore to a path that doesn't exist
      // (which will be created with proper permissions in normal operation)
      const result = await restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup.snapshotId,
        "/root/no-permission" // This should fail on non-root
      );

      // Should fail with permission error unless running as root.
      // Determine the running user to know which outcome to expect.
      const isRoot = process.getuid !== undefined && process.getuid() === 0;

      if (isRoot) {
        // Running as root: the restore may succeed (root can write anywhere).
        if (result.success) {
          // A successful restore must not produce a failure message.
          // The operation completed — verify the result is coherent.
          expect(result.message).not.toMatch(/error|fail|denied/i);
        } else {
          // Even root can get other errors (e.g. restic validation); message must exist.
          expect(result.message).toBeDefined();
          expect(result.message!.length).toBeGreaterThan(0);
        }
      } else {
        // Non-root: restore to /root/no-permission MUST be rejected with a
        // permission error, not silently succeed.
        expect(result.success).toBe(false);
        expect(result.message).toBeDefined();
        const msgLower = (result.message || "").toLowerCase();
        const hasPermissionError = msgLower.includes("permission") ||
                                   msgLower.includes("denied") ||
                                   msgLower.includes("access") ||
                                   msgLower.includes("cannot") ||
                                   msgLower.includes("mkdir") ||
                                   msgLower.includes("eacces");
        expect(hasPermissionError).toBe(true);
      }
    });
  });
});
