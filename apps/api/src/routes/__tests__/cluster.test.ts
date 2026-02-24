import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Create shared mock functions
const mockGetAllWorkers = vi.fn();
const mockGetHealthyWorkers = vi.fn();
const mockGetAllWorkerGroups = vi.fn();
const mockGetWorkersInGroup = vi.fn();
const mockGetRecentJobs = vi.fn();
const mockPing = vi.fn().mockResolvedValue("PONG");

// Mock dependencies with shared instances
vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(() => ({
    ping: mockPing,
  })),
  StateManager: vi.fn().mockImplementation(function () {
    return {
      getAllWorkers: mockGetAllWorkers,
      getHealthyWorkers: mockGetHealthyWorkers,
      getAllWorkerGroups: mockGetAllWorkerGroups,
      getWorkersInGroup: mockGetWorkersInGroup,
      getRecentJobs: mockGetRecentJobs,
    };
  }),
}));

vi.mock("../../services/scheduler", () => ({
  getQueueStats: vi.fn(),
  getScheduledJobs: vi.fn(),
  getRunningJobs: vi.fn(),
}));

import { getRedisConnection } from "@uni-backups/shared/redis";
import { getQueueStats, getScheduledJobs, getRunningJobs } from "../../services/scheduler";

describe("Cluster API Routes", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module cache to get fresh route handlers
    vi.resetModules();
    const clusterModule = await import("../cluster");
    app = new Hono();
    app.route("/cluster", clusterModule.default);
  });

  describe("GET /cluster/status", () => {
    it("returns healthy status when all workers are healthy", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "worker-1", status: "healthy", currentJobs: [], metrics: {} },
        { id: "worker-2", status: "healthy", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1", "worker-2"]);
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 0,
        active: 1,
        completed: 100,
        failed: 2,
        delayed: 0,
      });
      vi.mocked(getScheduledJobs).mockResolvedValue([{ name: "job-1", schedule: "0 * * * *" }]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("healthy");
      expect(json.workers.total).toBe(2);
      expect(json.workers.healthy).toBe(2);
    });

    it("returns degraded status when some workers are unhealthy", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "worker-1", status: "healthy", currentJobs: [], metrics: {} },
        { id: "worker-2", status: "offline", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("degraded");
      expect(json.workers.unhealthy).toBe(1);
    });

    it("returns unhealthy status when no workers are healthy", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "worker-1", status: "offline", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("unhealthy");
    });

    it("includes queue statistics", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.queues.backup.waiting).toBe(5);
      expect(json.queues.backup.active).toBe(2);
      expect(json.queues.backup.completed).toBe(100);
      expect(json.queues.backup.failed).toBe(3);
    });

    it("includes job counts", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([
        { name: "job-1", schedule: "0 * * * *" },
        { name: "job-2", schedule: "0 0 * * *" },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([{ jobName: "job-3", queuedAt: Date.now(), executionId: "e1" }]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.jobs.scheduled).toBe(2);
      expect(json.jobs.running).toBe(1);
    });
  });

  describe("GET /cluster/metrics", () => {
    it("returns aggregated metrics", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          status: "healthy",
          currentJobs: ["job-1"],
          metrics: { jobsProcessed: 50, jobsFailed: 2 },
        },
        {
          id: "worker-2",
          name: "Worker 2",
          status: "healthy",
          currentJobs: [],
          metrics: { jobsProcessed: 30, jobsFailed: 1 },
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 1, completed: 80, failed: 3, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.jobs.aggregated.totalJobsProcessed).toBe(80);
      expect(json.jobs.aggregated.totalJobsFailed).toBe(3);
      expect(json.jobs.aggregated.activeJobs).toBe(1);
    });

    it("includes worker details with metrics", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          status: "healthy",
          currentJobs: [],
          metrics: { jobsProcessed: 100, jobsFailed: 5 },
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.workers.details[0].jobsProcessed).toBe(100);
      expect(json.workers.details[0].jobsFailed).toBe(5);
    });

    it("includes worker status breakdown", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "w1", status: "healthy", currentJobs: [], metrics: {} },
        { id: "w2", status: "healthy", currentJobs: [], metrics: {} },
        { id: "w3", status: "degraded", currentJobs: [], metrics: {} },
        { id: "w4", status: "offline", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["w1", "w2"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.workers.byStatus.healthy).toBe(2);
      expect(json.workers.byStatus.degraded).toBe(1);
      expect(json.workers.byStatus.offline).toBe(1);
    });

    it("includes recent jobs", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      mockGetRecentJobs.mockResolvedValue([
        {
          id: "exec-1",
          jobName: "test-job",
          workerId: "worker-1",
          status: "completed",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          duration: 10000,
        },
      ]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.jobs.recent).toHaveLength(1);
      expect(json.jobs.recent[0].jobName).toBe("test-job");
    });
  });

  describe("GET /cluster/health", () => {
    it("returns healthy when workers are available", async () => {
      mockGetHealthyWorkers.mockResolvedValue(["worker-1", "worker-2"]);

      const res = await app.request("/cluster/health");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("healthy");
      expect(json.workers).toBe(2);
    });

    it("returns 503 when no healthy workers", async () => {
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/cluster/health");
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.status).toBe("unhealthy");
    });
  });

  describe("GET /cluster/ready", () => {
    it("returns ready when Redis is connected", async () => {
      mockPing.mockResolvedValue("PONG");

      const res = await app.request("/cluster/ready");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ready).toBe(true);
    });

    it("returns 503 when Redis connection fails", async () => {
      mockPing.mockRejectedValue(new Error("Connection refused"));

      const res = await app.request("/cluster/ready");
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.ready).toBe(false);
      expect(json.error).toBe("Connection refused");
    });
  });

  describe("GET /cluster/groups", () => {
    it("returns worker group health summary", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "default",
          primaryWorkerId: "worker-1",
          quorumSize: 1,
          lastElection: Date.now(),
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.groups).toHaveLength(1);
      expect(json.groups[0].id).toBe("default");
      expect(json.groups[0].status).toBe("healthy");
      expect(json.groups[0].hasQuorum).toBe(true);
    });

    it("returns critical status when no quorum", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "ha-group",
          primaryWorkerId: "worker-1",
          quorumSize: 2,
          lastElection: Date.now(),
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]); // Only 1 healthy, needs 2

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].status).toBe("critical");
      expect(json.groups[0].hasQuorum).toBe(false);
    });

    it("returns degraded status when primary is unhealthy but has quorum", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "default",
          primaryWorkerId: "worker-1",
          quorumSize: 1,
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]); // Primary not healthy

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].status).toBe("degraded");
      expect(json.groups[0].primaryHealthy).toBe(false);
    });

    it("includes worker counts", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "default",
          primaryWorkerId: "worker-1",
          quorumSize: 2,
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2", "worker-3"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1", "worker-2"]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].workers.total).toBe(3);
      expect(json.groups[0].workers.healthy).toBe(2);
      expect(json.groups[0].workers.quorumRequired).toBe(2);
    });

    it("handles empty groups list", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.groups).toEqual([]);
    });

    it("handles group with no primary worker", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "new-group",
          primaryWorkerId: null,
          quorumSize: 1,
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].primaryHealthy).toBe(false);
      expect(json.groups[0].primaryWorkerId).toBeNull();
    });

    it("includes lastElection date when present", async () => {
      const electionTime = Date.now() - 60000;
      mockGetAllWorkerGroups.mockResolvedValue([
        {
          groupId: "default",
          primaryWorkerId: "worker-1",
          quorumSize: 1,
          lastElection: electionTime,
        },
      ]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].lastElection).toBeDefined();
    });

    it("handles multiple groups", async () => {
      mockGetAllWorkerGroups.mockResolvedValue([
        { groupId: "group-1", primaryWorkerId: "w1", quorumSize: 1 },
        { groupId: "group-2", primaryWorkerId: "w2", quorumSize: 2 },
      ]);
      mockGetWorkersInGroup
        .mockResolvedValueOnce(["w1"])
        .mockResolvedValueOnce(["w2", "w3"]);
      mockGetHealthyWorkers.mockResolvedValue(["w1", "w2", "w3"]);

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups).toHaveLength(2);
      expect(json.groups[0].id).toBe("group-1");
      expect(json.groups[1].id).toBe("group-2");
    });
  });

  describe("GET /cluster/status - Additional Edge Cases", () => {
    it("returns healthy when all workers are in starting status", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "worker-1", status: "starting", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("healthy");
    });

    it("includes timestamp in response", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.timestamp).toBeDefined();
      expect(new Date(json.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("handles workers with stopping status", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "worker-1", status: "stopping", currentJobs: [], metrics: {} },
        { id: "worker-2", status: "healthy", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("degraded");
      expect(json.workers.unhealthy).toBe(1);
    });

    it("includes delayed jobs in queue stats", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 10,
      });
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.queues.backup.delayed).toBe(10);
    });
  });

  describe("GET /cluster/metrics - Additional Edge Cases", () => {
    it("handles workers with no metrics", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          status: "healthy",
          currentJobs: [],
          metrics: {},
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.workers.details[0].jobsProcessed).toBeUndefined();
    });

    it("counts all worker status types", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "w1", status: "healthy", currentJobs: [], metrics: {} },
        { id: "w2", status: "starting", currentJobs: [], metrics: {} },
        { id: "w3", status: "stopping", currentJobs: [], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["w1"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.workers.byStatus.healthy).toBe(1);
      expect(json.workers.byStatus.starting).toBe(1);
      expect(json.workers.byStatus.stopping).toBe(1);
    });

    it("aggregates active jobs from all workers", async () => {
      mockGetAllWorkers.mockResolvedValue([
        { id: "w1", status: "healthy", currentJobs: ["job-1", "job-2"], metrics: {} },
        { id: "w2", status: "healthy", currentJobs: ["job-3"], metrics: {} },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["w1", "w2"]);
      mockGetRecentJobs.mockResolvedValue([]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 3, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.jobs.aggregated.activeJobs).toBe(3);
    });

    it("includes job end time in recent jobs when available", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      const endTime = Date.now();
      mockGetRecentJobs.mockResolvedValue([
        {
          id: "exec-1",
          jobName: "test-job",
          workerId: "worker-1",
          status: "completed",
          startTime: Date.now() - 10000,
          endTime,
          duration: 10000,
        },
      ]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.jobs.recent[0].endTime).toBeDefined();
    });

    it("handles running job without end time", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);
      mockGetRecentJobs.mockResolvedValue([
        {
          id: "exec-1",
          jobName: "running-job",
          workerId: "worker-1",
          status: "running",
          startTime: Date.now(),
        },
      ]);
      vi.mocked(getQueueStats).mockResolvedValue({ waiting: 0, active: 1, completed: 0, failed: 0, delayed: 0 });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.jobs.recent[0].endTime).toBeNull();
    });
  });
});
