import type Redis from "ioredis";
import { getRedisConnection } from "./client";

export interface WorkerState {
  id: string;
  name: string;
  hostname: string;
  groups: string[];
  status: "starting" | "healthy" | "degraded" | "stopping" | "offline";
  lastHeartbeat: number;
  currentJobs: string[];
  metrics: {
    jobsProcessed: number;
    jobsFailed: number;
    lastJobTime: number;
  };
}

export interface WorkerGroupState {
  groupId: string;
  workers: string[];
  primaryWorkerId: string | null;
  failoverOrder: string[];
  quorumSize: number;
  fenceToken: string | null;
  lastElection: number;
  lastHealthCheck: number;
}

export interface JobExecution {
  id: string;
  jobName: string;
  workerId: string;
  status: "pending" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  snapshotId?: string;
  error?: string;
  duration?: number;
  priority?: number;
}

export const REDIS_KEYS = {
  WORKER: (id: string) => `workers:${id}`,
  WORKER_HEARTBEATS: "workers:heartbeats",
  WORKERS_BY_GROUP: (groupId: string) => `workers:by-group:${groupId}`,

  JOB_HISTORY: (id: string) => `jobs:history:${id}`,
  JOB_HISTORY_BY_NAME: (name: string) => `jobs:history:by-name:${name}`,
  JOB_HISTORY_ALL: "jobs:history:all",

  WORKER_GROUP: (groupId: string) => `worker_groups:${groupId}`,
  WORKER_GROUPS_SET: "worker_groups:__index__",
  WORKER_GROUP_VOTES: (groupId: string) => `worker_groups:${groupId}:votes`,
  WORKER_GROUP_LOCK: (groupId: string) => `worker_groups:${groupId}:lock`,
} as const;

export class StateManager {
  private redis: Redis;

  constructor(redis?: Redis) {
    this.redis = redis ?? getRedisConnection();
  }

  async setWorkerState(state: WorkerState): Promise<void> {
    const key = REDIS_KEYS.WORKER(state.id);
    const serialized = this.serializeWorkerState(state);

    await this.redis.hset(key, serialized);
    await this.redis.zadd(
      REDIS_KEYS.WORKER_HEARTBEATS,
      state.lastHeartbeat,
      state.id
    );

    // Update group memberships
    for (const groupId of state.groups) {
      await this.redis.sadd(REDIS_KEYS.WORKERS_BY_GROUP(groupId), state.id);
    }
  }

  async getWorkerState(workerId: string): Promise<WorkerState | null> {
    const key = REDIS_KEYS.WORKER(workerId);
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return this.deserializeWorkerState(data);
  }

  async getAllWorkers(): Promise<WorkerState[]> {
    const workerIds = await this.redis.zrange(REDIS_KEYS.WORKER_HEARTBEATS, 0, -1);

    const workers: WorkerState[] = [];
    for (const workerId of workerIds) {
      const state = await this.getWorkerState(workerId);
      if (state) {
        workers.push(state);
      }
    }

    return workers;
  }

  async getHealthyWorkers(thresholdMs = 30000): Promise<string[]> {
    const now = Date.now();
    const minTimestamp = now - thresholdMs;

    return this.redis.zrangebyscore(
      REDIS_KEYS.WORKER_HEARTBEATS,
      minTimestamp,
      now
    );
  }

  async getWorkersInGroup(groupId: string): Promise<string[]> {
    return this.redis.smembers(REDIS_KEYS.WORKERS_BY_GROUP(groupId));
  }

  async addWorkerToGroup(workerId: string, groupId: string): Promise<void> {
    await this.redis.sadd(REDIS_KEYS.WORKERS_BY_GROUP(groupId), workerId);
  }

  async removeWorker(workerId: string): Promise<void> {
    const state = await this.getWorkerState(workerId);

    // Remove from groups
    if (state) {
      for (const groupId of state.groups) {
        await this.redis.srem(REDIS_KEYS.WORKERS_BY_GROUP(groupId), workerId);
      }
    }

    // Remove heartbeat
    await this.redis.zrem(REDIS_KEYS.WORKER_HEARTBEATS, workerId);

    // Remove state
    await this.redis.del(REDIS_KEYS.WORKER(workerId));
  }

