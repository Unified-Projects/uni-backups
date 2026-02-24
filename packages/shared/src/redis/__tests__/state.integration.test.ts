/**
 * StateManager tests - REAL REDIS (NO MOCKS)
 *
 * Tests for Redis state management including workers, jobs, and worker groups.
 * Runs against actual Redis via Docker DNS or localhost.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager, REDIS_KEYS } from "../state";

// Real Redis configuration from environment
// Use DB 13 to avoid conflicts with other test files
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 13, // Use DB 13 to avoid conflicts with queue tests using DB 15
};

describe("StateManager (Real Redis)", () => {
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

  // ==================== Worker Operations ====================

  describe("Worker Operations", () => {
    const createWorkerState = (overrides = {}) => ({
      id: "worker-1",
      name: "Test Worker",
      hostname: "localhost",
      groups: ["default", "db-workers"],
      status: "healthy" as const,
      lastHeartbeat: Date.now(),
      currentJobs: [],
      metrics: {
        jobsProcessed: 10,
        jobsFailed: 1,
        lastJobTime: Date.now() - 1000,
      },
      ...overrides,
    });

    describe("setWorkerState", () => {
      it("should store worker state in hash", async () => {
        const state = createWorkerState();
        await stateManager.setWorkerState(state);

        const stored = await redis.hgetall(REDIS_KEYS.WORKER(state.id));
        expect(stored.id).toBe(state.id);
        expect(stored.name).toBe(state.name);
        expect(stored.hostname).toBe(state.hostname);
        expect(stored.status).toBe(state.status);
        expect(JSON.parse(stored.groups)).toEqual(state.groups);
      });

      it("should update heartbeat sorted set", async () => {
        const state = createWorkerState();
        await stateManager.setWorkerState(state);

        const score = await redis.zscore(
          REDIS_KEYS.WORKER_HEARTBEATS,
          state.id
        );
        expect(Number(score)).toBe(state.lastHeartbeat);
      });

      it("should update group memberships", async () => {
        const state = createWorkerState();
        await stateManager.setWorkerState(state);

        for (const groupId of state.groups) {
          const members = await redis.smembers(
            REDIS_KEYS.WORKERS_BY_GROUP(groupId)
          );
          expect(members).toContain(state.id);
        }
      });
    });

    describe("getWorkerState", () => {
      it("should retrieve and deserialize worker state", async () => {
        const state = createWorkerState();
        await stateManager.setWorkerState(state);

        const retrieved = await stateManager.getWorkerState(state.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(state.id);
        expect(retrieved!.name).toBe(state.name);
        expect(retrieved!.groups).toEqual(state.groups);
        expect(retrieved!.metrics).toEqual(state.metrics);
      });

      it("should return null for non-existent worker", async () => {
        const retrieved = await stateManager.getWorkerState("non-existent");
        expect(retrieved).toBeNull();
      });
    });

    describe("getAllWorkers", () => {
      it("should return all registered workers", async () => {
        const worker1 = createWorkerState({ id: "worker-1" });
        const worker2 = createWorkerState({ id: "worker-2" });
        const worker3 = createWorkerState({ id: "worker-3" });

        await stateManager.setWorkerState(worker1);
        await stateManager.setWorkerState(worker2);
        await stateManager.setWorkerState(worker3);

        const workers = await stateManager.getAllWorkers();
        expect(workers).toHaveLength(3);
        expect(workers.map((w) => w.id).sort()).toEqual([
          "worker-1",
          "worker-2",
          "worker-3",
        ]);
      });
    });

    describe("getHealthyWorkers", () => {
      it("should filter by heartbeat threshold", async () => {
        const now = Date.now();
        const healthyWorker = createWorkerState({
          id: "healthy-worker",
          lastHeartbeat: now - 5000, // 5 seconds ago
        });
        const unhealthyWorker = createWorkerState({
          id: "unhealthy-worker",
          lastHeartbeat: now - 60000, // 60 seconds ago
        });

        await stateManager.setWorkerState(healthyWorker);
        await stateManager.setWorkerState(unhealthyWorker);

        const healthy = await stateManager.getHealthyWorkers(30000);
        expect(healthy).toContain("healthy-worker");
        expect(healthy).not.toContain("unhealthy-worker");
      });

      it("should return empty array when no healthy workers", async () => {
        const unhealthyWorker = createWorkerState({
          lastHeartbeat: Date.now() - 120000, // 2 minutes ago
        });
        await stateManager.setWorkerState(unhealthyWorker);

        const healthy = await stateManager.getHealthyWorkers(30000);
        expect(healthy).toHaveLength(0);
      });
    });

    describe("getWorkersInGroup", () => {
      it("should return workers in specific group", async () => {
        const worker1 = createWorkerState({
          id: "worker-1",
          groups: ["default", "group-a"],
        });
        const worker2 = createWorkerState({
          id: "worker-2",
          groups: ["default", "group-b"],
        });
        const worker3 = createWorkerState({
          id: "worker-3",
          groups: ["group-a"],
        });

        await stateManager.setWorkerState(worker1);
        await stateManager.setWorkerState(worker2);
        await stateManager.setWorkerState(worker3);

        const groupAWorkers = await stateManager.getWorkersInGroup("group-a");
        expect(groupAWorkers.sort()).toEqual(["worker-1", "worker-3"]);

        const groupBWorkers = await stateManager.getWorkersInGroup("group-b");
        expect(groupBWorkers).toEqual(["worker-2"]);

        const defaultWorkers = await stateManager.getWorkersInGroup("default");
        expect(defaultWorkers.sort()).toEqual(["worker-1", "worker-2"]);
      });
    });

    describe("removeWorker", () => {
      it("should clean up all worker data", async () => {
        const state = createWorkerState();
        await stateManager.setWorkerState(state);

        // Verify worker exists
        expect(await stateManager.getWorkerState(state.id)).not.toBeNull();

        // Remove worker
        await stateManager.removeWorker(state.id);

        // Verify cleanup
        expect(await stateManager.getWorkerState(state.id)).toBeNull();
        expect(
          await redis.zscore(REDIS_KEYS.WORKER_HEARTBEATS, state.id)
        ).toBeNull();

        for (const groupId of state.groups) {
          const members = await redis.smembers(
            REDIS_KEYS.WORKERS_BY_GROUP(groupId)
          );
          expect(members).not.toContain(state.id);
        }
      });
    });
  });

  // ==================== Job Execution Operations ====================

  describe("Job Execution Operations", () => {
    const createJobExecution = (overrides = {}) => ({
      id: "exec-123",
      jobName: "test-backup",
      workerId: "worker-1",
      status: "running" as const,
      startTime: Date.now(),
      ...overrides,
    });

    describe("recordJobExecution", () => {
      it("should store execution in hash", async () => {
        const execution = createJobExecution();
        await stateManager.recordJobExecution(execution);

        const stored = await redis.hgetall(REDIS_KEYS.JOB_HISTORY(execution.id));
        expect(stored.id).toBe(execution.id);
        expect(stored.jobName).toBe(execution.jobName);
        expect(stored.workerId).toBe(execution.workerId);
        expect(stored.status).toBe(execution.status);
      });

      it("should add to job-specific history", async () => {
        const execution = createJobExecution();
        await stateManager.recordJobExecution(execution);

        const history = await redis.lrange(
          REDIS_KEYS.JOB_HISTORY_BY_NAME(execution.jobName),
          0,
          -1
        );
        expect(history).toContain(execution.id);
      });

      it("should add to global sorted set", async () => {
        const execution = createJobExecution();
        await stateManager.recordJobExecution(execution);

        const score = await redis.zscore(
          REDIS_KEYS.JOB_HISTORY_ALL,
          execution.id
        );
        expect(Number(score)).toBe(execution.startTime);
      });
    });

    describe("updateJobExecution", () => {
      it("should update specific fields", async () => {
        const execution = createJobExecution();
        await stateManager.recordJobExecution(execution);

        const endTime = Date.now() + 5000;
        await stateManager.updateJobExecution(execution.id, {
          status: "completed",
          endTime,
          snapshotId: "snap-123",
          duration: 5000,
        });

        const updated = await stateManager.getJobExecution(execution.id);
        expect(updated!.status).toBe("completed");
        expect(updated!.endTime).toBe(endTime);
        expect(updated!.snapshotId).toBe("snap-123");
        expect(updated!.duration).toBe(5000);
      });
    });

    describe("getJobExecution", () => {
      it("should retrieve execution by ID", async () => {
        const execution = createJobExecution({
          status: "completed",
          endTime: Date.now() + 5000,
          snapshotId: "snap-456",
        });
        await stateManager.recordJobExecution(execution);

        const retrieved = await stateManager.getJobExecution(execution.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(execution.id);
        expect(retrieved!.snapshotId).toBe(execution.snapshotId);
      });

      it("should return null for non-existent execution", async () => {
        const retrieved = await stateManager.getJobExecution("non-existent");
        expect(retrieved).toBeNull();
      });
    });

    describe("getRecentJobs", () => {
      it("should return recent executions globally", async () => {
        const now = Date.now();
        const exec1 = createJobExecution({
          id: "exec-1",
          startTime: now - 3000,
        });
        const exec2 = createJobExecution({
          id: "exec-2",
          startTime: now - 2000,
        });
        const exec3 = createJobExecution({
          id: "exec-3",
          startTime: now - 1000,
        });

        await stateManager.recordJobExecution(exec1);
        await stateManager.recordJobExecution(exec2);
        await stateManager.recordJobExecution(exec3);

        const recent = await stateManager.getRecentJobs(undefined, 10);
        expect(recent).toHaveLength(3);
        // Should be in reverse chronological order
        expect(recent[0].id).toBe("exec-3");
        expect(recent[1].id).toBe("exec-2");
        expect(recent[2].id).toBe("exec-1");
      });

      it("should filter by job name", async () => {
        const exec1 = createJobExecution({
          id: "exec-1",
          jobName: "backup-a",
        });
        const exec2 = createJobExecution({
          id: "exec-2",
          jobName: "backup-b",
        });
        const exec3 = createJobExecution({
          id: "exec-3",
          jobName: "backup-a",
        });

        await stateManager.recordJobExecution(exec1);
        await stateManager.recordJobExecution(exec2);
        await stateManager.recordJobExecution(exec3);

        const recent = await stateManager.getRecentJobs("backup-a", 10);
        expect(recent).toHaveLength(2);
        expect(recent.every((r) => r.jobName === "backup-a")).toBe(true);
      });

      it("should respect limit parameter", async () => {
        for (let i = 0; i < 10; i++) {
          await stateManager.recordJobExecution(
            createJobExecution({
              id: `exec-${i}`,
              startTime: Date.now() - i * 1000,
            })
          );
        }

        const recent = await stateManager.getRecentJobs(undefined, 3);
        expect(recent).toHaveLength(3);
      });
    });

    describe("getRunningJobsForWorker", () => {
      it("should filter running jobs by worker", async () => {
        const exec1 = createJobExecution({
          id: "exec-1",
          workerId: "worker-1",
          status: "running",
        });
        const exec2 = createJobExecution({
          id: "exec-2",
          workerId: "worker-2",
          status: "running",
        });
        const exec3 = createJobExecution({
          id: "exec-3",
          workerId: "worker-1",
          status: "completed",
        });

        await stateManager.recordJobExecution(exec1);
        await stateManager.recordJobExecution(exec2);
        await stateManager.recordJobExecution(exec3);

        const running = await stateManager.getRunningJobsForWorker("worker-1");
        expect(running).toHaveLength(1);
        expect(running[0].id).toBe("exec-1");
        expect(running[0].workerId).toBe("worker-1");
        expect(running[0].status).toBe("running");
      });
    });
  });

  // ==================== Worker Group Operations ====================

  describe("Worker Group Operations", () => {
    const createGroupState = (overrides = {}) => ({
      groupId: "volume-workers",
      workers: ["worker-1", "worker-2", "worker-3"],
      primaryWorkerId: "worker-1",
      failoverOrder: ["worker-1", "worker-2", "worker-3"],
      quorumSize: 2,
      fenceToken: null,
      lastElection: Date.now() - 10000,
      lastHealthCheck: Date.now() - 5000,
      ...overrides,
    });

    describe("setWorkerGroupState", () => {
      it("should store group state", async () => {
        const state = createGroupState();
        await stateManager.setWorkerGroupState(state);

        const stored = await redis.hgetall(
          REDIS_KEYS.WORKER_GROUP(state.groupId)
        );
        expect(stored.groupId).toBe(state.groupId);
        expect(stored.primaryWorkerId).toBe(state.primaryWorkerId);
        expect(JSON.parse(stored.workers)).toEqual(state.workers);
        expect(JSON.parse(stored.failoverOrder)).toEqual(state.failoverOrder);
      });
    });

    describe("getWorkerGroupState", () => {
      it("should retrieve group state", async () => {
        const state = createGroupState();
        await stateManager.setWorkerGroupState(state);

        const retrieved = await stateManager.getWorkerGroupState(state.groupId);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.groupId).toBe(state.groupId);
        expect(retrieved!.workers).toEqual(state.workers);
        expect(retrieved!.primaryWorkerId).toBe(state.primaryWorkerId);
        expect(retrieved!.quorumSize).toBe(state.quorumSize);
      });

      it("should return null for non-existent group", async () => {
        const retrieved =
          await stateManager.getWorkerGroupState("non-existent");
        expect(retrieved).toBeNull();
      });
    });

    describe("getAllWorkerGroups", () => {
      it("should return all groups excluding votes/locks", async () => {
        const group1 = createGroupState({ groupId: "group-1" });
        const group2 = createGroupState({ groupId: "group-2" });

        await stateManager.setWorkerGroupState(group1);
        await stateManager.setWorkerGroupState(group2);

        // Add votes and lock keys that should be excluded
        await redis.hset(REDIS_KEYS.WORKER_GROUP_VOTES("group-1"), {
          "worker-2": "worker-1",
        });
        await redis.set(REDIS_KEYS.WORKER_GROUP_LOCK("group-1"), "worker-2");

        const groups = await stateManager.getAllWorkerGroups();
        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.groupId).sort()).toEqual([
          "group-1",
          "group-2",
        ]);
      });
    });

    describe("castDownVote", () => {
      it("should record vote and return count", async () => {
        const groupId = "test-group";

        // First vote
        const count1 = await stateManager.castDownVote(
          groupId,
          "voter-1",
          "target-worker"
        );
        expect(count1).toBe(1);

        // Second vote for same target
        const count2 = await stateManager.castDownVote(
          groupId,
          "voter-2",
          "target-worker"
        );
        expect(count2).toBe(2);

        // Vote for different target
        const count3 = await stateManager.castDownVote(
          groupId,
          "voter-3",
          "other-worker"
        );
        expect(count3).toBe(1);
      });

      it("should overwrite existing vote from same voter", async () => {
        const groupId = "test-group";

        await stateManager.castDownVote(groupId, "voter-1", "target-1");
        const count = await stateManager.castDownVote(
          groupId,
          "voter-1",
          "target-2"
        );

        // voter-1's vote changed from target-1 to target-2
        const votes = await redis.hgetall(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
        expect(votes["voter-1"]).toBe("target-2");
        expect(count).toBe(1);
      });
    });

    describe("clearVotes", () => {
      it("should remove all votes for group", async () => {
        const groupId = "test-group";

        await stateManager.castDownVote(groupId, "voter-1", "target");
        await stateManager.castDownVote(groupId, "voter-2", "target");

        await stateManager.clearVotes(groupId);

        const votes = await redis.hgetall(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
        expect(Object.keys(votes)).toHaveLength(0);
      });
    });

    describe("acquireFailoverLock", () => {
      it("should acquire NX lock", async () => {
        const groupId = "test-group";

        const acquired = await stateManager.acquireFailoverLock(
          groupId,
          "worker-1"
        );
        expect(acquired).toBe(true);

        const lockValue = await redis.get(REDIS_KEYS.WORKER_GROUP_LOCK(groupId));
        expect(lockValue).toBe("worker-1");
      });

      it("should fail if lock exists", async () => {
        const groupId = "test-group";

        // First worker acquires lock
        const first = await stateManager.acquireFailoverLock(
          groupId,
          "worker-1"
        );
        expect(first).toBe(true);

        // Second worker fails to acquire
        const second = await stateManager.acquireFailoverLock(
          groupId,
          "worker-2"
        );
        expect(second).toBe(false);
      });
    });

    describe("releaseFailoverLock", () => {
      it("should remove lock", async () => {
        const groupId = "test-group";

        await stateManager.acquireFailoverLock(groupId, "worker-1");
        await stateManager.releaseFailoverLock(groupId);

        const lockValue = await redis.get(REDIS_KEYS.WORKER_GROUP_LOCK(groupId));
        expect(lockValue).toBeNull();
      });
    });

    describe("updatePrimaryWorker", () => {
      it("should update primary and generate new fence token", async () => {
        const groupId = "test-group";
        const state = createGroupState({ groupId });
        await stateManager.setWorkerGroupState(state);

        await stateManager.updatePrimaryWorker(groupId, "worker-2");

        const updated = await stateManager.getWorkerGroupState(groupId);
        expect(updated!.primaryWorkerId).toBe("worker-2");
        expect(updated!.fenceToken).not.toBeNull();
        expect(updated!.fenceToken).toMatch(/^\d+-[a-z0-9]+$/);
        expect(updated!.lastElection).toBeGreaterThan(state.lastElection);
      });
    });
  });
});
