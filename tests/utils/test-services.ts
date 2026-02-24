/**
 * Unified Test Services Manager
 *
 * Provides connections to all Docker test services for integration testing.
 * Designed to work with the services.yml Docker Compose configuration.
 */

import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { Client as PostgresClient } from "pg";
import { createConnection, Connection as MariaDBConnection } from "mysql2/promise";
import { StateManager, JobExecution } from "@uni-backups/shared/redis";
import { QUEUES } from "@uni-backups/queue";

export const TEST_CONFIG = {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || "testpass123",
    db: 15, // Test database
  },
  postgres: {
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    user: process.env.POSTGRES_USER || "testuser",
    password: process.env.POSTGRES_PASSWORD || "testpass123",
    database: process.env.POSTGRES_DB || "testdb",
  },
  postgresRestore: {
    host: process.env.POSTGRES_RESTORE_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_RESTORE_PORT || "5433"),
    user: process.env.POSTGRES_USER || "testuser",
    password: process.env.POSTGRES_PASSWORD || "testpass123",
    database: "restoredb",
  },
  mariadb: {
    host: process.env.MARIADB_HOST || "localhost",
    port: parseInt(process.env.MARIADB_PORT || "3306"),
    user: process.env.MARIADB_USER || "testuser",
    password: process.env.MARIADB_PASSWORD || "testpass123",
    database: process.env.MARIADB_DATABASE || "testdb",
  },
  mariadbRestore: {
    host: process.env.MARIADB_RESTORE_HOST || "localhost",
    port: parseInt(process.env.MARIADB_RESTORE_PORT || "3307"),
    user: process.env.MARIADB_USER || "testuser",
    password: process.env.MARIADB_PASSWORD || "testpass123",
    database: "restoredb",
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || "localhost:9000",
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin123",
    bucket: "integration-test",
    region: "us-east-1",
  },
  rest: {
    url: process.env.REST_SERVER_URL || "http://localhost:8000",
  },
  sftp: {
    host: process.env.SFTP_HOST || "localhost",
    port: parseInt(process.env.SFTP_PORT || "2222"),
    user: process.env.SFTP_USER || "testuser",
    password: process.env.SFTP_PASSWORD || "testpass123",
  },
  restic: {
    password: process.env.UNI_BACKUPS_RESTIC_PASSWORD || "test-password",
  },
};

/**
 * Create a Redis connection for testing
 */
export function createTestRedis(): Redis {
  return new Redis({
    ...TEST_CONFIG.redis,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
  });
}

/**
 * Create a BullMQ-compatible Redis connection
 */
