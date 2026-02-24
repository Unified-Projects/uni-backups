/**
 * Workers API Routes Integration Tests
 *
 * Tests the workers API routes against real Redis.
 * Requires Docker services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";

// Test configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests
  keyPrefix: "uni-backups:", // Must match getRedisConnection() prefix
};

const TEST_TIMEOUT = 30000;

describe("Workers API Routes (Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;

  // Helper to create worker state
  const createWorkerState = (overrides: Partial<{
    id: string;
    name: string;
    hostname: string;
    groups: string[];
    status: "starting" | "healthy" | "degraded" | "stopping" | "offline";
    lastHeartbeat: number;
    currentJobs: string[];
    metrics: { jobsProcessed: number; jobsFailed: number; lastJobTime: number };
  }> = {}) => ({
    id: overrides.id || "worker-1",
    name: overrides.name || "Test Worker 1",
    hostname: overrides.hostname || "test-host",
    groups: overrides.groups || ["default"],
    status: overrides.status || "healthy",
    lastHeartbeat: overrides.lastHeartbeat || Date.now(),
    currentJobs: overrides.currentJobs || [],
    metrics: overrides.metrics || {
      jobsProcessed: 0,
      jobsFailed: 0,
      lastJobTime: 0,
    },
  });

  // Helper to create worker group state
  const createWorkerGroupState = (overrides: Partial<{
    groupId: string;
    workers: string[];
    primaryWorkerId: string | null;
    failoverOrder: string[];
    quorumSize: number;
    fenceToken: string | null;
    lastElection: number;
    lastHealthCheck: number;
  }> = {}) => ({
    groupId: overrides.groupId || "default",
    workers: overrides.workers || ["worker-1", "worker-2"],
    primaryWorkerId: overrides.primaryWorkerId ?? "worker-1",
    failoverOrder: overrides.failoverOrder || ["worker-1", "worker-2"],
    quorumSize: overrides.quorumSize || 2,
    fenceToken: overrides.fenceToken ?? null,
    lastElection: overrides.lastElection || Date.now(),
    lastHealthCheck: overrides.lastHealthCheck || Date.now(),
  });

  beforeAll(async () => {
    // Set env vars FIRST before any imports that might use getRedisConnection()
    process.env.REDIS_HOST = TEST_REDIS_CONFIG.host;
    process.env.REDIS_PORT = String(TEST_REDIS_CONFIG.port);
    process.env.REDIS_PASSWORD = TEST_REDIS_CONFIG.password;
    process.env.REDIS_DB = String(TEST_REDIS_CONFIG.db);
    process.env.REDIS_KEY_PREFIX = TEST_REDIS_CONFIG.keyPrefix;

    // Close any existing singleton connections to force recreation with new config
    const { closeRedisConnections, getRedisConnection } = await import("@uni-backups/shared/redis");
    await closeRedisConnections();

    // Use the singleton connection - ensures test and route share the same Redis client
    redis = getRedisConnection();
    stateManager = new StateManager(redis);

    // Verify Redis is accessible
    try {
      await redis.ping();
    } catch {
      throw new Error(
        "Redis is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }

    const workersModule = await import("../workers");
    app = new Hono();
    app.route("/workers", workersModule.default);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await redis.flushdb();
    // Don't quit the singleton - use closeRedisConnections instead
    const { closeRedisConnections } = await import("@uni-backups/shared/redis");
    await closeRedisConnections();
  });

  beforeEach(async () => {
    // Clean the test database between tests
    await redis.flushdb();
  });

  describe("GET /workers", () => {
    it("returns empty list when no workers registered", async () => {
      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers).toHaveLength(0);
    });

    it("returns list of all registered workers", async () => {
      // Register workers
      await stateManager.setWorkerState(createWorkerState({ id: "worker-1", name: "Worker 1" }));
      await stateManager.setWorkerState(createWorkerState({ id: "worker-2", name: "Worker 2" }));
      await stateManager.setWorkerState(createWorkerState({ id: "worker-3", name: "Worker 3" }));

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers).toHaveLength(3);
      expect(json.workers.map((w: any) => w.id).sort()).toEqual(["worker-1", "worker-2", "worker-3"]);
    });

    it("marks healthy workers correctly based on heartbeat", async () => {
      const now = Date.now();

      // Healthy worker (recent heartbeat)
      await stateManager.setWorkerState(
        createWorkerState({
          id: "healthy-worker",
          status: "healthy",
          lastHeartbeat: now - 5000, // 5 seconds ago
        })
      );

      // Unhealthy worker (old heartbeat)
      await stateManager.setWorkerState(
        createWorkerState({
          id: "unhealthy-worker",
          status: "offline",
          lastHeartbeat: now - 120000, // 2 minutes ago
        })
      );

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers).toHaveLength(2);

      const healthyWorker = json.workers.find((w: any) => w.id === "healthy-worker");
      const unhealthyWorker = json.workers.find((w: any) => w.id === "unhealthy-worker");

      expect(healthyWorker.isHealthy).toBe(true);
      expect(unhealthyWorker.isHealthy).toBe(false);
    });

    it("includes worker metrics and current jobs", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          currentJobs: ["job-1", "job-2"],
          metrics: { jobsProcessed: 100, jobsFailed: 5, lastJobTime: Date.now() - 1000 },
        })
      );

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      const worker = json.workers[0];
      expect(worker.currentJobs).toEqual(["job-1", "job-2"]);
      expect(worker.metrics.jobsProcessed).toBe(100);
      expect(worker.metrics.jobsFailed).toBe(5);
    });

    it("includes worker groups", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["default", "database-workers", "volume-workers"],
        })
      );

      const res = await app.request("/workers");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers[0].groups).toEqual(["default", "database-workers", "volume-workers"]);
    });
  });

  describe("GET /workers/:id", () => {
    it("returns worker details when found", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          name: "Test Worker 1",
          hostname: "server1.example.com",
          groups: ["default"],
          status: "healthy",
        })
      );

      const res = await app.request("/workers/worker-1");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe("worker-1");
      expect(json.name).toBe("Test Worker 1");
      expect(json.hostname).toBe("server1.example.com");
      expect(json.groups).toEqual(["default"]);
      expect(json.status).toBe("healthy");
      expect(json.isHealthy).toBe(true);
    });

    it("returns 404 when worker not found", async () => {
      const res = await app.request("/workers/nonexistent-worker");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("correctly determines health status based on heartbeat", async () => {
      const now = Date.now();

      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          status: "healthy",
          lastHeartbeat: now - 60000, // 1 minute ago (unhealthy threshold)
        })
      );

      const res = await app.request("/workers/worker-1");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.isHealthy).toBe(false);
    });
  });

  describe("GET /workers/groups/:groupId", () => {
    it("returns worker group details with state", async () => {
      // Set up workers
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          name: "Worker 1",
          groups: ["test-group"],
          status: "healthy",
        })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          name: "Worker 2",
          groups: ["test-group"],
          status: "healthy",
        })
      );

      // Set up group state
      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
          failoverOrder: ["worker-1", "worker-2"],
          quorumSize: 2,
        })
      );

      const res = await app.request("/workers/groups/test-group");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe("test-group");
      expect(json.state).not.toBeNull();
      expect(json.state.primaryWorkerId).toBe("worker-1");
      expect(json.state.quorumSize).toBe(2);
      expect(json.workers).toHaveLength(2);
      expect(json.healthyCount).toBe(2);
      expect(json.totalCount).toBe(2);
    });

    it("returns null state when group has no state", async () => {
      const res = await app.request("/workers/groups/nonexistent-group");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.state).toBeNull();
      expect(json.workers).toHaveLength(0);
    });

    it("correctly counts healthy vs unhealthy workers", async () => {
      const now = Date.now();

      // Healthy worker
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "healthy",
          lastHeartbeat: now - 5000,
        })
      );

      // Unhealthy worker
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
        })
      );

      const res = await app.request("/workers/groups/test-group");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.healthyCount).toBe(1);
      expect(json.totalCount).toBe(2);
    });
  });

  describe("POST /workers/groups/:groupId/failover", () => {
    it("performs manual failover to specified worker", async () => {
      // Set up healthy workers
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "healthy",
        })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          groups: ["test-group"],
          status: "healthy",
        })
      );

      // Set up group with worker-1 as primary
      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
        })
      );

      const res = await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPrimaryId: "worker-2" }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.previousPrimary).toBe("worker-1");
      expect(json.newPrimary).toBe("worker-2");

      // Verify state was updated
      const groupState = await stateManager.getWorkerGroupState("test-group");
      expect(groupState?.primaryWorkerId).toBe("worker-2");
    });

    it("auto-selects healthy worker when no specific worker specified", async () => {
      const now = Date.now();

      // Unhealthy current primary
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      // Healthy backup
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          groups: ["test-group"],
          status: "healthy",
          lastHeartbeat: now,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
          failoverOrder: ["worker-1", "worker-2"],
        })
      );

      const res = await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.newPrimary).toBe("worker-2");
    });

    it("returns 404 when group not found", async () => {
      const res = await app.request("/workers/groups/nonexistent/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns 503 when no healthy workers available", async () => {
      const now = Date.now();

      // All workers unhealthy
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1"],
          primaryWorkerId: "worker-1",
        })
      );

      const res = await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.error).toContain("No healthy workers");
    });

    it("returns 400 when specified worker is not healthy", async () => {
      const now = Date.now();

      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "healthy",
          lastHeartbeat: now,
        })
      );

      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
        })
      );

      const res = await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPrimaryId: "worker-2" }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("not healthy");
    });

    it("returns 409 when failover already in progress", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "healthy",
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1"],
          primaryWorkerId: "worker-1",
        })
      );

      // Acquire lock first
      await stateManager.acquireFailoverLock("test-group", "other-process");

      const res = await app.request("/workers/groups/test-group/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPrimaryId: "worker-1" }),
      });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.error).toContain("already in progress");
    });
  });

  describe("DELETE /workers/:id", () => {
    it("removes worker from registry", async () => {
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-to-delete", name: "Worker To Delete" })
      );

      // Verify worker exists
      const beforeDelete = await stateManager.getWorkerState("worker-to-delete");
      expect(beforeDelete).not.toBeNull();

      const res = await app.request("/workers/worker-to-delete", { method: "DELETE" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify worker is removed
      const afterDelete = await stateManager.getWorkerState("worker-to-delete");
      expect(afterDelete).toBeNull();
    });

    it("returns 404 when worker not found", async () => {
      const res = await app.request("/workers/nonexistent", { method: "DELETE" });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("removes worker from all groups", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["group-a", "group-b"],
        })
      );

      // Verify worker is in groups
      const inGroupA = await stateManager.getWorkersInGroup("group-a");
      const inGroupB = await stateManager.getWorkersInGroup("group-b");
      expect(inGroupA).toContain("worker-1");
      expect(inGroupB).toContain("worker-1");

      await app.request("/workers/worker-1", { method: "DELETE" });

      // Verify worker removed from groups
      const afterGroupA = await stateManager.getWorkersInGroup("group-a");
      const afterGroupB = await stateManager.getWorkersInGroup("group-b");
      expect(afterGroupA).not.toContain("worker-1");
      expect(afterGroupB).not.toContain("worker-1");
    });
  });
});
