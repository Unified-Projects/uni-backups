/**
 * Failover Integration Tests - REAL REDIS (NO MOCKS)
 *
 * Tests the failover scenarios using actual Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager, REDIS_KEYS } from "@uni-backups/shared/redis";

// Real Redis configuration from environment
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts
};

describe("Failover Integration (Real Redis)", () => {
  let redis: Redis;
  let stateManager: StateManager;

  beforeEach(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    stateManager = new StateManager(redis);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  describe("Quorum-based Voting", () => {
    it("should accumulate votes for unhealthy primary", async () => {
      const groupId = "test-group";
      const primaryWorkerId = "worker-1";

      // Worker 2 votes that primary is down
      const vote1 = await stateManager.castDownVote(
        groupId,
        "worker-2",
        primaryWorkerId
      );
      expect(vote1).toBe(1);

      // Worker 3 votes that primary is down
      const vote2 = await stateManager.castDownVote(
        groupId,
        "worker-3",
        primaryWorkerId
      );
      expect(vote2).toBe(2);

      // Worker 4 votes that primary is down
      const vote3 = await stateManager.castDownVote(
        groupId,
        "worker-4",
        primaryWorkerId
      );
      expect(vote3).toBe(3);
    });

    it("should not double count votes from same worker", async () => {
      const groupId = "test-group";
      const primaryWorkerId = "worker-1";

      // Worker 2 votes
      await stateManager.castDownVote(groupId, "worker-2", primaryWorkerId);

      // Worker 2 votes again (should overwrite, not add)
      const voteCount = await stateManager.castDownVote(
        groupId,
        "worker-2",
        primaryWorkerId
      );

      expect(voteCount).toBe(1); // Still just 1 vote
    });

    it("should track votes for different targets separately", async () => {
      const groupId = "test-group";

      // Some workers think worker-1 is down
      await stateManager.castDownVote(groupId, "voter-1", "worker-1");
      await stateManager.castDownVote(groupId, "voter-2", "worker-1");

      // Some workers think worker-2 is down
      const worker2Votes = await stateManager.castDownVote(
        groupId,
        "voter-3",
        "worker-2"
      );

      expect(worker2Votes).toBe(1); // Only 1 vote for worker-2
    });
  });

  describe("Primary Election", () => {
    it("should elect new primary from failover order", async () => {
      const groupId = "volume-workers";

      // Set up initial group state
      await stateManager.setWorkerGroupState({
        groupId,
        workers: ["worker-1", "worker-2", "worker-3"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 2,
        fenceToken: "initial-token",
        lastElection: Date.now() - 100000,
        lastHealthCheck: Date.now() - 5000,
      });

      // Simulate failover - elect worker-2 as new primary
      await stateManager.updatePrimaryWorker(groupId, "worker-2");

      const updated = await stateManager.getWorkerGroupState(groupId);
      expect(updated!.primaryWorkerId).toBe("worker-2");
      expect(updated!.lastElection).toBeGreaterThan(Date.now() - 1000);
    });

    it("should generate new fence token on failover", async () => {
      const groupId = "test-group";

      await stateManager.setWorkerGroupState({
        groupId,
        workers: ["worker-1", "worker-2"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 2,
        fenceToken: "old-token",
        lastElection: Date.now() - 100000,
        lastHealthCheck: Date.now(),
      });

      await stateManager.updatePrimaryWorker(groupId, "worker-2");

      const updated = await stateManager.getWorkerGroupState(groupId);
      expect(updated!.fenceToken).not.toBe("old-token");
      expect(updated!.fenceToken).toBeTruthy();
    });

    it("should clear votes after failover", async () => {
      const groupId = "test-group";

      // Cast some votes
      await stateManager.castDownVote(groupId, "worker-2", "worker-1");
      await stateManager.castDownVote(groupId, "worker-3", "worker-1");

      // Verify votes exist
      const votesBefore = await redis.hgetall(
        REDIS_KEYS.WORKER_GROUP_VOTES(groupId)
      );
      expect(Object.keys(votesBefore)).toHaveLength(2);

      // Clear votes (simulating post-failover cleanup)
      await stateManager.clearVotes(groupId);

      const votesAfter = await redis.hgetall(
        REDIS_KEYS.WORKER_GROUP_VOTES(groupId)
      );
      expect(Object.keys(votesAfter)).toHaveLength(0);
    });
  });

  describe("Fence Token Validation", () => {
    it("should detect fence token change", async () => {
      const groupId = "test-group";

      await stateManager.setWorkerGroupState({
        groupId,
        workers: ["worker-1", "worker-2"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 2,
        fenceToken: "original-token",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      // Old primary might have stored this token
      const originalToken = "original-token";

      // Failover happens, new token is generated
      await stateManager.updatePrimaryWorker(groupId, "worker-2");

      const updated = await stateManager.getWorkerGroupState(groupId);
      const newToken = updated!.fenceToken;

      // Old primary's token should not match
      expect(newToken).not.toBe(originalToken);
    });
  });

  describe("Distributed Locking", () => {
    it("should prevent concurrent failovers", async () => {
      const groupId = "test-group";

      // Worker 2 acquires failover lock
      const lock1 = await stateManager.acquireFailoverLock(groupId, "worker-2");
      expect(lock1).toBe(true);

      // Worker 3 tries to acquire but fails
      const lock2 = await stateManager.acquireFailoverLock(groupId, "worker-3");
      expect(lock2).toBe(false);

      // Worker 4 also fails
      const lock3 = await stateManager.acquireFailoverLock(groupId, "worker-4");
      expect(lock3).toBe(false);
    });

    it("should allow new lock after release", async () => {
      const groupId = "test-group";

      // Worker 2 acquires and releases lock
      await stateManager.acquireFailoverLock(groupId, "worker-2");
      await stateManager.releaseFailoverLock(groupId);

      // Worker 3 can now acquire
      const lock = await stateManager.acquireFailoverLock(groupId, "worker-3");
      expect(lock).toBe(true);
    });
  });

  describe("Failover Scenario Simulation", () => {
    it("should complete full failover scenario", async () => {
      const groupId = "volume-workers";

      // Initial setup: worker-1 is primary
      await stateManager.setWorkerGroupState({
        groupId,
        workers: ["worker-1", "worker-2", "worker-3"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 2,
        fenceToken: "initial",
        lastElection: Date.now() - 100000,
        lastHealthCheck: Date.now(),
      });

      // Register all workers
      const now = Date.now();
      await stateManager.setWorkerState({
        id: "worker-1",
        name: "Worker 1",
        hostname: "host1",
        groups: [groupId],
        status: "healthy" as const,
        lastHeartbeat: now - 60000, // STALE - 60 seconds ago
        currentJobs: [],
        metrics: { jobsProcessed: 100, jobsFailed: 2, lastJobTime: now - 70000 },
      });

      await stateManager.setWorkerState({
        id: "worker-2",
        name: "Worker 2",
        hostname: "host2",
        groups: [groupId],
        status: "healthy" as const,
        lastHeartbeat: now, // HEALTHY
        currentJobs: [],
        metrics: { jobsProcessed: 50, jobsFailed: 1, lastJobTime: now - 5000 },
      });

      await stateManager.setWorkerState({
        id: "worker-3",
        name: "Worker 3",
        hostname: "host3",
        groups: [groupId],
        status: "healthy" as const,
        lastHeartbeat: now, // HEALTHY
        currentJobs: [],
        metrics: { jobsProcessed: 75, jobsFailed: 0, lastJobTime: now - 10000 },
      });

      // Check healthy workers
      const healthyWorkers = await stateManager.getHealthyWorkers(30000);
      expect(healthyWorkers).not.toContain("worker-1");
      expect(healthyWorkers).toContain("worker-2");
      expect(healthyWorkers).toContain("worker-3");

      // Voting phase
      const vote1 = await stateManager.castDownVote(
        groupId,
        "worker-2",
        "worker-1"
      );
      expect(vote1).toBe(1);

      const vote2 = await stateManager.castDownVote(
        groupId,
        "worker-3",
        "worker-1"
      );
      expect(vote2).toBe(2); // Quorum reached!

      // Acquire lock for failover
      const lockAcquired = await stateManager.acquireFailoverLock(
        groupId,
        "worker-2"
      );
      expect(lockAcquired).toBe(true);

      // Perform failover
      const groupState = await stateManager.getWorkerGroupState(groupId);
      const failoverOrder = groupState!.failoverOrder;

      // Find new primary from failover order that is healthy
      let newPrimaryId: string | null = null;
      for (const candidate of failoverOrder) {
        if (healthyWorkers.includes(candidate)) {
          newPrimaryId = candidate;
          break;
        }
      }

      expect(newPrimaryId).toBe("worker-2");

      await stateManager.updatePrimaryWorker(groupId, newPrimaryId!);
      await stateManager.clearVotes(groupId);
      await stateManager.releaseFailoverLock(groupId);

      // Verify final state
      const finalState = await stateManager.getWorkerGroupState(groupId);
      expect(finalState!.primaryWorkerId).toBe("worker-2");
      expect(finalState!.fenceToken).not.toBe("initial");

      const votes = await redis.hgetall(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
      expect(Object.keys(votes)).toHaveLength(0);
    });
  });

  describe("Concurrent Failover Prevention", () => {
    it("should handle race conditions with locks", async () => {
      const groupId = "race-test-group";

      // Simulate multiple workers trying to failover simultaneously
      const results = await Promise.all([
        stateManager.acquireFailoverLock(groupId, "worker-2"),
        stateManager.acquireFailoverLock(groupId, "worker-3"),
        stateManager.acquireFailoverLock(groupId, "worker-4"),
      ]);

      // Only one should succeed
      const successCount = results.filter((r) => r === true).length;
      expect(successCount).toBe(1);
    });
  });

  describe("Multi-Group Failover", () => {
    it("should handle failover independently across groups", async () => {
      // Set up two groups
      await stateManager.setWorkerGroupState({
        groupId: "group-a",
        workers: ["worker-1", "worker-2"],
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 1,
        fenceToken: "group-a-token",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      await stateManager.setWorkerGroupState({
        groupId: "group-b",
        workers: ["worker-3", "worker-4"],
        primaryWorkerId: "worker-3",
        failoverOrder: ["worker-4"],
        quorumSize: 1,
        fenceToken: "group-b-token",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      // Failover group-a
      await stateManager.updatePrimaryWorker("group-a", "worker-2");

      // Verify group-a changed
      const groupA = await stateManager.getWorkerGroupState("group-a");
      expect(groupA!.primaryWorkerId).toBe("worker-2");

      // Verify group-b unchanged
      const groupB = await stateManager.getWorkerGroupState("group-b");
      expect(groupB!.primaryWorkerId).toBe("worker-3");
      expect(groupB!.fenceToken).toBe("group-b-token");
    });
  });
});