export function createBullMQConnection(): Redis {
  return new Redis({
    ...TEST_CONFIG.redis,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Create a StateManager with real Redis
 */
export function createTestStateManager(redis?: Redis): StateManager {
  const connection = redis || createTestRedis();
  return new StateManager(connection);
}

/**
 * Create BullMQ queues for testing
 */
export function createTestQueues(connection?: Redis) {
  const conn = connection || createBullMQConnection();
  return {
    backup: new Queue(QUEUES.BACKUP_JOBS, { connection: conn }),
    prune: new Queue(QUEUES.PRUNE_JOBS, { connection: conn }),
    restore: new Queue(QUEUES.RESTORE_JOBS, { connection: conn }),
    connection: conn,
  };
}

/**
 * Clean up test queues
 */
export async function cleanupTestQueues(queues: ReturnType<typeof createTestQueues>) {
  await queues.backup.pause();
  await queues.prune.pause();
  await queues.restore.pause();
  await queues.backup.obliterate({ force: true });
  await queues.prune.obliterate({ force: true });
  await queues.restore.obliterate({ force: true });
  await queues.backup.close();
  await queues.prune.close();
  await queues.restore.close();
  await queues.connection.quit();
}

/**
 * Generate test snapshot/job execution records for retention testing
 */
export function generateSnapshots(
  jobName: string,
  count: number,
  now: number,
  intervalMs: number
): JobExecution[] {
  const snapshots: JobExecution[] = [];

  for (let i = 0; i < count; i++) {
    const snapshotTime = now - (i * intervalMs);
    snapshots.push({
      id: `snap-${jobName}-${i}-${snapshotTime}`,
      jobName,
      workerId: "test-worker",
      status: i % 5 === 0 ? "failed" : "completed",
      startTime: snapshotTime,
      endTime: snapshotTime + 1000,
      snapshotId: `abc${i.toString(16).padStart(8, "0")}`,
      duration: 1000,
      priority: i % 3,
    });
  }

  return snapshots;
}

/**
 * Simulate retention pruning logic for testing
 */
export function simulateRetentionPruning(
  jobs: JobExecution[],
  retention: { hourly?: number; daily?: number; weekly?: number; monthly?: number; yearly?: number; lastN?: number }
): JobExecution[] {
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  const oneYear = 365 * oneDay;

  const now = Date.now();
  let filtered = jobs;

  // Apply age-based retention policies (most restrictive first)
  // These filter by time, keeping only recent snapshots
  const timeFilters: Array<[string | undefined, number]> = [
    [retention.hourly, oneHour],
    [retention.daily, oneDay],
    [retention.weekly, oneWeek],
    [retention.monthly, oneMonth],
    [retention.yearly, oneYear],
  ];

  // Apply the most restrictive time filter (smallest retention period wins)
  const activeTimeFilters = timeFilters.filter(([value]) => value !== undefined);
  if (activeTimeFilters.length > 0) {
    // Sort by retention period (smallest first = most restrictive)
    activeTimeFilters.sort((a, b) => (a[0] as number) - (b[0] as number));
    const [mostRestrictive, interval] = activeTimeFilters[0];
    const cutoff = now - (mostRestrictive as number) * interval;
    filtered = filtered.filter(j => j.startTime >= cutoff);
  }

  // Apply last N retention (take only the N most recent)
  if (retention.lastN && retention.lastN > 0) {
    // Sort by startTime descending (most recent first)
    filtered = [...filtered].sort((a, b) => b.startTime - a.startTime);
    filtered = filtered.slice(0, retention.lastN);
  }

  return filtered;
}

/**
 * Create a PostgreSQL connection for testing
 */
export async function createTestPostgres(): Promise<PostgresClient> {
  const client = new PostgresClient(TEST_CONFIG.postgres);
  await client.connect();
  return client;
}

/**
 * Create a PostgreSQL restore target connection
 */
export async function createTestPostgresRestore(): Promise<PostgresClient> {
  const client = new PostgresClient(TEST_CONFIG.postgresRestore);
  await client.connect();
  return client;
}

/**
 * Create a MariaDB connection for testing
 */
export async function createTestMariaDB(): Promise<MariaDBConnection> {
  return createConnection(TEST_CONFIG.mariadb);
}

/**
 * Create a MariaDB restore target connection
 */
export async function createTestMariaDBRestore(): Promise<MariaDBConnection> {
  return createConnection(TEST_CONFIG.mariadbRestore);
}

export const TEST_STORAGE = {
  s3: {
    type: "s3" as const,
    endpoint: `http://${TEST_CONFIG.minio.endpoint}`,
    bucket: TEST_CONFIG.minio.bucket,
    region: TEST_CONFIG.minio.region,
    access_key: TEST_CONFIG.minio.accessKey,
    secret_key: TEST_CONFIG.minio.secretKey,
    path: "",
  },
  rest: {
    type: "rest" as const,
    url: TEST_CONFIG.rest.url,
    path: "",
  },
  sftp: {
    type: "sftp" as const,
    host: TEST_CONFIG.sftp.host,
    port: TEST_CONFIG.sftp.port,
    user: TEST_CONFIG.sftp.user,
    password: TEST_CONFIG.sftp.password,
    path: "/config/data",
  },
  local: {
    type: "local" as const,
    path: "/tmp/test-backup-storage",
  },
};

export interface TestContext {
  redis: Redis;
  bullmqConnection: Redis;
  stateManager: StateManager;
  queues: ReturnType<typeof createTestQueues>;
  postgres?: PostgresClient;
  mariadb?: MariaDBConnection;
}

/**
 * Initialize a full test context with all services
 */
export async function initTestContext(options: {
  redis?: boolean;
  queues?: boolean;
  postgres?: boolean;
  mariadb?: boolean;
} = {}): Promise<TestContext> {
  const { redis: needsRedis = true, queues: needsQueues = true, postgres: needsPostgres = false, mariadb: needsMariadb = false } = options;

  const redisConn = needsRedis ? createTestRedis() : (null as unknown as Redis);
  const bullmqConn = needsQueues ? createBullMQConnection() : (null as unknown as Redis);

  // Wait for Redis to be ready
  if (needsRedis) {
    await waitForRedis(redisConn);
    await redisConn.flushdb(); // Clean test DB
  }

  const context: TestContext = {
    redis: redisConn,
    bullmqConnection: bullmqConn,
    stateManager: needsRedis ? new StateManager(redisConn) : (null as unknown as StateManager),
    queues: needsQueues ? createTestQueues(bullmqConn) : (null as unknown as ReturnType<typeof createTestQueues>),
  };

  if (needsPostgres) {
    context.postgres = await createTestPostgres();
  }

  if (needsMariadb) {
    context.mariadb = await createTestMariaDB();
  }

  return context;
}

/**
 * Clean up test context
 */
export async function cleanupTestContext(context: TestContext) {
  if (context.queues) {
    await cleanupTestQueues(context.queues);
  }
  if (context.redis) {
    try {
      await context.redis.flushdb();
    } catch {
      // Ignore errors during cleanup
    }
    try {
      await context.redis.quit();
    } catch {
      // Ignore connection close errors
    }
  }
  if (context.bullmqConnection && context.bullmqConnection !== context.redis) {
    try {
      await context.bullmqConnection.quit();
    } catch {
      // Ignore connection close errors
    }
  }
  if (context.postgres) {
    try {
      await context.postgres.end();
    } catch {
      // Ignore errors
    }
  }
  if (context.mariadb) {
    try {
      await context.mariadb.end();
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Wait for Redis to be ready
 */
export async function waitForRedis(redis: Redis, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await redis.ping();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Redis did not become available within ${timeoutMs}ms`);
}

/**
 * Wait for MinIO to be ready
 */
export async function waitForMinio(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `http://${TEST_CONFIG.minio.endpoint}/minio/health/live`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`MinIO did not become available within ${timeoutMs}ms`);
}

/**
 * Wait for REST server to be ready
 */
export async function waitForRestServer(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(TEST_CONFIG.rest.url);
      if (response.ok || response.status === 404) return; // 404 is ok, means server is up
    } catch {
      // Continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`REST server did not become available within ${timeoutMs}ms`);
}

/**
 * Wait for PostgreSQL to be ready
 */
export async function waitForPostgres(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    let client: PostgresClient | undefined;
    try {
      client = await createTestPostgres();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      if (client) await client.end().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`PostgreSQL did not become available within ${timeoutMs}ms`);
}

/**
 * Wait for MariaDB to be ready
 */
export async function waitForMariaDB(timeoutMs = 60000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    let conn: MariaDBConnection | undefined;
    try {
      conn = await createTestMariaDB();
      await conn.query("SELECT 1");
      await conn.end();
      return;
    } catch {
      if (conn) await conn.end().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`MariaDB did not become available within ${timeoutMs}ms`);
}

/**
 * Wait for all services to be ready
 */
export async function waitForAllServices(options: {
  redis?: boolean;
  minio?: boolean;
  rest?: boolean;
  postgres?: boolean;
  mariadb?: boolean;
} = {}): Promise<void> {
  const { redis = true, minio = false, rest = false, postgres = false, mariadb = false } = options;

  const promises: Promise<void>[] = [];

  if (redis) {
    const conn = createTestRedis();
    promises.push(waitForRedis(conn).finally(() => conn.quit()));
  }
  if (minio) promises.push(waitForMinio());
  if (rest) promises.push(waitForRestServer());
  if (postgres) promises.push(waitForPostgres());
  if (mariadb) promises.push(waitForMariaDB());

  await Promise.all(promises);
}

/**
 * Generate a unique test ID
 */
export function generateTestId(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique repo name for tests
 */
export function generateTestRepoName(base = "test-repo"): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
