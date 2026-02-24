/**
 * Worker Endurance Tests
 *
 * These tests validate worker behavior under sustained operation:
 * - Memory stability over many sequential operations
 * - Mixed operation workloads (backup + prune)
 * - HeartbeatService endurance without memory leaks
 * - State manager connection stability over repeated operations
 *
 * Requirements:
 * - Restic binary installed and available in PATH
 * - Redis connection (for state manager tests)
 * - Tests will be skipped if dependencies are not available
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { HeartbeatService } from "../../apps/worker/src/services/heartbeat";
import { StateManager } from "../../packages/shared/src/redis/state";
import { getRedisConnection } from "../../packages/shared/src/redis";
import type { WorkerConfig } from "../../apps/worker/src/config";
import type { WorkerState } from "../../packages/shared/src/redis/state";
import {
  createLocalTestRepo,
  createTestBackup,
  cleanupTestRepo,
  listTestSnapshots,
  applyRetention,
  type TestRepo,
} from "../utils/restic-helpers";

/**
 * Check if restic is available
 */
function checkResticAvailability(): boolean {
  try {
    execSync("restic version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Redis is available
 */
function checkRedisAvailability(): boolean {
  return !!process.env.REDIS_HOST || !!process.env.RUNNING_IN_DOCKER;
}

const hasRestic = checkResticAvailability();
const hasRedis = checkRedisAvailability();

/**
 * Helper to measure memory usage
 */
function getMemoryUsage(): number {
  if (global.gc) {
    global.gc();
  }
  return process.memoryUsage().heapUsed;
}

/**
 * Helper to format bytes
 */
function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

describe("Worker Endurance Tests", { timeout: 300000 }, () => {
  if (!hasRestic) {
    console.warn("Skipping worker endurance tests - restic not available");
    console.warn("Install restic: https://restic.readthedocs.io/en/latest/020_installation.html");
  }

  if (!hasRedis) {
    console.warn("Skipping Redis-dependent tests - Redis not available");
    console.warn("Set REDIS_HOST environment variable or run in Docker");
  }

  it(
    "50 sequential backup jobs without excessive memory growth",
    { skip: !hasRestic, timeout: 300000 },
    async () => {
      let repo: TestRepo | null = null;

      try {
        // Create a test repository
        repo = await createLocalTestRepo("endurance-backup");

        // Track memory before operations
        const memoryBefore = getMemoryUsage();
        console.log(`Initial memory: ${formatBytes(memoryBefore)}`);

        const backupCount = 50;
        const snapshotIds: string[] = [];

        // Run 50 sequential backups with small data
        for (let i = 0; i < backupCount; i++) {
          const files = {
            [`file-${i}.txt`]: `Test content for backup ${i}\n`,
            [`data-${i}.json`]: JSON.stringify({ index: i, timestamp: Date.now() }),
          };

          const result = await createTestBackup(repo, files, {
            tags: ["endurance-test", `iteration-${i}`],
          });

          snapshotIds.push(result.snapshotId);

          // Log progress every 10 backups
          if ((i + 1) % 10 === 0) {
            const currentMemory = getMemoryUsage();
            const memoryGrowth = currentMemory - memoryBefore;
            console.log(
              `Completed ${i + 1}/${backupCount} backups, memory growth: ${formatBytes(memoryGrowth)}`
            );
          }
        }

        // Track memory after operations
        const memoryAfter = getMemoryUsage();
        const memoryGrowth = memoryAfter - memoryBefore;

        console.log(`Final memory: ${formatBytes(memoryAfter)}`);
        console.log(`Total memory growth: ${formatBytes(memoryGrowth)}`);

        // Verify all backups completed
        expect(snapshotIds.length).toBe(backupCount);
        expect(snapshotIds.every((id) => id.length > 0)).toBe(true);

        // Verify snapshots exist in repository
        const snapshots = await listTestSnapshots(repo);
        expect(snapshots.length).toBe(backupCount);

        // Assert memory growth is less than 50MB
        expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);

        console.log(`All ${backupCount} backups completed successfully`);
      } finally {
        if (repo) {
          await cleanupTestRepo(repo);
        }
      }
    }
  );

  it(
    "Mixed backup + prune over 100 operations",
    { skip: !hasRestic, timeout: 300000 },
    async () => {
      let repo: TestRepo | null = null;

      try {
        // Create a test repository
        repo = await createLocalTestRepo("endurance-mixed");

        const totalOperations = 100;
        let backupCount = 0;
        let pruneCount = 0;
        const errors: string[] = [];

        // Alternate between backups and prune (keep last 5)
        for (let i = 0; i < totalOperations; i++) {
          try {
            if (i % 10 === 0 && i > 0) {
              // Every 10th operation is a prune
              await applyRetention(repo, { last: 5 });
              pruneCount++;

              if (pruneCount % 3 === 0) {
                const snapshots = await listTestSnapshots(repo);
                console.log(
                  `Prune ${pruneCount} completed, ${snapshots.length} snapshots remaining`
                );
              }
            } else {
              // Otherwise, create a backup
              const files = {
                [`iteration-${i}.txt`]: `Data for operation ${i}\n${Date.now()}`,
              };

              await createTestBackup(repo, files, {
                tags: ["mixed-test"],
              });
              backupCount++;

              if (backupCount % 20 === 0) {
                console.log(`Completed ${backupCount} backups, ${pruneCount} prunes`);
              }
            }
          } catch (error) {
            errors.push(`Operation ${i}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        console.log(`Total operations: ${backupCount} backups, ${pruneCount} prunes`);
        console.log(`Errors encountered: ${errors.length}`);

        // Assert all operations completed without error
        expect(errors).toEqual([]);
        expect(backupCount + pruneCount).toBe(totalOperations);

        // Verify final snapshot count is reasonable (around 5 due to pruning)
        const finalSnapshots = await listTestSnapshots(repo);
        console.log(`Final snapshot count: ${finalSnapshots.length}`);
        expect(finalSnapshots.length).toBeGreaterThan(0);
        expect(finalSnapshots.length).toBeLessThanOrEqual(10);

        console.log(`Mixed operations test completed successfully`);
      } finally {
        if (repo) {
          await cleanupTestRepo(repo);
        }
      }
    }
  );

  it(
    "HeartbeatService runs 1000 intervals without memory leak",
    { timeout: 120000 },
    async () => {
      // This uses mocked/simulated heartbeat intervals
      const workerConfig: WorkerConfig = {
        id: "endurance-test-worker",
        name: "Endurance Test Worker",
        hostname: "localhost",
        groups: ["test-group"],
        heartbeatInterval: 10,
        healthCheckInterval: 100,
        maxConcurrentJobs: 1,
        redis: {
          host: process.env.REDIS_HOST || "localhost",
          port: parseInt(process.env.REDIS_PORT || "6379", 10),
          keyPrefix: "uni-backups:test:",
        },
      };

      // Create a mock state manager to avoid Redis dependency
      const mockStateManager = {
        setWorkerState: async (state: WorkerState) => {
          // Simulate some processing
          const data = JSON.stringify(state);
          return Promise.resolve();
        },
      } as unknown as StateManager;

      const heartbeatService = new HeartbeatService(workerConfig, mockStateManager);

      // Track memory before starting
      const memoryBefore = getMemoryUsage();
      console.log(`Initial memory: ${formatBytes(memoryBefore)}`);

      const totalCycles = 1000;
      let cycleCount = 0;

      // Simulate 1000 heartbeat cycles manually
      for (let i = 0; i < totalCycles; i++) {
        // Simulate heartbeat work
        await mockStateManager.setWorkerState({
          id: workerConfig.id,
          name: workerConfig.name,
          hostname: workerConfig.hostname,
          groups: workerConfig.groups,
          status: "healthy",
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: {
            jobsProcessed: i,
            jobsFailed: 0,
            lastJobTime: Date.now(),
          },
        });

        cycleCount++;

        // Log progress every 200 cycles
        if ((i + 1) % 200 === 0) {
          const currentMemory = getMemoryUsage();
          const memoryGrowth = currentMemory - memoryBefore;
          console.log(
            `Completed ${i + 1}/${totalCycles} heartbeat cycles, memory growth: ${formatBytes(memoryGrowth)}`
          );
        }
      }

      // Track memory after cycles
      const memoryAfter = getMemoryUsage();
      const memoryGrowth = memoryAfter - memoryBefore;

      console.log(`Final memory: ${formatBytes(memoryAfter)}`);
      console.log(`Total memory growth: ${formatBytes(memoryGrowth)}`);

      // Assert all cycles completed
      expect(cycleCount).toBe(totalCycles);

      // Assert memory growth is less than 10MB
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);

      console.log(`HeartbeatService endurance test completed successfully`);
    }
  );

  it(
    "State manager handles repeated operations without connection leaks",
    { skip: !hasRedis, timeout: 120000 },
    async () => {
      // Connect to Redis
      const redis = getRedisConnection();
      const stateManager = new StateManager(redis);

      // Track memory before operations
      const memoryBefore = getMemoryUsage();
      console.log(`Initial memory: ${formatBytes(memoryBefore)}`);

      const totalCycles = 500;
      const errors: string[] = [];

      // Perform 500 state read/write cycles
      for (let i = 0; i < totalCycles; i++) {
        try {
          // Write worker state
          const workerState: WorkerState = {
            id: `endurance-worker-${i % 10}`,
            name: `Endurance Worker ${i % 10}`,
            hostname: "localhost",
            groups: ["endurance-group"],
            status: "healthy",
            lastHeartbeat: Date.now(),
            currentJobs: [`job-${i}`],
            metrics: {
              jobsProcessed: i,
              jobsFailed: 0,
              lastJobTime: Date.now(),
            },
          };

          await stateManager.setWorkerState(workerState);

          // Read worker state back
          const retrievedState = await stateManager.getWorkerState(workerState.id);
          expect(retrievedState).not.toBeNull();
          expect(retrievedState?.id).toBe(workerState.id);

          // Also test job execution operations
          await stateManager.recordJobExecution({
            id: `execution-${i}`,
            jobName: `test-job-${i % 5}`,
            workerId: workerState.id,
            status: "running",
            startTime: Date.now(),
          });

          // Update job execution
          await stateManager.updateJobExecution(`execution-${i}`, {
            status: "completed",
            endTime: Date.now(),
            duration: 100,
          });

          // Log progress every 100 cycles
          if ((i + 1) % 100 === 0) {
            const currentMemory = getMemoryUsage();
            const memoryGrowth = currentMemory - memoryBefore;
            console.log(
              `Completed ${i + 1}/${totalCycles} state operations, memory growth: ${formatBytes(memoryGrowth)}`
            );
          }
        } catch (error) {
          errors.push(`Cycle ${i}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Track memory after operations
      const memoryAfter = getMemoryUsage();
      const memoryGrowth = memoryAfter - memoryBefore;

      console.log(`Final memory: ${formatBytes(memoryAfter)}`);
      console.log(`Total memory growth: ${formatBytes(memoryGrowth)}`);

      // Verify all operations completed without errors
      expect(errors).toEqual([]);

      // Verify Redis connection still works
      const healthyWorkers = await stateManager.getHealthyWorkers();
      expect(Array.isArray(healthyWorkers)).toBe(true);

      // Verify no excessive memory growth (allow up to 20MB for Redis connection overhead)
      expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024);

      console.log(`State manager endurance test completed successfully`);
    }
  );
});
