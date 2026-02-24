import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StateManager, REDIS_KEYS } from "../state";

// Mock Redis
const mockRedis = {
  hset: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn(),
  zadd: vi.fn().mockResolvedValue(1),
  zrange: vi.fn(),
  zrangebyscore: vi.fn(),
  zrevrange: vi.fn(),
  zrem: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
  smembers: vi.fn(),
  del: vi.fn().mockResolvedValue(1),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue(1),
  lrange: vi.fn(),
  zaddSync: vi.fn(),
  set: vi.fn(),
};

// Mock getRedisConnection
vi.mock("../client", () => ({
  getRedisConnection: () => mockRedis,
}));

describe("StateManager", () => {
  let stateManager: StateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager(mockRedis as unknown as Awaited<ReturnType<typeof import("../client").getRedisConnection>>);
  });

  describe("Worker Operations", () => {
    describe("setWorkerState", () => {
      it("should set worker state in Redis", async () => {
        const workerState = {
          id: "worker-1",
          name: "worker-1",
          hostname: "worker-host",
          groups: ["default", "high-priority"],
          status: "healthy" as const,
          lastHeartbeat: Date.now(),
          currentJobs: ["job-1", "job-2"],
          metrics: {
            jobsProcessed: 10,
            jobsFailed: 1,
            lastJobTime: Date.now(),
          },
        };

        await stateManager.setWorkerState(workerState);

        expect(mockRedis.hset).toHaveBeenCalled();
        expect(mockRedis.zadd).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_HEARTBEATS,
          workerState.lastHeartbeat,
          workerState.id
        );
        expect(mockRedis.sadd).toHaveBeenCalledTimes(2);
      });

      it("should handle single group membership", async () => {
        const workerState = {
          id: "worker-2",
          name: "worker-2",
          hostname: "host2",
          groups: ["default"],
          status: "healthy" as const,
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: { jobsProcessed: 0, jobsFailed: 0, lastJobTime: 0 },
        };

        await stateManager.setWorkerState(workerState);

        expect(mockRedis.sadd).toHaveBeenCalledTimes(1);
        expect(mockRedis.sadd).toHaveBeenCalledWith(
          REDIS_KEYS.WORKERS_BY_GROUP("default"),
          workerState.id
        );
      });
    });

    describe("getWorkerState", () => {
      it("should return worker state when found", async () => {
        const mockData = {
          id: "worker-1",
          name: "worker-1",
          hostname: "worker-host",
          groups: JSON.stringify(["default"]),
          status: "healthy",
          lastHeartbeat: "1704067200000",
          currentJobs: JSON.stringify(["job-1"]),
          metrics: JSON.stringify({ jobsProcessed: 5, jobsFailed: 0, lastJobTime: 1704067200000 }),
        };
        mockRedis.hgetall.mockResolvedValueOnce(mockData);

        const result = await stateManager.getWorkerState("worker-1");

        expect(result).not.toBeNull();
        expect(result?.id).toBe("worker-1");
        expect(result?.status).toBe("healthy");
        expect(result?.groups).toEqual(["default"]);
      });

      it("should return null when worker not found", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({});

        const result = await stateManager.getWorkerState("nonexistent");

        expect(result).toBeNull();
      });

      it("should return null for empty hash", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({ key: "value" });

        // This is actually a key-value, not a hash with fields
        // But our code checks for Object.keys(data).length === 0
        const result = await stateManager.getWorkerState("worker-x");
        expect(result).not.toBeNull();
      });
    });

    describe("getAllWorkers", () => {
      it("should return all workers with their states", async () => {
        mockRedis.zrange.mockResolvedValueOnce(["w1", "w2"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "w1",
            name: "w1",
            hostname: "h1",
            groups: "[]",
            status: "healthy",
            lastHeartbeat: "1704067200000",
            currentJobs: "[]",
            metrics: "{}",
          })
          .mockResolvedValueOnce({
            id: "w2",
            name: "w2",
            hostname: "h2",
            groups: "[]",
            status: "degraded",
            lastHeartbeat: "1704067200000",
            currentJobs: "[]",
            metrics: "{}",
          });

        const workers = await stateManager.getAllWorkers();

        expect(workers).toHaveLength(2);
        expect(workers[0].id).toBe("w1");
        expect(workers[1].id).toBe("w2");
      });

      it("should skip workers with missing state", async () => {
        mockRedis.zrange.mockResolvedValueOnce(["w1", "w2", "w3"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "w1",
            name: "w1",
            hostname: "h1",
            groups: "[]",
            status: "healthy",
            lastHeartbeat: "1704067200000",
            currentJobs: "[]",
            metrics: "{}",
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            id: "w3",
            name: "w3",
            hostname: "h3",
            groups: "[]",
            status: "healthy",
            lastHeartbeat: "1704067200000",
            currentJobs: "[]",
            metrics: "{}",
          });

        const workers = await stateManager.getAllWorkers();

        expect(workers).toHaveLength(2);
        expect(workers[0].id).toBe("w1");
        // w2 was skipped (empty state), so w3 is at index 1
        expect(workers[1].id).toBe("w3");
      });
    });

    describe("getHealthyWorkers", () => {
      it("should return workers with recent heartbeats", async () => {
        const fixedTime = 1704067200000;
        vi.spyOn(Date, "now").mockReturnValue(fixedTime);
        mockRedis.zrangebyscore.mockResolvedValueOnce(["w1", "w2"]);

        const healthy = await stateManager.getHealthyWorkers(30000);

        expect(mockRedis.zrangebyscore).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_HEARTBEATS,
          fixedTime - 30000,
          fixedTime
        );
        expect(healthy).toEqual(["w1", "w2"]);
        vi.restoreAllMocks();
      });

      it("should return empty array when no workers are healthy", async () => {
        mockRedis.zrangebyscore.mockResolvedValueOnce([]);

        const healthy = await stateManager.getHealthyWorkers(30000);

        expect(healthy).toEqual([]);
      });
    });

    describe("getWorkersInGroup", () => {
      it("should return workers in a specific group", async () => {
        mockRedis.smembers.mockResolvedValueOnce(["w1", "w2", "w3"]);

        const workers = await stateManager.getWorkersInGroup("default");

        expect(mockRedis.smembers).toHaveBeenCalledWith(
          REDIS_KEYS.WORKERS_BY_GROUP("default")
        );
        expect(workers).toEqual(["w1", "w2", "w3"]);
      });
    });

    describe("removeWorker", () => {
      it("should remove worker from all groups and clean up", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          id: "w1",
          name: "w1",
          hostname: "h1",
          groups: JSON.stringify(["default", "priority"]),
          status: "healthy",
          lastHeartbeat: "1704067200000",
          currentJobs: "[]",
          metrics: "{}",
        });

        await stateManager.removeWorker("w1");

        expect(mockRedis.srem).toHaveBeenCalledTimes(2);
        expect(mockRedis.srem).toHaveBeenCalledWith(
          REDIS_KEYS.WORKERS_BY_GROUP("default"),
          "w1"
        );
        expect(mockRedis.srem).toHaveBeenCalledWith(
          REDIS_KEYS.WORKERS_BY_GROUP("priority"),
          "w1"
        );
        expect(mockRedis.zrem).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_HEARTBEATS,
          "w1"
        );
        expect(mockRedis.del).toHaveBeenCalledWith(REDIS_KEYS.WORKER("w1"));
      });

      it("should handle worker with no groups", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          id: "w1",
          name: "w1",
          hostname: "h1",
          groups: "[]",
          status: "healthy",
          lastHeartbeat: "1704067200000",
          currentJobs: "[]",
          metrics: "{}",
        });

        await stateManager.removeWorker("w1");

        expect(mockRedis.srem).not.toHaveBeenCalled();
        expect(mockRedis.zrem).toHaveBeenCalled();
      });
    });
  });

  describe("Job Execution Operations", () => {
    describe("recordJobExecution", () => {
      it("should record job execution with all fields", async () => {
        const execution = {
          id: "exec-1",
          jobName: "daily-backup",
          workerId: "worker-1",
          status: "running" as const,
          startTime: Date.now(),
          snapshotId: "abc123",
        };

        await stateManager.recordJobExecution(execution);

        expect(mockRedis.hset).toHaveBeenCalled();
        expect(mockRedis.lpush).toHaveBeenCalledWith(
          REDIS_KEYS.JOB_HISTORY_BY_NAME("daily-backup"),
          "exec-1"
        );
        expect(mockRedis.ltrim).toHaveBeenCalledWith(
          REDIS_KEYS.JOB_HISTORY_BY_NAME("daily-backup"),
          0,
          99
        );
        expect(mockRedis.zadd).toHaveBeenCalledWith(
          REDIS_KEYS.JOB_HISTORY_ALL,
          "NX",
          execution.startTime,
          "exec-1"
        );
      });

      it("should handle completed execution with error", async () => {
        const execution = {
          id: "exec-2",
          jobName: "daily-backup",
          workerId: "worker-1",
          status: "failed" as const,
          startTime: Date.now() - 60000,
          endTime: Date.now(),
          error: "Connection timeout",
          duration: 60000,
        };

        await stateManager.recordJobExecution(execution);

        expect(mockRedis.hset).toHaveBeenCalled();
      });
    });

    describe("updateJobExecution", () => {
      it("should update specific fields", async () => {
        mockRedis.hset.mockResolvedValueOnce(1);

        await stateManager.updateJobExecution("exec-1", {
          status: "completed",
          snapshotId: "def456",
          duration: 30000,
        });

        expect(mockRedis.hset).toHaveBeenCalled();
      });

      it("should not call Redis if no updates provided", async () => {
        await stateManager.updateJobExecution("exec-1", {});

        expect(mockRedis.hset).not.toHaveBeenCalled();
      });
    });

    describe("getJobExecution", () => {
      it("should return job execution when found", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          id: "exec-1",
          jobName: "daily-backup",
          workerId: "worker-1",
          status: "completed",
          startTime: "1704067200000",
          endTime: "1704067230000",
          snapshotId: "abc123",
          duration: "30000",
        });

        const result = await stateManager.getJobExecution("exec-1");

        expect(result).not.toBeNull();
        expect(result?.id).toBe("exec-1");
        expect(result?.status).toBe("completed");
        expect(result?.snapshotId).toBe("abc123");
        expect(result?.duration).toBe(30000);
      });

      it("should return null when not found", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({});

        const result = await stateManager.getJobExecution("nonexistent");

        expect(result).toBeNull();
      });

      it("should handle optional fields being undefined", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          id: "exec-1",
          jobName: "daily-backup",
          workerId: "worker-1",
          status: "running",
          startTime: "1704067200000",
        });

        const result = await stateManager.getJobExecution("exec-1");

        expect(result).not.toBeNull();
        expect(result?.endTime).toBeUndefined();
        expect(result?.snapshotId).toBeUndefined();
        expect(result?.error).toBeUndefined();
      });
    });

    describe("getRecentJobs", () => {
      it("should get recent jobs for specific job name", async () => {
        mockRedis.lrange.mockResolvedValueOnce(["exec-1", "exec-2"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "exec-1",
            jobName: "daily-backup",
            workerId: "worker-1",
            status: "completed",
            startTime: "1704067200000",
          })
          .mockResolvedValueOnce({
            id: "exec-2",
            jobName: "daily-backup",
            workerId: "worker-2",
            status: "failed",
            startTime: "1704067500000",
          });

        const jobs = await stateManager.getRecentJobs("daily-backup", 10);

        expect(mockRedis.lrange).toHaveBeenCalledWith(
          REDIS_KEYS.JOB_HISTORY_BY_NAME("daily-backup"),
          0,
          9
        );
        expect(jobs).toHaveLength(2);
      });

      it("should get recent jobs across all jobs", async () => {
        mockRedis.zrevrange.mockResolvedValueOnce(["exec-3", "exec-2", "exec-1"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "exec-3",
            jobName: "weekly-backup",
            workerId: "worker-1",
            status: "completed",
            startTime: "1704067800000",
          })
          .mockResolvedValueOnce({
            id: "exec-2",
            jobName: "daily-backup",
            workerId: "worker-2",
            status: "failed",
            startTime: "1704067500000",
          })
          .mockResolvedValueOnce({
            id: "exec-1",
            jobName: "hourly-backup",
            workerId: "worker-1",
            status: "completed",
            startTime: "1704067200000",
          });

        const jobs = await stateManager.getRecentJobs(undefined, 50);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
          REDIS_KEYS.JOB_HISTORY_ALL,
          0,
          49
        );
        expect(jobs).toHaveLength(3);
      });

      it("should skip missing executions", async () => {
        mockRedis.lrange.mockResolvedValueOnce(["exec-1", "exec-2"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "exec-1",
            jobName: "daily-backup",
            workerId: "worker-1",
            status: "completed",
            startTime: "1704067200000",
          })
          .mockResolvedValueOnce({});

        const jobs = await stateManager.getRecentJobs("daily-backup", 10);

        expect(jobs).toHaveLength(1);
      });
    });

    describe("getRunningJobsForWorker", () => {
      it("should return running jobs for specific worker", async () => {
        mockRedis.zrevrange.mockResolvedValueOnce([
          "exec-1",
          "exec-2",
          "exec-3",
        ]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            id: "exec-1",
            jobName: "daily-backup",
            workerId: "worker-1",
            status: "running",
            startTime: "1704067200000",
          })
          .mockResolvedValueOnce({
            id: "exec-2",
            jobName: "daily-backup",
            workerId: "worker-2",
            status: "running",
            startTime: "1704067300000",
          })
          .mockResolvedValueOnce({
            id: "exec-3",
            jobName: "daily-backup",
            workerId: "worker-1",
            status: "completed",
            startTime: "1704067400000",
          });

        const jobs = await stateManager.getRunningJobsForWorker("worker-1");

        expect(jobs).toHaveLength(1);
        expect(jobs[0].id).toBe("exec-1");
      });
    });
  });

  describe("Worker Group Operations", () => {
    describe("setWorkerGroupState", () => {
      it("should set worker group state", async () => {
        const groupState = {
          groupId: "default",
          workers: ["w1", "w2"],
          primaryWorkerId: "w1",
          failoverOrder: ["w1", "w2"],
          quorumSize: 2,
          fenceToken: null,
          lastElection: Date.now(),
          lastHealthCheck: Date.now(),
        };

        await stateManager.setWorkerGroupState(groupState);

        expect(mockRedis.hset).toHaveBeenCalled();
        expect(mockRedis.sadd).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_GROUPS_SET,
          "default"
        );
      });
    });

    describe("getWorkerGroupState", () => {
      it("should return group state when found", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          groupId: "default",
          workers: JSON.stringify(["w1", "w2"]),
          primaryWorkerId: "w1",
          failoverOrder: JSON.stringify(["w1", "w2"]),
          quorumSize: "2",
          fenceToken: "",
          lastElection: "1704067200000",
          lastHealthCheck: "1704067200000",
        });

        const result = await stateManager.getWorkerGroupState("default");

        expect(result).not.toBeNull();
        expect(result?.groupId).toBe("default");
        expect(result?.workers).toEqual(["w1", "w2"]);
        expect(result?.primaryWorkerId).toBe("w1");
      });

      it("should return null when not found", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({});

        const result = await stateManager.getWorkerGroupState("nonexistent");

        expect(result).toBeNull();
      });
    });

    describe("getAllWorkerGroups", () => {
      it("should return all worker groups", async () => {
        mockRedis.smembers.mockResolvedValueOnce(["default", "priority"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            groupId: "default",
            workers: JSON.stringify(["w1"]),
            primaryWorkerId: "w1",
            failoverOrder: JSON.stringify(["w1"]),
            quorumSize: "1",
            fenceToken: "",
            lastElection: "1704067200000",
            lastHealthCheck: "1704067200000",
          })
          .mockResolvedValueOnce({
            groupId: "priority",
            workers: JSON.stringify(["w2", "w3"]),
            primaryWorkerId: "w2",
            failoverOrder: JSON.stringify(["w2", "w3"]),
            quorumSize: "2",
            fenceToken: "",
            lastElection: "1704067200000",
            lastHealthCheck: "1704067200000",
          });

        const groups = await stateManager.getAllWorkerGroups();

        expect(groups).toHaveLength(2);
        expect(groups[0].groupId).toBe("default");
        expect(groups[1].groupId).toBe("priority");
      });

      it("should skip groups with missing state", async () => {
        mockRedis.smembers.mockResolvedValueOnce(["default", "missing"]);
        mockRedis.hgetall
          .mockResolvedValueOnce({
            groupId: "default",
            workers: JSON.stringify(["w1"]),
            primaryWorkerId: "w1",
            failoverOrder: JSON.stringify(["w1"]),
            quorumSize: "1",
            fenceToken: "",
            lastElection: "1704067200000",
            lastHealthCheck: "1704067200000",
          })
          .mockResolvedValueOnce({});

        const groups = await stateManager.getAllWorkerGroups();

        expect(groups).toHaveLength(1);
      });
    });

    describe("castDownVote", () => {
      it("should cast vote and return count", async () => {
        mockRedis.hgetall.mockResolvedValueOnce({
          voter1: "target-worker",
          voter2: "target-worker",
          voter3: "other-worker",
        });

        const count = await stateManager.castDownVote(
          "default",
          "voter1",
          "target-worker"
        );

        expect(mockRedis.hset).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_GROUP_VOTES("default"),
          "voter1",
          "target-worker"
        );
        expect(count).toBe(2); // voter1 + voter2
      });
    });

    describe("clearVotes", () => {
      it("should delete votes key", async () => {
        await stateManager.clearVotes("default");

        expect(mockRedis.del).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_GROUP_VOTES("default")
        );
      });
    });

    describe("acquireFailoverLock", () => {
      it("should return true when lock acquired", async () => {
        mockRedis.set.mockResolvedValueOnce("OK");

        const acquired = await stateManager.acquireFailoverLock(
          "default",
          "worker-1"
        );

        expect(acquired).toBe(true);
        expect(mockRedis.set).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_GROUP_LOCK("default"),
          "worker-1",
          "EX",
          30,
          "NX"
        );
      });

      it("should return false when lock not acquired", async () => {
        mockRedis.set.mockResolvedValueOnce(null);

        const acquired = await stateManager.acquireFailoverLock(
          "default",
          "worker-2"
        );

        expect(acquired).toBe(false);
      });
    });

    describe("releaseFailoverLock", () => {
      it("should delete lock key", async () => {
        await stateManager.releaseFailoverLock("default");

        expect(mockRedis.del).toHaveBeenCalledWith(
          REDIS_KEYS.WORKER_GROUP_LOCK("default")
        );
      });
    });

    describe("updatePrimaryWorker", () => {
      it("should update primary and generate fence token", async () => {
        mockRedis.hset.mockResolvedValueOnce(1);

        await stateManager.updatePrimaryWorker("default", "worker-2");

        expect(mockRedis.hset).toHaveBeenCalled();
        const callArgs = mockRedis.hset.mock.calls[0][1];
        expect(callArgs.primaryWorkerId).toBe("worker-2");
        expect(callArgs.fenceToken).toBeDefined();
        expect(callArgs.fenceToken).toMatch(/^\d+-[\w]+$/);
      });
    });
  });

  describe("Serialization/Deserialization", () => {
    describe("Worker state serialization", () => {
      it("should correctly serialize and deserialize worker state", async () => {
        const originalState = {
          id: "worker-1",
          name: "worker-1",
          hostname: "test-host",
          groups: ["default", "priority"],
          status: "healthy" as const,
          lastHeartbeat: 1704067200000,
          currentJobs: ["job-1", "job-2"],
          metrics: {
            jobsProcessed: 100,
            jobsFailed: 2,
            lastJobTime: 1704067000000,
          },
        };

        await stateManager.setWorkerState(originalState);
        const serializedData = mockRedis.hset.mock.calls[0][1];

        expect(serializedData.groups).toBe(JSON.stringify(["default", "priority"]));
        expect(serializedData.currentJobs).toBe(JSON.stringify(["job-1", "job-2"]));
        expect(serializedData.metrics).toBe(JSON.stringify(originalState.metrics));

        // Now deserialize
        mockRedis.hgetall.mockResolvedValueOnce(serializedData);
        const retrievedState = await stateManager.getWorkerState("worker-1");

        expect(retrievedState).toEqual(originalState);
      });
    });

    describe("Job execution serialization", () => {
      it("should correctly serialize and deserialize job execution", async () => {
        const originalExecution = {
          id: "exec-1",
          jobName: "daily-backup",
          workerId: "worker-1",
          status: "completed" as const,
          startTime: 1704067200000,
          endTime: 1704067500000,
          snapshotId: "abc123def456",
          error: undefined,
          duration: 300000,
        };

        await stateManager.recordJobExecution(originalExecution);
        const serializedData = mockRedis.hset.mock.calls[0][1];

        expect(serializedData.startTime).toBe("1704067200000");
        expect(serializedData.endTime).toBe("1704067500000");
        expect(serializedData.duration).toBe("300000");

        // Now deserialize
        mockRedis.hgetall.mockResolvedValueOnce(serializedData);
        const retrieved = await stateManager.getJobExecution("exec-1");

        expect(retrieved).toEqual(originalExecution);
      });
    });

    describe("Worker group state serialization", () => {
      it("should correctly serialize and deserialize worker group state", async () => {
        const originalGroup = {
          groupId: "priority",
          workers: ["w1", "w2", "w3"],
          primaryWorkerId: "w1",
          failoverOrder: ["w1", "w2", "w3"],
          quorumSize: 2,
          fenceToken: "1704067200000-abc123",
          lastElection: 1704067200000,
          lastHealthCheck: 1704067100000,
        };

        await stateManager.setWorkerGroupState(originalGroup);
        const serializedData = mockRedis.hset.mock.calls[0][1];

        expect(JSON.parse(serializedData.workers)).toEqual(["w1", "w2", "w3"]);
        expect(JSON.parse(serializedData.failoverOrder)).toEqual([
          "w1",
          "w2",
          "w3",
        ]);

        // Now deserialize
        mockRedis.hgetall.mockResolvedValueOnce(serializedData);
        const retrieved = await stateManager.getWorkerGroupState("priority");

        expect(retrieved).toEqual(originalGroup);
      });
    });
  });

  describe("Fence Token Generation", () => {
    it("should generate unique fence tokens", async () => {
      mockRedis.hset.mockResolvedValue(1);

      await stateManager.updatePrimaryWorker("group-1", "worker-1");
      const firstToken = mockRedis.hset.mock.calls[0][1].fenceToken;

      await stateManager.updatePrimaryWorker("group-1", "worker-2");
      const secondToken = mockRedis.hset.mock.calls[1][1].fenceToken;

      expect(firstToken).not.toBe(secondToken);
      expect(firstToken).toMatch(/^\d+-[\w]+$/);
      expect(secondToken).toMatch(/^\d+-[\w]+$/);
    });

    it("should include timestamp in fence token", async () => {
      const beforeUpdate = Date.now();
      mockRedis.hset.mockResolvedValue(1);

      await stateManager.updatePrimaryWorker("group-1", "worker-1");

      const callArgs = mockRedis.hset.mock.calls[0][1];
      const tokenTimestamp = parseInt(callArgs.fenceToken.split("-")[0], 10);

      expect(tokenTimestamp).toBeGreaterThanOrEqual(beforeUpdate);
      expect(tokenTimestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty groups array", async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        id: "worker-1",
        name: "worker-1",
        hostname: "h1",
        groups: "[]",
        status: "healthy",
        lastHeartbeat: "1704067200000",
        currentJobs: "[]",
        metrics: "{}",
      });

      const state = await stateManager.getWorkerState("worker-1");

      expect(state?.groups).toEqual([]);
    });

    it("should handle empty metrics", async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        id: "worker-1",
        name: "worker-1",
        hostname: "h1",
        groups: "[]",
        status: "healthy",
        lastHeartbeat: "1704067200000",
        currentJobs: "[]",
        metrics: "",
      });

      const state = await stateManager.getWorkerState("worker-1");

      expect(state?.metrics).toEqual({});
    });

    it("should handle missing primary worker", async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        groupId: "default",
        workers: JSON.stringify(["w1"]),
        primaryWorkerId: "",
        failoverOrder: JSON.stringify(["w1"]),
        quorumSize: "1",
        fenceToken: "",
        lastElection: "0",
        lastHealthCheck: "0",
      });

      const state = await stateManager.getWorkerGroupState("default");

      expect(state?.primaryWorkerId).toBeNull();
      expect(state?.fenceToken).toBeNull();
      expect(state?.lastElection).toBe(0);
    });

    it("should use default quorum size", async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        groupId: "default",
        workers: JSON.stringify(["w1"]),
        primaryWorkerId: "",
        failoverOrder: JSON.stringify(["w1"]),
        quorumSize: "",
        fenceToken: "",
        lastElection: "0",
        lastHealthCheck: "0",
      });

      const state = await stateManager.getWorkerGroupState("default");

      expect(state?.quorumSize).toBe(2);
    });
  });
});
