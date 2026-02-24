import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Create shared mock functions
const mockGetAllWorkers = vi.fn();
const mockGetHealthyWorkers = vi.fn();
const mockGetWorkerState = vi.fn();
const mockGetWorkerGroupState = vi.fn();
const mockGetWorkersInGroup = vi.fn();
const mockAcquireFailoverLock = vi.fn();
const mockReleaseFailoverLock = vi.fn();
const mockUpdatePrimaryWorker = vi.fn();
const mockClearVotes = vi.fn();
const mockRemoveWorker = vi.fn();

// Mock dependencies with shared instances
vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(),
  StateManager: vi.fn().mockImplementation(function () { return {
    getAllWorkers: mockGetAllWorkers,
    getHealthyWorkers: mockGetHealthyWorkers,
    getWorkerState: mockGetWorkerState,
    getWorkerGroupState: mockGetWorkerGroupState,
    getWorkersInGroup: mockGetWorkersInGroup,
    acquireFailoverLock: mockAcquireFailoverLock,
    releaseFailoverLock: mockReleaseFailoverLock,
    updatePrimaryWorker: mockUpdatePrimaryWorker,
    clearVotes: mockClearVotes,
    removeWorker: mockRemoveWorker,
  }; }),
}));

vi.mock("@uni-backups/shared/config", () => ({
  getAllWorkerGroups: vi.fn(),
}));

import { getAllWorkerGroups } from "@uni-backups/shared/config";

