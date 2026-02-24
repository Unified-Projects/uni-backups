/**
 * Cluster API Routes Integration Tests
 *
 * Tests the cluster status and monitoring API routes against real Redis and BullMQ.
 * Requires Docker services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { StateManager } from "@uni-backups/shared/redis";
import { QUEUES } from "@uni-backups/queue";

// Test configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests
  keyPrefix: "uni-backups:", // Must match getRedisConnection() prefix
};

// BullMQ connections cannot use keyPrefix - use prefix option on Queue instead
const BULLMQ_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const TEST_TIMEOUT = 60000;

describe("Cluster API Routes (Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let bullmqConnection: Redis;
  let stateManager: StateManager;
  let backupQueue: Queue;

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
    // Set environment variables for Redis connection
    process.env.REDIS_HOST = TEST_REDIS_CONFIG.host;
    process.env.REDIS_PORT = String(TEST_REDIS_CONFIG.port);
    process.env.REDIS_PASSWORD = TEST_REDIS_CONFIG.password;
    process.env.REDIS_DB = String(TEST_REDIS_CONFIG.db);
    process.env.REDIS_KEY_PREFIX = TEST_REDIS_CONFIG.keyPrefix;

    // Close any existing singleton connections to force recreation with new config
    const { closeRedisConnections, getRedisConnection } = await import("@uni-backups/shared/redis");
    await closeRedisConnections();

    // Connect to real Redis with retry logic - use the singleton so route and test share connection
    let connected = false;
    let lastError: Error | null = null;
    for (let i = 0; i < 10; i++) {
      try {
        // Get the singleton connection - this will be the same one the route uses
        redis = getRedisConnection();
        bullmqConnection = new Redis({
          ...TEST_REDIS_CONFIG,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
        await redis.ping();
        connected = true;
        break;
      } catch (e) {
        lastError = e as Error;
        await closeRedisConnections(); // Reset singleton on failure
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!connected) {
      throw new Error(
        `Redis is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d. Error: ${lastError?.message}`
      );
    }

    // Use the same singleton for StateManager - ensures test and route share state
    stateManager = new StateManager(redis);

    // Initialize the scheduler (which creates the queue instance used by routes)
    // Skip syncSchedules since we don't have the config in test environment
    try {
      const { initScheduler, getBackupQueue } = await import("../../services/scheduler");
      await initScheduler({
        bullmqConnection: new Redis(BULLMQ_REDIS_CONFIG),
        redisConnection: redis, // Use the singleton so scheduler and test share state
      });
      // Use the scheduler's queue instance so tests use the same queue as the routes
      backupQueue = getBackupQueue()!;
    } catch (e) {
      // Scheduler initialization may fail due to missing config, which is OK for route tests
      console.log(`[Cluster Test] Scheduler init skipped: ${(e as Error).message}`);
      // Create our own queue as fallback
      backupQueue = new Queue(QUEUES.BACKUP_JOBS, {
        connection: new Redis(BULLMQ_REDIS_CONFIG),
      });
    }

    // Import routes after setting up connections
    const clusterModule = await import("../cluster");
    app = new Hono();
    app.route("/cluster", clusterModule.default);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    const { stopScheduler } = await import("../../services/scheduler");
    const { closeRedisConnections } = await import("@uni-backups/shared/redis");
    // Flush DB first to clean all state (including BullMQ queue data)
    await redis.flushdb();
    // Then stop scheduler (which closes the internal queue)
    await stopScheduler();
    // Close remaining connections
    await closeRedisConnections();
    await bullmqConnection.quit();
  });

  beforeEach(async () => {
    // Clean the test database between tests - this wipes all keys including BullMQ state
    await redis.flushdb();
  });

  describe("GET /cluster/status", () => {
    it("returns healthy status when all workers are healthy", async () => {
      // Register healthy workers
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-1", status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-2", status: "healthy" })
      );

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("healthy");
      expect(json.workers.total).toBe(2);
      expect(json.workers.healthy).toBe(2);
      expect(json.workers.unhealthy).toBe(0);
    });

    it("returns degraded status when some workers are unhealthy", async () => {
      const now = Date.now();

      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-1", status: "healthy", lastHeartbeat: now })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          status: "offline",
          lastHeartbeat: now - 120000, // 2 minutes ago
        })
      );

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("degraded");
      expect(json.workers.total).toBe(2);
      expect(json.workers.healthy).toBe(1);
      expect(json.workers.unhealthy).toBe(1);
    });

    it("returns unhealthy status when no workers are healthy", async () => {
      const now = Date.now();

      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.status).toBe("unhealthy");
      expect(json.workers.healthy).toBe(0);
    });

    it("includes queue statistics", async () => {
      // Add some jobs to the queue
      await backupQueue.add("test-job-1", { executionId: "e1", jobName: "job1" });
      await backupQueue.add("test-job-2", { executionId: "e2", jobName: "job2" });

      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.queues).toBeDefined();
      expect(json.queues.backup).toBeDefined();
      expect(typeof json.queues.backup.waiting).toBe("number");
      expect(typeof json.queues.backup.active).toBe("number");
    });

    it("includes timestamp", async () => {
      const res = await app.request("/cluster/status");
      const json = await res.json();

      expect(json.timestamp).toBeDefined();
      expect(new Date(json.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe("GET /cluster/metrics", () => {
    it("returns aggregated worker metrics", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          status: "healthy",
          currentJobs: ["job-1"],
          metrics: { jobsProcessed: 50, jobsFailed: 2, lastJobTime: Date.now() - 1000 },
        })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          status: "healthy",
          currentJobs: [],
          metrics: { jobsProcessed: 30, jobsFailed: 1, lastJobTime: Date.now() - 2000 },
        })
      );

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.workers.total).toBe(2);
      expect(json.workers.healthy).toBe(2);
      expect(json.workers.details).toHaveLength(2);
    });

    it("includes worker status breakdown", async () => {
      await stateManager.setWorkerState(
        createWorkerState({ id: "w1", status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "w2", status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "w3", status: "degraded" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "w4", status: "offline" })
      );

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.workers.byStatus.healthy).toBe(2);
      expect(json.workers.byStatus.degraded).toBe(1);
      expect(json.workers.byStatus.offline).toBe(1);
    });

    it("includes worker details with per-worker metrics", async () => {
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          name: "Test Worker 1",
          status: "healthy",
          currentJobs: ["job-a"],
          metrics: { jobsProcessed: 100, jobsFailed: 5, lastJobTime: Date.now() },
        })
      );

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      const workerDetail = json.workers.details.find((w: any) => w.id === "worker-1");
      expect(workerDetail).toBeDefined();
      expect(workerDetail.name).toBe("Test Worker 1");
      expect(workerDetail.jobsProcessed).toBe(100);
      expect(workerDetail.jobsFailed).toBe(5);
      expect(workerDetail.currentJobs).toBe(1);
    });

    it("includes recent job executions", async () => {
      // Record some job executions
      await stateManager.recordJobExecution({
        id: "exec-1",
        jobName: "test-job",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
      });

      const res = await app.request("/cluster/metrics");
      const json = await res.json();

      expect(json.jobs.recent).toBeDefined();
      expect(Array.isArray(json.jobs.recent)).toBe(true);
    });
  });

  describe("GET /cluster/health", () => {
    it("returns healthy status with worker count when workers available", async () => {
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-1", status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-2", status: "healthy" })
      );

      const res = await app.request("/cluster/health");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("healthy");
      expect(json.workers).toBe(2);
    });

    it("returns 503 with unhealthy status when no healthy workers", async () => {
      const now = Date.now();

      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      const res = await app.request("/cluster/health");
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.status).toBe("unhealthy");
      expect(json.message).toContain("No healthy workers");
    });

    it("returns 503 when no workers registered at all", async () => {
      const res = await app.request("/cluster/health");
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.status).toBe("unhealthy");
    });
  });

  describe("GET /cluster/ready", () => {
    it("returns ready when Redis is connected", async () => {
      const res = await app.request("/cluster/ready");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ready).toBe(true);
    });

    // Note: Testing Redis connection failure is tricky in integration tests
    // as it would require disconnecting Redis mid-test
  });

  describe("GET /cluster/groups", () => {
    it("returns worker group health summary", async () => {
      // Set up workers
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-1", groups: ["test-group"], status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-2", groups: ["test-group"], status: "healthy" })
      );

      // Set up group state
      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
          quorumSize: 2,
        })
      );

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.groups).toHaveLength(1);
      expect(json.groups[0].id).toBe("test-group");
      expect(json.groups[0].status).toBe("healthy");
      expect(json.groups[0].hasQuorum).toBe(true);
      expect(json.groups[0].primaryHealthy).toBe(true);
    });

    it("returns critical status when quorum not met", async () => {
      const now = Date.now();

      // Only one healthy worker but quorum requires 2
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["ha-group"],
          status: "healthy",
          lastHeartbeat: now,
        })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-2",
          groups: ["ha-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "ha-group",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
          quorumSize: 2, // Requires 2 healthy workers
        })
      );

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].status).toBe("critical");
      expect(json.groups[0].hasQuorum).toBe(false);
    });

    it("returns degraded status when primary is unhealthy but has quorum", async () => {
      const now = Date.now();

      // Primary is unhealthy but another worker is healthy
      await stateManager.setWorkerState(
        createWorkerState({
          id: "worker-1",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: now - 120000,
        })
      );
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
          primaryWorkerId: "worker-1", // Primary is the unhealthy one
          quorumSize: 1, // Quorum met with 1 healthy worker
        })
      );

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].status).toBe("degraded");
      expect(json.groups[0].primaryHealthy).toBe(false);
      expect(json.groups[0].hasQuorum).toBe(true);
    });

    it("includes worker counts per group", async () => {
      await stateManager.setWorkerState(
        createWorkerState({ id: "w1", groups: ["test-group"], status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({ id: "w2", groups: ["test-group"], status: "healthy" })
      );
      await stateManager.setWorkerState(
        createWorkerState({
          id: "w3",
          groups: ["test-group"],
          status: "offline",
          lastHeartbeat: Date.now() - 120000,
        })
      );

      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["w1", "w2", "w3"],
          quorumSize: 2,
        })
      );

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].workers.total).toBe(3);
      expect(json.groups[0].workers.healthy).toBe(2);
      expect(json.groups[0].workers.quorumRequired).toBe(2);
    });

    it("returns empty array when no groups configured", async () => {
      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.groups).toHaveLength(0);
    });

    it("includes last election timestamp", async () => {
      const electionTime = Date.now() - 60000;

      await stateManager.setWorkerState(
        createWorkerState({ id: "worker-1", groups: ["test-group"], status: "healthy" })
      );
      await stateManager.setWorkerGroupState(
        createWorkerGroupState({
          groupId: "test-group",
          workers: ["worker-1"],
          primaryWorkerId: "worker-1",
          quorumSize: 1,
          lastElection: electionTime,
        })
      );

      const res = await app.request("/cluster/groups");
      const json = await res.json();

      expect(json.groups[0].lastElection).toBeDefined();
      expect(new Date(json.groups[0].lastElection).getTime()).toBe(electionTime);
    });
  });
});
