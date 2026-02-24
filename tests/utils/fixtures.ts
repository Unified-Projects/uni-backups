/**
 * Test fixtures and data generators
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { randomBytes, createHash } from "crypto";

const FIXTURES_DIR = join(__dirname, "../fixtures/files");

export interface TestFile {
  path: string;
  content: Buffer;
  checksum: string;
}

/**
 * Generate a checksum for content
 */
export function generateChecksum(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Get all test files with their checksums
 */
export function getTestFiles(): TestFile[] {
  const files: TestFile[] = [];

  const readDir = (dir: string, basePath = ""): void => {
    const { readdirSync, statSync } = require("fs");
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relativePath = join(basePath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        readDir(fullPath, relativePath);
      } else {
        const content = readFileSync(fullPath);
        files.push({
          path: relativePath,
          content,
          checksum: generateChecksum(content),
        });
      }
    }
  };

  if (existsSync(join(FIXTURES_DIR, "sample"))) {
    readDir(join(FIXTURES_DIR, "sample"), "sample");
  }

  return files;
}

/**
 * Verify restored files match original checksums
 */
export function verifyRestoredFiles(
  restoreDir: string,
  originalFiles: TestFile[]
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const file of originalFiles) {
    const restoredPath = join(restoreDir, file.path);

    if (!existsSync(restoredPath)) {
      errors.push(`Missing file: ${file.path}`);
      continue;
    }

    const restoredContent = readFileSync(restoredPath);
    const restoredChecksum = generateChecksum(restoredContent);

    if (restoredChecksum !== file.checksum) {
      errors.push(
        `Checksum mismatch for ${file.path}: expected ${file.checksum}, got ${restoredChecksum}`
      );
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Generate a random binary file for testing
 */
export function generateBinaryFile(path: string, sizeBytes: number): TestFile {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = randomBytes(sizeBytes);
  writeFileSync(path, content);

  return {
    path,
    content,
    checksum: generateChecksum(content),
  };
}

/**
 * Create a test directory structure with files
 */
export function createTestDirectory(baseDir: string): TestFile[] {
  const files: TestFile[] = [];

  // Create directory structure
  const dirs = [
    join(baseDir, "level1"),
    join(baseDir, "level1/level2"),
    join(baseDir, "level1/level2/level3"),
    join(baseDir, "other"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create text files
  const textFiles = [
    { path: join(baseDir, "root.txt"), content: "Root level file" },
    { path: join(baseDir, "level1/file1.txt"), content: "Level 1 file" },
    {
      path: join(baseDir, "level1/level2/file2.txt"),
      content: "Level 2 file",
    },
    {
      path: join(baseDir, "level1/level2/level3/file3.txt"),
      content: "Level 3 file",
    },
    { path: join(baseDir, "other/other.txt"), content: "Other directory file" },
  ];

  for (const { path, content } of textFiles) {
    const buffer = Buffer.from(content);
    writeFileSync(path, buffer);
    files.push({
      path: path.replace(baseDir + "/", ""),
      content: buffer,
      checksum: generateChecksum(buffer),
    });
  }

  // Create a JSON file
  const jsonContent = Buffer.from(
    JSON.stringify({ test: true, timestamp: Date.now() }, null, 2)
  );
  const jsonPath = join(baseDir, "config.json");
  writeFileSync(jsonPath, jsonContent);
  files.push({
    path: "config.json",
    content: jsonContent,
    checksum: generateChecksum(jsonContent),
  });

  // Create a small binary file
  const binaryContent = randomBytes(1024);
  const binaryPath = join(baseDir, "binary.dat");
  writeFileSync(binaryPath, binaryContent);
  files.push({
    path: "binary.dat",
    content: binaryContent,
    checksum: generateChecksum(binaryContent),
  });

  return files;
}

/**
 * Clean up test directory
 */
export function cleanupTestDirectory(dir: string): void {
  const { rmSync } = require("fs");

  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Expected PostgreSQL data for verification
 */
export const POSTGRES_EXPECTED_DATA = {
  userCount: 3,
  orderCount: 5,
  productCount: 4,
  users: ["alice", "bob", "charlie"],
  completedOrdersAmount: 220.49, // 99.99 + 75.50 + 45.00
};

/**
 * Expected MariaDB data for verification
 */
export const MARIADB_EXPECTED_DATA = {
  productCount: 5,
  inventoryCount: 5,
  customerCount: 3,
  salesCount: 5,
  warehouses: ["warehouse-1", "warehouse-2"],
};

/**
 * Expected Redis data for verification
 */
export const REDIS_EXPECTED_DATA = {
  keys: ["test:key1", "test:key2", "test:hash", "test:list", "test:counter"],
  values: {
    "test:key1": "value1",
    "test:key2": "value2",
    "test:counter": "42",
  },
};

import { randomUUID } from "crypto";

/**
 * Worker configuration type
 */
export interface TestWorkerConfig {
  id: string;
  name: string;
  groups: string[];
  hostname: string;
  healthPort: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  concurrency: number;
}

/**
 * Create a test worker configuration
 */
export function createTestWorkerConfig(
  overrides?: Partial<TestWorkerConfig>
): TestWorkerConfig {
  const id = overrides?.id || `test-worker-${randomUUID().slice(0, 8)}`;
  return {
    id,
    name: overrides?.name || id,
    groups: overrides?.groups || ["default"],
    hostname: overrides?.hostname || "localhost",
    healthPort: overrides?.healthPort || 3002,
    heartbeatInterval: overrides?.heartbeatInterval || 5000,
    heartbeatTimeout: overrides?.heartbeatTimeout || 30000,
    concurrency: overrides?.concurrency || 2,
  };
}

/**
 * Worker state type for testing
 */
export interface TestWorkerState {
  id: string;
  name: string;
  hostname: string;
  groups: string[];
  status: "starting" | "healthy" | "degraded" | "stopping" | "offline";
  lastHeartbeat: number;
  currentJobs: string[];
  metrics: {
    jobsProcessed: number;
    jobsFailed: number;
    lastJobTime: number;
  };
}

/**
 * Create a test worker state
 */
export function createTestWorkerState(
  overrides?: Partial<TestWorkerState>
): TestWorkerState {
  const id = overrides?.id || `test-worker-${randomUUID().slice(0, 8)}`;
  return {
    id,
    name: overrides?.name || id,
    hostname: overrides?.hostname || "localhost",
    groups: overrides?.groups || ["default"],
    status: overrides?.status || "healthy",
    lastHeartbeat: overrides?.lastHeartbeat || Date.now(),
    currentJobs: overrides?.currentJobs || [],
    metrics: overrides?.metrics || {
      jobsProcessed: 0,
      jobsFailed: 0,
      lastJobTime: 0,
    },
  };
}

/**
 * Worker group state type for testing
 */
export interface TestWorkerGroupState {
  groupId: string;
  workers: string[];
  primaryWorkerId: string | null;
  failoverOrder: string[];
  quorumSize: number;
  fenceToken: string | null;
  lastElection: number;
  lastHealthCheck: number;
}

/**
 * Create a test worker group state
 */
export function createTestWorkerGroupState(
  overrides?: Partial<TestWorkerGroupState>
): TestWorkerGroupState {
  const groupId = overrides?.groupId || "test-group";
  return {
    groupId,
    workers: overrides?.workers || ["worker-1", "worker-2"],
    primaryWorkerId: overrides?.primaryWorkerId ?? "worker-1",
    failoverOrder: overrides?.failoverOrder || ["worker-1", "worker-2"],
    quorumSize: overrides?.quorumSize || 2,
    fenceToken: overrides?.fenceToken ?? null,
    lastElection: overrides?.lastElection || Date.now(),
    lastHealthCheck: overrides?.lastHealthCheck || Date.now(),
  };
}

/**
 * Job execution type for testing
 */
export interface TestJobExecution {
  id: string;
  jobName: string;
  workerId: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  snapshotId?: string;
  error?: string;
  duration?: number;
}

/**
 * Create a test job execution
 */
export function createTestJobExecution(
  overrides?: Partial<TestJobExecution>
): TestJobExecution {
  const id = overrides?.id || randomUUID();
  return {
    id,
    jobName: overrides?.jobName || "test-backup-job",
    workerId: overrides?.workerId || "test-worker-1",
    status: overrides?.status || "running",
    startTime: overrides?.startTime || Date.now(),
    endTime: overrides?.endTime,
    snapshotId: overrides?.snapshotId,
    error: overrides?.error,
    duration: overrides?.duration,
  };
}

/**
 * Backup job data type for testing
 */
export interface TestBackupJobData {
  executionId: string;
  jobName: string;
  jobConfig: Record<string, unknown>;
  storage: Record<string, unknown>;
  repoName: string;
  workerGroups: string[];
  priority: number;
  triggeredBy: "schedule" | "manual" | "failover";
  originalWorkerId?: string;
  queuedAt: number;
}

/**
 * Create test backup job data
 */
export function createTestBackupJobData(
  overrides?: Partial<TestBackupJobData>
): TestBackupJobData {
  return {
    executionId: overrides?.executionId || randomUUID(),
    jobName: overrides?.jobName || "test-backup-job",
    jobConfig: overrides?.jobConfig || {
      type: "volume",
      source: "/test/source",
      storage: "test-storage",
      worker_group: "default",
    },
    storage: overrides?.storage || {
      type: "local",
      path: "/test/backup",
    },
    repoName: overrides?.repoName || "test-repo",
    workerGroups: overrides?.workerGroups || ["default"],
    priority: overrides?.priority || 100,
    triggeredBy: overrides?.triggeredBy || "manual",
    originalWorkerId: overrides?.originalWorkerId,
    queuedAt: overrides?.queuedAt || Date.now(),
  };
}
