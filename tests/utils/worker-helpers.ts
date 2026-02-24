/**
 * Worker Test Helpers
 *
 * Utilities for simulating workers, testing heartbeat, fencing,
 * and cluster coordination in integration tests.
 */

import Redis from "ioredis";
import { StateManager, type WorkerState, type WorkerGroupState } from "@uni-backups/shared/redis";
import { createTestRedis, createTestStateManager, generateTestId, sleep } from "./test-services";
import type { WorkerConfig } from "../../apps/worker/src/config";

export interface SimulatedWorker {
  id: string;
  config: WorkerConfig;
  stateManager: StateManager;
  redis: Redis;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  isRunning: boolean;

  start(): Promise<void>;
  stop(): Promise<void>;
  sendHeartbeat(status?: WorkerState["status"]): Promise<void>;
  simulateFailure(): Promise<void>;
  getState(): Promise<WorkerState | null>;
}

/**
 * Create a simulated worker for testing
 */
export function createSimulatedWorker(
  config: Partial<WorkerConfig> & { groups: string[] },
  redis?: Redis
): SimulatedWorker {
  const workerId = config.id || generateTestId("worker");
  const connection = redis || createTestRedis();
  const stateManager = new StateManager(connection);

  const fullConfig: WorkerConfig = {
    id: workerId,
    name: config.name || workerId,
    groups: config.groups,
    hostname: config.hostname || "test-host",
    healthPort: config.healthPort || 3002,
    heartbeatInterval: config.heartbeatInterval || 1000,
    heartbeatTimeout: config.heartbeatTimeout || 5000,
    concurrency: config.concurrency || 2,
  };

  const worker: SimulatedWorker = {
    id: workerId,
    config: fullConfig,
    stateManager,
    redis: connection,
    heartbeatInterval: null,
    isRunning: false,

    async start(): Promise<void> {
      if (this.isRunning) return;

      this.isRunning = true;
      await this.sendHeartbeat("starting");

      // Start periodic heartbeats
      this.heartbeatInterval = setInterval(
        () => this.sendHeartbeat("healthy"),
        fullConfig.heartbeatInterval
      );

      // After first heartbeat, mark as healthy
      await sleep(100);
      await this.sendHeartbeat("healthy");
    },

    async stop(): Promise<void> {
      if (!this.isRunning) return;

      // Stop heartbeat interval FIRST to prevent race condition
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Send final stopping status (before marking as stopped)
      const statusToSend = "stopping" as const;
      await this.sendHeartbeat(statusToSend);

      this.isRunning = false;
    },

    async sendHeartbeat(status: WorkerState["status"] = "healthy"): Promise<void> {
      // Don't send heartbeats if worker is stopped or connection is closed
      if (!this.isRunning) return;

      // Check if redis connection is still connected
      if (this.redis.status !== "ready") return;

      const state: WorkerState = {
        id: workerId,
        name: fullConfig.name,
        hostname: fullConfig.hostname,
        groups: fullConfig.groups,
        status,
        lastHeartbeat: Date.now(),
        currentJobs: [],
        metrics: {
          jobsProcessed: 0,
          jobsFailed: 0,
          lastJobTime: 0,
        },
      };

      try {
        await stateManager.setWorkerState(state);
      } catch (error) {
        // Ignore connection errors during shutdown
        if (this.redis.status === "wait") return;
        throw error;
      }
    },

    async simulateFailure(): Promise<void> {
      // Stop sending heartbeats but don't update status
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      this.isRunning = false;
    },

    async getState(): Promise<WorkerState | null> {
      return stateManager.getWorkerState(workerId);
    },
  };

  return worker;
}

/**
 * Create multiple simulated workers
 */
export function createSimulatedWorkerCluster(
  count: number,
  groupId: string,
  redis?: Redis
): SimulatedWorker[] {
  const workers: SimulatedWorker[] = [];

  for (let i = 0; i < count; i++) {
    workers.push(
      createSimulatedWorker(
        {
          id: `worker-${groupId}-${i + 1}`,
          name: `Worker ${i + 1}`,
          groups: [groupId],
        },
        redis
      )
    );
  }

  return workers;
}

/**
 * Cleanup simulated workers
 */
export async function cleanupSimulatedWorkers(workers: SimulatedWorker[]): Promise<void> {
  for (const worker of workers) {
    await worker.stop();
  }
  // Note: We do NOT quit the Redis connection here because workers may share
  // a single connection with the test context. The test context cleanup handles
  // closing the shared connection.
}

