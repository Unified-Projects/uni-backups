/**
 * Test Configuration Factory
 *
 * Creates real configuration objects for integration testing.
 * These configurations work with the Docker test services.
 */

import type {
  RuntimeConfig,
  StorageConfig,
  JobConfig,
  WorkerGroup,
  S3Storage,
  RestStorage,
  SftpStorage,
  LocalStorage,
  FolderJob,
  PostgresJob,
  MariadbJob,
  RedisJob,
} from "@uni-backups/shared/config";
import { TEST_CONFIG, TEST_STORAGE, generateTestId, generateTestRepoName } from "./test-services";

/**
 * Create an S3 (MinIO) storage configuration for testing
 */
export function createTestS3Storage(overrides?: Partial<S3Storage>): S3Storage {
  return {
    ...TEST_STORAGE.s3,
    ...overrides,
  };
}

/**
 * Create a REST storage configuration for testing
 */
export function createTestRestStorage(overrides?: Partial<RestStorage>): RestStorage {
  return {
    ...TEST_STORAGE.rest,
    ...overrides,
  };
}

/**
 * Create an SFTP storage configuration for testing
 */
export function createTestSftpStorage(overrides?: Partial<SftpStorage>): SftpStorage {
  return {
    ...TEST_STORAGE.sftp,
    ...overrides,
  };
}

/**
 * Create a local storage configuration for testing
 */
export function createTestLocalStorage(overrides?: Partial<LocalStorage>): LocalStorage {
  return {
    ...TEST_STORAGE.local,
    ...overrides,
  };
}

interface TestJobOptions {
  name?: string;
  storage?: string;
  repo?: string;
  schedule?: string;
  tags?: string[];
  workerGroup?: string;
}

/**
 * Create a folder/volume backup job configuration
 */
export function createTestFolderJob(
  source: string,
  options: TestJobOptions = {}
): FolderJob {
  return {
    type: "folder",
    source,
    storage: options.storage || "test-storage",
    repo: options.repo || generateTestRepoName("folder"),
    schedule: options.schedule,
    tags: options.tags || [options.name || "test-folder-job"],
    worker_group: options.workerGroup || "default",
  };
}

/**
 * Create a PostgreSQL backup job configuration
 */
export function createTestPostgresJob(options: TestJobOptions = {}): PostgresJob {
  return {
    type: "postgres",
    host: TEST_CONFIG.postgres.host,
    port: TEST_CONFIG.postgres.port,
    database: TEST_CONFIG.postgres.database,
    user: TEST_CONFIG.postgres.user,
    password: TEST_CONFIG.postgres.password,
    storage: options.storage || "test-storage",
    repo: options.repo || generateTestRepoName("postgres"),
    schedule: options.schedule,
    tags: options.tags || [options.name || "test-postgres-job"],
    worker_group: options.workerGroup || "default",
    all_databases: false,
  };
}

/**
 * Create a MariaDB backup job configuration
 */
export function createTestMariaDBJob(options: TestJobOptions = {}): MariadbJob {
  return {
    type: "mariadb",
    host: TEST_CONFIG.mariadb.host,
    port: TEST_CONFIG.mariadb.port,
    database: TEST_CONFIG.mariadb.database,
    user: TEST_CONFIG.mariadb.user,
    password: TEST_CONFIG.mariadb.password,
    storage: options.storage || "test-storage",
    repo: options.repo || generateTestRepoName("mariadb"),
    schedule: options.schedule,
    tags: options.tags || [options.name || "test-mariadb-job"],
    worker_group: options.workerGroup || "default",
    all_databases: false,
  };
}

/**
 * Create a Redis backup job configuration
 */
export function createTestRedisJob(options: TestJobOptions = {}): RedisJob {
  return {
    type: "redis",
    host: TEST_CONFIG.redis.host,
    port: TEST_CONFIG.redis.port,
    password: TEST_CONFIG.redis.password,
    storage: options.storage || "test-storage",
    repo: options.repo || generateTestRepoName("redis"),
    schedule: options.schedule,
    tags: options.tags || [options.name || "test-redis-job"],
    worker_group: options.workerGroup || "default",
  };
}

interface TestRuntimeConfigOptions {
  storageTypes?: ("s3" | "rest" | "sftp" | "local")[];
  jobTypes?: ("folder" | "postgres" | "mariadb" | "redis")[];
  workerGroups?: Record<string, WorkerGroup>;
}

/**
 * Create a complete RuntimeConfig for testing
 */
