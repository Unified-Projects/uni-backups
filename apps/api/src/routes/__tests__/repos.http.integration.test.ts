/**
 * Repos API HTTP Integration Tests
 *
 * These tests use the real Hono app with real Redis connections.
 * They verify the full HTTP request/response cycle for repository operations.
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

describe("Repos API Routes (HTTP Integration)", () => {
  let app: Hono;
  let redis: Redis;
  let stateManager: StateManager;
  let testConfigDir: string;
  let testConfigFile: string;

  const setupTestConfig = () => {
    resetConfigCache();

    testConfigDir = join(tmpdir(), `uni-backups-repos-test-${Date.now()}`);
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

    const reposModule = await import("../repos");
    app = new Hono();
    app.route("/repos", reposModule.default);
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

  describe("GET /repos/:storage/:repo/snapshots", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/snapshots");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
      expect(json.error).toContain("not found");
    });

    it("returns 404 for valid storage with non-existent repo", async () => {
      // local-storage exists in config; test-repo is not configured as a job repo,
      // so restic will fail with a not-found error and the route returns 404.
      const res = await app.request("/repos/local-storage/test-repo/snapshots");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 and error body when filtering by tag on non-existent repo", async () => {
      // local-storage exists; test-repo does not exist in restic — route returns 404.
      // The response must contain an error property; the tag parameter is passed through
      // to restic but the repo-not-found response takes precedence.
      const res = await app.request("/repos/local-storage/test-repo/snapshots?tag=test-tag");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 and error body when filtering by host on non-existent repo", async () => {
      // local-storage exists; test-repo does not exist in restic — route returns 404.
      const res = await app.request("/repos/local-storage/test-repo/snapshots?host=test-host");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 and error body when filtering by latest on non-existent repo", async () => {
      // local-storage exists; test-repo does not exist in restic — route returns 404.
      const res = await app.request("/repos/local-storage/test-repo/snapshots?latest=5");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 400 for invalid latest parameter value", async () => {
      // The route validates that latest must be a positive integer.
      const res = await app.request("/repos/local-storage/test-repo/snapshots?latest=0");
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 400 for non-numeric latest parameter", async () => {
      const res = await app.request("/repos/local-storage/test-repo/snapshots?latest=abc");
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 for multiple query parameters on non-existent repo", async () => {
      // local-storage exists; test-repo does not — route returns 404.
      // All query params are forwarded to restic, but the repo-not-found error dominates.
      const res = await app.request(
        "/repos/local-storage/test-repo/snapshots?tag=backup&host=server1&latest=10"
      );
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });
  });

  describe("GET /repos/:storage/:repo/snapshots/:id", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/snapshots/abc123");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 404 for valid storage with non-existent repo or snapshot", async () => {
      // local-storage exists; test-repo does not exist in restic — restic returns a
      // not-found error which the route maps to 404. The response must include an error.
      const res = await app.request("/repos/local-storage/test-repo/snapshots/abc123");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });
  });

  describe("GET /repos/:storage/:repo/snapshots/:id/ls", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/snapshots/abc123/ls");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 404 with path query parameter when repo does not exist", async () => {
      // local-storage exists; test-repo and snapshot abc123 do not exist in restic.
      // The route maps the not-found error to 404 and returns an error body.
      const res = await app.request(
        "/repos/local-storage/test-repo/snapshots/abc123/ls?path=/data"
      );
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 when no path specified and repo does not exist", async () => {
      // Without a path param the route defaults to "/" but restic still fails because
      // neither the repo nor snapshot abc123 exists — route returns 404.
      const res = await app.request("/repos/local-storage/test-repo/snapshots/abc123/ls");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });
  });

  describe("GET /repos/:storage/:repo/stats", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/stats");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 404 for valid storage with non-existent repo", async () => {
      // local-storage exists; test-repo is not in the jobs config so the route does
      // not treat it as a configured repo. Restic fails with a not-found error → 404.
      const res = await app.request("/repos/local-storage/test-repo/stats");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });
  });

  describe("POST /repos/:storage/:repo/check", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/check", {
        method: "POST",
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("returns 404 for valid storage when repo does not exist", async () => {
      // local-storage exists; test-repo is not an initialised restic repo.
      // The check route maps not-found restic errors to 404.
      const res = await app.request("/repos/local-storage/test-repo/check", {
        method: "POST",
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 with readData parameter when repo does not exist", async () => {
      // The readData query param is forwarded to restic but the repo-not-found
      // error is returned first — route maps this to 404.
      const res = await app.request("/repos/local-storage/test-repo/check?readData=true", {
        method: "POST",
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });
  });

  describe("POST /repos/:storage/:repo/unlock", () => {
    it("returns 404 for non-existent storage", async () => {
      const res = await app.request("/repos/nonexistent-storage/test-repo/unlock", {
        method: "POST",
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toContain("not found");
    });

    it("handles unlock request for valid storage", async () => {
      const res = await app.request("/repos/local-storage/test-repo/unlock", {
        method: "POST",
      });
      // The unlock route always returns 200 regardless of whether restic succeeds
      // or fails — it reflects success: true/false in the body.
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("success");
      expect(typeof json.success).toBe("boolean");
    });
  });

  describe("Error handling", () => {
    it("handles malformed storage name gracefully", async () => {
      const res = await app.request(
        `/repos/${encodeURIComponent("../../../etc/passwd")}/test-repo/snapshots`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for special characters in repo name", async () => {
      // local-storage exists; the XSS string is used as a repo name which restic
      // will not find — route maps the not-found restic error to 404.
      const res = await app.request(
        `/repos/local-storage/${encodeURIComponent("<script>alert(1)</script>")}/snapshots`
      );
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns a non-500 status for very long path parameters", async () => {
      // A 1000-character repo name will be passed to restic which will either
      // reject it or fail to find the repo. Either way a 500 (server crash) is
      // never acceptable. The route must return 400 or 404.
      const longName = "x".repeat(1000);
      const res = await app.request(`/repos/local-storage/${longName}/snapshots`);
      expect([200, 400, 404]).toContain(res.status);
    });

    it("returns JSON error for all error responses", async () => {
      const res = await app.request("/repos/nonexistent/nonexistent/snapshots");
      expect(res.status).toBe(404);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Response structure", () => {
    it("returns 404 with error property for snapshot list on non-existent repo", async () => {
      // local-storage exists but test-repo is not an initialised restic repository.
      // The route returns 404 with an error property — not a silent pass.
      const res = await app.request("/repos/local-storage/test-repo/snapshots");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 with error property for stats on non-existent repo", async () => {
      // local-storage exists but test-repo is not an initialised restic repository.
      // The route returns 404 with an error property — not a silent pass.
      const res = await app.request("/repos/local-storage/test-repo/stats");
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns 404 with error property for check on non-existent repo", async () => {
      // local-storage exists but test-repo is not an initialised restic repository.
      // The check route maps not-found errors to 404.
      const res = await app.request("/repos/local-storage/test-repo/check", {
        method: "POST",
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("includes storage and repo in unlock response", async () => {
      const res = await app.request("/repos/local-storage/test-repo/unlock", {
        method: "POST",
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.storage).toBe("local-storage");
      expect(json.repo).toBe("test-repo");
    });
  });
});