describe("Workers API Routes", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const workersModule = await import("../workers");
    app = new Hono();
    app.route("/workers", workersModule.default);
  });

  describe("GET /workers", () => {
    it("returns list of all workers", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default"],
          status: "healthy",
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: { jobsProcessed: 100, jobsFailed: 2 },
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers).toHaveLength(1);
      expect(json.workers[0].id).toBe("worker-1");
      expect(json.workers[0].isHealthy).toBe(true);
    });

    it("marks unhealthy workers correctly", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default"],
          status: "offline",
          lastHeartbeat: Date.now() - 60000,
          currentJobs: [],
          metrics: {},
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(json.workers[0].isHealthy).toBe(false);
    });

    it("includes worker metrics", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default"],
          status: "healthy",
          lastHeartbeat: Date.now(),
          currentJobs: ["job-1"],
          metrics: { jobsProcessed: 50, jobsFailed: 1 },
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(json.workers[0].metrics).toEqual({ jobsProcessed: 50, jobsFailed: 1 });
      expect(json.workers[0].currentJobs).toEqual(["job-1"]);
    });
  });

  describe("GET /workers/:id", () => {
    it("returns worker details when found", async () => {
      mockGetWorkerState.mockResolvedValue({
        id: "worker-1",
        name: "Worker 1",
        hostname: "server1",
        groups: ["default"],
        status: "healthy",
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: { jobsProcessed: 100, jobsFailed: 2 },
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers/worker-1");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe("worker-1");
      expect(json.name).toBe("Worker 1");
    });

    it("returns 404 when worker not found", async () => {
      mockGetWorkerState.mockResolvedValue(null);

      const res = await app.request("/workers/nonexistent");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });
  });

  describe("GET /workers/groups", () => {
    it("returns list of worker groups", async () => {
      vi.mocked(getAllWorkerGroups).mockReturnValue([
        {
          name: "default",
          config: {
            workers: ["worker-1", "worker-2"],
            primary: "worker-1",
            failover_order: ["worker-1", "worker-2"],
            quorum_size: 1,
          },
        },
      ]);
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        fenceToken: 1,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers/groups");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.groups).toHaveLength(1);
      expect(json.groups[0].id).toBe("default");
      expect(json.groups[0].activeWorkers).toEqual(["worker-1"]);
    });
  });

  describe("GET /workers/groups/:groupId", () => {
    it("returns worker group details", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-1", "worker-2"],
        quorumSize: 1,
        fenceToken: 1,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      mockGetWorkerState
        .mockResolvedValueOnce({
          id: "worker-1",
          name: "Worker 1",
          status: "healthy",
          lastHeartbeat: Date.now(),
        })
        .mockResolvedValueOnce({
          id: "worker-2",
          name: "Worker 2",
          status: "offline",
          lastHeartbeat: Date.now() - 60000,
        });

      const res = await app.request("/workers/groups/default");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe("default");
      expect(json.workers).toHaveLength(2);
      expect(json.healthyCount).toBe(1);
      expect(json.totalCount).toBe(2);
    });

    it("handles group with no state", async () => {
      mockGetWorkerGroupState.mockResolvedValue(null);
      mockGetWorkersInGroup.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/workers/groups/nonexistent");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.state).toBeNull();
    });
  });

  describe("POST /workers/groups/:groupId/failover", () => {
    it("performs manual failover", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-1", "worker-2"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPrimaryId: "worker-2" }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.newPrimary).toBe("worker-2");
      expect(mockUpdatePrimaryWorker).toHaveBeenCalledWith("default", "worker-2");
    });

    it("returns 404 when group not found", async () => {
      mockGetWorkerGroupState.mockResolvedValue(null);

      const res = await app.request("/workers/groups/nonexistent/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it("returns 503 when no healthy workers available", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: [],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue([]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.error).toContain("No healthy workers");
    });

    it("returns 409 when failover already in progress", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockAcquireFailoverLock.mockResolvedValue(false);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.error).toContain("already in progress");
    });

    it("returns 400 when specified worker is not healthy", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: [],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2", "worker-3"]);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPrimaryId: "worker-3" }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("not healthy");
    });
  });

  describe("DELETE /workers/:id", () => {
    it("removes worker from registry", async () => {
      mockGetWorkerState.mockResolvedValue({
        id: "worker-1",
        name: "Worker 1",
      });

      const res = await app.request("/workers/worker-1", { method: "DELETE" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockRemoveWorker).toHaveBeenCalledWith("worker-1");
    });

    it("returns 404 when worker not found", async () => {
      mockGetWorkerState.mockResolvedValue(null);

      const res = await app.request("/workers/nonexistent", { method: "DELETE" });
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it("includes removal message in response", async () => {
      mockGetWorkerState.mockResolvedValue({
        id: "worker-to-remove",
        name: "Worker To Remove",
      });

      const res = await app.request("/workers/worker-to-remove", { method: "DELETE" });
      const json = await res.json();

      expect(json.message).toContain("worker-to-remove");
      expect(json.message).toContain("removed");
    });
  });

  describe("GET /workers - Additional Edge Cases", () => {
    it("handles workers with multiple groups", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default", "database", "high-priority"],
          status: "healthy",
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: {},
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(json.workers[0].groups).toEqual(["default", "database", "high-priority"]);
    });

    it("returns empty array when no workers exist", async () => {
      mockGetAllWorkers.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers).toEqual([]);
    });

    it("formats lastHeartbeat as Date", async () => {
      const heartbeatTime = Date.now();
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "worker-1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default"],
          status: "healthy",
          lastHeartbeat: heartbeatTime,
          currentJobs: [],
          metrics: {},
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(new Date(json.workers[0].lastHeartbeat).getTime()).toBe(heartbeatTime);
    });

    it("returns multiple workers with different statuses", async () => {
      mockGetAllWorkers.mockResolvedValue([
        {
          id: "w1",
          name: "Worker 1",
          hostname: "server1",
          groups: ["default"],
          status: "healthy",
          lastHeartbeat: Date.now(),
          currentJobs: [],
          metrics: {},
        },
        {
          id: "w2",
          name: "Worker 2",
          hostname: "server2",
          groups: ["default"],
          status: "offline",
          lastHeartbeat: Date.now() - 120000,
          currentJobs: [],
          metrics: {},
        },
        {
          id: "w3",
          name: "Worker 3",
          hostname: "server3",
          groups: ["database"],
          status: "degraded",
          lastHeartbeat: Date.now() - 30000,
          currentJobs: ["job-1"],
          metrics: { jobsProcessed: 50, jobsFailed: 5 },
        },
      ]);
      mockGetHealthyWorkers.mockResolvedValue(["w1"]);

      const res = await app.request("/workers");
      const json = await res.json();

      expect(json.workers).toHaveLength(3);
      expect(json.workers.filter((w: any) => w.isHealthy).length).toBe(1);
      expect(json.workers.find((w: any) => w.id === "w3").currentJobs).toEqual(["job-1"]);
    });
  });

  describe("GET /workers/:id - Additional Edge Cases", () => {
    it("includes all worker fields", async () => {
      mockGetWorkerState.mockResolvedValue({
        id: "worker-1",
        name: "Production Worker",
        hostname: "prod-server-01",
        groups: ["default", "priority"],
        status: "healthy",
        lastHeartbeat: Date.now(),
        currentJobs: ["backup-job", "prune-job"],
        metrics: { jobsProcessed: 150, jobsFailed: 3 },
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);

      const res = await app.request("/workers/worker-1");
      const json = await res.json();

      expect(json.hostname).toBe("prod-server-01");
      expect(json.groups).toEqual(["default", "priority"]);
      expect(json.currentJobs).toEqual(["backup-job", "prune-job"]);
      expect(json.metrics.jobsProcessed).toBe(150);
    });
  });

  describe("GET /workers/groups - Additional Edge Cases", () => {
    it("handles groups with no runtime state", async () => {
      vi.mocked(getAllWorkerGroups).mockReturnValue([
        {
          name: "new-group",
          config: {
            workers: ["worker-1"],
            primary: "worker-1",
            failover_order: [],
            quorum_size: 1,
          },
        },
      ]);
      mockGetWorkerGroupState.mockResolvedValue(null);
      mockGetWorkersInGroup.mockResolvedValue([]);
      mockGetHealthyWorkers.mockResolvedValue([]);

      const res = await app.request("/workers/groups");
      const json = await res.json();

      expect(json.groups[0].state).toBeNull();
      expect(json.groups[0].totalWorkers).toBe(0);
    });

    it("includes all config fields", async () => {
      vi.mocked(getAllWorkerGroups).mockReturnValue([
        {
          name: "ha-group",
          config: {
            workers: ["w1", "w2", "w3"],
            primary: "w1",
            failover_order: ["w1", "w2", "w3"],
            quorum_size: 2,
          },
        },
      ]);
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "w1",
        fenceToken: 5,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });
      mockGetWorkersInGroup.mockResolvedValue(["w1", "w2", "w3"]);
      mockGetHealthyWorkers.mockResolvedValue(["w1", "w2"]);

      const res = await app.request("/workers/groups");
      const json = await res.json();

      expect(json.groups[0].config.workers).toEqual(["w1", "w2", "w3"]);
      expect(json.groups[0].config.failoverOrder).toEqual(["w1", "w2", "w3"]);
      expect(json.groups[0].config.quorumSize).toBe(2);
      expect(json.groups[0].state.fenceToken).toBe(5);
    });

    it("handles multiple groups", async () => {
      vi.mocked(getAllWorkerGroups).mockReturnValue([
        {
          name: "group-1",
          config: { workers: ["w1"], primary: "w1", failover_order: [], quorum_size: 1 },
        },
        {
          name: "group-2",
          config: { workers: ["w2", "w3"], primary: "w2", failover_order: ["w2", "w3"], quorum_size: 1 },
        },
      ]);
      mockGetWorkerGroupState
        .mockResolvedValueOnce({ primaryWorkerId: "w1", fenceToken: 1 })
        .mockResolvedValueOnce({ primaryWorkerId: "w2", fenceToken: 2 });
      mockGetWorkersInGroup
        .mockResolvedValueOnce(["w1"])
        .mockResolvedValueOnce(["w2", "w3"]);
      mockGetHealthyWorkers.mockResolvedValue(["w1", "w2"]);

      const res = await app.request("/workers/groups");
      const json = await res.json();

      expect(json.groups).toHaveLength(2);
      expect(json.groups[0].activeWorkers).toEqual(["w1"]);
      expect(json.groups[1].activeWorkers).toEqual(["w2"]);
    });
  });

  describe("GET /workers/groups/:groupId - Additional Edge Cases", () => {
    it("filters out null worker details", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: [],
        quorumSize: 1,
      });
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-deleted"]);
      mockGetHealthyWorkers.mockResolvedValue(["worker-1"]);
      mockGetWorkerState
        .mockResolvedValueOnce({
          id: "worker-1",
          name: "Worker 1",
          status: "healthy",
          lastHeartbeat: Date.now(),
        })
        .mockResolvedValueOnce(null); // Worker deleted but still in group

      const res = await app.request("/workers/groups/default");
      const json = await res.json();

      expect(json.workers).toHaveLength(1);
      expect(json.totalCount).toBe(2); // Still counts in total
    });
  });

  describe("POST /workers/groups/:groupId/failover - Additional Edge Cases", () => {
    it("uses failover order to select new primary", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2", "worker-3"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2", "worker-3"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2", "worker-3"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(json.newPrimary).toBe("worker-2"); // First healthy in failover order
    });

    it("falls back to first healthy worker when failover order empty", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: [],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-3", "worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2", "worker-3"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(json.success).toBe(true);
    });

    it("clears votes after failover", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(mockClearVotes).toHaveBeenCalledWith("test-group");
    });

    it("releases failover lock after completion", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "worker-1",
        failoverOrder: ["worker-2"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["worker-2"]);
      mockGetWorkersInGroup.mockResolvedValue(["worker-1", "worker-2"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(mockReleaseFailoverLock).toHaveBeenCalledWith("test-group");
    });

    it("includes previous primary in response", async () => {
      mockGetWorkerGroupState.mockResolvedValue({
        primaryWorkerId: "old-primary",
        failoverOrder: ["new-primary"],
        quorumSize: 1,
      });
      mockGetHealthyWorkers.mockResolvedValue(["new-primary"]);
      mockGetWorkersInGroup.mockResolvedValue(["old-primary", "new-primary"]);
      mockAcquireFailoverLock.mockResolvedValue(true);

      const res = await app.request("/workers/groups/default/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(json.previousPrimary).toBe("old-primary");
      expect(json.newPrimary).toBe("new-primary");
    });
  });
});