/**
 * Create a test worker group state
 */
export async function createTestWorkerGroup(
  stateManager: StateManager,
  groupId: string,
  workers: string[],
  primaryWorkerId?: string | null,
  quorumSize = 2
): Promise<WorkerGroupState> {
  const state: WorkerGroupState = {
    groupId,
    workers,
    primaryWorkerId: primaryWorkerId ?? workers[0] ?? null,
    failoverOrder: workers,
    quorumSize,
    fenceToken: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    lastElection: Date.now(),
    lastHealthCheck: Date.now(),
  };

  await stateManager.setWorkerGroupState(state);
  return state;
}

/**
 * Update primary worker and generate new fence token
 */
export async function electNewPrimary(
  stateManager: StateManager,
  groupId: string,
  newPrimaryId: string
): Promise<void> {
  await stateManager.updatePrimaryWorker(groupId, newPrimaryId);
}

/**
 * Simulate voting for a worker to be down
 */
export async function simulateDownVotes(
  stateManager: StateManager,
  groupId: string,
  voters: string[],
  targetWorkerId: string
): Promise<number> {
  let voteCount = 0;
  for (const voterId of voters) {
    voteCount = await stateManager.castDownVote(groupId, voterId, targetWorkerId);
  }
  return voteCount;
}

/**
 * Wait for a worker's heartbeat to become stale
 */
export async function waitForStaleHeartbeat(
  stateManager: StateManager,
  workerId: string,
  thresholdMs: number,
  timeoutMs = 30000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const healthyWorkers = await stateManager.getHealthyWorkers(thresholdMs);

    if (!healthyWorkers.includes(workerId)) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

/**
 * Verify worker is healthy (has recent heartbeat)
 */
export async function verifyWorkerHealthy(
  stateManager: StateManager,
  workerId: string,
  thresholdMs = 5000
): Promise<boolean> {
  const healthyWorkers = await stateManager.getHealthyWorkers(thresholdMs);
  return healthyWorkers.includes(workerId);
}

/**
 * Get all healthy workers in a group
 */
export async function getHealthyWorkersInGroup(
  stateManager: StateManager,
  groupId: string,
  thresholdMs = 5000
): Promise<string[]> {
  const groupWorkers = await stateManager.getWorkersInGroup(groupId);
  const healthyWorkers = await stateManager.getHealthyWorkers(thresholdMs);

  return groupWorkers.filter((w) => healthyWorkers.includes(w));
}

/**
 * Wait for a failover to complete (new primary elected)
 */
export async function waitForFailover(
  stateManager: StateManager,
  groupId: string,
  expectedPrimaryId: string,
  timeoutMs = 30000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const groupState = await stateManager.getWorkerGroupState(groupId);

    if (groupState?.primaryWorkerId === expectedPrimaryId) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

/**
 * Wait for any primary to be elected (not a specific one)
 */
export async function waitForAnyPrimary(
  stateManager: StateManager,
  groupId: string,
  excludeWorkerId?: string,
  timeoutMs = 30000
): Promise<string | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const groupState = await stateManager.getWorkerGroupState(groupId);

    if (groupState?.primaryWorkerId && groupState.primaryWorkerId !== excludeWorkerId) {
      return groupState.primaryWorkerId;
    }

    await sleep(500);
  }

  return null;
}

/**
 * Get current primary for a group
 */
export async function getCurrentPrimary(
  stateManager: StateManager,
  groupId: string
): Promise<string | null> {
  const groupState = await stateManager.getWorkerGroupState(groupId);
  return groupState?.primaryWorkerId ?? null;
}

/**
 * Wait for a primary to be elected in a worker group
 */
export async function waitForPrimaryElection(
  stateManager: StateManager,
  groupId: string,
  timeoutMs = 30000
): Promise<string | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const groupState = await stateManager.getWorkerGroupState(groupId);

    if (groupState?.primaryWorkerId) {
      return groupState.primaryWorkerId;
    }

    await sleep(500);
  }

  return null;
}

/**
 * Set up a worker group with initial primary for testing
 */
export async function setupWorkerGroup(
  stateManager: StateManager,
  groupId: string,
  workerIds: string[],
  primaryWorkerId?: string
): Promise<void> {
  const primary = primaryWorkerId ?? workerIds[0];
  const state: WorkerGroupState = {
    groupId,
    workers: workerIds,
    primaryWorkerId: primary,
    failoverOrder: workerIds,
    quorumSize: Math.ceil(workerIds.length / 2) + 1,
    fenceToken: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    lastElection: Date.now(),
    lastHealthCheck: Date.now(),
  };

  await stateManager.setWorkerGroupState(state);

  // Register workers in the group
  for (const workerId of workerIds) {
    await stateManager.addWorkerToGroup(workerId, groupId);
  }
}

