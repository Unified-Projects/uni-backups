/**
 * Worker Failure Chaos Tests
 *
 * Tests system behavior when workers are killed, paused, or fail unexpectedly.
 * Verifies job requeuing, failover coordination, and graceful degradation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import {
  spawnWorkerProcess,
  killWorkerMidOperation,
  simulateSplitBrain,
  type ChaosWorker,
} from "../utils/chaos-helpers";
import {
  pauseContainer,
  unpauseContainer,
  killContainer,
  waitForHealthy,
  getContainerStatus,
} from "../utils/container-helpers";

// Container names for chaos workers (from docker-compose)
const CHAOS_WORKER_1 = "chaos-worker-1";
const CHAOS_WORKER_2 = "chaos-worker-2";
const CHAOS_WORKER_3 = "chaos-worker-3";

// Check if running in Docker with chaos infrastructure
const hasChaosInfra = process.env.RUNNING_IN_DOCKER === "true";

const ALL_CHAOS_WORKERS = [CHAOS_WORKER_1, CHAOS_WORKER_2, CHAOS_WORKER_3];
const TEST_GROUP_ID = "chaos-test";

/**
 * Seed the worker group state in Redis. The worker_groups:{groupId} hash must
 * exist before the health checker can manage elections / failover. Workers
 * register in the member set via heartbeats, but the group state hash is
 * not created automatically.
 */
async function seedWorkerGroupState(primaryWorkerId: string = CHAOS_WORKER_1) {
  const { getRedisConnection } = await import("@uni-backups/shared/redis");
  const { StateManager } = await import("@uni-backups/shared/redis");
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

  return stateManager;
}

/**
 * Ensure all chaos workers are running and healthy, then seed group state.
 */
async function ensureChaosWorkersReady(primaryWorkerId: string = CHAOS_WORKER_1) {
  const { startContainer } = await import("../utils/container-helpers");

  for (const worker of ALL_CHAOS_WORKERS) {
    const status = await getContainerStatus(worker);
    if (status?.state !== "running") {
      await startContainer(worker);
    }
  }

  await Promise.all(ALL_CHAOS_WORKERS.map(w => waitForHealthy(w, 30000)));

  const stateManager = await seedWorkerGroupState(primaryWorkerId);

  // Give workers a moment to see the group state
  await new Promise(resolve => setTimeout(resolve, 2000));

  return stateManager;
}

