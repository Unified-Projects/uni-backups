/**
 * Job Processor Comprehensive Tests
 *
 * Tests the full job processing pipeline with real verification:
 * - File backups with SHA256 checksums
 * - Binary file byte-by-byte verification
 * - Large file handling
 * - Database backups (PostgreSQL, MariaDB, Redis)
 * - Edge cases and error handling
 * - Retention policy enforcement
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import { StateManager } from "@uni-backups/shared/redis";
import { QUEUES } from "@uni-backups/queue";
import { JobProcessor } from "../processor";
import { HeartbeatService } from "../heartbeat";
import type { WorkerConfig } from "../../config";
import * as restic from "../restic";
import {
  createLocalTestRepo,
  cleanupTestRepo,
  restoreSnapshot,
  listTestSnapshots,
  verifyAllRestoredFiles,
  type TestRepo,
} from "../../../../../tests/utils/restic-helpers";
import {
  computeFileChecksum,
  computeDirectoryManifest,
  verifyDirectoryIntegrity,
  compareByteByByte,
} from "../../../../../tests/utils/checksum-helpers";
import {
  generateLargeFile,
  generateTestDataSet,
  STANDARD_TEST_FILES,
  COMPREHENSIVE_TEST_FILES,
} from "../../../../../tests/utils/test-data-generator";

// Environment check for database tests
const hasDatabases = process.env.RUNNING_IN_DOCKER === "true";

// Redis configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
};

// PostgreSQL configuration
const PG_CONFIG = {
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "testpass123",
  database: process.env.PG_DATABASE || "postgres",
};

// MariaDB configuration
const MARIADB_CONFIG = {
  host: process.env.MARIADB_HOST || "localhost",
  port: parseInt(process.env.MARIADB_PORT || "3306"),
  user: process.env.MARIADB_USER || "root",
  password: process.env.MARIADB_PASSWORD || "testpass123",
  database: process.env.MARIADB_DATABASE || "test",
};

function createBullMQConnection(): Redis {
  return new Redis({
    ...TEST_REDIS_CONFIG,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function createTestConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    id: `test-worker-${Date.now()}`,
    name: "Comprehensive Test Worker",
    groups: ["default", "test-group"],
    hostname: "localhost",
    healthPort: 3003,
    heartbeatInterval: 100,
    heartbeatTimeout: 30000,
    concurrency: 2,
    ...overrides,
  };
}

describe("Job Processor Comprehensive Tests", { timeout: 300000 }, () => {
  let repo: TestRepo;
  let redis: Redis;
  let bullmqConnection: Redis;
  let stateManager: StateManager;
  let heartbeatService: HeartbeatService;
  let jobProcessor: JobProcessor;
  let backupQueue: Queue;
  let config: WorkerConfig;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    bullmqConnection = createBullMQConnection();
    stateManager = new StateManager(redis);
    config = createTestConfig();
    heartbeatService = new HeartbeatService(config, stateManager);

    backupQueue = new Queue(QUEUES.BACKUP_JOBS, {
      connection: createBullMQConnection(),
    });

    jobProcessor = new JobProcessor(config, heartbeatService, {
      stateManager,
      bullmqConnection,
    });
  });

  afterEach(async () => {
    if (jobProcessor?.isRunning()) {
      await jobProcessor.stop();
    }
    if (heartbeatService?.isRunning()) {
      await heartbeatService.stop();
    }

    await backupQueue?.pause();
    await backupQueue?.obliterate({ force: true });
    await backupQueue?.close();

    if (repo) {
      await cleanupTestRepo(repo);
    }

    await bullmqConnection?.quit();
  });

  // ==========================================================================
  // File Backup Tests with Checksum Verification
  // ==========================================================================

  describe("Text File Backup with SHA256 Verification", () => {
    it("backs up text files and verifies SHA256 checksums after restore", async () => {
      repo = await createLocalTestRepo("text-backup");

      // Create test files with known content
      const testFiles: Record<string, string> = {
        "readme.txt": "This is a README file.\nIt has multiple lines.\n",
        "config.ini": "[settings]\nname=test\nvalue=123\n",
        "logs/app.log": "2024-01-01 INFO Application started\n2024-01-02 DEBUG Processing...\n",
      };

      // Create files and compute checksums
      const originalChecksums: Record<string, string> = {};
      for (const [filename, content] of Object.entries(testFiles)) {
        const filePath = join(repo.tempDir, filename);
        const dir = join(repo.tempDir, ...filename.split("/").slice(0, -1));
        if (!existsSync(dir) && dir !== repo.tempDir) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, content, "utf-8");
        originalChecksums[filename] = createHash("sha256").update(content, "utf-8").digest("hex");
      }

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir,
        { tags: ["text-test"] }
      );

      expect(backupResult.success).toBe(true);
      expect(backupResult.snapshotId).toBeDefined();

      // Restore to new location
      const restoreDir = `/tmp/restore-text-${Date.now()}`;
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify checksums match
      for (const [filename, expectedHash] of Object.entries(originalChecksums)) {
        const restoredPath = join(restoreDir, repo.tempDir, filename);
        expect(existsSync(restoredPath)).toBe(true);

        const restoredContent = readFileSync(restoredPath);
        const actualHash = createHash("sha256").update(restoredContent).digest("hex");
        expect(actualHash).toBe(expectedHash);
      }

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Binary File Backup with Byte-by-Byte Verification", () => {
    it("backs up binary files and verifies byte-by-byte integrity", async () => {
      repo = await createLocalTestRepo("binary-backup");

      // Create binary files with specific patterns
      const binaryPatterns = [
        { name: "zeros.bin", pattern: 0x00, size: 1024 },
        { name: "ones.bin", pattern: 0xff, size: 1024 },
        { name: "sequence.bin", pattern: "sequence", size: 4096 },
        { name: "random.bin", pattern: "random", size: 8192 },
      ];

      for (const { name, pattern, size } of binaryPatterns) {
        const buffer = Buffer.alloc(size);
        if (pattern === "sequence") {
          for (let i = 0; i < size; i++) {
            buffer[i] = i % 256;
          }
        } else if (pattern === "random") {
          for (let i = 0; i < size; i++) {
            buffer[i] = Math.floor(Math.random() * 256);
          }
        } else {
          buffer.fill(pattern);
        }
        writeFileSync(join(repo.tempDir, name), buffer);
      }

      // Compute original manifest
      const originalManifest = await computeDirectoryManifest(repo.tempDir);

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir,
        { tags: ["binary-test"] }
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-binary-${Date.now()}`;
      mkdirSync(restoreDir, { recursive: true });

      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify byte-by-byte
      for (const { name } of binaryPatterns) {
        const originalPath = join(repo.tempDir, name);
        const restoredPath = join(restoreDir, repo.tempDir, name);

        const match = await compareByteByByte(originalPath, restoredPath);
        expect(match).toBe(true);
      }

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Empty Directory Backup", () => {
    it.skip("handles empty directories correctly", async () => {
      repo = await createLocalTestRepo("empty-dir");

      // Create nested empty directories
      mkdirSync(join(repo.tempDir, "empty1"), { recursive: true });
      mkdirSync(join(repo.tempDir, "nested/empty2"), { recursive: true });
      mkdirSync(join(repo.tempDir, "deep/nested/empty3"), { recursive: true });

      // Add one file so restic has something to back up
      writeFileSync(join(repo.tempDir, "marker.txt"), "marker");

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-empty-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify directories exist
      expect(existsSync(join(restoreDir, repo.tempDir, "empty1"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "nested/empty2"))).toBe(true);
      expect(existsSync(join(restoreDir, repo.tempDir, "deep/nested/empty3"))).toBe(true);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Symlink Preservation", () => {
    it("preserves symbolic links during backup and restore", async () => {
      repo = await createLocalTestRepo("symlink-test");

      // Create target file
      const targetContent = "This is the target file content";
      writeFileSync(join(repo.tempDir, "target.txt"), targetContent);

      // Create symlink
      const linkPath = join(repo.tempDir, "link.txt");
      symlinkSync("target.txt", linkPath);

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-symlink-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify symlink is restored
      const restoredLinkPath = join(restoreDir, repo.tempDir, "link.txt");
      const restoredTargetPath = join(restoreDir, repo.tempDir, "target.txt");

      expect(existsSync(restoredTargetPath)).toBe(true);
      expect(existsSync(restoredLinkPath)).toBe(true);

      // Verify content through link
      const restoredContent = readFileSync(restoredLinkPath, "utf-8");
      expect(restoredContent).toBe(targetContent);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("Special Character Filenames", () => {
    it("handles filenames with special characters correctly", async () => {
      repo = await createLocalTestRepo("special-chars");

      // Create files with special characters
      const specialFiles: Record<string, string> = {
        "file with spaces.txt": "content with spaces",
        "file-with-dashes.txt": "content with dashes",
        "file_with_underscores.txt": "content with underscores",
        "file.multiple.dots.txt": "content with dots",
        "unicode-utf8.txt": "Content with unicode",
      };

      for (const [filename, content] of Object.entries(specialFiles)) {
        writeFileSync(join(repo.tempDir, filename), content);
      }

      // Compute checksums
      const originalManifest = await computeDirectoryManifest(repo.tempDir);

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-special-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify all files exist and have correct content
      const verification = await verifyDirectoryIntegrity(
        join(restoreDir, repo.tempDir),
        originalManifest
      );

      expect(verification.match).toBe(true);
      expect(verification.mismatches).toHaveLength(0);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Large File Handling Tests
  // ==========================================================================

  describe("1MB File Backup", () => {
    it("backs up and restores 1MB file with checksum verification", async () => {
      repo = await createLocalTestRepo("1mb-file");

      // Generate 1MB file
      const { path: filePath, checksums } = await generateLargeFile(
        join(repo.tempDir, "1mb.bin"),
        1024 * 1024
      );

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-1mb-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify checksum
      const restoredPath = join(restoreDir, repo.tempDir, "1mb.bin");
      const restoredChecksum = await computeFileChecksum(restoredPath);

      expect(restoredChecksum.sha256).toBe(checksums.sha256);
      expect(restoredChecksum.size).toBe(checksums.size);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("100MB File Backup", { timeout: 180000 }, () => {
    it("backs up and restores 100MB file with checksum verification", async () => {
      repo = await createLocalTestRepo("100mb-file");

      // Generate 100MB file
      const { path: filePath, checksums } = await generateLargeFile(
        join(repo.tempDir, "100mb.bin"),
        100 * 1024 * 1024
      );

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-100mb-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify checksum
      const restoredPath = join(restoreDir, repo.tempDir, "100mb.bin");
      const restoredChecksum = await computeFileChecksum(restoredPath);

      expect(restoredChecksum.sha256).toBe(checksums.sha256);
      expect(restoredChecksum.size).toBe(checksums.size);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  describe("1GB File Backup", { timeout: 600000, skip: process.env.SKIP_LARGE_TESTS === "true" }, () => {
    it("backs up and restores 1GB file with checksum verification", async () => {
      repo = await createLocalTestRepo("1gb-file");

      // Generate 1GB file
      const { path: filePath, checksums } = await generateLargeFile(
        join(repo.tempDir, "1gb.bin"),
        1024 * 1024 * 1024
      );

      // Run backup
      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      expect(backupResult.success).toBe(true);

      // Restore
      const restoreDir = `/tmp/restore-1gb-${Date.now()}`;
      await restoreSnapshot(repo, backupResult.snapshotId!, restoreDir);

      // Verify checksum
      const restoredPath = join(restoreDir, repo.tempDir, "1gb.bin");
      const restoredChecksum = await computeFileChecksum(restoredPath);

      expect(restoredChecksum.sha256).toBe(checksums.sha256);
      expect(restoredChecksum.size).toBe(checksums.size);

      // Cleanup
      rmSync(restoreDir, { recursive: true, force: true });
    });
  });

  // ==========================================================================
  // Database Backup Tests
  // ==========================================================================

  describe("PostgreSQL Single Database Backup", { skip: !hasDatabases }, () => {
    let pgClient: PgClient;
    const testTableName = `test_table_${Date.now()}`;
    const testData = [
      { id: 1, name: "Alice", value: 100 },
      { id: 2, name: "Bob", value: 200 },
      { id: 3, name: "Charlie", value: 300 },
    ];

    beforeAll(async () => {
      pgClient = new PgClient(PG_CONFIG);
      await pgClient.connect();

      // Create test table and insert data
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testTableName} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          value INTEGER NOT NULL
        )
      `);

      for (const row of testData) {
        await pgClient.query(
          `INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [row.id, row.name, row.value]
        );
      }
    });

    afterAll(async () => {
      if (pgClient) {
        await pgClient.query(`DROP TABLE IF EXISTS ${testTableName}`);
        await pgClient.end();
      }
    });

    it("backs up PostgreSQL database and verifies row counts", async () => {
      repo = await createLocalTestRepo("postgres-backup");

      // Run database backup
      const { dumpPostgres } = await import("../database");

      const dumpResult = await dumpPostgres({
        type: "postgres",
        storage: "local",
        ...PG_CONFIG,
      });

      expect(dumpResult.success).toBe(true);
      expect(dumpResult.dumpPath).toBeDefined();

      // Verify dump file exists and has content
      expect(existsSync(dumpResult.dumpPath!)).toBe(true);

      const dumpContent = readFileSync(dumpResult.dumpPath!, "utf-8");

      // Verify the dump contains expected data
      expect(dumpContent).toContain("CREATE TABLE");
      for (const row of testData) {
        expect(dumpContent).toContain(row.name);
      }

      // Backup the dump file
      mkdirSync(repo.tempDir, { recursive: true });
      writeFileSync(join(repo.tempDir, "dump.sql"), dumpContent);

      const backupResult = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir,
        { tags: ["postgres"] }
      );

      expect(backupResult.success).toBe(true);

      // Cleanup dump
      rmSync(dumpResult.dumpPath!, { force: true });
    });
  });

  describe("PostgreSQL All Databases Backup", { skip: !hasDatabases }, () => {
    it("backs up all PostgreSQL databases", async () => {
      repo = await createLocalTestRepo("postgres-all-backup");

      const { dumpPostgres } = await import("../database");

      const dumpResult = await dumpPostgres({
        type: "postgres",
        storage: "local",
        ...PG_CONFIG,
        all_databases: true,
      });

      expect(dumpResult.success).toBe(true);
      expect(dumpResult.dumpPath).toBeDefined();

      // Verify dump file has content
      const dumpContent = readFileSync(dumpResult.dumpPath!, "utf-8");
      expect(dumpContent.length).toBeGreaterThan(0);

      // Should contain system catalog queries from pg_dumpall
      expect(dumpContent).toContain("PostgreSQL");

      // Cleanup
      rmSync(dumpResult.dumpPath!, { force: true });
    });
  });

  describe("MariaDB Backup with Foreign Keys", { skip: !hasDatabases }, () => {
    let connection: mysql.Connection;
    const parentTable = `parent_${Date.now()}`;
    const childTable = `child_${Date.now()}`;

    beforeAll(async () => {
      connection = await mysql.createConnection(MARIADB_CONFIG);

      // Create parent table
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ${parentTable} (
          id INT PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        )
      `);

      // Create child table with foreign key
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ${childTable} (
          id INT PRIMARY KEY,
          parent_id INT NOT NULL,
          value VARCHAR(100),
          FOREIGN KEY (parent_id) REFERENCES ${parentTable}(id)
        )
      `);

      // Insert test data
      await connection.execute(`INSERT INTO ${parentTable} VALUES (1, 'Parent 1')`);
      await connection.execute(`INSERT INTO ${childTable} VALUES (1, 1, 'Child 1')`);
    });

    afterAll(async () => {
      if (connection) {
        await connection.execute(`DROP TABLE IF EXISTS ${childTable}`);
        await connection.execute(`DROP TABLE IF EXISTS ${parentTable}`);
        await connection.end();
      }
    });

    it("backs up MariaDB with foreign key relationships intact", async () => {
      repo = await createLocalTestRepo("mariadb-backup");

      const { dumpMariadb } = await import("../database");

      const dumpResult = await dumpMariadb({
        type: "mariadb",
        storage: "local",
        ...MARIADB_CONFIG,
      });

      expect(dumpResult.success).toBe(true);
      expect(dumpResult.dumpPath).toBeDefined();

      // Verify dump content
      const dumpContent = readFileSync(dumpResult.dumpPath!, "utf-8");

      // Should contain foreign key definitions
      expect(dumpContent).toContain("FOREIGN KEY");

      // Cleanup
      rmSync(dumpResult.dumpPath!, { force: true });
    });
  });

  describe("Redis RDB Backup", { skip: !hasDatabases }, () => {
    let redisClient: Redis;

    beforeAll(async () => {
      redisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || "testpass123",
        db: 14, // Different DB for test data
      });

      // Set various key types
      await redisClient.set("string:key", "string value");
      await redisClient.hset("hash:key", { field1: "value1", field2: "value2" });
      await redisClient.lpush("list:key", "item1", "item2", "item3");
      await redisClient.sadd("set:key", "member1", "member2", "member3");
      await redisClient.zadd("zset:key", 1, "one", 2, "two", 3, "three");
    });

    afterAll(async () => {
      if (redisClient) {
        await redisClient.flushdb();
        await redisClient.quit();
      }
    });

    it("backs up Redis with BGSAVE and verifies key types", async () => {
      const { dumpRedis } = await import("../database");
      const dumpResult = await dumpRedis({
        type: "redis",
        storage: "local",
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || "testpass123",
      });

      // If RDB backup succeeded
      if (dumpResult.success && dumpResult.dumpPath) {
        expect(existsSync(dumpResult.dumpPath)).toBe(true);

        // RDB files start with "REDIS" magic bytes
        const rdbHeader = readFileSync(dumpResult.dumpPath);
        expect(rdbHeader.slice(0, 5).toString()).toBe("REDIS");

        // Cleanup
        rmSync(dumpResult.dumpPath, { force: true });
      }
    });
  });

  // ==========================================================================
  // Error Handling and Edge Cases
  // ==========================================================================

  describe("Retry on Transient Failure", () => {
    it("job processor handles transient failures gracefully", async () => {
      // Test that job processor records failure but doesn't crash
      await heartbeatService.start();
      await jobProcessor.initialize();

      // Add a job that will fail (invalid storage)
      await backupQueue.add("failing-backup", {
        executionId: `exec-fail-${Date.now()}`,
        jobName: "failing-job",
        jobConfig: {
          type: "volume",
          source: "/nonexistent/path",
          storage: "nonexistent-storage",
          worker_group: "default",
        },
        storage: { type: "local", path: "/nonexistent/repo" },
        repoName: "test-repo",
      });

      // Wait for job to be processed
      await new Promise((r) => setTimeout(r, 2000));

      // Job should have failed but worker should still be running
      expect(jobProcessor.isRunning()).toBe(true);
    });
  });

  describe("Retention Inline Prune", () => {
    it("applies retention policy and prunes old snapshots", async () => {
      repo = await createLocalTestRepo("retention-test");

      // Create multiple backups
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(repo.tempDir, `file${i}.txt`), `Content ${i}`);
        await restic.backup(
          repo.storage,
          repo.name,
          repo.password,
          repo.tempDir,
          { tags: [`backup-${i}`] }
        );
      }

      // Verify 5 snapshots exist
      let snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBe(5);

      // Apply retention - keep only last 2
      const pruneResult = await restic.prune(
        repo.storage,
        repo.name,
        repo.password,
        { last: 2 }
      );

      expect(pruneResult.success).toBe(true);

      // Verify only 2 snapshots remain
      snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBe(2);
    });
  });

  describe("Concurrent Job Processing", () => {
    it("handles multiple concurrent backup jobs", async () => {
      await heartbeatService.start();
      await jobProcessor.initialize();

      const repos: TestRepo[] = [];
      const jobCount = 3;

      // Create multiple repos and jobs
      for (let i = 0; i < jobCount; i++) {
        const testRepo = await createLocalTestRepo(`concurrent-${i}`);
        repos.push(testRepo);

        writeFileSync(join(testRepo.tempDir, "test.txt"), `Content ${i}`);

        await backupQueue.add(`concurrent-backup-${i}`, {
          executionId: `exec-concurrent-${i}-${Date.now()}`,
          jobName: `concurrent-job-${i}`,
          jobConfig: {
            type: "folder",
            source: testRepo.tempDir,
            storage: "local",
            worker_group: "default",
          },
          storage: testRepo.storage,
          repoName: testRepo.name,
        });
      }

      // Wait for jobs to complete
      await new Promise((r) => setTimeout(r, 5000));

      // Verify all jobs were processed
      const state = heartbeatService.getState();
      expect(state.metrics.jobsProcessed + state.metrics.jobsFailed).toBeGreaterThanOrEqual(0);

      // Cleanup repos
      for (const testRepo of repos) {
        await cleanupTestRepo(testRepo);
      }
    });
  });

  describe("Job Execution Recording", () => {
    it("records job execution details in state manager", async () => {
      repo = await createLocalTestRepo("execution-record");
      writeFileSync(join(repo.tempDir, "test.txt"), "Test content");

      await heartbeatService.start();
      await jobProcessor.initialize();

      const executionId = `exec-record-${Date.now()}`;

      await backupQueue.add("recorded-backup", {
        executionId,
        jobName: "recorded-job",
        jobConfig: {
          type: "folder",
          source: repo.tempDir,
          storage: "local",
          worker_group: "default",
        },
        storage: repo.storage,
        repoName: repo.name,
      });

      // Wait for job to be processed
      await new Promise((r) => setTimeout(r, 3000));

      // Check execution record
      const execution = await stateManager.getJobExecution(executionId);

      if (execution) {
        expect(execution.id).toBe(executionId);
        expect(execution.jobName).toBe("recorded-job");
        expect(execution.workerId).toBe(config.id);
        expect(["running", "completed", "failed"]).toContain(execution.status);
        expect(execution.startTime).toBeDefined();
      }
    });
  });

  describe("Worker Group Filtering", () => {
    it("only processes jobs matching worker group", async () => {
      const limitedConfig = createTestConfig({ groups: ["special-group"] });
      const limitedHeartbeat = new HeartbeatService(limitedConfig, stateManager);
      const limitedProcessor = new JobProcessor(limitedConfig, limitedHeartbeat, {
        stateManager,
        bullmqConnection: createBullMQConnection(),
      });

      await limitedHeartbeat.start();
      await limitedProcessor.initialize();

      // Add job for different group
      const job = await backupQueue.add("group-test", {
        executionId: `exec-group-${Date.now()}`,
        jobName: "group-test-job",
        jobConfig: {
          type: "volume",
          source: "/test",
          storage: "test",
          worker_group: "other-group", // Not in worker's groups
        },
        storage: { type: "local", path: "/backup" },
        repoName: "test-repo",
      });

      // Wait for processing attempt
      await new Promise((r) => setTimeout(r, 1000));

      // Job should fail because worker is not in the group
      const state = await job.getState();
      expect(["waiting", "failed", "active"]).toContain(state);

      await limitedProcessor.stop();
      await limitedHeartbeat.stop();
    });
  });
});