  async recordJobExecution(execution: JobExecution): Promise<void> {
    const key = REDIS_KEYS.JOB_HISTORY(execution.id);
    const serialized = this.serializeJobExecution(execution);

    await this.redis.hset(key, serialized);

    // zadd NX adds the member only if it doesn't already exist.
    // Returns 1 if added (first insertion), 0 if it was already indexed.
    // This prevents duplicate index entries when recordJobExecution is called
    // multiple times for the same execution (e.g. running → completed).
    const added = await this.redis.zadd(
      REDIS_KEYS.JOB_HISTORY_ALL,
      "NX",
      execution.startTime,
      execution.id
    );

    if (added === 1) {
      await this.redis.lpush(
        REDIS_KEYS.JOB_HISTORY_BY_NAME(execution.jobName),
        execution.id
      );
      await this.redis.ltrim(REDIS_KEYS.JOB_HISTORY_BY_NAME(execution.jobName), 0, 99);
    }
  }

  async updateJobExecution(
    executionId: string,
    updates: Partial<JobExecution>
  ): Promise<void> {
    const key = REDIS_KEYS.JOB_HISTORY(executionId);
    const serialized: Record<string, string> = {};

    for (const [field, value] of Object.entries(updates)) {
      if (value !== undefined) {
        serialized[field] = typeof value === "object" ? JSON.stringify(value) : String(value);
      }
    }

    if (Object.keys(serialized).length > 0) {
      await this.redis.hset(key, serialized);
    }
  }

  async getJobExecution(executionId: string): Promise<JobExecution | null> {
    const key = REDIS_KEYS.JOB_HISTORY(executionId);
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return this.deserializeJobExecution(data);
  }

  async getRecentJobs(jobName?: string, limit = 50): Promise<JobExecution[]> {
    let ids: string[];

    if (jobName) {
      ids = await this.redis.lrange(
        REDIS_KEYS.JOB_HISTORY_BY_NAME(jobName),
        0,
        limit - 1
      );
    } else {
      ids = await this.redis.zrevrange(REDIS_KEYS.JOB_HISTORY_ALL, 0, limit - 1);
    }

    const executions: JobExecution[] = [];
    for (const id of ids) {
      const execution = await this.getJobExecution(id);
      if (execution) {
        executions.push(execution);
      }
    }

    return executions;
  }

  async getRunningJobsForWorker(workerId: string): Promise<JobExecution[]> {
    const allRunning = await this.getRecentJobs(undefined, 100);
    return allRunning.filter(
      (j) => j.status === "running" && j.workerId === workerId
    );
  }

  async setWorkerGroupState(state: WorkerGroupState): Promise<void> {
    const key = REDIS_KEYS.WORKER_GROUP(state.groupId);
    const serialized = this.serializeWorkerGroupState(state);
    await this.redis.hset(key, serialized);
    await this.redis.sadd(REDIS_KEYS.WORKER_GROUPS_SET, state.groupId);
  }

  async getWorkerGroupState(groupId: string): Promise<WorkerGroupState | null> {
    const key = REDIS_KEYS.WORKER_GROUP(groupId);
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return this.deserializeWorkerGroupState(data);
  }

  async getAllWorkerGroups(): Promise<WorkerGroupState[]> {
    const groupIds = await this.redis.smembers(REDIS_KEYS.WORKER_GROUPS_SET);
    const groups: WorkerGroupState[] = [];

    for (const groupId of groupIds) {
      const state = await this.getWorkerGroupState(groupId);
      if (state) {
        groups.push(state);
      }
    }

    return groups;
  }

  async castDownVote(
    groupId: string,
    voterId: string,
    targetWorkerId: string
  ): Promise<number> {
    await this.redis.hset(
      REDIS_KEYS.WORKER_GROUP_VOTES(groupId),
      voterId,
      targetWorkerId
    );

    // Count votes for this target
    const allVotes = await this.redis.hgetall(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
    return Object.values(allVotes).filter((v) => v === targetWorkerId).length;
  }

  async clearVotes(groupId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.WORKER_GROUP_VOTES(groupId));
  }

