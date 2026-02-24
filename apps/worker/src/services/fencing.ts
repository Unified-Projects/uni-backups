/**
 * Fencing Service
 *
 * Implements fencing for split-brain prevention in the worker cluster.
 * Uses fence tokens to ensure only the legitimate primary can perform write operations.
 */

import type Redis from "ioredis";
import { getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import type { WorkerConfig } from "../config";

export interface FenceValidation {
  valid: boolean;
  reason?: string;
  currentToken?: string;
  expectedToken?: string;
}

export interface FencingServiceOptions {
  stateManager?: StateManager;
  redis?: Redis;
}

export class FencingService {
  private workerConfig: WorkerConfig;
  private stateManager: StateManager;
  private redis: Redis;
  private localFenceTokens: Map<string, string> = new Map();

  constructor(workerConfig: WorkerConfig, options?: FencingServiceOptions) {
    this.workerConfig = workerConfig;
    this.redis = options?.redis ?? getRedisConnection();
    this.stateManager = options?.stateManager ?? new StateManager(this.redis);
  }

  async validatePrimary(groupId: string): Promise<FenceValidation> {
    const groupState = await this.stateManager.getWorkerGroupState(groupId);

    if (!groupState) {
      return {
        valid: false,
        reason: `Worker group ${groupId} not found`,
      };
    }

    if (groupState.primaryWorkerId !== this.workerConfig.id) {
      return {
        valid: false,
        reason: `This worker (${this.workerConfig.id}) is not the primary for group ${groupId}. Current primary: ${groupState.primaryWorkerId}`,
      };
    }

    const localToken = this.localFenceTokens.get(groupId);

    if (!localToken) {
      // First time - store the current token
      if (groupState.fenceToken) {
        this.localFenceTokens.set(groupId, groupState.fenceToken);
      }
      return { valid: true };
    }

    if (groupState.fenceToken && localToken !== groupState.fenceToken) {
      return {
        valid: false,
        reason: "Fence token mismatch - this worker may have been fenced off",
        currentToken: groupState.fenceToken,
        expectedToken: localToken,
      };
    }

    return { valid: true };
  }

  async acquireFenceToken(groupId: string): Promise<string | null> {
    const redis = this.redis;

    const newToken = this.generateFenceToken();

    // Use Lua script for atomic check-and-set
    const luaScript = `
      local groupKey = KEYS[1]
      local workerId = ARGV[1]
      local newToken = ARGV[2]

      local currentPrimary = redis.call('HGET', groupKey, 'primaryWorkerId')

      if currentPrimary == workerId then
        redis.call('HSET', groupKey, 'fenceToken', newToken)
        return newToken
      else
        return nil
      end
    `;

    const result = await redis.eval(
      luaScript,
      1,
      `worker_groups:${groupId}`,
      this.workerConfig.id,
      newToken
    ) as string | null;

    if (result) {
      this.localFenceTokens.set(groupId, result);
    }

    return result;
  }

  async fenceOff(groupId: string, oldWorkerId: string): Promise<void> {
    const redis = this.redis;
    const newToken = this.generateFenceToken();

    // Update the fence token, which will invalidate the old worker's operations
    await redis.hset(`worker_groups:${groupId}`, {
      fenceToken: newToken,
      lastFenceUpdate: Date.now().toString(),
      fencedWorker: oldWorkerId,
    });

    const fencingEvent = JSON.stringify({
      timestamp: Date.now(),
      groupId,
      fencedWorkerId: oldWorkerId,
      newToken,
      initiatedBy: this.workerConfig.id,
    });

    await redis.lpush(`fencing:events:${groupId}`, fencingEvent);
    await redis.ltrim(`fencing:events:${groupId}`, 0, 99);

    console.log(`[Fencing] Worker ${oldWorkerId} fenced off in group ${groupId}`);
  }

  async refreshFenceToken(groupId: string): Promise<void> {
    const groupState = await this.stateManager.getWorkerGroupState(groupId);

    if (groupState?.fenceToken) {
      this.localFenceTokens.set(groupId, groupState.fenceToken);
    }
  }

  async isFencedOff(groupId: string): Promise<boolean> {
    const validation = await this.validatePrimary(groupId);
    return !validation.valid && validation.reason?.includes("fenced");
  }

  /**
   * Execute an operation only if the fence is valid
   * Returns false if the operation should not proceed
   */
  async executeWithFencing<T>(
    groupId: string,
    operation: () => Promise<T>
  ): Promise<{ success: boolean; result?: T; fenceError?: string }> {
    const preValidation = await this.validatePrimary(groupId);
    if (!preValidation.valid) {
      return {
        success: false,
        fenceError: preValidation.reason,
      };
    }

    try {
      const result = await operation();

      // Post-check fence (to catch race conditions)
      const postValidation = await this.validatePrimary(groupId);
      if (!postValidation.valid) {
        console.warn(
          `[Fencing] Fence invalidated during operation for group ${groupId}: ${postValidation.reason}`
        );
        // Operation completed but fence is now invalid
        // Caller should handle this case (e.g., rollback or mark as potentially inconsistent)
        return {
          success: true,
          result,
          fenceError: `Operation completed but fence was invalidated: ${postValidation.reason}`,
        };
      }

      return { success: true, result };
    } catch (error) {
      // Check if failure was due to fencing
      const postValidation = await this.validatePrimary(groupId);
      if (!postValidation.valid) {
        return {
          success: false,
          fenceError: `Operation failed and fence is invalid: ${postValidation.reason}`,
        };
      }
      throw error;
    }
  }

  private generateFenceToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${this.workerConfig.id.slice(0, 8)}`;
  }

  getLocalFenceToken(groupId: string): string | undefined {
    return this.localFenceTokens.get(groupId);
  }

  clearLocalTokens(): void {
    this.localFenceTokens.clear();
  }
}
