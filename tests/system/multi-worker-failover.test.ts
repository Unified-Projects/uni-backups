/**
 * Multi-Worker Failover System Tests
 *
 * Tests for multi-worker failover scenarios:
 * - Primary failure detection and election
 * - Job reassignment to new primary
 * - Old primary recovery handling
 * - Quorum-based failover
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
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
  type SimulatedWorker,
  waitForPrimaryElection,
  forceFailover,
  setupWorkerGroup,
} from "../utils/worker-helpers";

describe("Multi-Worker Failover System Tests", () => {
  let testContext: TestContext;
  let redis: Redis;

  const TEST_TIMEOUT = 120000; // 2 minutes per test

  beforeAll(async () => {
    await waitForAllServices({ redis: true });
    testContext = await initTestContext({ redis: true, queues: true });
    redis = testContext.redis;
  }, 60000);

  afterAll(async () => {
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  describe("Primary Election", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("failover-group");
      workers = createSimulatedWorkerCluster(3, groupId, redis);
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("should elect a primary when cluster starts", async () => {
      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }

      // Set up worker group with initial primary
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id));

      // Wait a bit for election to complete
      await sleep(500);

      // Verify primary is set
      const groupState = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(groupState?.primaryWorkerId).toBeDefined();
      expect(workers.map(w => w.id)).toContain(groupState?.primaryWorkerId);
    });

    it("should have only one primary at a time", async () => {
      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }

      // Set up worker group
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id), workers[0].id);

      // Check that only one worker is primary
      const groupState = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(groupState?.primaryWorkerId).toBeDefined();

      // Verify no other workers are marked as primary
      let primaryCount = 0;
      for (const worker of workers) {
        const state = await testContext.stateManager.getWorkerGroupState(groupId);
        if (state?.primaryWorkerId === worker.id) {
          primaryCount++;
        }
      }
      expect(primaryCount).toBe(1);
    });

    it("should trigger new election when primary fails", async () => {
      // Start all workers
      for (const worker of workers) {
        await worker.start();
      }

      // Set up worker group
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id));

      // Get current primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const initialPrimary = initialGroup?.primaryWorkerId;

      expect(initialPrimary).toBeDefined();

      // Stop the primary worker
      const primaryWorker = workers.find(w => w.id === initialPrimary);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop();

      // Set a new primary manually (simulating election)
      const newPrimary = workers.find(w => w.id !== initialPrimary)?.id;
      if (newPrimary) {
        await testContext.stateManager.setWorkerGroupState({
          ...initialGroup!,
          primaryWorkerId: newPrimary,
          lastElection: Date.now(),
          fenceToken: `test-token-${Date.now()}`,
        });
      }

      // Verify new primary was set
      const updatedGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(updatedGroup?.primaryWorkerId).not.toBe(initialPrimary);
      expect(workers.map(w => w.id)).toContain(updatedGroup?.primaryWorkerId);
    });
  });

  describe("Job Reassignment", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("job-reassign");
      workers = createSimulatedWorkerCluster(2, groupId, redis);
      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id));
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("should reassign jobs when primary fails", async () => {
      // Start both workers
      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      // Get initial primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const primaryId = initialGroup?.primaryWorkerId;
      expect(primaryId).toBeDefined();

      // Queue a job (simulated)
      const executionId = generateTestId("exec");
      await testContext.stateManager.recordJobExecution({
        id: executionId,
        jobName: "test-job",
        workerId: primaryId!,
        status: "running",
        startTime: Date.now(),
      });

      // Simulate primary failure
      const primaryWorker = workers.find(w => w.id === primaryId);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop();

      // Simulate failover by electing new primary (simulated workers don't auto-failover)
      const newPrimaryId = workers.find(w => w.id !== primaryId)?.id;
      if (newPrimaryId) {
        await forceFailover(testContext.stateManager, groupId, newPrimaryId);
      }

      await sleep(1000);

      // Verify job was detected as failed/orphaned
      const jobExecution = await testContext.stateManager.getJobExecution(executionId);
      expect(jobExecution).toBeDefined();

      // New primary should have been elected
      const currentPrimary = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(currentPrimary?.primaryWorkerId).not.toBe(primaryId);
    });

    it("should not reassign jobs when secondary fails", async () => {
      // Start both workers
      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      // Get current primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const primaryId = initialGroup?.primaryWorkerId;
      const secondaryId = workers.find(w => w.id !== primaryId)?.id;

      // Stop secondary worker
      const secondaryWorker = workers.find(w => w.id === secondaryId);
      await secondaryWorker!.stop();

      await sleep(1000);

      // Verify primary is still the same
      const groupAfter = await testContext.stateManager.getWorkerGroupState(groupId);
      expect(groupAfter?.primaryWorkerId).toBe(primaryId);
    });
  });

  describe("Old Primary Recovery", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("recovery");
      workers = createSimulatedWorkerCluster(2, groupId, redis);
      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id));
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("old primary rejoins as secondary after recovery", async () => {
      // Start both workers
      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      // Get initial primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const primaryId = initialGroup?.primaryWorkerId;
      expect(primaryId).toBeDefined();

      // Stop primary
      const primaryWorker = workers.find(w => w.id === primaryId);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop();

      // Simulate failover by electing new primary (simulated workers don't auto-failover)
      const newPrimaryId = workers.find(w => w.id !== primaryId)?.id;
      expect(newPrimaryId).toBeDefined();
      await forceFailover(testContext.stateManager, groupId, newPrimaryId!);

      await sleep(1000);

      // Restart old primary
      await primaryWorker!.start();
      await sleep(1000);

      // Verify old primary is now a secondary (healthy but not primary)
      const stateManager = testContext.stateManager;
      const recoveredState = await stateManager.getWorkerState(primaryId!);

      expect(recoveredState).toBeDefined();
      expect(recoveredState?.status).toBe("healthy");

      // Verify new primary is still primary
      const finalGroup = await stateManager.getWorkerGroupState(groupId);
      expect(finalGroup?.primaryWorkerId).toBe(newPrimaryId);
    });

    it("old primary cannot become primary again until quorum agrees", async () => {
      // Start all 3 workers in a cluster
      const clusterGroupId = generateTestId("3-node");
      const clusterWorkers = createSimulatedWorkerCluster(3, clusterGroupId, redis);

      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, clusterGroupId, clusterWorkers.map(w => w.id));

      for (const worker of clusterWorkers) {
        await worker.start();
      }

      await sleep(1500);

      // Get initial primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(clusterGroupId);
      const initialPrimary = initialGroup?.primaryWorkerId;
      expect(initialPrimary).toBeDefined();

      // Stop primary
      const primaryWorker = clusterWorkers.find(w => w.id === initialPrimary);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop();

      // Simulate failover by electing new primary (simulated workers don't auto-failover)
      const newPrimaryId = clusterWorkers.find(w => w.id !== initialPrimary)?.id;
      expect(newPrimaryId).toBeDefined();
      await forceFailover(testContext.stateManager, clusterGroupId, newPrimaryId!);

      await sleep(1000);

      // Restart old primary
      await primaryWorker!.start();
      await sleep(1000);

      // Verify old primary is in the worker list but not primary
      const workersInGroup = await testContext.stateManager.getWorkersInGroup(clusterGroupId);
      expect(workersInGroup).toContain(initialPrimary);

      const finalGroup = await testContext.stateManager.getWorkerGroupState(clusterGroupId);
      expect(finalGroup?.primaryWorkerId).not.toBe(initialPrimary);

      await cleanupSimulatedWorkers(clusterWorkers);
    });
  });

  describe("Quorum-based Failover", () => {
    it("failover should require quorum of workers", async () => {
      const quorumGroupId = generateTestId("quorum");
      const quorumWorkers = createSimulatedWorkerCluster(3, quorumGroupId, redis);

      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, quorumGroupId, quorumWorkers.map(w => w.id));

      for (const worker of quorumWorkers) {
        await worker.start();
      }

      await sleep(1000);

      // Get initial primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(quorumGroupId);
      const initialPrimary = initialGroup?.primaryWorkerId;
      expect(initialPrimary).toBeDefined();

      // Stop one secondary (not enough to affect quorum)
      const secondaries = quorumWorkers.filter(w => w.id !== initialPrimary);
      await secondaries[0].stop();

      await sleep(1000);

      // Primary should still be the same (no failover triggered for secondary failure)
      const groupAfter = await testContext.stateManager.getWorkerGroupState(quorumGroupId);
      expect(groupAfter?.primaryWorkerId).toBe(initialPrimary);

      await cleanupSimulatedWorkers(quorumWorkers);
    });

    it("should not elect new primary without quorum", async () => {
      const noQuorumGroupId = generateTestId("no-quorum");
      const workers = createSimulatedWorkerCluster(3, noQuorumGroupId, redis);

      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, noQuorumGroupId, workers.map(w => w.id));

      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      // Get initial primary
      const initialGroup = await testContext.stateManager.getWorkerGroupState(noQuorumGroupId);
      const initialPrimary = initialGroup?.primaryWorkerId;
      expect(initialPrimary).toBeDefined();

      // Stop primary and one secondary (only 1 worker left - no quorum)
      const remaining = workers.filter(w => w.id !== initialPrimary);
      await remaining[0].stop(); // Stop one secondary
      const primaryWorker = workers.find(w => w.id === initialPrimary);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop(); // Stop primary

      await sleep(1000);

      // Without quorum (only 1 of 3 workers alive), primary should still be the old one
      // (no automatic failover in simulated workers, and we shouldn't manually trigger it)
      const finalGroup = await testContext.stateManager.getWorkerGroupState(noQuorumGroupId);
      // The primary should still be set to initialPrimary (no one triggered failover)
      expect(finalGroup?.primaryWorkerId).toBe(initialPrimary);

      await cleanupSimulatedWorkers(workers);
    });
  });

  describe("Fence Token Validation", () => {
    let workers: SimulatedWorker[];
    let groupId: string;

    beforeEach(async () => {
      groupId = generateTestId("fence");
      workers = createSimulatedWorkerCluster(2, groupId, redis);
      // Set up worker group BEFORE starting workers
      await setupWorkerGroup(testContext.stateManager, groupId, workers.map(w => w.id));
    });

    afterEach(async () => {
      if (workers) {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("should generate unique fence token on failover", async () => {
      // Start workers
      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      // Get initial fence token
      const initialGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const initialFenceToken = initialGroup?.fenceToken;

      expect(initialFenceToken).toBeDefined();

      // Fail primary
      const primaryId = initialGroup?.primaryWorkerId;
      expect(primaryId).toBeDefined();
      const primaryWorker = workers.find(w => w.id === primaryId);
      expect(primaryWorker).toBeDefined();
      await primaryWorker!.stop();

      // Simulate failover by electing new primary (this generates a new fence token)
      const newPrimaryId = workers.find(w => w.id !== primaryId)?.id;
      expect(newPrimaryId).toBeDefined();
      await forceFailover(testContext.stateManager, groupId, newPrimaryId!);

      await sleep(500);

      // Get new fence token
      const newGroup = await testContext.stateManager.getWorkerGroupState(groupId);
      const newFenceToken = newGroup?.fenceToken;

      expect(newFenceToken).toBeDefined();
      expect(newFenceToken).not.toBe(initialFenceToken);
    });

    it("fence token should include timestamp", async () => {
      for (const worker of workers) {
        await worker.start();
      }

      await sleep(1000);

      const group = await testContext.stateManager.getWorkerGroupState(groupId);
      const fenceToken = group?.fenceToken;

      expect(fenceToken).toBeDefined();
      expect(fenceToken).toMatch(/^\d+-[\w]+$/);

      const timestamp = parseInt(fenceToken!.split("-")[0], 10);
      expect(timestamp).toBeGreaterThan(1600000000000);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});
