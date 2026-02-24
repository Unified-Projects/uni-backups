import type Redis from "ioredis";
import { Worker, Job } from "bullmq";
import { getBullMQConnection, getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import { QUEUES, type BackupJobData, type PruneJobData, type BackupResult, type JobExecution } from "@uni-backups/queue";
import { getConfig } from "@uni-backups/shared/config";
import type { WorkerConfig } from "../config";
import type { HeartbeatService } from "./heartbeat";
import * as restic from "./restic";
import { runDatabaseBackup } from "./database";

export interface JobProcessorOptions {
  stateManager?: StateManager;
  bullmqConnection?: Redis;
}

export class JobProcessor {
  private workerConfig: WorkerConfig;
  private heartbeatService: HeartbeatService;
  private stateManager: StateManager;
  private bullmqConnection: Redis;
  private backupWorker: Worker<BackupJobData, BackupResult> | null = null;
  private pruneWorker: Worker<PruneJobData, BackupResult> | null = null;
  private running = false;

  constructor(workerConfig: WorkerConfig, heartbeatService: HeartbeatService, options?: JobProcessorOptions) {
    this.workerConfig = workerConfig;
    this.heartbeatService = heartbeatService;
    this.bullmqConnection = options?.bullmqConnection ?? getBullMQConnection();
    this.stateManager = options?.stateManager ?? new StateManager(getRedisConnection());
  }

  async initialize(): Promise<void> {
    if (this.running) {
      return;
    }

    this.backupWorker = new Worker<BackupJobData, BackupResult>(
      QUEUES.BACKUP_JOBS,
      async (job) => this.processBackupJob(job),
      {
        connection: this.bullmqConnection,
        concurrency: this.workerConfig.concurrency,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      }
    );

    this.pruneWorker = new Worker<PruneJobData, BackupResult>(
      QUEUES.PRUNE_JOBS,
      async (job) => this.processPruneJob(job),
      {
        connection: this.bullmqConnection,
        concurrency: 1, // Prune jobs should run sequentially
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      }
    );

    this.setupEventHandlers(this.backupWorker, "backup");
    this.setupEventHandlers(this.pruneWorker, "prune");

    this.running = true;
    console.log(`[Processor] Initialized with concurrency ${this.workerConfig.concurrency}`);
  }

  private setupEventHandlers(worker: Worker, type: string): void {
    worker.on("completed", (job) => {
      console.log(`[Processor] ${type} job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Processor] ${type} job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error(`[Processor] ${type} worker error:`, err);
    });
  }

  private async processBackupJob(job: Job<BackupJobData, BackupResult>): Promise<BackupResult> {
    const { executionId, jobName, jobConfig, storage } = job.data;
    const startTime = Date.now();

    console.log(`[Processor] Starting backup job: ${jobName} (execution: ${executionId})`);

    // Check if this worker should handle this job (worker group filtering)
    if (jobConfig.worker_group && !this.workerConfig.groups.includes(jobConfig.worker_group)) {
      console.log(`[Processor] Skipping job ${jobName} - not in worker group ${jobConfig.worker_group}`);
      throw new Error(`Worker not in group ${jobConfig.worker_group}`);
    }

    this.heartbeatService.jobStarted(executionId);

    const execution: JobExecution = {
      id: executionId,
      jobName,
      workerId: this.workerConfig.id,
      status: "running",
      startTime,
    };
    await this.stateManager.recordJobExecution(execution);

    try {
      const config = getConfig();
      const resticPassword = config.resticPassword;

      if (!resticPassword) {
        throw new Error("Restic password not configured");
      }

      const repoName = jobConfig.repo || jobName;

      const initResult = await restic.initRepo(storage, repoName, resticPassword);
      if (!initResult.success) {
        throw new Error(`Failed to initialize repo: ${initResult.message}`);
      }

      let backupResult: { success: boolean; message: string; snapshotId?: string };

      switch (jobConfig.type) {
        case "volume":
        case "folder":
          backupResult = await restic.backup(storage, repoName, resticPassword, jobConfig.source, {
            tags: [...(jobConfig.tags || []), jobName],
            exclude: jobConfig.exclude,
            onProgress: (line) => {
              job.updateProgress({ message: line });
            },
          });
          break;

        case "postgres":
        case "mariadb":
        case "redis":
          backupResult = await runDatabaseBackup(
            jobConfig,
            jobName,
            storage,
            repoName,
            resticPassword,
            (line) => job.updateProgress({ message: line })
          );
          break;

        default:
          throw new Error(`Unknown job type: ${(jobConfig as any).type}`);
      }

      if (!backupResult.success) {
        throw new Error(backupResult.message);
      }

      // Run prune if retention is configured (inline for small retention policies)
      if (jobConfig.retention) {
        await restic.prune(storage, repoName, resticPassword, jobConfig.retention, {
          tags: [jobName],
        });
      }

      const endTime = Date.now();

      execution.status = "completed";
      execution.endTime = endTime;
      execution.duration = endTime - startTime;
      execution.snapshotId = backupResult.snapshotId;
      await this.stateManager.recordJobExecution(execution);

      this.heartbeatService.jobCompleted(executionId, true);

      console.log(`[Processor] Backup job completed: ${jobName} in ${endTime - startTime}ms`);

      return {
        success: true,
        message: backupResult.message,
        snapshotId: backupResult.snapshotId,
        duration: endTime - startTime,
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      execution.status = "failed";
      execution.endTime = endTime;
      execution.duration = endTime - startTime;
      execution.error = errorMessage;
      await this.stateManager.recordJobExecution(execution);

      this.heartbeatService.jobCompleted(executionId, false);

      console.error(`[Processor] Backup job failed: ${jobName}`, error);

      return {
        success: false,
        message: errorMessage,
        duration: endTime - startTime,
      };
    }
  }

  private async processPruneJob(job: Job<PruneJobData, BackupResult>): Promise<BackupResult> {
    const { executionId, jobName, storage, repoName, retention, tags } = job.data;
    const startTime = Date.now();

    console.log(`[Processor] Starting prune job: ${jobName} (execution: ${executionId})`);

    this.heartbeatService.jobStarted(executionId);

    try {
      const config = getConfig();
      const resticPassword = config.resticPassword;

      if (!resticPassword) {
        throw new Error("Restic password not configured");
      }

      const result = await restic.prune(storage, repoName, resticPassword, retention, {
        tags,
        onProgress: (line) => {
          job.updateProgress({ message: line });
        },
      });

      const endTime = Date.now();

      this.heartbeatService.jobCompleted(executionId, result.success);

      if (!result.success) {
        throw new Error(result.message);
      }

      console.log(`[Processor] Prune job completed: ${jobName} in ${endTime - startTime}ms`);

      return {
        success: true,
        message: result.message,
        duration: endTime - startTime,
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.heartbeatService.jobCompleted(executionId, false);

      console.error(`[Processor] Prune job failed: ${jobName}`, error);

      return {
        success: false,
        message: errorMessage,
        duration: endTime - startTime,
      };
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log(`[Processor] Stopping workers...`);

    const closePromises: Promise<void>[] = [];

    if (this.backupWorker) {
      closePromises.push(this.backupWorker.close());
    }

    if (this.pruneWorker) {
      closePromises.push(this.pruneWorker.close());
    }

    await Promise.all(closePromises);

    this.running = false;
    console.log(`[Processor] Workers stopped`);
  }

  isRunning(): boolean {
    return this.running;
  }

  async pause(): Promise<void> {
    if (this.backupWorker) {
      await this.backupWorker.pause();
    }
    if (this.pruneWorker) {
      await this.pruneWorker.pause();
    }
    console.log(`[Processor] Paused`);
  }

  async resume(): Promise<void> {
    if (this.backupWorker) {
      await this.backupWorker.resume();
    }
    if (this.pruneWorker) {
      await this.pruneWorker.resume();
    }
    console.log(`[Processor] Resumed`);
  }
}