export function createTestRuntimeConfig(options: TestRuntimeConfigOptions = {}): RuntimeConfig {
  const {
    storageTypes = ["s3", "local"],
    jobTypes = ["folder"],
    workerGroups = {},
  } = options;

  // Build storage map
  const storage = new Map<string, StorageConfig>();
  if (storageTypes.includes("s3")) {
    storage.set("s3-storage", createTestS3Storage());
  }
  if (storageTypes.includes("rest")) {
    storage.set("rest-storage", createTestRestStorage());
  }
  if (storageTypes.includes("sftp")) {
    storage.set("sftp-storage", createTestSftpStorage());
  }
  if (storageTypes.includes("local")) {
    storage.set("local-storage", createTestLocalStorage());
  }

  // Default storage name
  const defaultStorage = storage.keys().next().value || "test-storage";

  // Build jobs map
  const jobs = new Map<string, JobConfig>();
  if (jobTypes.includes("folder")) {
    jobs.set("test-folder-job", createTestFolderJob("/tmp/test-source", { storage: defaultStorage, name: "test-folder-job" }));
  }
  if (jobTypes.includes("postgres")) {
    jobs.set("test-postgres-job", createTestPostgresJob({ storage: defaultStorage, name: "test-postgres-job" }));
  }
  if (jobTypes.includes("mariadb")) {
    jobs.set("test-mariadb-job", createTestMariaDBJob({ storage: defaultStorage, name: "test-mariadb-job" }));
  }
  if (jobTypes.includes("redis")) {
    jobs.set("test-redis-job", createTestRedisJob({ storage: defaultStorage, name: "test-redis-job" }));
  }

  // Build worker groups map
  const workerGroupsMap = new Map<string, WorkerGroup>();
  workerGroupsMap.set("default", {
    workers: ["worker-1", "worker-2"],
    primary: "worker-1",
    failover_order: ["worker-1", "worker-2"],
    quorum_size: 2,
  });
  for (const [name, config] of Object.entries(workerGroups)) {
    workerGroupsMap.set(name, config);
  }

  return {
    storage,
    jobs,
    workerGroups: workerGroupsMap,
    redis: {
      host: TEST_CONFIG.redis.host,
      port: TEST_CONFIG.redis.port,
      password: TEST_CONFIG.redis.password,
      db: TEST_CONFIG.redis.db,
    },
    resticPassword: TEST_CONFIG.restic.password,
    resticCacheDir: "/tmp/restic-test-cache",
  };
}

/**
 * Creates functions that can be used to override the config module in tests.
 * Use these to inject real test configuration into the API routes.
 */
export function createConfigOverrides(config: RuntimeConfig) {
  return {
    getConfig: () => config,
    getStorage: (name: string) => config.storage.get(name),
    getJob: (name: string) => config.jobs.get(name),
    getAllJobs: () => Array.from(config.jobs.entries()).map(([name, cfg]) => ({ name, config: cfg })),
    getAllStorage: () => Array.from(config.storage.entries()).map(([name, cfg]) => ({ name, config: cfg })),
    getWorkerGroup: (name: string) => config.workerGroups.get(name),
    getAllWorkerGroups: () => Array.from(config.workerGroups.entries()).map(([name, cfg]) => ({ name, config: cfg })),
    getResticPassword: () => config.resticPassword,
  };
}

/**
 * Create test source directory with files for backup testing
 */
export async function createTestSourceDirectory(baseDir: string): Promise<{ files: string[]; totalSize: number }> {
  const fs = await import("fs/promises");
  const path = await import("path");

  await fs.mkdir(baseDir, { recursive: true });

  const files: string[] = [];
  let totalSize = 0;

  // Create text files
  const textFiles = [
    { name: "readme.txt", content: "Test backup source directory" },
    { name: "data.json", content: JSON.stringify({ test: true, timestamp: Date.now() }) },
    { name: "config.yml", content: "key: value\nlist:\n  - item1\n  - item2" },
  ];

  for (const { name, content } of textFiles) {
    const filePath = path.join(baseDir, name);
    await fs.writeFile(filePath, content);
    files.push(name);
    totalSize += content.length;
  }

  // Create subdirectory with files
  const subDir = path.join(baseDir, "subdir");
  await fs.mkdir(subDir, { recursive: true });

  const subDirFile = "nested-file.txt";
  const subDirContent = "Nested file content for backup testing";
  await fs.writeFile(path.join(subDir, subDirFile), subDirContent);
  files.push(`subdir/${subDirFile}`);
  totalSize += subDirContent.length;

  // Create a binary file
  const { randomBytes } = await import("crypto");
  const binaryContent = randomBytes(1024);
  await fs.writeFile(path.join(baseDir, "binary.dat"), binaryContent);
  files.push("binary.dat");
  totalSize += binaryContent.length;

  return { files, totalSize };
}

/**
 * Clean up test directories
 */
export async function cleanupTestDirectory(dir: string): Promise<void> {
  const fs = await import("fs/promises");
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Verify restored files match original source
 */
export async function verifyRestoredFiles(
  sourceDir: string,
  restoreDir: string
): Promise<{ success: boolean; errors: string[] }> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const crypto = await import("crypto");

  const errors: string[] = [];

  async function compareFiles(relativePath: string) {
    const sourcePath = path.join(sourceDir, relativePath);
    const restorePath = path.join(restoreDir, relativePath);

    try {
      const [sourceContent, restoreContent] = await Promise.all([
        fs.readFile(sourcePath),
        fs.readFile(restorePath),
      ]);

      const sourceHash = crypto.createHash("sha256").update(sourceContent).digest("hex");
      const restoreHash = crypto.createHash("sha256").update(restoreContent).digest("hex");

      if (sourceHash !== restoreHash) {
        errors.push(`Content mismatch: ${relativePath}`);
      }
    } catch (err: any) {
      errors.push(`Error comparing ${relativePath}: ${err.message}`);
    }
  }

  async function walkDir(dir: string, basePath = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walkDir(path.join(dir, entry.name), relativePath);
      } else {
        await compareFiles(relativePath);
      }
    }
  }

  await walkDir(sourceDir);

  return { success: errors.length === 0, errors };
}
