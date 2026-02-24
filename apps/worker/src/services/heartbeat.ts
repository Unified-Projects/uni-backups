import { getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import type { WorkerState } from "@uni-backups/queue";
import type { WorkerConfig } from "../config";

export class HeartbeatService {
  private workerId: string;
  private workerConfig: WorkerConfig;
  private stateManager: StateManager;
  private heartbeatTimer: Timer | null = null;
  private running = false;
  private currentJobs: Set<string> = new Set();
  private metrics = {
    jobsProcessed: 0,
    jobsFailed: 0,
    lastJobTime: 0,
  };

  constructor(workerConfig: WorkerConfig, stateManager?: StateManager) {
    this.workerId = workerConfig.id;
    this.workerConfig = workerConfig;
    this.stateManager = stateManager ?? new StateManager(getRedisConnection());
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    await this.sendHeartbeat("starting");

    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat("healthy"),
      this.workerConfig.heartbeatInterval
    );

    console.log(`[Heartbeat] Started for worker ${this.workerId}`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.sendHeartbeat("stopping");

    console.log(`[Heartbeat] Stopped for worker ${this.workerId}`);
  }

  private async sendHeartbeat(status: WorkerState["status"]): Promise<void> {
    try {
      const state: WorkerState = {
        id: this.workerId,
        name: this.workerConfig.name,
        hostname: this.workerConfig.hostname,
        groups: this.workerConfig.groups,
        status,
        lastHeartbeat: Date.now(),
        currentJobs: Array.from(this.currentJobs),
        metrics: { ...this.metrics },
      };

      await this.stateManager.setWorkerState(state);
    } catch (error) {
      console.error(`[Heartbeat] Failed to send heartbeat:`, error);
    }
  }

  jobStarted(jobId: string): void {
    this.currentJobs.add(jobId);
  }

  jobCompleted(jobId: string, success: boolean): void {
    this.currentJobs.delete(jobId);

    if (success) {
      this.metrics.jobsProcessed++;
    } else {
      this.metrics.jobsFailed++;
    }

    this.metrics.lastJobTime = Date.now();
  }

  getState(): {
    running: boolean;
    currentJobs: string[];
    metrics: typeof this.metrics;
  } {
    return {
      running: this.running,
      currentJobs: Array.from(this.currentJobs),
      metrics: { ...this.metrics },
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}
