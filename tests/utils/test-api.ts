/**
 * Test API Factory
 *
 * Creates a Hono app instance for integration testing with real services.
 * Sets up the environment for tests to use real Redis, BullMQ, etc.
 */

import { Hono } from "hono";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
import type { RuntimeConfig } from "@uni-backups/shared/config";
import { TEST_CONFIG, createBullMQConnection, createTestRedis } from "./test-services";

// Re-export types for convenience
export type { RuntimeConfig };

/**
 * Set up environment variables for testing
 * Call this at the very beginning of test files
 */
export function setupTestEnvironment(): void {
  // Redis
  process.env.REDIS_HOST = TEST_CONFIG.redis.host;
  process.env.REDIS_PORT = String(TEST_CONFIG.redis.port);
  process.env.REDIS_PASSWORD = TEST_CONFIG.redis.password;
  process.env.REDIS_DB = String(TEST_CONFIG.redis.db);

  // PostgreSQL
  process.env.POSTGRES_HOST = TEST_CONFIG.postgres.host;
  process.env.POSTGRES_PORT = String(TEST_CONFIG.postgres.port);
  process.env.POSTGRES_USER = TEST_CONFIG.postgres.user;
  process.env.POSTGRES_PASSWORD = TEST_CONFIG.postgres.password;
  process.env.POSTGRES_DB = TEST_CONFIG.postgres.database;

  // MariaDB
  process.env.MARIADB_HOST = TEST_CONFIG.mariadb.host;
  process.env.MARIADB_PORT = String(TEST_CONFIG.mariadb.port);
  process.env.MARIADB_USER = TEST_CONFIG.mariadb.user;
  process.env.MARIADB_PASSWORD = TEST_CONFIG.mariadb.password;
  process.env.MARIADB_DATABASE = TEST_CONFIG.mariadb.database;

  // MinIO
  process.env.MINIO_ENDPOINT = TEST_CONFIG.minio.endpoint;
  process.env.MINIO_ACCESS_KEY = TEST_CONFIG.minio.accessKey;
  process.env.MINIO_SECRET_KEY = TEST_CONFIG.minio.secretKey;

  // Restic
  process.env.UNI_BACKUPS_RESTIC_PASSWORD = TEST_CONFIG.restic.password;

  // API
  process.env.UNI_BACKUPS_API_PORT = "3001";
  process.env.NODE_ENV = "test";
}

export interface TestAppContext {
  redis: Redis;
  bullmqConnection: Redis;
  stateManager: StateManager;
  cleanup: () => Promise<void>;
}

/**
 * Create a test context with all required connections
 */
export async function createTestAppContext(): Promise<TestAppContext> {
  const redis = createTestRedis();
  const bullmqConnection = createBullMQConnection();

  // Wait for Redis to be ready
  await waitForConnection(redis);

  // Flush test database
  await redis.flushdb();

  const stateManager = new StateManager(redis);

  const cleanup = async () => {
    await redis.flushdb();
    await redis.quit();
    await bullmqConnection.quit();
  };

  return {
    redis,
    bullmqConnection,
    stateManager,
    cleanup,
  };
}

async function waitForConnection(redis: Redis, timeoutMs = 10000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await redis.ping();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Redis connection timeout after ${timeoutMs}ms`);
}

/**
 * Import routes dynamically to avoid singleton issues
 */
export async function createTestApiApp(context: TestAppContext): Promise<Hono> {
  const app = new Hono();

  // Health check that uses the test context
  app.get("/health", async (c) => {
    try {
      await context.redis.ping();
      return c.json({ status: "ok", redis: "connected" });
    } catch (error) {
      return c.json({ status: "error", redis: "disconnected" }, 503);
    }
  });

  // Import and mount routes
  // Note: These routes will use the singleton Redis connection from shared/redis
  // which reads from environment variables we set up
  const { default: storageRoutes } = await import("../../apps/api/src/routes/storage");
  const { default: jobsRoutes } = await import("../../apps/api/src/routes/jobs");
  const { default: reposRoutes } = await import("../../apps/api/src/routes/repos");
  const { default: restoreRoutes } = await import("../../apps/api/src/routes/restore");
  const { default: scheduleRoutes } = await import("../../apps/api/src/routes/schedule");
  const { default: workersRoutes } = await import("../../apps/api/src/routes/workers");
  const { default: clusterRoutes } = await import("../../apps/api/src/routes/cluster");

  app.route("/api/storage", storageRoutes);
  app.route("/api/jobs", jobsRoutes);
  app.route("/api/repos", reposRoutes);
  app.route("/api/restore", restoreRoutes);
  app.route("/api/schedule", scheduleRoutes);
  app.route("/api/workers", workersRoutes);
  app.route("/api/cluster", clusterRoutes);

  return app;
}

export interface TestRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Make a test request to the API
 */
export async function testRequest(
  app: Hono,
  path: string,
  options: TestRequestOptions = {}
): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  const { method = "GET", body, headers = {} } = options;

  const requestInit: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await app.request(path, requestInit);

  return {
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
}

/**
 * Register a test worker in the state manager
 */
export async function registerTestWorker(
  stateManager: StateManager,
  workerId: string,
  options: {
    name?: string;
    groups?: string[];
    status?: "starting" | "healthy" | "degraded" | "stopping" | "offline";
  } = {}
): Promise<void> {
  const { name = workerId, groups = ["default"], status = "healthy" } = options;

  await stateManager.setWorkerState({
    id: workerId,
    name,
    hostname: "test-host",
    groups,
    status,
    lastHeartbeat: Date.now(),
    currentJobs: [],
    metrics: {
      jobsProcessed: 0,
      jobsFailed: 0,
      lastJobTime: 0,
    },
  });
}

/**
 * Register a test worker group in the state manager
 */
export async function registerTestWorkerGroup(
  stateManager: StateManager,
  groupId: string,
  options: {
    workers?: string[];
    primaryWorkerId?: string;
    quorumSize?: number;
  } = {}
): Promise<void> {
  const {
    workers = ["worker-1", "worker-2"],
    primaryWorkerId = workers[0],
    quorumSize = 2,
  } = options;

  await stateManager.setWorkerGroupState({
    groupId,
    workers,
    primaryWorkerId,
    failoverOrder: workers,
    quorumSize,
    fenceToken: null,
    lastElection: Date.now(),
    lastHealthCheck: Date.now(),
  });
}

/**
 * Create a test job execution record
 */
export async function createTestJobExecution(
  stateManager: StateManager,
  executionId: string,
  options: {
    jobName?: string;
    workerId?: string;
    status?: "pending" | "running" | "completed" | "failed";
  } = {}
): Promise<void> {
  const {
    jobName = "test-job",
    workerId = "test-worker-1",
    status = "running",
  } = options;

  await stateManager.recordJobExecution({
    id: executionId,
    jobName,
    workerId,
    status,
    startTime: Date.now(),
  });
}

/**
 * Assert that a response is successful
 */
export function assertSuccess(response: { status: number }): void {
  if (response.status >= 400) {
    throw new Error(`Expected success status, got ${response.status}`);
  }
}

/**
 * Assert that a response is a specific status
 */
export function assertStatus(response: { status: number }, expected: number): void {
  if (response.status !== expected) {
    throw new Error(`Expected status ${expected}, got ${response.status}`);
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
