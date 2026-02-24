/**
 * Restic Test Helpers
 *
 * Utilities for creating, managing, and verifying restic repositories
 * in integration tests. Uses real restic operations - no mocking.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { StorageConfig, LocalStorage, S3Storage, RestStorage, SftpStorage } from "@uni-backups/shared/config";
import * as restic from "../../apps/api/src/services/restic";
import { TEST_CONFIG, TEST_STORAGE } from "./test-services";

// Re-export storage configs for convenience
export { TEST_STORAGE };

export interface TestRepo {
  storage: StorageConfig;
  name: string;
  password: string;
  tempDir: string;
}

export interface TestBackupResult {
  snapshotId: string;
  files: Record<string, { hash: string; size: number }>;
}

/**
 * Generate a unique repository name for tests
 */
export function generateRepoName(prefix = "test-repo"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a test repository on any storage backend
 */
export async function createTestRepo(
  storage: StorageConfig,
  namePrefix = "test"
): Promise<TestRepo> {
  const name = generateRepoName(namePrefix);
  const password = TEST_CONFIG.restic.password;
  const tempDir = `/tmp/restic-test-${name}`;

  // Create temp directory for test files
  mkdirSync(tempDir, { recursive: true });

  // Initialize the repository
  const result = await restic.initRepo(storage, name, password);

  if (!result.success && !result.alreadyExists) {
    throw new Error(`Failed to initialize test repo: ${result.message}`);
  }

  return { storage, name, password, tempDir };
}

/**
 * Create a test repository using local storage (fastest for tests)
 */
export async function createLocalTestRepo(namePrefix = "local-test"): Promise<TestRepo> {
  const name = generateRepoName(namePrefix);
  const password = TEST_CONFIG.restic.password;
  const repoDir = `/tmp/restic-repos-${Date.now()}`;
  const tempDir = `/tmp/restic-test-${name}`;

  mkdirSync(repoDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  const storage: LocalStorage = {
    type: "local",
    path: repoDir,
  };

  const result = await restic.initRepo(storage, name, password);

  if (!result.success && !result.alreadyExists) {
    throw new Error(`Failed to initialize local test repo: ${result.message}`);
  }

  return { storage, name, password, tempDir };
}

/**
 * Create a test repository using S3/MinIO storage
 */
export async function createS3TestRepo(namePrefix = "s3-test"): Promise<TestRepo> {
  return createTestRepo(TEST_STORAGE.s3, namePrefix);
}

/**
 * Create a test repository using REST server storage
 */
export async function createRestTestRepo(namePrefix = "rest-test"): Promise<TestRepo> {
  return createTestRepo(TEST_STORAGE.rest, namePrefix);
}

/**
 * Create a test repository using SFTP storage
 */
export async function createSftpTestRepo(namePrefix = "sftp-test"): Promise<TestRepo> {
  return createTestRepo(TEST_STORAGE.sftp, namePrefix);
}

/**
 * Cleanup a test repository and its temp files
 */
export async function cleanupTestRepo(repo: TestRepo): Promise<void> {
  // Remove temp directory
  if (existsSync(repo.tempDir)) {
    rmSync(repo.tempDir, { recursive: true, force: true });
  }

  // For local storage, we can also clean up the repo itself
  if (repo.storage.type === "local") {
    const repoPath = join(repo.storage.path, repo.name);
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true });
    }
  }
}

/**
 * Create test files in the temp directory
 */
export function createTestFiles(
  repo: TestRepo,
  files: Record<string, string | Buffer>
): Record<string, { hash: string; size: number }> {
  const result: Record<string, { hash: string; size: number }> = {};

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(repo.tempDir, filename);
    const dir = join(repo.tempDir, filename.split("/").slice(0, -1).join("/"));

    if (dir !== repo.tempDir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    writeFileSync(filePath, buffer);

    result[filename] = {
      hash: createHash("sha256").update(buffer).digest("hex"),
      size: buffer.length,
    };
  }

  return result;
}

/**
 * Create a random binary file
 */
export function createRandomFile(repo: TestRepo, filename: string, sizeBytes: number): { hash: string; size: number } {
  const buffer = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }

  const filePath = join(repo.tempDir, filename);
  writeFileSync(filePath, buffer);

  return {
    hash: createHash("sha256").update(buffer).digest("hex"),
    size: sizeBytes,
  };
}

/**
 * Create test backup with sample files
 */
export async function createTestBackup(
  repo: TestRepo,
  files: Record<string, string | Buffer>,
  options?: { tags?: string[]; hostname?: string }
): Promise<TestBackupResult> {
  // Create the files
  const fileInfo = createTestFiles(repo, files);

  // Run backup
  const result = await restic.backup(
    repo.storage,
    repo.name,
    repo.password,
    repo.tempDir,
    options
  );

  if (!result.success || !result.snapshotId) {
    throw new Error(`Backup failed: ${result.message}`);
  }

  return {
    snapshotId: result.snapshotId,
    files: fileInfo,
  };
}

/**
 * Create multiple sequential backups (for testing retention, incremental backup, etc.)
 */
