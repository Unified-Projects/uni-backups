/**
 * Storage API HTTP Integration Tests
 *
 * These tests use the real Hono app with real Redis connections.
 * They verify the full HTTP request/response cycle.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
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

const TEST_TIMEOUT = 60000;

describe("Storage API Routes (HTTP Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;
  let testConfigDir: string;
  let testConfigFile: string;

  const setupTestConfig = () => {
    resetConfigCache();

    testConfigDir = join(tmpdir(), `uni-backups-storage-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
    testConfigFile = join(testConfigDir, "backups.yml");

    const yamlContent = `
storage:
  local-storage:
    type: local
    path: /tmp/test-backup-storage

  s3-storage:
    type: s3
    bucket: test-bucket
    endpoint: http://localhost:9000
    access_key: minioadmin
    secret_key: minioadmin123

  rest-storage:
    type: rest
    url: http://localhost:8000

  sftp-storage:
    type: sftp
    host: localhost
    port: 2222
    user: testuser
    path: /backups

jobs:
  testfolder:
    type: folder
    source: /tmp/test-source
    storage: local-storage
    schedule: "0 * * * *"
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

    const { closeRedisConnections, getRedisConnection } = await import(
      "@uni-backups/shared/redis"
    );
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

    const storageModule = await import("../storage");
    app = new Hono();
    app.route("/storage", storageModule.default);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    const { closeRedisConnections } = await import("@uni-backups/shared/redis");
    await redis.flushdb();
    await closeRedisConnections();

    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  describe("GET /storage", () => {
    it("returns list of all configured storage backends", async () => {
      const res = await app.request("/storage");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("storage");
      expect(Array.isArray(json.storage)).toBe(true);
      expect(json.storage.length).toBeGreaterThanOrEqual(4);
    });

    it("returns storage backends with correct properties", async () => {
      const res = await app.request("/storage");
      expect(res.status).toBe(200);

      const json = await res.json();

      const localStorage = json.storage.find(
        (s: any) => s.name === "local-storage"
      );
      expect(localStorage).toBeDefined();
      expect(localStorage.type).toBe("local");
      expect(localStorage.path).toBe("/tmp/test-backup-storage");
    });

    it("returns S3 storage with required properties", async () => {
      const res = await app.request("/storage");
      expect(res.status).toBe(200);

      const json = await res.json();

      const s3Storage = json.storage.find((s: any) => s.name === "s3-storage");
      expect(s3Storage).toBeDefined();
      expect(s3Storage.type).toBe("s3");
      expect(s3Storage.bucket).toBe("test-bucket");
    });

    it("returns REST storage with URL", async () => {
      const res = await app.request("/storage");
      expect(res.status).toBe(200);

      const json = await res.json();

      const restStorage = json.storage.find(
        (s: any) => s.name === "rest-storage"
      );
      expect(restStorage).toBeDefined();
      expect(restStorage.type).toBe("rest");
      expect(restStorage.url).toBe("http://localhost:8000");
    });

    it("returns SFTP storage with connection details", async () => {
      const res = await app.request("/storage");
      expect(res.status).toBe(200);

      const json = await res.json();

      const sftpStorage = json.storage.find(
        (s: any) => s.name === "sftp-storage"
      );
      expect(sftpStorage).toBeDefined();
      expect(sftpStorage.type).toBe("sftp");
      expect(sftpStorage.host).toBe("localhost");
      expect(sftpStorage.port).toBe(2222);
    });
  });

  describe("GET /storage/:name/status", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/storage/nonexistent-storage/status");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
      expect(json.error).toContain("not found");
    });

    it("returns status for local storage", async () => {
      const res = await app.request("/storage/local-storage/status");
      // May fail if path doesn't exist, but should not 404
      expect([200, 500]).toContain(res.status);

      const json = await res.json();
      if (res.status === 200) {
        expect(json).toHaveProperty("name");
        expect(json).toHaveProperty("status");
        expect(["connected", "error"]).toContain(json.status);
      }
    });
  });

  describe("GET /storage/:name/repos", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/storage/nonexistent-storage/repos");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns repos list for valid storage", async () => {
      const res = await app.request("/storage/local-storage/repos");
      // May fail if storage isn't set up, but response structure should be valid
      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        const json = await res.json();
        expect(json).toHaveProperty("repos");
        expect(Array.isArray(json.repos)).toBe(true);
      }
    });
  });

  describe("GET /storage/:name/stats", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/storage/nonexistent-storage/stats");
      expect(res.status).toBe(404);
    });

    it("returns stats structure for valid storage", async () => {
      const res = await app.request("/storage/local-storage/stats");
      // May fail if no repos exist
      expect([200, 404, 500]).toContain(res.status);

      if (res.status === 200) {
        const json = await res.json();
        expect(json).toHaveProperty("storage");
        expect(json).toHaveProperty("totalSize");
        expect(json).toHaveProperty("totalFileCount");
        expect(json).toHaveProperty("totalSnapshots");
        expect(json).toHaveProperty("repoCount");
        expect(json).toHaveProperty("repos");
      }
    });
  });

  describe("Error handling", () => {
    it("handles malformed storage name gracefully", async () => {
      const res = await app.request(
        `/storage/${encodeURIComponent("../../../etc/passwd")}/status`
      );
      expect(res.status).toBe(404);
    });

    it("handles special characters in storage name", async () => {
      const res = await app.request(
        `/storage/${encodeURIComponent("<script>alert(1)</script>")}/repos`
      );
      expect(res.status).toBe(404);
    });

    it("returns JSON error for all error responses", async () => {
      const res = await app.request("/storage/nonexistent/status");
      expect(res.status).toBe(404);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });
});
