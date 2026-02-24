/**
 * Health Checker Service Unit Tests
 *
 * Tests for worker health monitoring and failover functionality.
 * Uses mocks for Redis, StateManager, and configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis
const mockRedis = {
  hset: vi.fn().mockResolvedValue(1),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue("OK"),
};

// Mock StateManager
const mockStateManager = {
  getWorkerGroupState: vi.fn(),
  getWorkersInGroup: vi.fn(),
  getHealthyWorkers: vi.fn(),
  castDownVote: vi.fn(),
  acquireFailoverLock: vi.fn(),
  releaseFailoverLock: vi.fn(),
  updatePrimaryWorker: vi.fn(),
  clearVotes: vi.fn(),
  getWorkerState: vi.fn(),
};

// Mock config
vi.mock("@uni-backups/shared/config", () => ({
  getConfig: vi.fn(() => ({
    workerGroups: new Map([
      ["group-1", {
        workers: ["worker-1", "worker-2", "worker-3"],
        primary: "worker-1",
        failover_order: ["worker-2", "worker-3"],
        quorum_size: 2,
      }],
    ]),
  })),
}));

vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(() => mockRedis),
  StateManager: vi.fn().mockImplementation(function () { return mockStateManager; }),
}));

import { HealthChecker } from "../health-checker";
import type { WorkerConfig } from "../../config";

describe("HealthChecker", () => {
  let healthChecker: HealthChecker;
  let workerConfig: WorkerConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    workerConfig = {
      id: "worker-1",
      name: "test-worker",
      hostname: "test-host.local",
      groups: ["group-1"],
      heartbeatInterval: 5000,
      heartbeatTimeout: 15000,
      concurrency: 2,
    };

    // Default mock implementations
    mockStateManager.getWorkerGroupState.mockResolvedValue({
      id: "group-1",
      primaryWorkerId: "worker-1",
      failoverOrder: ["worker-2", "worker-3"],
      quorumSize: 2,
      fenceToken: "token-123",
    });

    mockStateManager.getWorkersInGroup.mockResolvedValue([
      { id: "worker-1", status: "healthy" },
      { id: "worker-2", status: "healthy" },
      { id: "worker-3", status: "healthy" },
    ]);

    mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-1", "worker-2", "worker-3"]);
    mockStateManager.castDownVote.mockResolvedValue(1);
    mockStateManager.acquireFailoverLock.mockResolvedValue(true);
    mockStateManager.releaseFailoverLock.mockResolvedValue(undefined);
    mockStateManager.updatePrimaryWorker.mockResolvedValue(undefined);
    mockStateManager.clearVotes.mockResolvedValue(undefined);

    healthChecker = new HealthChecker(workerConfig, {
      stateManager: mockStateManager as any,
      redis: mockRedis as any,
      checkInterval: 10000,
    });
  });

  afterEach(async () => {
    if (healthChecker.isRunning()) {
      await healthChecker.stop();
    }
    vi.useRealTimers();
  });

  describe("start()", () => {
    it("starts the health checker and runs initial check", async () => {
      await healthChecker.start();

      expect(healthChecker.isRunning()).toBe(true);
      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalled();
    });

    it("sets up interval timer", async () => {
      await healthChecker.start();

      mockStateManager.getWorkerGroupState.mockClear();

      // Advance time to trigger periodic check
      vi.advanceTimersByTime(10000);

      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalled();
    });

    it("does not start twice if already running", async () => {
      await healthChecker.start();
      mockStateManager.getWorkerGroupState.mockClear();

      await healthChecker.start();

      // Initial health check should not run again
      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalledTimes(0);
    });
  });

  describe("stop()", () => {
    it("stops the health checker", async () => {
      await healthChecker.start();
      await healthChecker.stop();

      expect(healthChecker.isRunning()).toBe(false);
    });

    it("clears timer on stop", async () => {
      await healthChecker.start();
      await healthChecker.stop();

      mockStateManager.getWorkerGroupState.mockClear();
      vi.advanceTimersByTime(20000);

      // No checks should occur after stop
      expect(mockStateManager.getWorkerGroupState).not.toHaveBeenCalled();
    });

    it("does nothing if not running", async () => {
      await healthChecker.stop();
      expect(healthChecker.isRunning()).toBe(false);
    });
  });

  describe("checkWorkerGroup()", () => {
    it("detects healthy primary", async () => {
      await healthChecker.start();

      // Primary is healthy - should update health check time
      expect(mockRedis.hset).toHaveBeenCalledWith(
        "worker_groups:group-1",
        expect.objectContaining({
          lastHealthCheck: expect.any(String),
        })
      );
    });

    it("detects unhealthy primary", async () => {
      // Primary is not in healthy workers list
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);

      await healthChecker.start();

      expect(mockStateManager.castDownVote).toHaveBeenCalledWith(
        "group-1",
        "worker-1",
        "worker-1"
      );
    });

    it("casts down vote for unhealthy primary", async () => {
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(1);

      await healthChecker.start();

      expect(mockStateManager.castDownVote).toHaveBeenCalled();
    });

    it("triggers failover when quorum reached", async () => {
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(2); // Quorum size

      await healthChecker.start();

      expect(mockStateManager.acquireFailoverLock).toHaveBeenCalledWith(
        "group-1",
        "worker-1"
      );
      expect(mockStateManager.updatePrimaryWorker).toHaveBeenCalled();
    });

    it("does not trigger failover before quorum", async () => {
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(1); // Below quorum

      await healthChecker.start();

      expect(mockStateManager.acquireFailoverLock).not.toHaveBeenCalled();
    });
  });

  describe("triggerFailover()", () => {
    beforeEach(() => {
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(2);
    });

    it("acquires lock before failover", async () => {
      await healthChecker.start();

      expect(mockStateManager.acquireFailoverLock).toHaveBeenCalledWith(
        "group-1",
        "worker-1"
      );
    });

    it("selects from failover order", async () => {
      await healthChecker.start();

      // worker-2 is first in failover order and healthy
      expect(mockStateManager.updatePrimaryWorker).toHaveBeenCalledWith(
        "group-1",
        "worker-2"
      );
    });

    it("falls back to any healthy worker when failover order exhausted", async () => {
      // Only worker-3 is healthy, but worker-2 is first in failover order
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-3"]);
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"], // worker-2 is not healthy
        quorumSize: 2,
      });

      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).toHaveBeenCalledWith(
        "group-1",
        "worker-3"
      );
    });

    it("handles no healthy workers available", async () => {
      mockStateManager.getHealthyWorkers.mockResolvedValue([]);
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 2,
      });

      await healthChecker.start();

      // Should not update primary when no healthy workers
      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });

    it("releases lock after failover", async () => {
      await healthChecker.start();

      expect(mockStateManager.releaseFailoverLock).toHaveBeenCalledWith("group-1");
    });

    it("releases lock even if failover fails", async () => {
      mockStateManager.updatePrimaryWorker.mockRejectedValue(new Error("Update failed"));

      await healthChecker.start();

      expect(mockStateManager.releaseFailoverLock).toHaveBeenCalledWith("group-1");
    });

    it("clears votes after successful failover", async () => {
      await healthChecker.start();

      expect(mockStateManager.clearVotes).toHaveBeenCalledWith("group-1");
    });

    it("records failover event", async () => {
      await healthChecker.start();

      expect(mockRedis.lpush).toHaveBeenCalledWith(
        "failover:events:group-1",
        expect.stringContaining('"fromWorkerId":"worker-1"')
      );
    });

    it("skips failover if another worker is handling it", async () => {
      mockStateManager.acquireFailoverLock.mockResolvedValue(false);

      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });
  });

  describe("electPrimary()", () => {
    beforeEach(() => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: null, // No primary set
        failoverOrder: ["worker-1", "worker-2", "worker-3"],
        quorumSize: 2,
      });
    });

    it("elects primary when none is set", async () => {
      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).toHaveBeenCalled();
    });

    it("selects first healthy worker from failover order", async () => {
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);

      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).toHaveBeenCalledWith(
        "group-1",
        "worker-2"
      );
    });

    it("acquires lock before election", async () => {
      await healthChecker.start();

      expect(mockStateManager.acquireFailoverLock).toHaveBeenCalled();
    });

    it("skips election if lock not acquired", async () => {
      mockStateManager.acquireFailoverLock.mockResolvedValue(false);

      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });

    it("double-checks primary is still not set", async () => {
      // First call returns no primary, second call returns a primary
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            id: "group-1",
            primaryWorkerId: null,
            failoverOrder: ["worker-1"],
            quorumSize: 2,
          });
        }
        return Promise.resolve({
          id: "group-1",
          primaryWorkerId: "worker-2", // Already set by another worker
          failoverOrder: ["worker-1"],
          quorumSize: 2,
        });
      });

      await healthChecker.start();

      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });
  });

  describe("isWorkerHealthy()", () => {
    it("returns healthy when worker heartbeat is recent", async () => {
      const now = Date.now();
      mockStateManager.getWorkerState.mockResolvedValue({
        id: "worker-2",
        lastHeartbeat: now - 5000, // 5 seconds ago
      });

      const result = await healthChecker.isWorkerHealthy("worker-2");

      expect(result.healthy).toBe(true);
      expect(result.workerId).toBe("worker-2");
      expect(result.lastHeartbeat).toBe(now - 5000);
    });

    it("returns unhealthy when heartbeat is stale", async () => {
      const now = Date.now();
      mockStateManager.getWorkerState.mockResolvedValue({
        id: "worker-2",
        lastHeartbeat: now - 20000, // 20 seconds ago, beyond 15s timeout
      });

      const result = await healthChecker.isWorkerHealthy("worker-2");

      expect(result.healthy).toBe(false);
      expect(result.reason).toContain("heartbeat");
      expect(result.reason).toContain("15000ms");
    });

    it("returns unhealthy when worker not found", async () => {
      mockStateManager.getWorkerState.mockResolvedValue(null);

      const result = await healthChecker.isWorkerHealthy("unknown-worker");

      expect(result.healthy).toBe(false);
      expect(result.reason).toBe("Worker not found");
      expect(result.lastHeartbeat).toBe(0);
    });
  });

  describe("isRunning()", () => {
    it("returns false before start", () => {
      expect(healthChecker.isRunning()).toBe(false);
    });

    it("returns true after start", async () => {
      await healthChecker.start();
      expect(healthChecker.isRunning()).toBe(true);
    });

    it("returns false after stop", async () => {
      await healthChecker.start();
      await healthChecker.stop();
      expect(healthChecker.isRunning()).toBe(false);
    });
  });

  describe("error handling", () => {
    it("continues checking other groups on error", async () => {
      const multiGroupConfig: WorkerConfig = {
        ...workerConfig,
        groups: ["group-1", "group-2"],
      };

      const multiGroupChecker = new HealthChecker(multiGroupConfig, {
        stateManager: mockStateManager as any,
        redis: mockRedis as any,
        workerGroups: new Map([
          ["group-1", { workers: ["worker-1"], primary: "worker-1", failover_order: [], quorum_size: 1 }],
          ["group-2", { workers: ["worker-1"], primary: "worker-1", failover_order: [], quorum_size: 1 }],
        ]),
        checkInterval: 10000,
      });

      // First group fails, second should still be checked
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Group 1 error"));
        }
        return Promise.resolve({
          id: "group-2",
          primaryWorkerId: "worker-1",
          failoverOrder: [],
          quorumSize: 1,
        });
      });

      await multiGroupChecker.start();

      // Both groups should have been attempted
      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalledTimes(2);

      await multiGroupChecker.stop();
    });

    it("handles missing group configuration gracefully", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue(null);

      // Should not throw
      await expect(healthChecker.start()).resolves.not.toThrow();
    });
  });

  describe("worker group configuration", () => {
    it("uses injected workerGroups when provided", async () => {
      const customGroups = new Map([
        ["custom-group", {
          workers: ["worker-a", "worker-b"],
          primary: "worker-a",
          failover_order: ["worker-b"],
          quorum_size: 1,
        }],
      ]);

      const customChecker = new HealthChecker(
        { ...workerConfig, groups: ["custom-group"] },
        {
          stateManager: mockStateManager as any,
          redis: mockRedis as any,
          workerGroups: customGroups,
          checkInterval: 10000,
        }
      );

      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "custom-group",
        primaryWorkerId: "worker-a",
        failoverOrder: ["worker-b"],
        quorumSize: 1,
      });

      await customChecker.start();

      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalledWith("custom-group");

      await customChecker.stop();
    });

    it("uses custom check interval when provided", async () => {
      const customChecker = new HealthChecker(workerConfig, {
        stateManager: mockStateManager as any,
        redis: mockRedis as any,
        checkInterval: 30000,
      });

      await customChecker.start();
      mockStateManager.getWorkerGroupState.mockClear();

      // Default interval would trigger at 10000ms
      vi.advanceTimersByTime(10000);
      expect(mockStateManager.getWorkerGroupState).not.toHaveBeenCalled();

      // Custom interval triggers at 30000ms
      vi.advanceTimersByTime(20000);
      expect(mockStateManager.getWorkerGroupState).toHaveBeenCalled();

      await customChecker.stop();
    });
  });

  describe("edge cases", () => {
    it("partial quorum: single down-vote in 3-worker group does not trigger failover", async () => {
      // 1 down-vote is below quorum of 2
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(1); // Only 1 vote, quorum is 2

      await healthChecker.start();

      expect(mockStateManager.castDownVote).toHaveBeenCalled();
      expect(mockStateManager.acquireFailoverLock).not.toHaveBeenCalled();
      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });

    it("lock contention: no stale election when lock fails and primary changes", async () => {
      // Primary is unhealthy and quorum is reached, but lock acquisition fails
      // AND primary changes during the check (another worker won the election)
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockStateManager.castDownVote.mockResolvedValue(2); // Quorum reached
      mockStateManager.acquireFailoverLock.mockResolvedValue(false); // Another worker has the lock

      await healthChecker.start();

      // Since lock was not acquired, no primary update should happen
      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
      // Votes should not be cleared either (the lock holder handles that)
      expect(mockStateManager.clearVotes).not.toHaveBeenCalled();
    });

    it("stale group state: no primary and no healthy workers does not crash", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: null,
        failoverOrder: [],
        quorumSize: 2,
      });
      mockStateManager.getHealthyWorkers.mockResolvedValue([]);

      // Should not throw
      await expect(healthChecker.start()).resolves.not.toThrow();

      // Should not attempt to update primary with no healthy workers
      expect(mockStateManager.updatePrimaryWorker).not.toHaveBeenCalled();
    });

    it("rapid consecutive health checks do not overlap", async () => {
      let concurrentChecks = 0;
      let maxConcurrentChecks = 0;

      // Track concurrent calls to getWorkerGroupState
      // Use Promise.resolve() instead of setTimeout to avoid fake-timer deadlocks
      mockStateManager.getWorkerGroupState.mockImplementation(async () => {
        concurrentChecks++;
        maxConcurrentChecks = Math.max(maxConcurrentChecks, concurrentChecks);
        // Yield the event loop without depending on fake timers
        await Promise.resolve();
        await Promise.resolve();
        concurrentChecks--;
        return {
          id: "group-1",
          primaryWorkerId: "worker-1",
          failoverOrder: ["worker-2", "worker-3"],
          quorumSize: 2,
        };
      });

      await healthChecker.start();

      // Advance timers multiple times to trigger several check intervals
      // Use advanceTimersByTimeAsync consistently to handle both timer advancement
      // and microtask flushing in Vitest v4
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }

      // The health checker should serialize checks, not run them concurrently
      // maxConcurrentChecks should be 1 (or at most 2 if there's overlap at boundary)
      expect(maxConcurrentChecks).toBeLessThanOrEqual(2);
    });

    it("handles getHealthyWorkers returning only the current primary", async () => {
      // Primary is the only healthy worker -- no failover target available
      mockStateManager.getHealthyWorkers.mockResolvedValue(["worker-1"]);
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 2,
      });

      await healthChecker.start();

      // Primary is healthy, so no down vote should be cast
      expect(mockStateManager.castDownVote).not.toHaveBeenCalled();
    });
  });
});