export async function createMultipleBackups(
  repo: TestRepo,
  count: number,
  generateContent: (index: number) => Record<string, string | Buffer>
): Promise<string[]> {
  const snapshotIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const content = generateContent(i);
    const result = await createTestBackup(repo, content);
    snapshotIds.push(result.snapshotId);
  }

  return snapshotIds;
}

/**
 * Verify backup integrity using restic check
 */
export async function verifyBackupIntegrity(repo: TestRepo): Promise<boolean> {
  const result = await restic.check(repo.storage, repo.name, repo.password);
  return result.success;
}

/**
 * Verify backup integrity with full data read
 */
export async function verifyBackupIntegrityFull(repo: TestRepo): Promise<boolean> {
  const result = await restic.check(repo.storage, repo.name, repo.password, {
    readData: true,
  });
  return result.success;
}

/**
 * List snapshots in test repo
 */
export async function listTestSnapshots(
  repo: TestRepo,
  options?: { tags?: string[]; latest?: number }
): Promise<restic.ResticSnapshot[]> {
  const result = await restic.listSnapshots(
    repo.storage,
    repo.name,
    repo.password,
    options
  );

  if (!result.success) {
    throw new Error(`Failed to list snapshots: ${result.message}`);
  }

  return result.snapshots || [];
}

/**
 * List files in a snapshot
 */
export async function listSnapshotFiles(
  repo: TestRepo,
  snapshotId: string,
  path?: string
): Promise<restic.ResticLsEntry[]> {
  const result = await restic.listFiles(
    repo.storage,
    repo.name,
    repo.password,
    snapshotId,
    path
  );

  if (!result.success) {
    throw new Error(`Failed to list files: ${result.message}`);
  }

  return result.entries || [];
}

/**
 * Restore from a snapshot
 */
export async function restoreSnapshot(
  repo: TestRepo,
  snapshotId: string,
  targetDir: string,
  options?: { include?: string[]; exclude?: string[] }
): Promise<void> {
  const result = await restic.restore(
    repo.storage,
    repo.name,
    repo.password,
    snapshotId,
    targetDir,
    options
  );

  if (!result.success) {
    throw new Error(`Restore failed: ${result.message}`);
  }
}

/**
 * Verify restored file matches original
 */
export function verifyRestoredFile(
  originalRepo: TestRepo,
  restoredPath: string,
  originalHash: string
): boolean {
  if (!existsSync(restoredPath)) {
    return false;
  }

  const content = readFileSync(restoredPath);
  const hash = createHash("sha256").update(content).digest("hex");

  return hash === originalHash;
}

/**
 * Verify all restored files match originals
 */
export function verifyAllRestoredFiles(
  restoreDir: string,
  sourceDir: string,
  files: Record<string, { hash: string; size: number }>
): { match: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  for (const [filename, { hash, size }] of Object.entries(files)) {
    const restoredPath = join(restoreDir, sourceDir, filename);

    if (!existsSync(restoredPath)) {
      mismatches.push(`${filename}: file not found`);
      continue;
    }

    const stat = statSync(restoredPath);
    if (stat.size !== size) {
      mismatches.push(`${filename}: size mismatch (expected ${size}, got ${stat.size})`);
      continue;
    }

    const content = readFileSync(restoredPath);
    const actualHash = createHash("sha256").update(content).digest("hex");

    if (actualHash !== hash) {
      mismatches.push(`${filename}: hash mismatch`);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

/**
 * Apply retention policy and return remaining snapshot count
 */
export async function applyRetention(
  repo: TestRepo,
  retention: { last?: number; hourly?: number; daily?: number; weekly?: number; monthly?: number; yearly?: number },
  options?: { tags?: string[]; dryRun?: boolean }
): Promise<{ success: boolean; remainingCount?: number }> {
  const result = await restic.prune(
    repo.storage,
    repo.name,
    repo.password,
    retention,
    options
  );

  if (!result.success) {
    return { success: false };
  }

  const snapshots = await listTestSnapshots(repo);
  return { success: true, remainingCount: snapshots.length };
}

/**
 * Get repository statistics
 */
export async function getRepoStats(repo: TestRepo): Promise<restic.ResticStats | null> {
  const result = await restic.stats(repo.storage, repo.name, repo.password);

  if (!result.success) {
    return null;
  }

  return result.stats || null;
}

/**
 * Unlock a repository
 */
export async function unlockRepo(repo: TestRepo): Promise<boolean> {
  const result = await restic.unlock(repo.storage, repo.name, repo.password);
  return result.success;
}

/**
 * Standard test file set for consistent testing
 */
export const STANDARD_TEST_FILES = {
  "text.txt": "Hello World!\nThis is a test file.",
  "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]),
  "json/config.json": JSON.stringify({ test: true, version: 1 }, null, 2),
  "nested/deep/file.txt": "Deeply nested content",
  "unicode.txt": "Hello World! Bonjour! Hola!",
};

/**
 * Create a standard backup for common test scenarios
 */
export async function createStandardBackup(repo: TestRepo): Promise<TestBackupResult> {
  return createTestBackup(repo, STANDARD_TEST_FILES, {
    tags: ["test", "standard"],
  });
}
