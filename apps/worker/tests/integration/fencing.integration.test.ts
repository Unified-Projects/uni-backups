/**
 * FencingService tests - REAL REDIS (NO MOCKS)
 *
 * Tests the fencing service for split-brain prevention against actual Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager } from "@uni-backups/shared/redis";
import { FencingService } from "../../src/services/fencing";
import type { WorkerConfig } from "../../src/config";

// Real Redis configuration from environment
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts
};

function createTestConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    id: "worker-1",
    name: "Test Worker 1",
    groups: ["default", "test-group"],
    hostname: "localhost",
    healthPort: 3002,
    heartbeatInterval: 5000,
    heartbeatTimeout: 30000,
    concurrency: 2,
    ...overrides,
  };
}

describe("FencingService (Real Redis)", () => {
  let redis: Redis;
  let stateManager: StateManager;
  let fencingService: FencingService;
  let config: WorkerConfig;

  beforeEach(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    stateManager = new StateManager(redis);
    await redis.flushdb();

    config = createTestConfig();
    fencingService = new FencingService(config, { stateManager, redis });
  });

  afterEach(async () => {
    fencingService.clearLocalTokens();
    await redis.flushdb();
    await redis.quit();
  });

  // Helper to create worker group state
  async function createWorkerGroup(groupId: string, primaryWorkerId: string, fenceToken: string | null = null) {
    await stateManager.setWorkerGroupState({
      groupId,
      workers: ["worker-1", "worker-2", "worker-3"],
      primaryWorkerId,
      failoverOrder: ["worker-1", "worker-2", "worker-3"],
      quorumSize: 2,
      fenceToken,
      lastElection: Date.now() - 10000,
      lastHealthCheck: Date.now(),
    });
  }

  describe("validatePrimary()", () => {
    it("should return valid for current primary", async () => {
      await createWorkerGroup("test-group", "worker-1"); // worker-1 is primary

      const result = await fencingService.validatePrimary("test-group");

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should return invalid if not primary", async () => {
      await createWorkerGroup("test-group", "worker-2"); // worker-2 is primary, not worker-1

      const result = await fencingService.validatePrimary("test-group");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not the primary");
      expect(result.reason).toContain("worker-2");
    });

    it("should return invalid for fence token mismatch", async () => {
      // Set up initial state with fence token
      await createWorkerGroup("test-group", "worker-1", "original-token");

      // First validation - stores the token locally
      await fencingService.validatePrimary("test-group");

      // Simulate failover - token changes
      await stateManager.updatePrimaryWorker("test-group", "worker-1");

      const result = await fencingService.validatePrimary("test-group");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Fence token mismatch");
    });

    it("should handle group not found", async () => {
      const result = await fencingService.validatePrimary("non-existent");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  describe("acquireFenceToken()", () => {
    it("should atomically acquire token if primary", async () => {
      await createWorkerGroup("test-group", "worker-1");

      const result = await fencingService.acquireFenceToken("test-group");

      expect(result).not.toBeNull();
      // Format is: timestamp-randomhex-workeridprefix
      expect(result).toMatch(/^\d+-[a-z0-9]+-[a-z0-9-]+$/);

      // Token should be stored locally
      expect(fencingService.getLocalFenceToken("test-group")).toBe(result);

      // Token should be in Redis
      const groupState = await stateManager.getWorkerGroupState("test-group");
      expect(groupState!.fenceToken).toBe(result);
    });

    it("should fail if not primary", async () => {
      await createWorkerGroup("test-group", "worker-2"); // worker-2 is primary, not worker-1

      const result = await fencingService.acquireFenceToken("test-group");

      expect(result).toBeNull();
    });
  });

  describe("fenceOff()", () => {
    it("should invalidate old worker's token", async () => {
      const originalToken = "original-token";
      await createWorkerGroup("test-group", "worker-1", originalToken);

      await fencingService.fenceOff("test-group", "old-worker");

      // The fence token should have changed
      const groupState = await stateManager.getWorkerGroupState("test-group");
      expect(groupState!.fenceToken).not.toBe(originalToken);

      // The fencedWorker field is stored directly in Redis (not via StateManager)
      const fencedWorker = await redis.hget("worker_groups:test-group", "fencedWorker");
      expect(fencedWorker).toBe("old-worker");
    });

    it("should record fencing event", async () => {
      await createWorkerGroup("test-group", "worker-1");

      await fencingService.fenceOff("test-group", "old-worker");

      // Check fencing events list in Redis
      const events = await redis.lrange("fencing:events:test-group", 0, -1);
      expect(events.length).toBeGreaterThan(0);

      const latestEvent = JSON.parse(events[0]);
      expect(latestEvent.fencedWorkerId).toBe("old-worker");
      expect(latestEvent.groupId).toBe("test-group");
      expect(latestEvent.initiatedBy).toBe(config.id);
    });
  });

  describe("refreshFenceToken()", () => {
    it("should update local token from Redis", async () => {
      await createWorkerGroup("test-group", "worker-1", "refreshed-token");

      await fencingService.refreshFenceToken("test-group");

      expect(fencingService.getLocalFenceToken("test-group")).toBe(
        "refreshed-token"
      );
    });

    it("should handle null fence token", async () => {
      await createWorkerGroup("test-group", "worker-1", null);

      await fencingService.refreshFenceToken("test-group");

      // Should not throw and local token should remain undefined
      expect(fencingService.getLocalFenceToken("test-group")).toBeUndefined();
    });
  });

  describe("isFencedOff()", () => {
    it("should detect fenced status", async () => {
      // Set up initial state
      await createWorkerGroup("test-group", "worker-1", "original-token");

      // First validation to set initial token
      await fencingService.validatePrimary("test-group");

      // Simulate failover - token changes
      await stateManager.updatePrimaryWorker("test-group", "worker-1");

      const isFenced = await fencingService.isFencedOff("test-group");
      expect(isFenced).toBe(true);
    });

    it("should return false when not fenced", async () => {
      await createWorkerGroup("test-group", "worker-1", null);

      const isFenced = await fencingService.isFencedOff("test-group");
      expect(isFenced).toBe(false);
    });
  });

  describe("executeWithFencing()", () => {
    it("should execute operation if fence valid", async () => {
      await createWorkerGroup("test-group", "worker-1", null);

      let operationExecuted = false;
      const operation = async () => {
        operationExecuted = true;
        return "result";
      };

      const result = await fencingService.executeWithFencing(
        "test-group",
        operation
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe("result");
      expect(result.fenceError).toBeUndefined();
      expect(operationExecuted).toBe(true);
    });

    it("should fail if pre-check fails", async () => {
      await createWorkerGroup("test-group", "worker-2", null); // Not the primary

      let operationExecuted = false;
      const operation = async () => {
        operationExecuted = true;
        return "result";
      };

      const result = await fencingService.executeWithFencing(
        "test-group",
        operation
      );

      expect(result.success).toBe(false);
      expect(result.fenceError).toContain("not the primary");
      expect(operationExecuted).toBe(false);
    });

    it("should warn if post-check fails but return result", async () => {
      await createWorkerGroup("test-group", "worker-1", "token-1");

      // Refresh local token
      await fencingService.refreshFenceToken("test-group");

      const operation = async () => {
        // Simulate failover during operation
        await stateManager.updatePrimaryWorker("test-group", "worker-1");
        return "result";
      };

      const result = await fencingService.executeWithFencing(
        "test-group",
        operation
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe("result");
      expect(result.fenceError).toContain("fence was invalidated");
    });

    it("should handle operation errors with fence check", async () => {
      await createWorkerGroup("test-group", "worker-1", null);

      const operation = async () => {
        throw new Error("Operation failed");
      };

      // Should rethrow the error
      await expect(
        fencingService.executeWithFencing("test-group", operation)
      ).rejects.toThrow("Operation failed");
    });
  });

  describe("getLocalFenceToken()", () => {
    it("should return stored token", async () => {
      await createWorkerGroup("test-group", "worker-1", "stored-token");

      await fencingService.refreshFenceToken("test-group");

      expect(fencingService.getLocalFenceToken("test-group")).toBe(
        "stored-token"
      );
    });

    it("should return undefined for unknown group", () => {
      expect(fencingService.getLocalFenceToken("unknown-group")).toBeUndefined();
    });
  });

  describe("clearLocalTokens()", () => {
    it("should clear all tokens", async () => {
      // Store some tokens
      await createWorkerGroup("group-1", "worker-1", "token-1");
      await fencingService.refreshFenceToken("group-1");

      await createWorkerGroup("group-2", "worker-1", "token-2");
      await fencingService.refreshFenceToken("group-2");

      expect(fencingService.getLocalFenceToken("group-1")).toBe("token-1");
      expect(fencingService.getLocalFenceToken("group-2")).toBe("token-2");

      fencingService.clearLocalTokens();

      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
      expect(fencingService.getLocalFenceToken("group-2")).toBeUndefined();
    });
  });
});
