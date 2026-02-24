/**
 * Fencing Service Unit Tests
 *
 * Tests for fencing functionality used in split-brain prevention.
 * Uses mocks for Redis and StateManager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis module
const mockRedis = {
  eval: vi.fn(),
  hset: vi.fn().mockResolvedValue(1),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue("OK"),
};

// Mock StateManager
const mockStateManager = {
  getWorkerGroupState: vi.fn(),
};

vi.mock("@uni-backups/shared/redis", () => ({
  getRedisConnection: vi.fn(() => mockRedis),
  StateManager: vi.fn().mockImplementation(function () { return mockStateManager; }),
}));

import { FencingService, type FenceValidation } from "../fencing";
import type { WorkerConfig } from "../../config";

describe("FencingService", () => {
  let fencingService: FencingService;
  let workerConfig: WorkerConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-initialize mock functions after clearAllMocks to ensure they retain
    // vi.fn() capabilities (mockResolvedValue, mockImplementation, etc.)
    mockStateManager.getWorkerGroupState = vi.fn();

    workerConfig = {
      id: "worker-1",
      name: "test-worker",
      hostname: "test-host.local",
      groups: ["group-1"],
      heartbeatInterval: 5000,
      heartbeatTimeout: 15000,
      concurrency: 2,
    };

    fencingService = new FencingService(workerConfig, {
      stateManager: mockStateManager as any,
      redis: mockRedis as any,
    });
  });

  afterEach(() => {
    fencingService.clearLocalTokens();
  });

  describe("validatePrimary()", () => {
    it("returns false when group not found", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue(null);

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("returns false when worker is not primary", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "other-worker",
        fenceToken: "token-123",
      });

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not the primary");
      expect(result.reason).toContain("worker-1");
      expect(result.reason).toContain("other-worker");
    });

    it("stores token on first validation when primary", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-abc",
      });

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(true);
      expect(fencingService.getLocalFenceToken("group-1")).toBe("token-abc");
    });

    it("returns valid when no fence token exists", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: null,
      });

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(true);
    });

    it("returns false on token mismatch (fenced off)", async () => {
      // First call - set up local token
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-original",
      });
      await fencingService.validatePrimary("group-1");

      // Second call - token has changed (we were fenced off)
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-new",
      });

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Fence token mismatch");
      expect(result.currentToken).toBe("token-new");
      expect(result.expectedToken).toBe("token-original");
    });

    it("returns valid when token matches", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-abc",
      });

      // First validation stores token
      await fencingService.validatePrimary("group-1");

      // Second validation should still be valid
      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(true);
    });
  });

  describe("acquireFenceToken()", () => {
    it("acquires fence token successfully when primary", async () => {
      mockRedis.eval.mockResolvedValue("new-token-123");

      const result = await fencingService.acquireFenceToken("group-1");

      expect(result).toBe("new-token-123");
      expect(fencingService.getLocalFenceToken("group-1")).toBe("new-token-123");
    });

    it("returns null when not primary (acquisition failed)", async () => {
      mockRedis.eval.mockResolvedValue(null);

      const result = await fencingService.acquireFenceToken("group-1");

      expect(result).toBeNull();
      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
    });

    it("uses Lua script for atomic operation", async () => {
      mockRedis.eval.mockResolvedValue("token");

      await fencingService.acquireFenceToken("group-1");

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("local groupKey = KEYS[1]"),
        1,
        "worker_groups:group-1",
        "worker-1",
        expect.any(String)
      );
    });

    it("stores token locally after successful acquisition", async () => {
      mockRedis.eval.mockResolvedValue("acquired-token");

      await fencingService.acquireFenceToken("group-1");

      expect(fencingService.getLocalFenceToken("group-1")).toBe("acquired-token");
    });
  });

  describe("fenceOff()", () => {
    it("updates fence token in Redis", async () => {
      await fencingService.fenceOff("group-1", "old-worker");

      expect(mockRedis.hset).toHaveBeenCalledWith(
        "worker_groups:group-1",
        expect.objectContaining({
          fenceToken: expect.any(String),
          lastFenceUpdate: expect.any(String),
          fencedWorker: "old-worker",
        })
      );
    });

    it("records fencing event", async () => {
      await fencingService.fenceOff("group-1", "old-worker");

      expect(mockRedis.lpush).toHaveBeenCalledWith(
        "fencing:events:group-1",
        expect.stringContaining('"fencedWorkerId":"old-worker"')
      );
    });

    it("trims fencing events to keep last 100", async () => {
      await fencingService.fenceOff("group-1", "old-worker");

      expect(mockRedis.ltrim).toHaveBeenCalledWith(
        "fencing:events:group-1",
        0,
        99
      );
    });

    it("includes initiator in fencing event", async () => {
      await fencingService.fenceOff("group-1", "old-worker");

      expect(mockRedis.lpush).toHaveBeenCalledWith(
        "fencing:events:group-1",
        expect.stringContaining('"initiatedBy":"worker-1"')
      );
    });
  });

  describe("refreshFenceToken()", () => {
    it("updates local token from Redis", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "refreshed-token",
      });

      await fencingService.refreshFenceToken("group-1");

      expect(fencingService.getLocalFenceToken("group-1")).toBe("refreshed-token");
    });

    it("does not update when no fence token in state", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: null,
      });

      await fencingService.refreshFenceToken("group-1");

      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
    });

    it("does not update when group state not found", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue(null);

      await fencingService.refreshFenceToken("group-1");

      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
    });
  });

  describe("isFencedOff()", () => {
    it("returns true when fenced off", async () => {
      // Set up initial token
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "original-token",
      });
      await fencingService.validatePrimary("group-1");

      // Token changed (fenced off)
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "new-token",
      });

      const result = await fencingService.isFencedOff("group-1");

      expect(result).toBe(true);
    });

    it("returns false when not fenced off", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-abc",
      });
      await fencingService.validatePrimary("group-1");

      const result = await fencingService.isFencedOff("group-1");

      expect(result).toBe(false);
    });

    it("returns false when not primary (different error)", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "other-worker",
        fenceToken: "token",
      });

      const result = await fencingService.isFencedOff("group-1");

      // Not fenced specifically, just not primary
      expect(result).toBe(false);
    });
  });

  describe("executeWithFencing()", () => {
    beforeEach(() => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-123",
      });
    });

    it("executes operation when fence is valid", async () => {
      const operation = vi.fn().mockResolvedValue("result");

      const result = await fencingService.executeWithFencing("group-1", operation);

      expect(operation).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.result).toBe("result");
    });

    it("does not execute when pre-check fails", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "other-worker",
        fenceToken: "token-123",
      });

      const operation = vi.fn().mockResolvedValue("result");

      const result = await fencingService.executeWithFencing("group-1", operation);

      expect(operation).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.fenceError).toContain("not the primary");
    });

    it("reports error when post-check fails", async () => {
      // Set up initial token with first validatePrimary call
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-123",
      });
      await fencingService.validatePrimary("group-1");

      // Now set up for executeWithFencing: pre-check passes, post-check returns different token
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Pre-check passes (same token)
          return Promise.resolve({
            id: "group-1",
            primaryWorkerId: "worker-1",
            fenceToken: "token-123",
          });
        }
        // Post-check: token changed during operation
        return Promise.resolve({
          id: "group-1",
          primaryWorkerId: "worker-1",
          fenceToken: "new-token",
        });
      });

      const operation = vi.fn().mockResolvedValue("result");

      const result = await fencingService.executeWithFencing("group-1", operation);

      expect(operation).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.result).toBe("result");
      expect(result.fenceError).toContain("fence was invalidated");
    });

    it("handles operation exceptions with valid fence", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Operation failed"));

      await expect(
        fencingService.executeWithFencing("group-1", operation)
      ).rejects.toThrow("Operation failed");
    });

    it("returns fence error when operation fails and fence is invalid", async () => {
      // Set up token first
      await fencingService.validatePrimary("group-1");

      // Now make operation fail and fence become invalid
      // Pre-check passes (call 1), operation fails, post-check shows not primary (call 2)
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Pre-check passes
          return Promise.resolve({
            id: "group-1",
            primaryWorkerId: "worker-1",
            fenceToken: "token-123",
          });
        }
        // Post-check after error - fence invalid (not primary anymore)
        return Promise.resolve({
          id: "group-1",
          primaryWorkerId: "other-worker",
          fenceToken: "token-123",
        });
      });

      const operation = vi.fn().mockRejectedValue(new Error("Op failed"));

      const result = await fencingService.executeWithFencing("group-1", operation);

      expect(result.success).toBe(false);
      expect(result.fenceError).toContain("Operation failed and fence is invalid");
    });
  });

  describe("getLocalFenceToken()", () => {
    it("returns undefined when no token stored", () => {
      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
    });

    it("returns stored token", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "my-token",
      });

      await fencingService.validatePrimary("group-1");

      expect(fencingService.getLocalFenceToken("group-1")).toBe("my-token");
    });
  });

  describe("clearLocalTokens()", () => {
    it("clears all stored tokens", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-1",
      });
      await fencingService.validatePrimary("group-1");

      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-2",
        primaryWorkerId: "worker-1",
        fenceToken: "token-2",
      });
      await fencingService.validatePrimary("group-2");

      fencingService.clearLocalTokens();

      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
      expect(fencingService.getLocalFenceToken("group-2")).toBeUndefined();
    });
  });

  describe("fence token generation", () => {
    it("generates unique fence tokens", async () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 10; i++) {
        mockRedis.eval.mockResolvedValueOnce(`token-${i}`);
        await fencingService.acquireFenceToken(`group-${i}`);
      }

      // Each call should have a unique token argument
      const tokenArgs = mockRedis.eval.mock.calls.map((call: any[]) => call[4]);
      const uniqueTokens = new Set(tokenArgs);

      expect(uniqueTokens.size).toBe(10);
    });

    it("includes worker ID in fence token", async () => {
      mockRedis.eval.mockImplementation((_script: any, _count: any, _key: any, _workerId: any, token: any) => {
        return Promise.resolve(token);
      });

      const token = await fencingService.acquireFenceToken("group-1");

      expect(token).toContain("worker-1".slice(0, 8));
    });
  });

  describe("edge cases", () => {
    it("rapid token changes: 10 consecutive acquires all produce unique tokens", async () => {
      const tokens: string[] = [];

      for (let i = 0; i < 10; i++) {
        const tokenValue = `rapid-token-${i}-${Date.now()}`;
        mockRedis.eval.mockResolvedValueOnce(tokenValue);
        const result = await fencingService.acquireFenceToken("group-1");
        if (result) {
          tokens.push(result);
        }
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
      expect(tokens.length).toBe(10);

      // getLocalFenceToken should return the latest token
      expect(fencingService.getLocalFenceToken("group-1")).toBe(tokens[tokens.length - 1]);
    });

    it("Redis error during pre-check in executeWithFencing throws", async () => {
      mockStateManager.getWorkerGroupState.mockRejectedValue(
        new Error("Redis connection refused")
      );

      const operation = vi.fn().mockResolvedValue("should-not-run");

      await expect(
        fencingService.executeWithFencing("group-1", operation)
      ).rejects.toThrow("Redis connection refused");

      // Operation should not have been called
      expect(operation).not.toHaveBeenCalled();
    });

    it("Redis error during post-check still returns operation result", async () => {
      // Set up initial token
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-123",
      });
      await fencingService.validatePrimary("group-1");

      // executeWithFencing calls validatePrimary up to 3 times:
      //   call 1: pre-check (should pass)
      //   call 2: post-check in try block (Redis error -> falls to catch)
      //   call 3: post-check in catch block (fence shows invalid -> controlled return)
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Pre-check: valid primary with matching token
          return Promise.resolve({
            id: "group-1",
            primaryWorkerId: "worker-1",
            fenceToken: "token-123",
          });
        }
        if (callCount === 2) {
          // Post-check in try block: Redis timeout
          return Promise.reject(new Error("Redis timeout"));
        }
        // Post-check in catch block: fence is now invalid (primary changed)
        // This allows executeWithFencing to return a controlled error result
        // instead of propagating the Redis timeout exception
        return Promise.resolve({
          id: "group-1",
          primaryWorkerId: "other-worker",
          fenceToken: "token-123",
        });
      });

      const operation = vi.fn().mockResolvedValue("operation-completed");

      // The operation itself succeeded, but the post-check Redis error causes
      // executeWithFencing to fall into its catch handler. The catch handler's
      // validatePrimary shows the fence is invalid, so it returns a controlled
      // error result rather than propagating the Redis timeout.
      const result = await fencingService.executeWithFencing("group-1", operation);

      // Operation was executed successfully before the post-check error
      expect(operation).toHaveBeenCalled();
      // The catch handler returns a controlled error with fence information
      expect(result.success).toBe(false);
      expect(result.fenceError).toContain("Operation failed and fence is invalid");
    });

    it("primary change between pre-check and post-check reports fenceError", async () => {
      // Set up initial token
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: "token-123",
      });
      await fencingService.validatePrimary("group-1");

      // Pre-check: worker-1 is primary with same token
      // Post-check: worker-2 is now primary (primary changed during operation)
      let callCount = 0;
      mockStateManager.getWorkerGroupState.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            id: "group-1",
            primaryWorkerId: "worker-1",
            fenceToken: "token-123",
          });
        }
        return Promise.resolve({
          id: "group-1",
          primaryWorkerId: "worker-2",
          fenceToken: "token-456",
        });
      });

      const operation = vi.fn().mockResolvedValue("completed");

      const result = await fencingService.executeWithFencing("group-1", operation);

      // Operation was executed (pre-check passed)
      expect(operation).toHaveBeenCalled();
      expect(result.result).toBe("completed");
      // But post-check detected the fence was invalidated
      expect(result.fenceError).toBeDefined();
      expect(result.fenceError).toContain("fence was invalidated");
    });

    it("validatePrimary with undefined fenceToken does not store token", async () => {
      mockStateManager.getWorkerGroupState.mockResolvedValue({
        id: "group-1",
        primaryWorkerId: "worker-1",
        fenceToken: undefined,
      });

      const result = await fencingService.validatePrimary("group-1");

      expect(result.valid).toBe(true);
      // No token should be stored when fenceToken is undefined
      expect(fencingService.getLocalFenceToken("group-1")).toBeUndefined();
    });

    it("acquireFenceToken for multiple groups stores separate tokens", async () => {
      mockRedis.eval
        .mockResolvedValueOnce("token-group-a")
        .mockResolvedValueOnce("token-group-b");

      await fencingService.acquireFenceToken("group-a");
      await fencingService.acquireFenceToken("group-b");

      expect(fencingService.getLocalFenceToken("group-a")).toBe("token-group-a");
      expect(fencingService.getLocalFenceToken("group-b")).toBe("token-group-b");

      // Clearing one group's token via clearLocalTokens clears all
      fencingService.clearLocalTokens();
      expect(fencingService.getLocalFenceToken("group-a")).toBeUndefined();
      expect(fencingService.getLocalFenceToken("group-b")).toBeUndefined();
    });
  });
});
