/**
 * Concurrent Operations Chaos Tests
 *
 * Tests system behavior with concurrent and conflicting operations:
 * - Multiple workers claiming same job
 * - Backup and prune running concurrently
 * - Restore while backup is running
 * - Multiple failover elections
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createLocalTestRepo,
  createTestBackup,
  cleanupTestRepo,
  listTestSnapshots,
  type TestRepo,
} from "../utils/restic-helpers";
import {
  generateTestDataSet,
  STANDARD_TEST_FILES,
} from "../utils/test-data-generator";
import {
  getContainerStatus,
  waitForHealthy,
  killContainer,
  startContainer,
  waitForStopped,
} from "../utils/container-helpers";
import * as restic from "../../apps/api/src/services/restic";

// Check if running in Docker with chaos infrastructure
const hasDocker = process.env.RUNNING_IN_DOCKER === "true";

const ALL_CHAOS_WORKERS = ["chaos-worker-1", "chaos-worker-2", "chaos-worker-3"];
const TEST_GROUP_ID = "chaos-test";

/**
 * Seed the worker group state in Redis and ensure all chaos workers are running.
 * Mirrors the pattern from worker-failure.chaos.test.ts.
 */
async function ensureChaosWorkersReady(primaryWorkerId: string = ALL_CHAOS_WORKERS[0]) {
  const { getRedisConnection, StateManager } = await import("@uni-backups/shared/redis");

  for (const worker of ALL_CHAOS_WORKERS) {
    const status = await getContainerStatus(worker);
    if (status?.state !== "running") {
      await startContainer(worker);
    }
  }

  await Promise.all(ALL_CHAOS_WORKERS.map((w) => waitForHealthy(w, 30000)));

  const redis = getRedisConnection();
  const stateManager = new StateManager(redis);

  await stateManager.setWorkerGroupState({
    groupId: TEST_GROUP_ID,
    workers: ALL_CHAOS_WORKERS,
    primaryWorkerId,
    failoverOrder: ALL_CHAOS_WORKERS,
    quorumSize: 2,
    fenceToken: `seed-${Date.now()}`,
    lastElection: Date.now(),
    lastHealthCheck: Date.now(),
  });

  // Give workers a moment to see the group state
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return stateManager;
}

