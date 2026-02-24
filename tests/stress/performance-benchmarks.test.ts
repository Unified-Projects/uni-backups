/**
 * Performance Benchmark Tests
 *
 * Tests that measure performance of key operations:
 * - Restic backup/restore/prune operations
 * - Redis state management operations
 * - BullMQ queue operations
 *
 * These tests verify that operations complete within acceptable time limits
 * under normal conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "fs";
import { execSync } from "child_process";
import Redis from "ioredis";
import { Queue } from "bullmq";
import {
  createLocalTestRepo,
  cleanupTestRepo,
  createTestBackup,
  createRandomFile,
  listTestSnapshots,
  type TestRepo,
} from "../utils/restic-helpers";
import {
  createTestRedis,
  createBullMQConnection,
  TEST_CONFIG,
  generateTestId,
} from "../utils/test-services";
import * as restic from "../../apps/api/src/services/restic";

// Check if restic is available
function checkResticAvailable(): boolean {
  try {
    execSync("which restic", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasRestic = checkResticAvailable();
const hasRedis = !!process.env.REDIS_HOST || process.env.RUNNING_IN_DOCKER === "true";

describe("Performance Benchmarks", { timeout: 120000 }, () => {
  describe("Restic Operations", { skip: !hasRestic }, () => {
    let repo: TestRepo;

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("Backup 1MB file completes under 10s", async () => {
      // Create test repo
      repo = await createLocalTestRepo("perf-backup");

      // Generate 1MB test data
      const startSetup = Date.now();
      createRandomFile(repo, "large-file.bin", 1024 * 1024);
      const setupDuration = Date.now() - startSetup;
      console.log(`Setup (1MB file generation) took ${setupDuration}ms`);

      // Time the backup operation
      const startBackup = Date.now();
      const result = await restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir,
        { tags: ["perf-test"] }
      );
      const backupDuration = Date.now() - startBackup;

      console.log(`Backup operation took ${backupDuration}ms`);

      // Assert success and duration
      expect(result.success).toBe(true);
      expect(result.snapshotId).toBeDefined();
      expect(backupDuration).toBeLessThan(10000);
    });

    it("List 20 snapshots completes under 5s", async () => {
      // Create test repo
      repo = await createLocalTestRepo("perf-list");

      // Create 20 sequential backups (small data)
      const startSetup = Date.now();
      for (let i = 0; i < 20; i++) {
        await createTestBackup(repo, {
          [`file-${i}.txt`]: `Content for backup ${i}`,
        });
      }
      const setupDuration = Date.now() - startSetup;
      console.log(`Setup (20 backups) took ${setupDuration}ms`);

      // Time listSnapshots operation
      const startList = Date.now();
      const snapshots = await listTestSnapshots(repo);
      const listDuration = Date.now() - startList;

      console.log(`List operation took ${listDuration}ms`);

      // Assert success and duration
      expect(snapshots).toHaveLength(20);
      expect(listDuration).toBeLessThan(5000);
    });

    it("Prune operation completes under 30s", async () => {
      // Create test repo with 10 snapshots
      repo = await createLocalTestRepo("perf-prune");

      const startSetup = Date.now();
      for (let i = 0; i < 10; i++) {
        await createTestBackup(repo, {
          [`data-${i}.txt`]: `Data for snapshot ${i}`,
        });
      }
      const setupDuration = Date.now() - startSetup;
      console.log(`Setup (10 backups) took ${setupDuration}ms`);

      // Verify we have 10 snapshots
      const snapshotsBefore = await listTestSnapshots(repo);
      expect(snapshotsBefore).toHaveLength(10);

      // Time prune (keep last 3) operation
      const startPrune = Date.now();
      const pruneResult = await restic.prune(
        repo.storage,
        repo.name,
        repo.password,
        { last: 3 }
      );
      const pruneDuration = Date.now() - startPrune;

      console.log(`Prune operation took ${pruneDuration}ms`);

      // Assert success and duration
      expect(pruneResult.success).toBe(true);
      expect(pruneDuration).toBeLessThan(30000);

      // Verify snapshots were pruned
      const snapshotsAfter = await listTestSnapshots(repo);
      expect(snapshotsAfter.length).toBeLessThanOrEqual(3);
    });
  });

  describe("Redis Operations", { skip: !hasRedis }, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = createTestRedis();
      await redis.ping();
      await redis.flushdb();
    });

    afterEach(async () => {
      if (redis) {
        await redis.quit();
      }
    });

    it("1000 Redis state writes complete under 5s", async () => {
      const keyPrefix = `perf-write-${generateTestId()}`;
      const iterations = 1000;

      // Time 1000 sequential HSET operations
      const startWrite = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redis.hset(`${keyPrefix}:${i}`, {
          id: `job-${i}`,
          status: "completed",
          timestamp: Date.now().toString(),
          data: JSON.stringify({ iteration: i }),
        });
      }
      const writeDuration = Date.now() - startWrite;

      console.log(`1000 Redis writes took ${writeDuration}ms (${(writeDuration / iterations).toFixed(2)}ms per write)`);

      // Assert total duration
      expect(writeDuration).toBeLessThan(5000);

      // Verify data was written
      const exists = await redis.exists(`${keyPrefix}:0`, `${keyPrefix}:999`);
      expect(exists).toBeGreaterThanOrEqual(2);

      // Clean up
      const keys = await redis.keys(`${keyPrefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });

    it("100 Redis state reads complete under 2s", async () => {
      const keyPrefix = `perf-read-${generateTestId()}`;
      const iterations = 100;

      // Write test data to Redis
      const startSetup = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redis.hset(`${keyPrefix}:${i}`, {
          id: `job-${i}`,
          status: "completed",
          timestamp: Date.now().toString(),
          result: JSON.stringify({ data: `result-${i}` }),
        });
      }
      const setupDuration = Date.now() - startSetup;
      console.log(`Setup (100 writes) took ${setupDuration}ms`);

      // Time 100 sequential HGETALL operations
      const startRead = Date.now();
      const results = [];
      for (let i = 0; i < iterations; i++) {
        const data = await redis.hgetall(`${keyPrefix}:${i}`);
        results.push(data);
      }
      const readDuration = Date.now() - startRead;

      console.log(`100 Redis reads took ${readDuration}ms (${(readDuration / iterations).toFixed(2)}ms per read)`);

      // Assert total duration
      expect(readDuration).toBeLessThan(2000);

      // Verify data was read correctly
      expect(results).toHaveLength(iterations);
      expect(results[0].id).toBe("job-0");
      expect(results[99].id).toBe("job-99");

      // Clean up
      const keys = await redis.keys(`${keyPrefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });
  });

  describe("Queue Operations", { skip: !hasRedis }, () => {
    let connection: Redis;
    let queue: Queue;

    beforeEach(async () => {
      connection = createBullMQConnection();
      const queueName = `perf-queue-${generateTestId()}`;
      queue = new Queue(queueName, { connection });
    });

    afterEach(async () => {
      if (queue) {
        await queue.pause();
        await queue.obliterate({ force: true });
        await queue.close();
      }
      if (connection) {
        await connection.quit();
      }
    });

    it("100 BullMQ queue additions complete under 3s", async () => {
      const iterations = 100;

      // Time adding 100 jobs
      const startAdd = Date.now();
      const jobs = [];
      for (let i = 0; i < iterations; i++) {
        const job = await queue.add(
          "perf-test-job",
          {
            iteration: i,
            timestamp: Date.now(),
            data: `test-data-${i}`,
          },
          {
            removeOnComplete: true,
            removeOnFail: false,
          }
        );
        jobs.push(job);
      }
      const addDuration = Date.now() - startAdd;

      console.log(`100 queue additions took ${addDuration}ms (${(addDuration / iterations).toFixed(2)}ms per job)`);

      // Assert total duration
      expect(addDuration).toBeLessThan(3000);

      // Verify jobs were added
      expect(jobs).toHaveLength(iterations);
      expect(jobs[0].id).toBeDefined();
      expect(jobs[99].id).toBeDefined();

      // Verify queue count
      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).toBe(iterations);
    });
  });
});