  async acquireFailoverLock(
    groupId: string,
    workerId: string,
    ttlSeconds = 30
  ): Promise<boolean> {
    const result = await this.redis.set(
      REDIS_KEYS.WORKER_GROUP_LOCK(groupId),
      workerId,
      "EX",
      ttlSeconds,
      "NX"
    );
    return result === "OK";
  }

  async releaseFailoverLock(groupId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.WORKER_GROUP_LOCK(groupId));
  }

  async updatePrimaryWorker(
    groupId: string,
    newPrimaryId: string
  ): Promise<void> {
    await this.redis.hset(REDIS_KEYS.WORKER_GROUP(groupId), {
      primaryWorkerId: newPrimaryId,
      lastElection: Date.now().toString(),
      fenceToken: this.generateFenceToken(),
    });
  }

  private serializeWorkerState(state: WorkerState): Record<string, string> {
    return {
      id: state.id,
      name: state.name,
      hostname: state.hostname,
      groups: JSON.stringify(state.groups),
      status: state.status,
      lastHeartbeat: state.lastHeartbeat.toString(),
      currentJobs: JSON.stringify(state.currentJobs),
      metrics: JSON.stringify(state.metrics),
    };
  }

  private deserializeWorkerState(data: Record<string, string>): WorkerState {
    return {
      id: data.id,
      name: data.name,
      hostname: data.hostname,
      groups: JSON.parse(data.groups || "[]"),
      status: data.status as WorkerState["status"],
      lastHeartbeat: parseInt(data.lastHeartbeat, 10),
      currentJobs: JSON.parse(data.currentJobs || "[]"),
      metrics: JSON.parse(data.metrics || "{}"),
    };
  }

  private serializeJobExecution(execution: JobExecution): Record<string, string> {
    const result: Record<string, string> = {
      id: execution.id,
      jobName: execution.jobName,
      workerId: execution.workerId,
      status: execution.status,
      startTime: execution.startTime.toString(),
    };

    if (execution.endTime !== undefined) {
      result.endTime = execution.endTime.toString();
    }
    if (execution.snapshotId !== undefined) {
      result.snapshotId = execution.snapshotId;
    }
    if (execution.error !== undefined) {
      result.error = execution.error;
    }
    if (execution.duration !== undefined) {
      result.duration = execution.duration.toString();
    }
    if (execution.priority !== undefined) {
      result.priority = execution.priority.toString();
    }

    return result;
  }

  private deserializeJobExecution(data: Record<string, string>): JobExecution {
    return {
      id: data.id,
      jobName: data.jobName,
      workerId: data.workerId,
      status: data.status as JobExecution["status"],
      startTime: parseInt(data.startTime, 10),
      endTime: data.endTime ? parseInt(data.endTime, 10) : undefined,
      snapshotId: data.snapshotId || undefined,
      error: data.error || undefined,
      duration: data.duration ? parseInt(data.duration, 10) : undefined,
      priority: data.priority ? parseInt(data.priority, 10) : undefined,
    };
  }

  private serializeWorkerGroupState(
    state: WorkerGroupState
  ): Record<string, string> {
    return {
      groupId: state.groupId,
      workers: JSON.stringify(state.workers),
      primaryWorkerId: state.primaryWorkerId || "",
      failoverOrder: JSON.stringify(state.failoverOrder),
      quorumSize: state.quorumSize.toString(),
      fenceToken: state.fenceToken || "",
      lastElection: state.lastElection.toString(),
      lastHealthCheck: state.lastHealthCheck.toString(),
    };
  }

  private deserializeWorkerGroupState(
    data: Record<string, string>
  ): WorkerGroupState {
    return {
      groupId: data.groupId,
      workers: JSON.parse(data.workers || "[]"),
      primaryWorkerId: data.primaryWorkerId || null,
      failoverOrder: JSON.parse(data.failoverOrder || "[]"),
      quorumSize: parseInt(data.quorumSize, 10) || 2,
      fenceToken: data.fenceToken || null,
      lastElection: parseInt(data.lastElection, 10) || 0,
      lastHealthCheck: parseInt(data.lastHealthCheck, 10) || 0,
    };
  }

  private generateFenceToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

let defaultStateManager: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!defaultStateManager) {
    defaultStateManager = new StateManager();
  }
  return defaultStateManager;
}