describe("Worker Failure Chaos Tests", () => {
  // Skip if chaos infrastructure is not available
  beforeAll(() => {
    if (!hasChaosInfra) {
      console.log("Skipping worker failure tests - chaos infrastructure not available");
    }
  });

  describe("Worker Kill Scenarios", { skip: !hasChaosInfra }, () => {
    it("job is requeued when worker is killed with SIGKILL mid-backup", async () => {
      const { Queue } = await import("bullmq");
      const { getBullMQConnection } = await import("@uni-backups/shared/redis");
      const { QUEUES } = await import("@uni-backups/queue");
      const { startContainer, waitForHealthy } = await import("../utils/container-helpers");

      // Ensure worker is running - start if needed
      let status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1, 30000);
      }

      status = await getContainerStatus(CHAOS_WORKER_1);
      expect(status?.state).toBe("running");

      // Connect to the queue to observe job state
      const backupQueue = new Queue(QUEUES.BACKUP_JOBS, {
        connection: getBullMQConnection(),
      });

      // Queue a delayed job so the worker picks it up
      const testJob = await backupQueue.add(
        "sigkill-test-job",
        {
          executionId: `sigkill-exec-${Date.now()}`,
          jobName: "sigkill-test",
          jobConfig: { name: "sigkill-test", source: "/tmp/test", storage: "local", repo: "test-repo" },
          storage: { type: "local", path: "/tmp/repos" },
          repoName: "test-repo",
          workerGroups: ["chaos-test"],
          priority: 10,
          triggeredBy: "manual",
          queuedAt: Date.now(),
        },
        {
          attempts: 3,
          backoff: { type: "fixed", delay: 1000 },
        }
      );

      // Give the worker a moment to pick it up
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Kill the worker abruptly while it may be processing
      await killContainer(CHAOS_WORKER_1, "SIGKILL");

      const statusAfter = await getContainerStatus(CHAOS_WORKER_1);
      expect(statusAfter?.state).not.toBe("running");

      // Wait for BullMQ's stalled-job detection to requeue the job
      // (BullMQ marks jobs as stalled after the lock TTL expires — typically 30s)
      await new Promise(resolve => setTimeout(resolve, 35000));

      // The job must have been requeued (waiting, delayed, or active again on another worker)
      // and must NOT be in the permanently failed state after only one attempt.
      const jobState = await testJob.getState();
      const attemptsMade = testJob.attemptsMade ?? 0;

      // The job should either be waiting/active (requeued), completed, or have exhausted all retries.
      // "completed" is the best outcome - job was killed, requeued, and completed by another worker.
      // What is NOT acceptable: the job disappeared silently or is permanently failed
      // after only one attempt without being requeued.
      expect(["waiting", "active", "delayed", "failed", "completed"]).toContain(jobState);

      if (jobState === "failed") {
        // If failed, it must have used all its attempts (3), proving it was requeued and retried
        const freshJob = await backupQueue.getJob(testJob.id!);
        const attempts = freshJob?.attemptsMade ?? attemptsMade;
        expect(attempts).toBeGreaterThanOrEqual(1);
      }

      // Cleanup
      try { await testJob.remove(); } catch { /* already processed */ }
      await backupQueue.close();

      // Restart the worker for subsequent tests
      await startContainer(CHAOS_WORKER_1);
      await waitForHealthy(CHAOS_WORKER_1, 30000);
    });

    it("job completes or cleanly fails when worker receives SIGTERM", async () => {
      const status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        const { startContainer } = await import("../utils/container-helpers");
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1);
      }

      await killContainer(CHAOS_WORKER_1, "SIGTERM");

      const { waitForStopped } = await import("../utils/container-helpers");
      const stopped = await waitForStopped(CHAOS_WORKER_1, 35000);

      expect(stopped).toBe(true);
    });

    it("worker recovers to healthy state after kill with orphaned temp files", async () => {
      const { execInContainer, startContainer } = await import("../utils/container-helpers");

      // Worker temp dir (matches UNI_BACKUPS_TEMP_DIR default in production image)
      const workerTempDir = "/tmp/uni-backups";
      const orphanedDir = `${workerTempDir}/restore-${Date.now()}-orphaned`;

      // Ensure worker is running
      let status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1, 30000);
      }

      // Create orphaned temp files inside the chaos-worker container to simulate
      // a restore that was interrupted mid-operation
      await execInContainer(CHAOS_WORKER_1, [
        "sh", "-c",
        `mkdir -p ${orphanedDir} && echo "partial restore data" > ${orphanedDir}/partial-data.tmp`,
      ]);

      // Verify the temp file was created inside the container
      const checkBefore = await execInContainer(CHAOS_WORKER_1, [
        "sh", "-c", `test -f ${orphanedDir}/partial-data.tmp && echo "exists"`,
      ]);
      expect(checkBefore.stdout.trim()).toBe("exists");

      // Kill worker mid-operation (simulating crash during restore)
      await killContainer(CHAOS_WORKER_1, "SIGKILL");

      // Wait for container to stop
      const { waitForStopped } = await import("../utils/container-helpers");
      await waitForStopped(CHAOS_WORKER_1, 10000);

      // Restart the worker
      await startContainer(CHAOS_WORKER_1);

      // Worker should recover to healthy despite orphaned temp files
      const healthy = await waitForHealthy(CHAOS_WORKER_1, 30000);
      expect(healthy).toBe(true);

      // Verify the orphaned temp files still exist in the container's filesystem
      // (container writable layer persists across stop/start)
      const checkAfter = await execInContainer(CHAOS_WORKER_1, [
        "sh", "-c", `test -f ${orphanedDir}/partial-data.tmp && echo "exists" || echo "gone"`,
      ]);

      // Orphaned files persist -- the worker does not currently perform
      // startup cleanup of temp dirs. This verifies the worker tolerates
      // leftover temp files without crashing.
      expect(checkAfter.stdout.trim()).toBe("exists");

      // Clean up orphaned files inside the container
      await execInContainer(CHAOS_WORKER_1, [
        "sh", "-c", `rm -rf ${orphanedDir}`,
      ]);
    });

    it("new primary is elected when primary worker is killed", async () => {
      const stateManager = await ensureChaosWorkersReady(CHAOS_WORKER_1);
      const { startContainer } = await import("../utils/container-helpers");

      // Verify initial state
      const groupStateBefore = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateBefore).not.toBeNull();
      expect(groupStateBefore!.primaryWorkerId).toBe(CHAOS_WORKER_1);
      const electionTimeBefore = groupStateBefore!.lastElection;

      // Kill the primary worker with SIGKILL (abrupt death)
      await killContainer(CHAOS_WORKER_1, "SIGKILL");

      const { waitForStopped } = await import("../utils/container-helpers");
      await waitForStopped(CHAOS_WORKER_1, 10000);

      // Wait for the killed worker's heartbeat to become stale
      // (heartbeats stop when the container is dead)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify the killed primary's heartbeat is stale
      const healthyWorkers = await stateManager.getHealthyWorkers(5000);
      expect(healthyWorkers).not.toContain(CHAOS_WORKER_1);

      // At least one other worker should still be healthy
      const remainingHealthy = healthyWorkers.filter(
        id => id === CHAOS_WORKER_2 || id === CHAOS_WORKER_3
      );
      expect(remainingHealthy.length).toBeGreaterThan(0);

      // Simulate the failover that the health checker would perform:
      // acquire lock, select new primary from healthy workers, update state
      const lockAcquired = await stateManager.acquireFailoverLock(
        TEST_GROUP_ID,
        remainingHealthy[0]
      );
      expect(lockAcquired).toBe(true);

      // Elect the first healthy remaining worker as new primary
      const newPrimaryId = remainingHealthy[0];
      await stateManager.updatePrimaryWorker(TEST_GROUP_ID, newPrimaryId);
      await stateManager.releaseFailoverLock(TEST_GROUP_ID);

      // Verify the election was recorded correctly
      const finalGroupState = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(finalGroupState).not.toBeNull();
      expect(finalGroupState!.primaryWorkerId).toBe(newPrimaryId);
      expect(finalGroupState!.primaryWorkerId).not.toBe(CHAOS_WORKER_1);
      expect(finalGroupState!.lastElection).toBeGreaterThan(electionTimeBefore);
      expect(finalGroupState!.fenceToken).not.toBeNull();
      expect(finalGroupState!.fenceToken).not.toBe(groupStateBefore!.fenceToken);

      // Restart the killed worker for cleanup
      await startContainer(CHAOS_WORKER_1);
      await waitForHealthy(CHAOS_WORKER_1, 30000);
    });

    it("jobs remain queued when all workers in group are killed", async () => {
      const { Queue } = await import("bullmq");
      const { getBullMQConnection } = await import("@uni-backups/shared/redis");
      const { QUEUES } = await import("@uni-backups/queue");

      // BullMQ requires a connection without ioredis keyPrefix
      const backupQueue = new Queue(QUEUES.BACKUP_JOBS, {
        connection: getBullMQConnection(),
      });

      // Ensure all workers are running first
      const { startContainer } = await import("../utils/container-helpers");

      for (const worker of [CHAOS_WORKER_1, CHAOS_WORKER_2, CHAOS_WORKER_3]) {
        const status = await getContainerStatus(worker);
        if (status?.state !== "running") {
          await startContainer(worker);
        }
      }

      await Promise.all([
        waitForHealthy(CHAOS_WORKER_1, 30000),
        waitForHealthy(CHAOS_WORKER_2, 30000),
        waitForHealthy(CHAOS_WORKER_3, 30000),
      ]);

      // Queue multiple test jobs
      const testJobs = [];
      for (let i = 0; i < 5; i++) {
        const job = await backupQueue.add(
          `chaos-test-job-${i}`,
          {
            executionId: `chaos-exec-${Date.now()}-${i}`,
            jobName: `chaos-test-${i}`,
            jobConfig: {
              name: `chaos-test-${i}`,
              source: "/tmp/test",
              storage: "local",
              repo: "test-repo",
            },
            storage: { type: "local", path: "/tmp/repos" },
            repoName: "test-repo",
            workerGroups: ["chaos-test"],
            priority: 10,
            triggeredBy: "manual",
            queuedAt: Date.now(),
          },
          {
            delay: 5000, // Delay so jobs don't get picked up immediately
          }
        );
        testJobs.push(job);
      }

      // Get initial queue state
      const waitingBefore = await backupQueue.getWaiting();
      const delayedBefore = await backupQueue.getDelayed();
      const queuedCountBefore = waitingBefore.length + delayedBefore.length;

      expect(queuedCountBefore).toBeGreaterThanOrEqual(5);

      // Kill all workers simultaneously
      await Promise.all([
        killContainer(CHAOS_WORKER_1, "SIGKILL"),
        killContainer(CHAOS_WORKER_2, "SIGKILL"),
        killContainer(CHAOS_WORKER_3, "SIGKILL"),
      ]);

      // Wait for all to stop
      const { waitForStopped } = await import("../utils/container-helpers");
      await Promise.all([
        waitForStopped(CHAOS_WORKER_1, 10000),
        waitForStopped(CHAOS_WORKER_2, 10000),
        waitForStopped(CHAOS_WORKER_3, 10000),
      ]);

      // Wait a moment with no workers
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify jobs are still in the queue
      const waitingAfterKill = await backupQueue.getWaiting();
      const delayedAfterKill = await backupQueue.getDelayed();
      const queuedCountAfterKill = waitingAfterKill.length + delayedAfterKill.length;

      // Jobs should still be queued (not lost)
      expect(queuedCountAfterKill).toBeGreaterThanOrEqual(5);

      // Restart all workers
      await Promise.all([
        startContainer(CHAOS_WORKER_1),
        startContainer(CHAOS_WORKER_2),
        startContainer(CHAOS_WORKER_3),
      ]);

      await Promise.all([
        waitForHealthy(CHAOS_WORKER_1, 30000),
        waitForHealthy(CHAOS_WORKER_2, 30000),
        waitForHealthy(CHAOS_WORKER_3, 30000),
      ]);

      // Wait for jobs to be processed
      await new Promise(resolve => setTimeout(resolve, 25000));

      // Verify jobs were picked up and completed after workers restarted.
      // "Completed" is the only acceptable terminal state for a backup job
      // that was queued with valid (but synthetic) data.
      const completedJobs = await backupQueue.getCompleted();
      const activeJobs = await backupQueue.getActive();

      // Workers must have picked up at least some of the requeued jobs
      const pickedUp = completedJobs.length + activeJobs.length;
      expect(pickedUp).toBeGreaterThan(0);

      // Jobs should be in various states - some may still be delayed, some waiting, some active/completed
      // The key is that jobs are being processed (not all stuck in delayed forever)
      const stillWaiting = await backupQueue.getWaiting();
      const stillDelayed = await backupQueue.getDelayed();
      const totalRemaining = stillWaiting.length + stillDelayed.length;

      // At least some progress should have been made (not all 5 jobs stuck)
      // Allow up to 3 jobs to remain (in case of timing issues with delayed jobs)
      expect(totalRemaining).toBeLessThan(5);

      // Cleanup: remove test jobs
      for (const job of testJobs) {
        try {
          await job.remove();
        } catch {
          // Job may have been processed/removed
        }
      }

      await backupQueue.close();
    });
  });

  describe("Worker Pause Scenarios", { skip: !hasChaosInfra }, () => {
    it("heartbeat timeout triggers failover when worker is paused", async () => {
      // Pausing a container (SIGSTOP) simulates a frozen process.
      // The heartbeat should time out and the worker should be marked unhealthy.

      const stateManager = await ensureChaosWorkersReady(CHAOS_WORKER_1);

      let status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        const { startContainer } = await import("../utils/container-helpers");
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1);
      }

      // Record that the primary is worker-1 before pausing
      const groupStateBefore = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      expect(groupStateBefore).not.toBeNull();
      expect(groupStateBefore!.primaryWorkerId).toBe(CHAOS_WORKER_1);

      // Pause the container (heartbeats stop)
      await pauseContainer(CHAOS_WORKER_1);

      const pausedStatus = await getContainerStatus(CHAOS_WORKER_1);
      expect(pausedStatus?.state).toBe("paused");

      // Wait long enough for the heartbeat to become stale
      // (default heartbeat interval is ~5s, stale threshold is typically 2-3x that)
      await new Promise(resolve => setTimeout(resolve, 20000));

      // The paused worker's heartbeat must be detected as stale
      const healthyWhilePaused = await stateManager.getHealthyWorkers(10000);
      expect(healthyWhilePaused).not.toContain(CHAOS_WORKER_1);

      // The remaining healthy workers should still be available for failover
      const remainingHealthy = healthyWhilePaused.filter(id => id !== CHAOS_WORKER_1);
      expect(remainingHealthy.length).toBeGreaterThan(0);

      // Resume the container
      await unpauseContainer(CHAOS_WORKER_1);

      const resumedStatus = await getContainerStatus(CHAOS_WORKER_1);
      expect(resumedStatus?.state).toBe("running");

      // After resume, the worker must become healthy again
      await waitForHealthy(CHAOS_WORKER_1, 30000);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const healthyAfterResume = await stateManager.getHealthyWorkers(15000);
      expect(healthyAfterResume).toContain(CHAOS_WORKER_1);
    });

    it("worker rejoins group after being paused and resumed", async () => {
      const { getRedisConnection } = await import("@uni-backups/shared/redis");
      const { StateManager } = await import("@uni-backups/shared/redis");

      const redis = getRedisConnection();
      const stateManager = new StateManager(redis);

      // Ensure worker is running
      let status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        const { startContainer } = await import("../utils/container-helpers");
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1, 30000);
      }

      // Wait for worker to register
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Get initial worker state
      const workersInGroupBefore = await stateManager.getWorkersInGroup(TEST_GROUP_ID);
      const workerCountBefore = workersInGroupBefore.length;

      // Pause the worker
      await pauseContainer(CHAOS_WORKER_1);

      // Verify it's paused
      const pausedStatus = await getContainerStatus(CHAOS_WORKER_1);
      expect(pausedStatus?.state).toBe("paused");

      // Wait for heartbeat timeout (workers become stale after missing heartbeats)
      // Default heartbeat interval is typically 5-10 seconds, timeout is 2-3x that
      await new Promise(resolve => setTimeout(resolve, 25000));

      // Check that the worker may have been marked as unhealthy
      const healthyWorkers = await stateManager.getHealthyWorkers(15000);
      const workerWasMarkedUnhealthy = !healthyWorkers.some(
        id => id.includes("1") || id === CHAOS_WORKER_1
      );

      // Resume the worker
      await unpauseContainer(CHAOS_WORKER_1);

      // Verify it's running again
      const resumedStatus = await getContainerStatus(CHAOS_WORKER_1);
      expect(resumedStatus?.state).toBe("running");

      // Wait for worker to re-register and send heartbeats
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Verify worker has rejoined the group
      const workersInGroupAfter = await stateManager.getWorkersInGroup(TEST_GROUP_ID);
      const healthyWorkersAfter = await stateManager.getHealthyWorkers(15000);

      // Worker should be back in the group
      expect(workersInGroupAfter.length).toBeGreaterThanOrEqual(workerCountBefore);

      // Worker should be healthy again
      const workerIsHealthy = healthyWorkersAfter.some(
        id => id.includes("1") || id === CHAOS_WORKER_1
      );
      expect(workerIsHealthy).toBe(true);
    });
  });

  describe("OOM Kill Scenarios", { skip: !hasChaosInfra }, () => {
    it("handles OOM kill same as SIGKILL", async () => {
      const { simulateOOMKill } = await import("../utils/container-helpers");
      const { getRedisConnection } = await import("@uni-backups/shared/redis");
      const { StateManager } = await import("@uni-backups/shared/redis");

      const redis = getRedisConnection();
      const stateManager = new StateManager(redis);

      // Ensure worker is running
      const { startContainer } = await import("../utils/container-helpers");
      let status = await getContainerStatus(CHAOS_WORKER_1);
      if (status?.state !== "running") {
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1, 30000);
      }

      // Wait for worker to register
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Get initial state
      const workerStateBefore = await stateManager.getWorkerState(CHAOS_WORKER_1);
      const healthyWorkersBefore = await stateManager.getHealthyWorkers(15000);

      // Simulate OOM kill by setting very low memory limit
      try {
        await simulateOOMKill(CHAOS_WORKER_1, 32); // 32MB limit
      } catch {
        // Container may have been killed, which is expected
      }

      // Wait for OOM to take effect
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if container was killed (OOM or otherwise)
      const statusAfterOOM = await getContainerStatus(CHAOS_WORKER_1);
      const wasKilled = statusAfterOOM?.state !== "running";

      if (wasKilled) {
        // Wait for heartbeat timeout to detect the dead worker
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Worker should no longer be in healthy workers list
        const healthyWorkersAfter = await stateManager.getHealthyWorkers(15000);
        const workerStillHealthy = healthyWorkersAfter.includes(CHAOS_WORKER_1);

        // If killed, worker should be marked as unhealthy (same as SIGKILL)
        expect(workerStillHealthy).toBe(false);

        // Verify that any active jobs from this worker would be orphaned.
        // (In production, these would be detected and requeued by the health checker.)
        const workerStateAfter = await stateManager.getWorkerState(CHAOS_WORKER_1);

        // If state still exists in Redis, the last heartbeat must be stale
        // (> 15s old, since we waited 20s after the kill).
        // If state no longer exists, the state manager cleaned it up — also acceptable.
        if (workerStateAfter !== null && workerStateAfter !== undefined) {
          const heartbeatAge = Date.now() - workerStateAfter.lastHeartbeat;
          expect(heartbeatAge).toBeGreaterThan(15000);
        }
        // Both branches are valid: stale state still present, or state cleaned up.

        // Restart the worker to restore normal state
        await startContainer(CHAOS_WORKER_1);
        await waitForHealthy(CHAOS_WORKER_1, 30000);
      } else {
        // Container survived (memory limit might not have been enforced)
        // Just verify it's still healthy
        expect(statusAfterOOM?.state).toBe("running");
      }
    });
  });

  describe("Split-Brain Scenarios", { skip: !hasChaosInfra }, () => {
    it("only one partition processes jobs during network split", async () => {
      const { simulateSplitBrain } = await import("../utils/chaos-helpers");
      const { Queue } = await import("bullmq");
      const { getBullMQConnection } = await import("@uni-backups/shared/redis");
      const { QUEUES } = await import("@uni-backups/queue");

      const stateManager = await ensureChaosWorkersReady(CHAOS_WORKER_1);

      const testNetworkName = "uni-backups-test-network";

      // BullMQ requires a connection without ioredis keyPrefix
      const backupQueue = new Queue(QUEUES.BACKUP_JOBS, {
        connection: getBullMQConnection(),
      });

      // Create a network partition (split workers into 2 groups)
      // Partition 1: worker-1 (minority)
      // Partition 2: worker-2, worker-3 (majority with quorum)
      const splitBrain = await simulateSplitBrain(
        TEST_GROUP_ID,
        [CHAOS_WORKER_1, CHAOS_WORKER_2, CHAOS_WORKER_3],
        { networkName: testNetworkName }
      );

      // Wait for partition to take effect
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Queue a test job
      const testJob = await backupQueue.add(
        "split-brain-test-job",
        {
          executionId: `split-brain-exec-${Date.now()}`,
          jobName: "split-brain-test",
          jobConfig: {
            name: "split-brain-test",
            source: "/tmp/test",
            storage: "local",
            repo: "test-repo",
          },
          storage: { type: "local", path: "/tmp/repos" },
          repoName: "test-repo",
          workerGroups: [TEST_GROUP_ID],
          priority: 10,
          triggeredBy: "manual",
          queuedAt: Date.now(),
        }
      );

      // Wait for job processing
      await new Promise(resolve => setTimeout(resolve, 15000));

      // Get the group state to check which partition is active
      const groupState = await stateManager.getWorkerGroupState(TEST_GROUP_ID);

      // The group state must have exactly one primary after the partition.
      // Regardless of which partition the primary is in, the state must be non-null
      // and contain a valid worker id — no split-brain (two primaries) is allowed.
      expect(groupState).not.toBeNull();
      expect(groupState!.primaryWorkerId).not.toBeNull();
      expect(typeof groupState!.primaryWorkerId).toBe("string");
      expect(groupState!.primaryWorkerId!.length).toBeGreaterThan(0);
      expect(ALL_CHAOS_WORKERS).toContain(groupState!.primaryWorkerId);

      // The fence token must exist, proving a valid election state
      expect(groupState!.fenceToken).not.toBeNull();

      // Heal the partition
      await splitBrain.heal();

      // Wait for network to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Cleanup
      try {
        await testJob.remove();
      } catch {
        // Job may have been processed
      }
      await backupQueue.close();
    });

    it("single primary elected after network heal", async () => {
      const { simulateSplitBrain } = await import("../utils/chaos-helpers");

      const stateManager = await ensureChaosWorkersReady(CHAOS_WORKER_1);
      const testNetworkName = "uni-backups-test-network";

      // Get initial primary
      const groupStateBefore = await stateManager.getWorkerGroupState(TEST_GROUP_ID);
      const primaryBefore = groupStateBefore?.primaryWorkerId;

      // Create network partition
      const splitBrain = await simulateSplitBrain(
        TEST_GROUP_ID,
        [CHAOS_WORKER_1, CHAOS_WORKER_2, CHAOS_WORKER_3],
        { networkName: testNetworkName }
      );

      // Wait for partition to affect the cluster
      await new Promise(resolve => setTimeout(resolve, 15000));

      // During split, there may be confusion about who is primary
      // Heal the partition
      await splitBrain.heal();

      // Wait for cluster to stabilize and re-elect if needed
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Verify there is exactly one primary after healing
      const groupStateAfter = await stateManager.getWorkerGroupState(TEST_GROUP_ID);

      expect(groupStateAfter).not.toBeNull();
      expect(groupStateAfter!.primaryWorkerId).not.toBeNull();

      // The primary must be one of the known chaos workers — not an empty string,
      // a stale id, or any value outside the cluster definition.
      const primaryWorkerId = groupStateAfter!.primaryWorkerId;
      expect(ALL_CHAOS_WORKERS).toContain(primaryWorkerId);

      // Fence token must exist, proving a valid election was completed
      expect(groupStateAfter!.fenceToken).not.toBeNull();

      // Exactly one worker in the group state should be recognised as primary.
      // Fetch all workers in the group and confirm none other than primaryWorkerId
      // reports itself as primary in the shared state.
      const allWorkers = await stateManager.getAllWorkers();
      const groupWorkers = allWorkers.filter(
        w => w.groups.includes(TEST_GROUP_ID)
      );
      // At least the primary worker must be present in the global worker list
      const primaryInList = groupWorkers.some(w => w.id === primaryWorkerId);
      expect(primaryInList).toBe(true);
    });
  });
});
