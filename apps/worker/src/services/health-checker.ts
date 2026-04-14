/**
 * Health Checker Service
 *
 * Monitors worker health within a worker group using quorum-based voting.
 * When a worker is detected as unhealthy by a quorum of workers, failover is triggered.
 */

import type Redis from "ioredis";
import { getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import { getConfig } from "@uni-backups/shared/config";
import type { WorkerConfig } from "../config";

export interface HealthCheckResult {
  workerId: string;
  healthy: boolean;
  lastHeartbeat: number;
  reason?: string;
}

export interface HealthCheckerOptions {
  stateManager?: StateManager;
  redis?: Redis;
  workerGroups?: Map<string, { workers: string[]; primary: string; failover_order: string[]; quorum_size: number }>;
  checkInterval?: number;
}

type WorkerGroupConfig = {
  workers: string[];
  primary?: string;
  failover_order?: string[];
  quorum_size: number;
};

export class HealthChecker {
  private workerConfig: WorkerConfig;
  private stateManager: StateManager;
  private redis: Redis;
  private workerGroups?: Map<string, { workers: string[]; primary: string; failover_order: string[]; quorum_size: number }>;
  private checkTimer: Timer | null = null;
  private running = false;
  private checkInterval: number;
  private heartbeatTimeout: number;

  constructor(workerConfig: WorkerConfig, options?: HealthCheckerOptions) {
    this.workerConfig = workerConfig;
    this.redis = options?.redis ?? getRedisConnection();
    this.stateManager = options?.stateManager ?? new StateManager(this.redis);
    this.workerGroups = options?.workerGroups;
    this.checkInterval = options?.checkInterval ?? parseInt(process.env.HEALTH_CHECK_INTERVAL || "10000", 10);
    this.heartbeatTimeout = workerConfig.heartbeatTimeout;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Start periodic health checks
    this.checkTimer = setInterval(
      () => this.runHealthChecks(),
      this.checkInterval
    );

    // Perform an initial health check immediately
    await this.runHealthChecks();

    console.log(`[HealthChecker] Started for worker ${this.workerConfig.id}`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    console.log(`[HealthChecker] Stopped for worker ${this.workerConfig.id}`);
  }

  private async runHealthChecks(): Promise<void> {
    for (const groupId of this.workerConfig.groups) {
      try {
        await this.checkWorkerGroup(groupId);
      } catch (error) {
        console.error(`[HealthChecker] Error checking group ${groupId}:`, error);
      }
    }
  }

  private async checkWorkerGroup(groupId: string): Promise<void> {
    // Use injected workerGroups (for testing) or fall back to config file
    const groupConfig = this.workerGroups?.get(groupId) ?? getConfig().workerGroups.get(groupId);

    if (!groupConfig) {
      return;
    }

    const groupMembers = await this.getGroupMembers(groupId, groupConfig);
    const groupState = await this.stateManager.getWorkerGroupState(groupId);
    const healthyWorkerIds = new Set(
      await this.stateManager.getHealthyWorkers(this.heartbeatTimeout)
    );
    const healthyGroupWorkerIds = new Set(
      groupMembers.filter((workerId) => healthyWorkerIds.has(workerId))
    );

    if (!groupState) {
      // No group state yet - attempt initial primary election using configured membership/order.
      await this.electPrimary(groupId, groupConfig, groupMembers, healthyGroupWorkerIds);
      return;
    }

    if (groupState.primaryWorkerId) {
      const primaryHealthy = healthyGroupWorkerIds.has(groupState.primaryWorkerId);

      if (!primaryHealthy) {
        console.log(
          `[HealthChecker] Primary worker ${groupState.primaryWorkerId} appears unhealthy in group ${groupId}`
        );

        const voteCount = await this.stateManager.castDownVote(
          groupId,
          this.workerConfig.id,
          groupState.primaryWorkerId
        );

        console.log(
          `[HealthChecker] Cast down vote for ${groupState.primaryWorkerId} (${voteCount}/${groupState.quorumSize} votes)`
        );

        if (voteCount >= groupState.quorumSize) {
          console.log(
            `[HealthChecker] Quorum reached for ${groupState.primaryWorkerId} in group ${groupId}, triggering failover`
          );

          await this.triggerFailover(
            groupId,
            groupState.primaryWorkerId,
            healthyGroupWorkerIds,
            groupConfig,
            groupMembers
          );
        }
      } else {
        await this.updateGroupHealthCheck(groupId);
      }
    } else {
      await this.electPrimary(groupId, groupConfig, groupMembers, healthyGroupWorkerIds);
    }
  }

  private async triggerFailover(
    groupId: string,
    failedWorkerId: string,
    healthyWorkerIds: Set<string>,
    groupConfig: WorkerGroupConfig,
    groupMembers: string[]
  ): Promise<void> {
    const lockAcquired = await this.stateManager.acquireFailoverLock(
      groupId,
      this.workerConfig.id
    );

    if (!lockAcquired) {
      console.log(`[HealthChecker] Another worker is already handling failover for ${groupId}`);
      return;
    }

    try {
      const groupState = await this.stateManager.getWorkerGroupState(groupId);
      if (!groupState) {
        return;
      }

      let newPrimaryId: string | null = null;
      newPrimaryId = this.selectPrimaryCandidate(
        groupConfig,
        groupMembers,
        healthyWorkerIds,
        failedWorkerId
      );

      if (newPrimaryId) {
        console.log(
          `[HealthChecker] Failover: ${failedWorkerId} -> ${newPrimaryId} in group ${groupId}`
        );

        await this.stateManager.updatePrimaryWorker(groupId, newPrimaryId);
        await this.stateManager.clearVotes(groupId);

        await this.recordFailoverEvent(groupId, failedWorkerId, newPrimaryId);
      } else {
        console.error(`[HealthChecker] No healthy workers available for failover in group ${groupId}`);
      }
    } finally {
      await this.stateManager.releaseFailoverLock(groupId);
    }
  }

  private async electPrimary(
    groupId: string,
    groupConfig: WorkerGroupConfig,
    groupMembers: string[],
    healthyWorkerIds: Set<string>
  ): Promise<void> {
    const lockAcquired = await this.stateManager.acquireFailoverLock(
      groupId,
      this.workerConfig.id
    );

    if (!lockAcquired) {
      return;
    }

    try {
      // Double-check that primary is still not set
      const groupState = await this.stateManager.getWorkerGroupState(groupId);
      if (groupState?.primaryWorkerId) {
        return;
      }

      let newPrimaryId: string | null = null;
      newPrimaryId = this.selectPrimaryCandidate(
        groupConfig,
        groupMembers,
        healthyWorkerIds
      );

      if (newPrimaryId) {
        console.log(`[HealthChecker] Elected ${newPrimaryId} as primary in group ${groupId}`);
        await this.stateManager.updatePrimaryWorker(groupId, newPrimaryId);
      }
    } finally {
      await this.stateManager.releaseFailoverLock(groupId);
    }
  }

  private async updateGroupHealthCheck(groupId: string): Promise<void> {
    await this.redis.hset(`worker_groups:${groupId}`, {
      lastHealthCheck: Date.now().toString(),
    });
  }

  private async getGroupMembers(
    groupId: string,
    groupConfig: WorkerGroupConfig
  ): Promise<string[]> {
    if (groupConfig.workers.length > 0) {
      return Array.from(new Set(groupConfig.workers));
    }

    return Array.from(new Set(await this.stateManager.getWorkersInGroup(groupId)));
  }

  private selectPrimaryCandidate(
    groupConfig: WorkerGroupConfig,
    groupMembers: string[],
    healthyWorkerIds: Set<string>,
    excludeWorkerId?: string
  ): string | null {
    const eligibleMembers = groupMembers.filter(
      (workerId) => workerId !== excludeWorkerId && healthyWorkerIds.has(workerId)
    );

    if (eligibleMembers.length === 0) {
      return null;
    }

    if (groupConfig.primary && eligibleMembers.includes(groupConfig.primary)) {
      return groupConfig.primary;
    }

    for (const candidateId of groupConfig.failover_order ?? []) {
      if (eligibleMembers.includes(candidateId)) {
        return candidateId;
      }
    }

    return eligibleMembers[0] ?? null;
  }

  private async recordFailoverEvent(
    groupId: string,
    fromWorkerId: string,
    toWorkerId: string
  ): Promise<void> {
    const event = JSON.stringify({
      timestamp: Date.now(),
      groupId,
      fromWorkerId,
      toWorkerId,
      initiatedBy: this.workerConfig.id,
    });

    await this.redis.lpush(`failover:events:${groupId}`, event);
    await this.redis.ltrim(`failover:events:${groupId}`, 0, 99); // Keep last 100 events
  }

  async isWorkerHealthy(workerId: string): Promise<HealthCheckResult> {
    const worker = await this.stateManager.getWorkerState(workerId);

    if (!worker) {
      return {
        workerId,
        healthy: false,
        lastHeartbeat: 0,
        reason: "Worker not found",
      };
    }

    const now = Date.now();
    const timeSinceHeartbeat = now - worker.lastHeartbeat;
    const healthy = timeSinceHeartbeat < this.heartbeatTimeout;

    return {
      workerId,
      healthy,
      lastHeartbeat: worker.lastHeartbeat,
      reason: healthy ? undefined : `Last heartbeat ${timeSinceHeartbeat}ms ago (threshold: ${this.heartbeatTimeout}ms)`,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}