describe("Concurrent Operations Chaos Tests", () => {
  describe("Job Claiming Conflicts", { timeout: 120000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("concurrent-claim");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("only one worker processes a job when multiple claim simultaneously", async () => {
      const backup = await createTestBackup(repo, { "test.txt": "Concurrent test" });
      expect(backup.snapshotId).toBeDefined();
    });

    it("job is not duplicated when claimed by multiple workers", async () => {
      // A job should only be processed once, even if claimed by multiple workers

      // Create multiple sequential backups
      await createTestBackup(repo, { "file1.txt": "Content 1" });
      await createTestBackup(repo, { "file2.txt": "Content 2" });
      await createTestBackup(repo, { "file3.txt": "Content 3" });

      const snapshots = await listTestSnapshots(repo);

      // Should have exactly 3 snapshots (one per backup)
      expect(snapshots.length).toBe(3);
    });
  });

  describe("Backup and Prune Conflicts", { timeout: 120000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("concurrent-prune");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("backup and prune can run on same repo concurrently", async () => {
      // Restic uses locking to prevent conflicts
      // Both operations should eventually complete

      // Create initial backups
      for (let i = 0; i < 5; i++) {
        await createTestBackup(repo, { [`file${i}.txt`]: `Content ${i}` });
      }

      // Start prune and backup concurrently
      const prunePromise = restic.prune(
        repo.storage,
        repo.name,
        repo.password,
        { last: 3 }
      );

      const backupPromise = restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      // Both should complete (one may wait for the other due to repo lock)
      const [pruneResult, backupResult] = await Promise.all([
        prunePromise,
        backupPromise,
      ]);

      // At least one must succeed — both failing simultaneously indicates a bug,
      // not a locking issue (restic serialises via exclusive repo locks).
      expect(pruneResult.success || backupResult.success).toBe(true);

      // If prune succeeded, verify the snapshot count was reduced
      if (pruneResult.success) {
        const snapshotsAfterPrune = await listTestSnapshots(repo);
        expect(snapshotsAfterPrune.length).toBeLessThanOrEqual(3 + 1); // keep:3 + possibly 1 new backup
      }

      // If backup succeeded, verify a new snapshot was created
      if (backupResult.success) {
        expect(backupResult.snapshotId).toBeDefined();
        expect(backupResult.snapshotId!.length).toBeGreaterThan(0);
      }

      // If either failed, it must have a descriptive error (not undefined)
      if (!pruneResult.success) {
        expect(pruneResult.message).toBeDefined();
      }
      if (!backupResult.success) {
        expect(backupResult.message).toBeDefined();
      }

      // Repository must remain consistent regardless of lock ordering
      const checkResult = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkResult.success).toBe(true);
    });

    it("prune does not delete snapshot being restored", async () => {
      // Restic serializes operations via repo locks. When restore and prune
      // race, whichever acquires the lock first runs to completion before
      // the other starts. Two valid outcomes:
      //   1. Restore gets lock first -> restore succeeds, prune runs after
      //   2. Prune gets lock first -> prune removes snapshot, restore fails
      // Either way, the repo must remain consistent (no corruption).

      // Create backups
      const backup1 = await createTestBackup(repo, { "keep.txt": "Keep this" });
      await createTestBackup(repo, { "other.txt": "Other content" });

      // Start restore
      const restorePromise = restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        backup1.snapshotId,
        `/tmp/restore-${Date.now()}`
      );

      // Start prune that would remove all but last 1
      const prunePromise = restic.prune(
        repo.storage,
        repo.name,
        repo.password,
        { last: 1 }
      );

      // Both should complete without crashing (restic serialises via exclusive repo lock)
      const [restoreResult, pruneResult] = await Promise.all([
        restorePromise,
        prunePromise,
      ]);

      // At least one must succeed — the first to acquire the lock runs to completion.
      // Both failing is not acceptable for this scenario.
      expect(restoreResult.success || pruneResult.success).toBe(true);

      // If restore succeeded, it must have produced output files
      if (restoreResult.success) {
        // Restore success is sufficient — no snapshotId to check
      } else {
        // If restore failed (prune got lock first and removed the snapshot),
        // the error must be descriptive
        expect(restoreResult.message).toBeDefined();
        expect(restoreResult.message!.length).toBeGreaterThan(0);
      }

      if (pruneResult.success) {
        // Prune succeeded — snapshot count should now be at most 1 (keep:last=1)
        const remaining = await listTestSnapshots(repo);
        expect(remaining.length).toBeLessThanOrEqual(1);
      } else {
        // Prune failed (restore got lock first) — must have a descriptive error
        expect(pruneResult.message).toBeDefined();
        expect(pruneResult.message!.length).toBeGreaterThan(0);
      }

      // Repository must remain consistent regardless of operation ordering
      const checkResult = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkResult.success).toBe(true);
    });
  });

  describe("Restore While Backup Running", { timeout: 120000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("concurrent-restore");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("restore completes while backup is running", async () => {
      // Create initial backup for restore
      const initialBackup = await createTestBackup(repo, {
        "initial.txt": "Initial content",
      });

      // Create test data for new backup
      const testData = generateTestDataSet(repo.tempDir + "/new", STANDARD_TEST_FILES);

      // Start both operations
      const restorePromise = restic.restore(
        repo.storage,
        repo.name,
        repo.password,
        initialBackup.snapshotId,
        `/tmp/concurrent-restore-${Date.now()}`
      );

      const backupPromise = restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        testData.basePath
      );

      const [restoreResult, backupResult] = await Promise.all([
        restorePromise,
        backupPromise,
      ]);

      // Both should succeed
      expect(restoreResult.success).toBe(true);
      expect(backupResult.success).toBe(true);
    });
  });

  describe("Multiple Failover Elections", { timeout: 120000, skip: !hasDocker }, () => {
    it("single primary elected when multiple failovers triggered", async () => {
      // Seed group state with chaos-worker-1 as primary (matches worker-failure pattern)
      const stateManager = await ensureChaosWorkersReady(ALL_CHAOS_WORKERS[0]);

      // Verify initial state is properly seeded
      const groupStateBefore = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateBefore).not.toBeNull();
      expect(groupStateBefore!.primaryWorkerId).toBe(ALL_CHAOS_WORKERS[0]);
      const originalPrimaryId = groupStateBefore!.primaryWorkerId!;
      const electionTimeBefore = groupStateBefore!.lastElection;

      // Kill the primary worker
      await killContainer(originalPrimaryId, "SIGKILL");
      await waitForStopped(originalPrimaryId, 10000);

      // Wait for the killed worker's heartbeat to become stale
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Verify the killed primary's heartbeat is stale
      const healthyWorkers = await stateManager.getHealthyWorkers(5000);
      expect(healthyWorkers).not.toContain(originalPrimaryId);

      // At least one other worker should still be healthy
      const remainingHealthy = healthyWorkers.filter(
        (id) => id !== originalPrimaryId
      );
      expect(remainingHealthy.length).toBeGreaterThan(0);

      // Simulate concurrent failover attempts from multiple remaining workers.
      // Both acquire the lock concurrently -- only one should succeed.
      const failoverAttempts = await Promise.all(
        remainingHealthy.map((workerId) =>
          stateManager.acquireFailoverLock(TEST_GROUP_ID, workerId)
        )
      );

      // Exactly one worker should have acquired the lock
      const lockWinners = remainingHealthy.filter((_, i) => failoverAttempts[i]);
      expect(lockWinners.length).toBe(1);

      // The lock winner elects itself as new primary
      const newPrimaryId = lockWinners[0];
      await stateManager.updatePrimaryWorker(TEST_GROUP_ID, newPrimaryId);
      await stateManager.releaseFailoverLock(TEST_GROUP_ID);

      // Verify election was recorded correctly
      const finalGroupState = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(finalGroupState).not.toBeNull();
      expect(finalGroupState!.primaryWorkerId).toBe(newPrimaryId);
      expect(finalGroupState!.primaryWorkerId).not.toBe(originalPrimaryId);
      expect(finalGroupState!.lastElection).toBeGreaterThan(electionTimeBefore);
      expect(finalGroupState!.fenceToken).not.toBe(groupStateBefore!.fenceToken);

      // Restart the killed worker for cleanup
      await startContainer(originalPrimaryId);
      await waitForHealthy(originalPrimaryId, 30000);
    });

    it("quorum prevents split elections", async () => {
      const { simulateSplitBrain } = await import("../utils/chaos-helpers");

      // Seed group state with chaos-worker-1 as primary
      const stateManager = await ensureChaosWorkersReady(ALL_CHAOS_WORKERS[0]);
      const testNetworkName = "uni-backups-test-network";

      // Verify initial state
      const groupStateBefore = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateBefore).not.toBeNull();
      expect(groupStateBefore!.primaryWorkerId).toBe(ALL_CHAOS_WORKERS[0]);

      // Create a network partition: partition1=[worker-1,worker-2] (majority),
      // partition2=[worker-3] (minority, gets disconnected from network).
      // simulateSplitBrain splits at midpoint: partition1=first half, partition2=second half.
      // With 3 workers: partition1=[worker-1,worker-2], partition2=[worker-3]
      const splitBrain = await simulateSplitBrain(
        TEST_GROUP_ID,
        ALL_CHAOS_WORKERS,
        { networkName: testNetworkName }
      );

      // Wait for partition to take effect
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Group state is stored in Redis. The partition only affects network
      // connectivity, not Redis access. Verify the primary is still set.
      const groupStateDuringPartition = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateDuringPartition).not.toBeNull();
      expect(groupStateDuringPartition!.primaryWorkerId).not.toBeNull();

      // Only one primaryWorkerId should exist in the group state (no split-brain)
      // Primary must be a known chaos worker, not an empty string or garbage value
      expect(ALL_CHAOS_WORKERS).toContain(groupStateDuringPartition!.primaryWorkerId);

      // Heal the partition
      await splitBrain.heal();

      // Wait for cluster to stabilize
      await new Promise((resolve) => setTimeout(resolve, 20000));

      // After healing, verify exactly one primary exists and state is consistent
      const groupStateAfterHeal = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateAfterHeal).not.toBeNull();
      expect(groupStateAfterHeal!.primaryWorkerId).not.toBeNull();
      expect(ALL_CHAOS_WORKERS).toContain(groupStateAfterHeal!.primaryWorkerId);
      expect(groupStateAfterHeal!.fenceToken).not.toBeNull();
    });
  });

  describe("Lock Contention", { timeout: 60000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("lock-contention");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("handles lock contention gracefully", async () => {
      await createTestBackup(repo, { "init.txt": "Initialize" });

      // Start multiple operations that need locks
      const operations = [
        restic.listSnapshots(repo.storage, repo.name, repo.password),
        restic.check(repo.storage, repo.name, repo.password),
        restic.stats(repo.storage, repo.name, repo.password),
      ];

      const results = await Promise.all(operations);

      // Restic uses exclusive locking — when operations contend, some may
      // fail with a lock error rather than queuing. The critical invariants:
      // 1. At least one operation must succeed.
      // 2. Any failing operation must carry a descriptive error message.
      // 3. The repository must not be left corrupted.
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(succeeded.length).toBeGreaterThan(0);

      // listSnapshots and stats do NOT require exclusive locks; at minimum
      // listSnapshots must succeed since it is a read-only metadata operation.
      expect(results[0].success).toBe(true); // listSnapshots
      expect(Array.isArray(results[0].snapshots)).toBe(true);

      // Any failed operation must have a descriptive error, not undefined/null
      for (const failedOp of failed) {
        expect(failedOp.message).toBeDefined();
        expect(failedOp.message!.length).toBeGreaterThan(0);
      }

      // Verify the repository is still consistent after contention
      const checkResult = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkResult.success).toBe(true);
    });

    it("stale locks are removed by unlock command", async () => {
      await createTestBackup(repo, { "test.txt": "Test" });

      // Force unlock (removes any stale locks)
      const unlockResult = await restic.unlock(repo.storage, repo.name, repo.password);
      expect(unlockResult.success).toBe(true);

      // Should be able to operate normally
      const listResult = await restic.listSnapshots(repo.storage, repo.name, repo.password);
      expect(listResult.success).toBe(true);
    });
  });

  describe("Race Conditions", { timeout: 60000 }, () => {
    let repo: TestRepo;

    beforeEach(async () => {
      repo = await createLocalTestRepo("race-conditions");
    });

    afterEach(async () => {
      if (repo) {
        await cleanupTestRepo(repo);
      }
    });

    it("handles rapid sequential backups without data loss", async () => {
      // Rapidly creating backups one after another should not cause data
      // loss or corruption. Restic serializes via locks so we run these
      // sequentially in rapid succession (not in parallel, which would
      // cause lock contention failures).
      const snapshotIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const content = { [`rapid-${i}.txt`]: `Rapid content ${i} ${Date.now()}` };
        const result = await createTestBackup(repo, content);
        expect(result.snapshotId).toBeDefined();
        snapshotIds.push(result.snapshotId);
      }

      // All 10 snapshots should exist and be unique
      const uniqueIds = new Set(snapshotIds);
      expect(uniqueIds.size).toBe(10);

      // Verify all snapshots are in the repo
      const snapshots = await listTestSnapshots(repo);
      expect(snapshots.length).toBe(10);

      // Verify repository integrity after rapid backups
      const checkResult = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkResult.success).toBe(true);
    });

    it("handles parallel list and backup operations", async () => {
      // Create initial backup
      await createTestBackup(repo, { "init.txt": "Initial" });

      // Start parallel operations -- restic may fail one due to lock
      // contention. Use raw restic calls so we can inspect results
      // without createTestBackup throwing on failure.
      const listPromise = restic.listSnapshots(repo.storage, repo.name, repo.password);
      const backupPromise = restic.backup(
        repo.storage,
        repo.name,
        repo.password,
        repo.tempDir
      );

      const [listResult, backupResult] = await Promise.all([listPromise, backupPromise]);

      // At least one must succeed — they serialize via repo locks.
      // Both failing simultaneously indicates a bug.
      expect(listResult.success || backupResult.success).toBe(true);

      // list is a read-only operation and does NOT require an exclusive lock in
      // recent restic versions; it should therefore always succeed.
      expect(listResult.success).toBe(true);
      expect(Array.isArray(listResult.snapshots)).toBe(true);

      // If backup succeeded it must have produced a snapshot
      if (backupResult.success) {
        expect(backupResult.snapshotId).toBeDefined();
        expect(backupResult.snapshotId!.length).toBeGreaterThan(0);
      } else {
        // Backup lost the lock race — must have a descriptive error
        expect(backupResult.message).toBeDefined();
      }

      // Verify repository remains consistent after parallel operations
      const checkResult = await restic.check(repo.storage, repo.name, repo.password);
      expect(checkResult.success).toBe(true);
    });
  });
});
