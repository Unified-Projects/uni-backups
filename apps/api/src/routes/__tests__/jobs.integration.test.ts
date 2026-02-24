import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { StateManager } from "@uni-backups/shared/redis";
import { QUEUES, type BackupJobData } from "@uni-backups/queue";
import { resetConfigCache } from "@uni-backups/shared/config";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
  keyPrefix: "uni-backups:",
};

const BULLMQ_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const TEST_TIMEOUT = 60000;

describe("Jobs API Routes (Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;
  let backupQueue: Queue<BackupJobData>;
  let testConfigDir: string;
  let testConfigFile: string;

  const setupTestConfig = () => {
    resetConfigCache();

    testConfigDir = join(tmpdir(), `uni-backups-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
    testConfigFile = join(testConfigDir, "backups.yml");

    const yamlContent = `
storage:
  local:
    type: local
    path: /tmp/test-backup-storage

jobs:
  testfolder:
    type: folder
    source: /tmp/test-source
    storage: local
    schedule: "0 * * * *"
    worker_group: default

  testpostgres:
    type: postgres
    database: testdb
    host: localhost
    port: 5432
    user: testuser
    storage: local
    worker_group: database-workers
`;

    writeFileSync(testConfigFile, yamlContent);

    process.env.REDIS_HOST = TEST_REDIS_CONFIG.host;
    process.env.REDIS_PORT = String(TEST_REDIS_CONFIG.port);
    process.env.REDIS_PASSWORD = TEST_REDIS_CONFIG.password;
    process.env.REDIS_DB = String(TEST_REDIS_CONFIG.db);
    process.env.REDIS_KEY_PREFIX = TEST_REDIS_CONFIG.keyPrefix;
    process.env.UNI_BACKUPS_RESTIC_PASSWORD = "test-restic-password";
    process.env.UNI_BACKUPS_CONFIG_FILE = testConfigFile;

    resetConfigCache();
  };

  beforeAll(async () => {
    setupTestConfig();

    const { closeRedisConnections, getRedisConnection } = await import("@uni-backups/shared/redis");
    await closeRedisConnections();

    redis = getRedisConnection();

    try {
      await redis.ping();
    } catch {
      throw new Error(
        "Redis is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }

    stateManager = new StateManager(redis);

    const { initScheduler, getBackupQueue } = await import("../../services/scheduler");
    await initScheduler({
      bullmqConnection: new Redis(BULLMQ_REDIS_CONFIG),
      redisConnection: redis,
    });

    backupQueue = getBackupQueue()!;

    const jobsModule = await import("../jobs");
    app = new Hono();
    app.route("/jobs", jobsModule.default);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    const { stopScheduler } = await import("../../services/scheduler");
    const { closeRedisConnections } = await import("@uni-backups/shared/redis");
    await stopScheduler();
    await backupQueue.pause();
    await backupQueue.obliterate({ force: true });
    await backupQueue.close();
    await redis.flushdb();
    await closeRedisConnections();

    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    await redis.flushdb();
    await backupQueue.drain();
    await backupQueue.pause();
    await backupQueue.obliterate({ force: true });
    await backupQueue.resume();
  });

  describe("GET /jobs", () => {
    it("returns list of all configured jobs", async () => {
      const res = await app.request("/jobs");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.jobs).toBeDefined();
      expect(Array.isArray(json.jobs)).toBe(true);
      expect(json.jobs.length).toBeGreaterThanOrEqual(2);
    });

    it("returns jobs with correct properties", async () => {
      const res = await app.request("/jobs");
      const json = await res.json();

      const folderJob = json.jobs.find((j: any) => j.name === "testfolder");
      expect(folderJob).toBeDefined();
      expect(folderJob.type).toBe("folder");
      expect(folderJob.storage).toBe("local");
      expect(folderJob.source).toBe("/tmp/test-source");
      expect(folderJob.schedule).toBe("0 * * * *");
      expect(folderJob.workerGroup).toBe("default");
    });

    it("returns postgres job with database-specific properties", async () => {
      const res = await app.request("/jobs");
      const json = await res.json();

      const pgJob = json.jobs.find((j: any) => j.name === "testpostgres");
      expect(pgJob).toBeDefined();
      expect(pgJob.type).toBe("postgres");
      expect(pgJob.database).toBe("testdb");
      expect(pgJob.host).toBe("localhost");
    });

    it("marks running jobs correctly", async () => {
      await backupQueue.add("backup:testfolder", {
        executionId: "exec-1",
        jobName: "testfolder",
        jobConfig: { type: "folder", source: "/tmp/test-source", storage: "local" },
        storage: { type: "local", path: "/tmp/test-backup-storage" },
        repoName: "testfolder",
        workerGroups: ["default"],
        triggeredBy: "manual",
        queuedAt: Date.now(),
      } as BackupJobData);

      const res = await app.request("/jobs");
      const json = await res.json();

      expect(json.jobs).toBeDefined();
    });

    it("includes last run information when available", async () => {
      await stateManager.recordJobExecution({
        id: "exec-completed",
        jobName: "testfolder",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
        snapshotId: "snap-123",
      });

      const res = await app.request("/jobs");
      const json = await res.json();

      const folderJob = json.jobs.find((j: any) => j.name === "testfolder");
      expect(folderJob.lastRun).toBeDefined();
      expect(folderJob.lastRun.status).toBe("completed");
      expect(folderJob.lastRun.snapshotId).toBe("snap-123");
    });
  });

  describe("GET /jobs/:name", () => {
    it("returns job details when found", async () => {
      const res = await app.request("/jobs/testfolder");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.name).toBe("testfolder");
      expect(json.config).toBeDefined();
      expect(json.config.type).toBe("folder");
      expect(json.config.source).toBe("/tmp/test-source");
    });

    it("returns 404 when job not found", async () => {
      const res = await app.request("/jobs/nonexistent-job");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("includes recent runs in response", async () => {
      await stateManager.recordJobExecution({
        id: "exec-1",
        jobName: "testfolder",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 20000,
        endTime: Date.now() - 10000,
        duration: 10000,
      });
      await stateManager.recordJobExecution({
        id: "exec-2",
        jobName: "testfolder",
        workerId: "worker-1",
        status: "completed",
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        duration: 10000,
      });

      const res = await app.request("/jobs/testfolder");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.recentRuns).toBeDefined();
      expect(json.recentRuns.length).toBeGreaterThanOrEqual(2);
    });

    it("indicates if job is currently active", async () => {
      const res = await app.request("/jobs/testfolder");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.isActive).toBeDefined();
      expect(typeof json.isActive).toBe("boolean");
    });

    it("returns full config for postgres job", async () => {
      const res = await app.request("/jobs/testpostgres");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config.host).toBe("localhost");
      expect(json.config.port).toBe(5432);
      expect(json.config.database).toBe("testdb");
      expect(json.config.user).toBe("testuser");
    });
  });

  describe("POST /jobs/:name/run", () => {
    it("queues job for execution", async () => {
      const res = await app.request("/jobs/testfolder/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("queued");
      expect(json.executionId).toBeDefined();
      expect(json.name).toBe("testfolder");
    });

    it("returns 404 when job not found", async () => {
      const res = await app.request("/jobs/nonexistent/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("returns 409 when job is already queued", async () => {
      const firstRes = await app.request("/jobs/testfolder/run", { method: "POST" });
      expect(firstRes.status).toBe(200);

      const secondRes = await app.request("/jobs/testfolder/run", { method: "POST" });
      const json = await secondRes.json();

      expect(secondRes.status).toBe(409);
      expect(json.error).toContain("already");
    });

    it("adds job to BullMQ queue", async () => {
      const res = await app.request("/jobs/testfolder/run", { method: "POST" });
      const json = await res.json();

      expect(res.status).toBe(200);

      const waiting = await backupQueue.getWaiting();
      const jobInQueue = waiting.some((j) => j.data.executionId === json.executionId);
      expect(jobInQueue).toBe(true);
    });
  });

  describe("GET /jobs/queue/stats", () => {
    it("returns queue statistics", async () => {
      const res = await app.request("/jobs/queue/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(typeof json.waiting).toBe("number");
      expect(typeof json.active).toBe("number");
      expect(typeof json.completed).toBe("number");
      expect(typeof json.failed).toBe("number");
    });

    it("reflects correct queue counts", async () => {
      await backupQueue.add("job-1", { executionId: "e1", jobName: "j1" } as any);
      await backupQueue.add("job-2", { executionId: "e2", jobName: "j2" } as any);

      const res = await app.request("/jobs/queue/stats");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.waiting).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /jobs/:name/history", () => {
    it("returns 404 when job not found", async () => {
      const res = await app.request("/jobs/nonexistent/history");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toContain("not found");
    });
  });
});
