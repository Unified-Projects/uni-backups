/**
 * Heartbeat Service Unit Tests
 *
 * Tests for worker heartbeat functionality including lifecycle management,
 * job tracking, and metrics updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkerState } from "@uni-backups/queue";

// Mock the redis modules
vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(() => ({})),
  StateManager: vi.fn().mockImplementation(function () { return {
    setWorkerState: vi.fn().mockResolvedValue(undefined),
    getWorkerState: vi.fn().mockResolvedValue(null),
  }; }),
}));

import { HeartbeatService } from "../heartbeat";
import { StateManager } from "@uni-backups/shared/redis";
import type { WorkerConfig } from "../../config";

describe("HeartbeatService", () => {
  let heartbeatService: HeartbeatService;
  let mockStateManager: {
    setWorkerState: ReturnType<typeof vi.fn>;
    getWorkerState: ReturnType<typeof vi.fn>;
  };
  let workerConfig: WorkerConfig;

  beforeEach(() => {
    vi.useFakeTimers();

    mockStateManager = {
      setWorkerState: vi.fn().mockResolvedValue(undefined),
      getWorkerState: vi.fn().mockResolvedValue(null),
    };

    workerConfig = {
      id: "worker-1",
      name: "test-worker",
      hostname: "test-host.local",
      groups: ["group-1", "group-2"],
      heartbeatInterval: 5000,
      heartbeatTimeout: 15000,
      concurrency: 2,
    };

    heartbeatService = new HeartbeatService(workerConfig, mockStateManager as unknown as InstanceType<typeof StateManager>);
  });

  afterEach(async () => {
    // Ensure service is stopped to clean up timers
    if (heartbeatService.isRunning()) {
      await heartbeatService.stop();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("start()", () => {
    it("sends initial heartbeat on start", async () => {
      await heartbeatService.start();

      expect(mockStateManager.setWorkerState).toHaveBeenCalledTimes(1);
      expect(mockStateManager.setWorkerState).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "worker-1",
          name: "test-worker",
          hostname: "test-host.local",
          groups: ["group-1", "group-2"],
          status: "starting",
        })
      );
    });

    it("sets up interval timer on start", async () => {
      await heartbeatService.start();

      expect(heartbeatService.isRunning()).toBe(true);

      // Advance time to trigger periodic heartbeat
      vi.advanceTimersByTime(5000);

      // Should have sent initial + one periodic heartbeat
      expect(mockStateManager.setWorkerState).toHaveBeenCalledTimes(2);
    });

    it("sends periodic heartbeats at configured interval", async () => {
      await heartbeatService.start();

      // Reset call count after initial heartbeat
      mockStateManager.setWorkerState.mockClear();

      // Advance by 3 intervals
      vi.advanceTimersByTime(15000);

      expect(mockStateManager.setWorkerState).toHaveBeenCalledTimes(3);

      // All periodic heartbeats should have "healthy" status
      const calls = mockStateManager.setWorkerState.mock.calls;
      calls.forEach((call: any) => {
        expect(call[0].status).toBe("healthy");
      });
    });

    it("does not start twice if already running", async () => {
      await heartbeatService.start();
      mockStateManager.setWorkerState.mockClear();

      await heartbeatService.start();

      expect(mockStateManager.setWorkerState).not.toHaveBeenCalled();
    });

    it("marks service as running after start", async () => {
      expect(heartbeatService.isRunning()).toBe(false);

      await heartbeatService.start();

      expect(heartbeatService.isRunning()).toBe(true);
    });
  });

  describe("stop()", () => {
    it("sends final heartbeat on stop", async () => {
      await heartbeatService.start();
      mockStateManager.setWorkerState.mockClear();

      await heartbeatService.stop();

      expect(mockStateManager.setWorkerState).toHaveBeenCalledTimes(1);
      expect(mockStateManager.setWorkerState).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "stopping",
        })
      );
    });

    it("clears timer on stop", async () => {
      await heartbeatService.start();
      await heartbeatService.stop();

      expect(heartbeatService.isRunning()).toBe(false);

      // Advance time - should not trigger any heartbeats
      mockStateManager.setWorkerState.mockClear();
      vi.advanceTimersByTime(10000);

      expect(mockStateManager.setWorkerState).not.toHaveBeenCalled();
    });

    it("does nothing if not running", async () => {
      await heartbeatService.stop();

      expect(mockStateManager.setWorkerState).not.toHaveBeenCalled();
    });

    it("marks service as not running after stop", async () => {
      await heartbeatService.start();
      expect(heartbeatService.isRunning()).toBe(true);

      await heartbeatService.stop();

      expect(heartbeatService.isRunning()).toBe(false);
    });
  });

  describe("jobStarted()", () => {
    it("adds job to current jobs list", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");

      const state = heartbeatService.getState();
      expect(state.currentJobs).toContain("job-1");
    });

    it("tracks multiple jobs", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobStarted("job-2");
      heartbeatService.jobStarted("job-3");

      const state = heartbeatService.getState();
      expect(state.currentJobs).toEqual(["job-1", "job-2", "job-3"]);
    });

    it("includes current jobs in heartbeat", async () => {
      await heartbeatService.start();
      mockStateManager.setWorkerState.mockClear();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobStarted("job-2");

      // Trigger a heartbeat
      vi.advanceTimersByTime(5000);

      expect(mockStateManager.setWorkerState).toHaveBeenCalledWith(
        expect.objectContaining({
          currentJobs: expect.arrayContaining(["job-1", "job-2"]),
        })
      );
    });
  });

  describe("jobCompleted()", () => {
    it("removes job from current jobs list", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobStarted("job-2");
      heartbeatService.jobCompleted("job-1", true);

      const state = heartbeatService.getState();
      expect(state.currentJobs).not.toContain("job-1");
      expect(state.currentJobs).toContain("job-2");
    });

    it("increments jobsProcessed on successful completion", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobCompleted("job-1", true);

      const state = heartbeatService.getState();
      expect(state.metrics.jobsProcessed).toBe(1);
      expect(state.metrics.jobsFailed).toBe(0);
    });

    it("increments jobsFailed on failed completion", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobCompleted("job-1", false);

      const state = heartbeatService.getState();
      expect(state.metrics.jobsProcessed).toBe(0);
      expect(state.metrics.jobsFailed).toBe(1);
    });

    it("tracks cumulative metrics across multiple jobs", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobCompleted("job-1", true);

      heartbeatService.jobStarted("job-2");
      heartbeatService.jobCompleted("job-2", true);

      heartbeatService.jobStarted("job-3");
      heartbeatService.jobCompleted("job-3", false);

      heartbeatService.jobStarted("job-4");
      heartbeatService.jobCompleted("job-4", true);

      const state = heartbeatService.getState();
      expect(state.metrics.jobsProcessed).toBe(3);
      expect(state.metrics.jobsFailed).toBe(1);
    });

    it("updates lastJobTime on completion", async () => {
      vi.useRealTimers();
      const beforeTime = Date.now();

      heartbeatService = new HeartbeatService(workerConfig, mockStateManager as unknown as InstanceType<typeof StateManager>);
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobCompleted("job-1", true);

      const afterTime = Date.now();
      const state = heartbeatService.getState();

      expect(state.metrics.lastJobTime).toBeGreaterThanOrEqual(beforeTime);
      expect(state.metrics.lastJobTime).toBeLessThanOrEqual(afterTime);

      await heartbeatService.stop();
      vi.useFakeTimers();
    });

    it("includes metrics in heartbeat", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");
      heartbeatService.jobCompleted("job-1", true);
      heartbeatService.jobStarted("job-2");
      heartbeatService.jobCompleted("job-2", false);

      mockStateManager.setWorkerState.mockClear();
      vi.advanceTimersByTime(5000);

      expect(mockStateManager.setWorkerState).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({
            jobsProcessed: 1,
            jobsFailed: 1,
          }),
        })
      );
    });
  });

  describe("getState()", () => {
    it("returns current state", async () => {
      await heartbeatService.start();

      heartbeatService.jobStarted("job-1");

      const state = heartbeatService.getState();

      expect(state).toEqual({
        running: true,
        currentJobs: ["job-1"],
        metrics: {
          jobsProcessed: 0,
          jobsFailed: 0,
          lastJobTime: 0,
        },
      });
    });

    it("returns copy of metrics to prevent mutation", async () => {
      await heartbeatService.start();

      const state1 = heartbeatService.getState();
      state1.metrics.jobsProcessed = 100;

      const state2 = heartbeatService.getState();
      expect(state2.metrics.jobsProcessed).toBe(0);
    });

    it("returns copy of currentJobs array to prevent mutation", async () => {
      await heartbeatService.start();
      heartbeatService.jobStarted("job-1");

      const state1 = heartbeatService.getState();
      state1.currentJobs.push("fake-job");

      const state2 = heartbeatService.getState();
      expect(state2.currentJobs).toEqual(["job-1"]);
    });
  });

  describe("isRunning()", () => {
    it("returns false before start", () => {
      expect(heartbeatService.isRunning()).toBe(false);
    });

    it("returns true after start", async () => {
      await heartbeatService.start();
      expect(heartbeatService.isRunning()).toBe(true);
    });

    it("returns false after stop", async () => {
      await heartbeatService.start();
      await heartbeatService.stop();
      expect(heartbeatService.isRunning()).toBe(false);
    });
  });

  describe("error handling", () => {
    it("handles StateManager errors gracefully during heartbeat", async () => {
      mockStateManager.setWorkerState.mockRejectedValueOnce(new Error("Redis connection failed"));

      // Should not throw
      await expect(heartbeatService.start()).resolves.not.toThrow();
    });

    it("continues sending heartbeats after transient errors", async () => {
      mockStateManager.setWorkerState
        .mockRejectedValueOnce(new Error("Transient error"))
        .mockResolvedValue(undefined);

      await heartbeatService.start();

      // Advance time to trigger next heartbeat
      vi.advanceTimersByTime(5000);

      // Should have attempted 2 heartbeats (initial + 1 periodic)
      expect(mockStateManager.setWorkerState).toHaveBeenCalledTimes(2);
    });

    it("includes lastHeartbeat timestamp in state", async () => {
      await heartbeatService.start();

      expect(mockStateManager.setWorkerState).toHaveBeenCalledWith(
        expect.objectContaining({
          lastHeartbeat: expect.any(Number),
        })
      );
    });
  });

  describe("constructor", () => {
    it("uses provided StateManager", () => {
      const customStateManager = {
        setWorkerState: vi.fn().mockResolvedValue(undefined),
      };

      const service = new HeartbeatService(
        workerConfig,
        customStateManager as unknown as InstanceType<typeof StateManager>
      );

      // The custom state manager should be used
      expect(service).toBeDefined();
    });

    it("creates default StateManager when not provided", () => {
      const service = new HeartbeatService(workerConfig);
      expect(service).toBeDefined();
    });
  });
});