/**
 * Get current fence token for a group
 */
export async function getFenceToken(
  stateManager: StateManager,
  groupId: string
): Promise<string | null> {
  const groupState = await stateManager.getWorkerGroupState(groupId);
  return groupState?.fenceToken ?? null;
}

/**
 * Verify fence token has changed (indicating a failover)
 */
export async function verifyFenceTokenChanged(
  stateManager: StateManager,
  groupId: string,
  originalToken: string
): Promise<boolean> {
  const currentToken = await getFenceToken(stateManager, groupId);
  return currentToken !== null && currentToken !== originalToken;
}

/**
 * Attempt to acquire failover lock
 */
export async function tryAcquireFailoverLock(
  stateManager: StateManager,
  groupId: string,
  workerId: string,
  ttlSeconds = 30
): Promise<boolean> {
  return stateManager.acquireFailoverLock(groupId, workerId, ttlSeconds);
}

/**
 * Release failover lock
 */
export async function releaseFailoverLock(
  stateManager: StateManager,
  groupId: string
): Promise<void> {
  await stateManager.releaseFailoverLock(groupId);
}

/**
 * Force a failover to a new primary
 * This simulates a failover by updating the group state directly
 */
export async function forceFailover(
  stateManager: StateManager,
  groupId: string,
  newPrimaryId: string
): Promise<void> {
  await stateManager.updatePrimaryWorker(groupId, newPrimaryId);
}

/**
 * Record a test job execution
 */
export async function recordTestJobExecution(
  stateManager: StateManager,
  jobName: string,
  workerId: string,
  status: "pending" | "running" | "completed" | "failed" = "completed",
  options?: {
    snapshotId?: string;
    error?: string;
    duration?: number;
  }
): Promise<string> {
  const executionId = generateTestId("exec");
  const now = Date.now();

  await stateManager.recordJobExecution({
    id: executionId,
    jobName,
    workerId,
    status,
    startTime: now - (options?.duration || 1000),
    endTime: status === "completed" || status === "failed" ? now : undefined,
    snapshotId: options?.snapshotId,
    error: options?.error,
    duration: options?.duration,
  });

  return executionId;
}

/**
 * Update job execution status
 */
export async function updateTestJobExecution(
  stateManager: StateManager,
  executionId: string,
  status: "pending" | "running" | "completed" | "failed",
  options?: {
    snapshotId?: string;
    error?: string;
  }
): Promise<void> {
  await stateManager.updateJobExecution(executionId, {
    status,
    endTime: status === "completed" || status === "failed" ? Date.now() : undefined,
    ...options,
  });
}

export interface WorkerTestContext {
  redis: Redis;
  stateManager: StateManager;
  workers: SimulatedWorker[];
  groupId: string;
}

/**
 * Create a full worker test context
 */
export async function createWorkerTestContext(
  workerCount = 3,
  groupId?: string
): Promise<WorkerTestContext> {
  const redis = createTestRedis();
  const stateManager = createTestStateManager(redis);
  const testGroupId = groupId || generateTestId("group");

  // Create workers
  const workers = createSimulatedWorkerCluster(workerCount, testGroupId, redis);

  // Create worker group
  const workerIds = workers.map((w) => w.id);
  await createTestWorkerGroup(stateManager, testGroupId, workerIds, workerIds[0], Math.ceil(workerCount / 2));

  return {
    redis,
    stateManager,
    workers,
    groupId: testGroupId,
  };
}

/**
 * Cleanup worker test context
 */
export async function cleanupWorkerTestContext(context: WorkerTestContext): Promise<void> {
  // Stop all workers
  await cleanupSimulatedWorkers(context.workers);

  // Clear Redis data
  await context.redis.flushdb();
  await context.redis.quit();
}

/**
 * Start all workers in context
 */
export async function startAllWorkers(context: WorkerTestContext): Promise<void> {
  for (const worker of context.workers) {
    await worker.start();
  }
  // Wait for heartbeats to propagate
  await sleep(500);
}

/**
 * Stop all workers in context
 */
export async function stopAllWorkers(context: WorkerTestContext): Promise<void> {
  for (const worker of context.workers) {
    await worker.stop();
  }
}
