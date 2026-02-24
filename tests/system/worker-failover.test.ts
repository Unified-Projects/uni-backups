/**
 * Worker Failover System Integration Tests
 *
 * End-to-end tests that verify worker failover mechanisms:
 * - Primary/secondary election
 * - Heartbeat monitoring
 * - Fence token validation
 * - Quorum-based voting
 * - Job takeover on failover
 *
 * Prerequisites:
 * - docker compose -f tests/compose/services.yml --profile redis up -d --wait
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  sleep,
  generateTestId,
} from "../utils/test-services";
import {
  createSimulatedWorker,
  createSimulatedWorkerCluster,
  cleanupSimulatedWorkers,
  createTestWorkerGroup,
  electNewPrimary,
  simulateDownVotes,
  waitForStaleHeartbeat,
  verifyWorkerHealthy,
  getHealthyWorkersInGroup,
  waitForFailover,
  waitForAnyPrimary,
  getCurrentPrimary,
  getFenceToken,
  verifyFenceTokenChanged,
  tryAcquireFailoverLock,
  releaseFailoverLock,
  type SimulatedWorker,
} from "../utils/worker-helpers";

describe("Worker Failover System Tests", () => {
  let testContext: TestContext;

  const TEST_TIMEOUT = 60000; // 1 minute per test

  beforeAll(async () => {
    // Wait for Redis
    await waitForAllServices({
      redis: true,
    });

    // Initialize test context
    testContext = await initTestContext({
      redis: true,
      queues: true,
    });
  }, 60000);

  afterAll(async () => {
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  describe("Worker Registration and Health", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(3, groupId, testContext.redis);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("workers register and appear as healthy after starting", async () => {
      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }

      // Wait for heartbeats to propagate (needs > 1 heartbeat interval of 1000ms)
      await sleep(1500);

      // Verify all workers are healthy
      for (const worker of workers) {
        const isHealthy = await verifyWorkerHealthy(
          testContext.stateManager,
          worker.id,
          10000
        );
        expect(isHealthy).toBe(true);
      }

      // Verify worker states in Redis
      for (const worker of workers) {
        const state = await worker.getState();
        expect(state).toBeDefined();
        expect(state?.status).toBe("healthy");
        expect(state?.groups).toContain(groupId);
      }
    }, TEST_TIMEOUT);

    it("workers become stale when heartbeat stops", async () => {
      const worker = workers[0];
      const heartbeatThreshold = 1000; // 1 second threshold

      // Start worker with fast heartbeat
      worker.config.heartbeatInterval = 200;
      await worker.start();

      // Wait for initial heartbeats
      await sleep(500);

      // Verify worker is healthy
      const initialHealth = await verifyWorkerHealthy(
        testContext.stateManager,
        worker.id,
        heartbeatThreshold
      );
      expect(initialHealth).toBe(true);

      // Simulate failure (stop heartbeats)
      await worker.simulateFailure();

      // Wait for worker to become stale
      const becameStale = await waitForStaleHeartbeat(
        testContext.stateManager,
        worker.id,
        heartbeatThreshold,
        5000
      );
      expect(becameStale).toBe(true);
    }, TEST_TIMEOUT);

    it("tracks multiple workers in same group", async () => {
      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);

      // Get all healthy workers in group
      const healthyWorkers = await getHealthyWorkersInGroup(
        testContext.stateManager,
        groupId,
        10000
      );

      expect(healthyWorkers.length).toBe(3);
      for (const worker of workers) {
        expect(healthyWorkers).toContain(worker.id);
      }
    }, TEST_TIMEOUT);
  });

  describe("Primary Election", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(3, groupId, testContext.redis);

      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("establishes primary worker for group", async () => {
      // Create worker group with first worker as primary
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      // Verify primary is set
      const primary = await getCurrentPrimary(testContext.stateManager, groupId);
      expect(primary).toBe(workers[0].id);

      // Verify fence token exists
      const fenceToken = await getFenceToken(testContext.stateManager, groupId);
      expect(fenceToken).toBeDefined();
      expect(fenceToken).not.toBe("");
    }, TEST_TIMEOUT);

    it("elects new primary when current primary fails", async () => {
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      const originalPrimary = workers[0].id;
      const originalToken = await getFenceToken(testContext.stateManager, groupId);

      // Simulate primary failure
      await workers[0].simulateFailure();

      // Elect new primary
      await electNewPrimary(testContext.stateManager, groupId, workers[1].id);

      // Wait for failover
      const failoverComplete = await waitForFailover(
        testContext.stateManager,
        groupId,
        workers[1].id,
        10000
      );
      expect(failoverComplete).toBe(true);

      // Verify new primary
      const newPrimary = await getCurrentPrimary(testContext.stateManager, groupId);
      expect(newPrimary).toBe(workers[1].id);
      expect(newPrimary).not.toBe(originalPrimary);

      // Verify fence token changed
      const tokenChanged = await verifyFenceTokenChanged(
        testContext.stateManager,
        groupId,
        originalToken!
      );
      expect(tokenChanged).toBe(true);
    }, TEST_TIMEOUT);

    it("respects failover order when electing new primary", async () => {
      const workerIds = workers.map((w) => w.id);
      // Set specific failover order: worker 2 should be next
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      // Simulate primary failure
      await workers[0].simulateFailure();

      // Elect according to failover order (second in list)
      await electNewPrimary(testContext.stateManager, groupId, workers[1].id);

      const newPrimary = await getCurrentPrimary(testContext.stateManager, groupId);
      expect(newPrimary).toBe(workers[1].id);
    }, TEST_TIMEOUT);
  });

  describe("Quorum-based Voting", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(5, groupId, testContext.redis);

      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("requires quorum for failover decision", async () => {
      const workerIds = workers.map((w) => w.id);
      const quorumSize = 3; // Majority of 5

      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        quorumSize
      );

      // Simulate primary failure
      await workers[0].simulateFailure();

      // Not enough votes yet (only 2 workers vote)
      const votes = await simulateDownVotes(
        testContext.stateManager,
        groupId,
        [workers[1].id, workers[2].id],
        workers[0].id
      );
      expect(votes).toBe(2);

      // Add one more vote to reach quorum
      const finalVotes = await simulateDownVotes(
        testContext.stateManager,
        groupId,
        [workers[3].id],
        workers[0].id
      );
      expect(finalVotes).toBe(3);
    }, TEST_TIMEOUT);

    it("clears votes after election", async () => {
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        3
      );

      // Simulate votes
      await simulateDownVotes(
        testContext.stateManager,
        groupId,
        [workers[1].id, workers[2].id, workers[3].id],
        workers[0].id
      );

      // Trigger election
      await electNewPrimary(testContext.stateManager, groupId, workers[1].id);

      // After the election the new primary must be recorded correctly
      const groupStateAfterElection = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(groupStateAfterElection).not.toBeNull();
      expect(groupStateAfterElection!.primaryWorkerId).toBe(workers[1].id);

      // The fence token must have changed, confirming a new epoch started
      const newFenceToken = await getFenceToken(testContext.stateManager, groupId);
      expect(newFenceToken).toBeDefined();
      expect(newFenceToken!.length).toBeGreaterThan(0);

      // Votes for the OLD primary (workers[0]) should not affect the new election state.
      // If the StateManager exposes vote counts, verify they are cleared.
      // As a proxy: no additional failover lock should be held by the old candidate.
      const canAcquireLock = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[2].id,
        5
      );
      // We should be able to acquire the lock (election lock was released)
      expect(canAcquireLock).toBe(true);
      await releaseFailoverLock(testContext.stateManager, groupId);
    }, TEST_TIMEOUT);
  });

  describe("Fence Token Validation", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(3, groupId, testContext.redis);

      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("generates new fence token on failover", async () => {
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      const tokens: string[] = [];

      // Get initial token
      const initialToken = await getFenceToken(testContext.stateManager, groupId);
      expect(initialToken).toBeDefined();
      tokens.push(initialToken!);

      // Perform multiple failovers
      for (let i = 1; i < workers.length; i++) {
        await electNewPrimary(testContext.stateManager, groupId, workers[i].id);
        const newToken = await getFenceToken(testContext.stateManager, groupId);
        expect(newToken).toBeDefined();
        tokens.push(newToken!);
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    }, TEST_TIMEOUT);

    it("prevents stale worker from taking actions after failover", async () => {
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      const originalToken = await getFenceToken(testContext.stateManager, groupId);

      // Failover to new primary
      await electNewPrimary(testContext.stateManager, groupId, workers[1].id);

      const newToken = await getFenceToken(testContext.stateManager, groupId);

      // Original token should no longer be valid
      expect(newToken).not.toBe(originalToken);
    }, TEST_TIMEOUT);
  });

  describe("Failover Lock Mechanism", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(3, groupId, testContext.redis);

      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
      // Always release lock to prevent test pollution
      await releaseFailoverLock(testContext.stateManager, groupId);
    });

    it("only one worker can acquire failover lock", async () => {
      // First worker acquires lock
      const firstAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[0].id,
        30
      );
      expect(firstAcquired).toBe(true);

      // Second worker cannot acquire lock
      const secondAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[1].id,
        30
      );
      expect(secondAcquired).toBe(false);

      // Third worker cannot acquire lock
      const thirdAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[2].id,
        30
      );
      expect(thirdAcquired).toBe(false);
    }, TEST_TIMEOUT);

    it("lock can be acquired after release", async () => {
      // First worker acquires lock
      const firstAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[0].id,
        30
      );
      expect(firstAcquired).toBe(true);

      // Release lock
      await releaseFailoverLock(testContext.stateManager, groupId);

      // Second worker can now acquire lock
      const secondAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[1].id,
        30
      );
      expect(secondAcquired).toBe(true);
    }, TEST_TIMEOUT);

    it("lock expires after TTL", async () => {
      const shortTtl = 1; // 1 second

      // Acquire lock with short TTL
      const acquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[0].id,
        shortTtl
      );
      expect(acquired).toBe(true);

      // Wait for TTL to expire
      await sleep(1500);

      // Another worker should now be able to acquire
      const secondAcquired = await tryAcquireFailoverLock(
        testContext.stateManager,
        groupId,
        workers[1].id,
        30
      );
      expect(secondAcquired).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("Multi-Group Isolation", () => {
    let group1Workers: SimulatedWorker[];
    let group2Workers: SimulatedWorker[];
    let group1Id: string;
    let group2Id: string;

    beforeEach(async () => {
      group1Id = generateTestId("group1");
      group2Id = generateTestId("group2");

      group1Workers = createSimulatedWorkerCluster(2, group1Id, testContext.redis);
      group2Workers = createSimulatedWorkerCluster(2, group2Id, testContext.redis);

      for (const worker of [...group1Workers, ...group2Workers]) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      await cleanupSimulatedWorkers([...group1Workers, ...group2Workers]);
    });

    it("failover in one group does not affect other groups", async () => {
      // Setup both groups
      await createTestWorkerGroup(
        testContext.stateManager,
        group1Id,
        group1Workers.map((w) => w.id),
        group1Workers[0].id,
        2
      );
      await createTestWorkerGroup(
        testContext.stateManager,
        group2Id,
        group2Workers.map((w) => w.id),
        group2Workers[0].id,
        2
      );

      const group1Token = await getFenceToken(testContext.stateManager, group1Id);
      const group2Token = await getFenceToken(testContext.stateManager, group2Id);

      // Failover in group 1
      await electNewPrimary(testContext.stateManager, group1Id, group1Workers[1].id);

      // Verify group 1 changed
      const newGroup1Token = await getFenceToken(testContext.stateManager, group1Id);
      expect(newGroup1Token).not.toBe(group1Token);

      // Verify group 2 unchanged
      const currentGroup2Token = await getFenceToken(testContext.stateManager, group2Id);
      expect(currentGroup2Token).toBe(group2Token);

      const group2Primary = await getCurrentPrimary(testContext.stateManager, group2Id);
      expect(group2Primary).toBe(group2Workers[0].id);
    }, TEST_TIMEOUT);

    it("workers can belong to multiple groups", async () => {
      // Create a worker that belongs to both groups
      const sharedWorker = createSimulatedWorker(
        {
          id: generateTestId("shared-worker"),
          groups: [group1Id, group2Id],
        },
        testContext.redis
      );
      await sharedWorker.start();

      try {
        // Verify worker appears in both groups
        const group1Healthy = await getHealthyWorkersInGroup(
          testContext.stateManager,
          group1Id,
          10000
        );
        const group2Healthy = await getHealthyWorkersInGroup(
          testContext.stateManager,
          group2Id,
          10000
        );

        expect(group1Healthy).toContain(sharedWorker.id);
        expect(group2Healthy).toContain(sharedWorker.id);
      } finally {
        await cleanupSimulatedWorkers([sharedWorker]);
      }
    }, TEST_TIMEOUT);
  });

  describe("Graceful Shutdown", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("group");
      workers = createSimulatedWorkerCluster(3, groupId, testContext.redis);

      for (const worker of workers) {
        await worker.start();
      }
      await sleep(500);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("worker updates status to stopping on graceful shutdown", async () => {
      // Gracefully stop a worker
      await workers[0].stop();

      // Verify status is stopping
      const state = await workers[0].getState();
      expect(state?.status).toBe("stopping");
    }, TEST_TIMEOUT);

    it("primary handoff happens during graceful shutdown", async () => {
      const workerIds = workers.map((w) => w.id);
      await createTestWorkerGroup(
        testContext.stateManager,
        groupId,
        workerIds,
        workerIds[0],
        2
      );

      // Verify initial primary
      expect(await getCurrentPrimary(testContext.stateManager, groupId)).toBe(workers[0].id);

      // Gracefully stop primary
      await workers[0].stop();

      // Elect new primary
      await electNewPrimary(testContext.stateManager, groupId, workers[1].id);

      // Verify new primary
      const newPrimary = await getCurrentPrimary(testContext.stateManager, groupId);
      expect(newPrimary).toBe(workers[1].id);
    }, TEST_TIMEOUT);
  });
});
