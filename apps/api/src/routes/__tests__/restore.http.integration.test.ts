/**
 * Restore API HTTP Integration Tests
 *
 * These tests use the real Hono app with real Redis connections.
 * They verify the full HTTP request/response cycle for restore operations.
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

describe("Restore API Routes (HTTP Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;
  let testConfigDir: string;
  let testConfigFile: string;

  const setupTestConfig = () => {
    resetConfigCache();

    testConfigDir = join(tmpdir(), `uni-backups-restore-test-${Date.now()}`);
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

    const restoreModule = await import("../restore");
    app = new Hono();
    app.route("/restore", restoreModule.default);
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

  describe("POST /restore", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "nonexistent-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/tmp/restore-target",
        }),
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 400 when target is missing for path method", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          // Missing target
        }),
      });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Target path is required");
    });

    it("initiates restore operation with valid parameters", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/tmp/restore-target",
        }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("id");
      expect(json.status).toBe("pending");
      expect(json.message).toBe("Restore operation started");
    });

    it("accepts download method without target", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("id");
      expect(json.status).toBe("pending");
    });

    it("accepts paths array for selective restore", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
          paths: ["/data/important", "/config"],
        }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("id");
    });

    it("generates unique operation IDs", async () => {
      const res1 = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });

      const res2 = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });

      const json1 = await res1.json();
      const json2 = await res2.json();

      expect(json1.id).not.toBe(json2.id);
    });
  });

  describe("GET /restore/:id", () => {
    it("returns 404 for non-existent operation", async () => {
      const res = await app.request("/restore/nonexistent-operation-id");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns operation status after creation", async () => {
      // First create an operation
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/tmp/restore-target",
        }),
      });
      const createJson = await createRes.json();
      const operationId = createJson.id;

      // Then get its status
      const statusRes = await app.request(`/restore/${operationId}`);
      expect(statusRes.status).toBe(200);

      const statusJson = await statusRes.json();
      expect(statusJson.id).toBe(operationId);
      expect(statusJson.storage).toBe("local-storage");
      expect(statusJson.repo).toBe("test-repo");
      expect(statusJson.snapshotId).toBe("abc12345");
      expect(statusJson.method).toBe("path");
      expect(statusJson.target).toBe("/tmp/restore-target");
      // Operation was just created with no worker running — only "pending" or "running" are valid.
      // "failed" or "completed" without a worker is a broken state, not a passing test.
      expect(["pending", "running"]).toContain(statusJson.status);
      expect(statusJson.startTime).toBeDefined();
    });

    it("includes paths array in status response", async () => {
      const paths = ["/data/file1.txt", "/data/file2.txt"];

      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
          paths,
        }),
      });
      const createJson = await createRes.json();

      const statusRes = await app.request(`/restore/${createJson.id}`);
      const statusJson = await statusRes.json();

      expect(statusJson.paths).toEqual(paths);
    });

    it("shows downloadReady flag for completed download operations", async () => {
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      const createJson = await createRes.json();

      // Check status immediately (will be pending or running)
      const statusRes = await app.request(`/restore/${createJson.id}`);
      const statusJson = await statusRes.json();

      // downloadReady must be false while the operation has not yet completed.
      // In this test context there is no worker, so the operation will always be
      // "pending" or "running" immediately after creation — never "completed".
      expect(["pending", "running"]).toContain(statusJson.status);
      expect(statusJson.downloadReady).toBe(false);
    });
  });

  describe("GET /restore/:id/download", () => {
    it("returns 404 for non-existent operation", async () => {
      const res = await app.request("/restore/nonexistent-id/download");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 400 for incomplete operations", async () => {
      // Create an operation
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });
      const createJson = await createRes.json();

      // Immediately try to download (should fail as not completed).
      // There is no worker in this test context so the operation is always
      // "pending" or "running" at this point — 400 is the only valid response.
      const downloadRes = await app.request(`/restore/${createJson.id}/download`);
      expect(downloadRes.status).toBe(400);

      const downloadJson = await downloadRes.json();
      expect(downloadJson.error).toContain("not completed");
    });

    it("returns 400 for path method operations", async () => {
      // Create a path-method operation
      const createRes = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "path",
          target: "/tmp/restore-target",
        }),
      });
      const createJson = await createRes.json();

      // Wait a moment for potential completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to download (should fail as method is path, not download).
      // Whether the operation is still pending or has completed, path-method
      // operations must never be downloadable — expect exactly 400.
      const downloadRes = await app.request(`/restore/${createJson.id}/download`);
      expect(downloadRes.status).toBe(400);
    });
  });

  describe("GET /restore", () => {
    it("returns empty list when no operations exist", async () => {
      const res = await app.request("/restore");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("operations");
      expect(Array.isArray(json.operations)).toBe(true);
    });

    it("returns list of operations after creating some", async () => {
      // Create a few operations
      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "repo1",
          snapshotId: "aabbccdd",
          method: "download",
        }),
      });

      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "repo2",
          snapshotId: "11223344",
          method: "path",
          target: "/tmp/restore",
        }),
      });

      const res = await app.request("/restore");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.operations.length).toBeGreaterThanOrEqual(2);
    });

    it("returns operations sorted by start time (newest first)", async () => {
      // Create operations with slight delay
      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "first-repo",
          snapshotId: "aabbccdd",
          method: "download",
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "second-repo",
          snapshotId: "11223344",
          method: "download",
        }),
      });

      const res = await app.request("/restore");
      const json = await res.json();

      // The test explicitly creates 2 operations so there must be at least 2.
      // If there are fewer, the list endpoint or the create calls are broken.
      expect(json.operations.length).toBeGreaterThanOrEqual(2);
      // Second (newer) operation should be first in the list.
      expect(json.operations[0].repo).toBe("second-repo");
    });

    it("returns operations with required fields", async () => {
      await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: "local-storage",
          repo: "test-repo",
          snapshotId: "abc12345",
          method: "download",
        }),
      });

      const res = await app.request("/restore");
      const json = await res.json();

      const operation = json.operations[0];
      expect(operation).toHaveProperty("id");
      expect(operation).toHaveProperty("storage");
      expect(operation).toHaveProperty("repo");
      expect(operation).toHaveProperty("snapshotId");
      expect(operation).toHaveProperty("method");
      expect(operation).toHaveProperty("status");
      expect(operation).toHaveProperty("startTime");
    });

    it("limits results to 50 operations", async () => {
      const res = await app.request("/restore");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.operations.length).toBeLessThanOrEqual(50);
    });
  });

  describe("Error handling", () => {
    it("handles malformed JSON body gracefully", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      // Malformed JSON must produce a 400 client error, never a 500.
      // A 500 here means the application is crashing on bad input.
      expect(res.status).toBe(400);
    });

    it("handles missing required fields", async () => {
      const res = await app.request("/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      // Missing required fields (storage, repo, snapshotId) are a client error.
      // 400 is the correct response. 404 is also acceptable if the route
      // attempts to look up the (empty) storage name before validating the body.
      // 500 is never acceptable — the server must not crash on missing fields.
      expect([400, 404]).toContain(res.status);
    });

    it("handles special characters in operation ID", async () => {
      const res = await app.request(
        `/restore/${encodeURIComponent("<script>alert(1)</script>")}`
      );
      expect(res.status).toBe(404);
    });

    it("handles path traversal in operation ID", async () => {
      const res = await app.request(
        `/restore/${encodeURIComponent("../../../etc/passwd")}`
      );
      expect(res.status).toBe(404);
    });

    it("returns JSON error responses", async () => {
      const res = await app.request("/restore/nonexistent");
      expect(res.status).toBe(404);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Concurrent operations", () => {
    it("handles multiple concurrent restore requests", async () => {
      const snapIds = ["aabb0000", "aabb0001", "aabb0002", "aabb0003", "aabb0004"];
      const requests = Array.from({ length: 5 }, (_, i) =>
        app.request("/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "local-storage",
            repo: `test-repo-${i}`,
            snapshotId: snapIds[i],
            method: "download",
          }),
        })
      );

      const responses = await Promise.all(requests);

      // All should succeed
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // All should have unique IDs
      const ids = await Promise.all(responses.map(async (r) => (await r.json()).id));
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);
    });

    it("tracks all concurrent operations in list endpoint", async () => {
      const concurrentSnapIds = ["ccdd0000", "ccdd0001", "ccdd0002"];
      const createPromises = Array.from({ length: 3 }, (_, i) =>
        app.request("/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "local-storage",
            repo: `concurrent-repo-${i}`,
            snapshotId: concurrentSnapIds[i],
            method: "download",
          }),
        })
      );

      await Promise.all(createPromises);

      const listRes = await app.request("/restore");
      const listJson = await listRes.json();

      expect(listJson.operations.length).toBeGreaterThanOrEqual(3);
    });
  });
});
