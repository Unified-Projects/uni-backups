import type Redis from "ioredis";
import { Queue, QueueEvents, Worker } from "bullmq";
import { getBullMQConnection, getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import {
  JOB_PRIORITY,
  QUEUES,
  type BackupJobData,
  type JobExecution,
  type ScheduledJobData,
  getQueueConfig,
} from "@uni-backups/queue";
import { getConfig } from "@uni-backups/shared/config";
import { randomUUID } from "crypto";

export interface SchedulerOptions {
  bullmqConnection?: Redis;
  redisConnection?: Redis;
}

let backupQueue: Queue<BackupJobData> | null = null;
let queueEvents: QueueEvents | null = null;
let scheduleTriggerQueue: Queue<ScheduledJobData> | null = null;
let scheduleTriggerWorker: Worker<ScheduledJobData, void> | null = null;
let stateManager: StateManager | null = null;

const SCHEDULE_TRIGGER_QUEUE = QUEUES.BACKUP_SCHEDULED;

export async function initScheduler(options?: SchedulerOptions): Promise<void> {
  console.log("[Scheduler] Initializing BullMQ scheduler...");

  const connection = options?.bullmqConnection ?? getBullMQConnection();
  const redisConnection = options?.redisConnection ?? getRedisConnection();

  backupQueue = new Queue<BackupJobData>(QUEUES.BACKUP_JOBS, {
    connection,
    defaultJobOptions: getQueueConfig(QUEUES.BACKUP_JOBS),
  });
  await backupQueue.waitUntilReady();
  await backupQueue.resume();

  scheduleTriggerQueue = new Queue<ScheduledJobData>(SCHEDULE_TRIGGER_QUEUE, {
    connection,
    defaultJobOptions: getQueueConfig(QUEUES.BACKUP_SCHEDULED),
  });
  await scheduleTriggerQueue.waitUntilReady();

  scheduleTriggerWorker = new Worker<ScheduledJobData, void>(
    SCHEDULE_TRIGGER_QUEUE,
    async (job) => {
      const result = await queueJob(job.data.jobName, "schedule");
      if (!result.queued) {
        throw new Error(result.message);
      }
    },
    {
      connection,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
  await scheduleTriggerWorker.waitUntilReady();

  queueEvents = new QueueEvents(QUEUES.BACKUP_JOBS, { connection });
  await queueEvents.waitUntilReady();

  queueEvents.on("completed", ({ jobId, returnvalue }) => {
    console.log(`[Scheduler] Job ${jobId} completed`);
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[Scheduler] Job ${jobId} failed: ${failedReason}`);
  });

  stateManager = new StateManager(redisConnection);

  await syncSchedules();

  console.log("[Scheduler] BullMQ scheduler initialized");
}

export async function syncSchedules(): Promise<void> {
  if (!scheduleTriggerQueue) {
    throw new Error("Scheduler not initialized");
  }

  const config = getConfig();

  const existingRepeatables = await scheduleTriggerQueue.getRepeatableJobs();

  console.log(`[Scheduler] Syncing schedules, found ${existingRepeatables.length} existing repeatables`);
  for (const r of existingRepeatables) {
    console.log(`[Scheduler] Existing repeatable: name=${r.name}, key=${r.key}, next=${r.next}`);
  }

  for (const [jobName, jobConfig] of config.jobs) {
    if (jobConfig.schedule) {
      const repeatKey = `schedule-${jobName}`;

      // Remove existing schedule if any (to update it)
      const existingKey = existingRepeatables.find((r) => r.name === `schedule-${jobName}`)?.key;
      if (existingKey) {
        console.log(`[Scheduler] Removing existing schedule for "${jobName}" with key: ${existingKey}`);
        await scheduleTriggerQueue.removeRepeatableByKey(existingKey);
      }

      await scheduleTriggerQueue.add(
        `schedule-${jobName}`,
        {
          jobName,
        },
        {
          repeat: {
            pattern: jobConfig.schedule,
            key: repeatKey,
          },
          priority: jobConfig.priority,
        }
      );

      console.log(`[Scheduler] Scheduled job "${jobName}" with cron: ${jobConfig.schedule}, key: ${repeatKey}`);
    }
  }

  for (const repeatable of existingRepeatables) {
    if (repeatable.name?.startsWith("schedule-")) {
      const jobName = repeatable.name.slice("schedule-".length);
      const jobConfig = config.jobs.get(jobName);

      if (!jobConfig || !jobConfig.schedule) {
        await scheduleTriggerQueue.removeRepeatableByKey(repeatable.key);
        console.log(`[Scheduler] Removed schedule for job "${jobName}"`);
      }
    }
  }
}

export async function queueJob(
  jobName: string,
  triggeredBy: "manual" | "failover" | "schedule" = "manual"
): Promise<{ executionId: string; queued: boolean; message: string }> {
  if (!backupQueue) {
    return { executionId: "", queued: false, message: "Scheduler not initialized" };
  }

  const config = getConfig();
  const jobConfig = config.jobs.get(jobName);

  if (!jobConfig) {
    return { executionId: "", queued: false, message: `Job "${jobName}" not found` };
  }

  const storage = config.storage.get(jobConfig.storage);
  if (!storage) {
    return {
      executionId: "",
      queued: false,
      message: `Storage "${jobConfig.storage}" not found for job "${jobName}"`,
    };
  }

  const executionId = randomUUID();

  const jobData: BackupJobData = {
    executionId,
    jobName,
    jobConfig,
    storage,
    repoName: jobConfig.repo || jobName,
    workerGroups: [jobConfig.worker_group],
    priority: jobConfig.priority ?? JOB_PRIORITY.NORMAL,
    triggeredBy,
    queuedAt: Date.now(),
  };

  try {
    await backupQueue.add(`backup-${jobName}`, jobData, {
      jobId: executionId,
      priority: jobData.priority,
    });
  } catch (err) {
    console.error(`[Scheduler] Failed to queue job "${jobName}":`, err);
    return {
      executionId: "",
      queued: false,
      message: `Failed to queue job "${jobName}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    executionId,
    queued: true,
    message: `Job "${jobName}" queued for execution`,
  };
}

export async function stopScheduler(): Promise<void> {
  console.log("[Scheduler] Stopping...");

  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }

  if (scheduleTriggerWorker) {
    await scheduleTriggerWorker.close();
    scheduleTriggerWorker = null;
  }

  if (scheduleTriggerQueue) {
    await scheduleTriggerQueue.close();
    scheduleTriggerQueue = null;
  }

  if (backupQueue) {
    await backupQueue.close();
    backupQueue = null;
  }

  console.log("[Scheduler] Stopped");
}

// Derives from config rather than getRepeatableJobs() to avoid the brief window where
// BullMQ removes and re-adds a repeatable, which would make the endpoint report 0 jobs.
export async function getScheduledJobs(): Promise<
  Array<{
    name: string;
    schedule: string;
    nextRun?: Date;
  }>
> {
  const config = getConfig();

  let repeatables: Array<{ name?: string; next?: number }> = [];
  if (scheduleTriggerQueue) {
    try {
      repeatables = await scheduleTriggerQueue.getRepeatableJobs();
    } catch {
      // proceed without nextRun times
    }
  }

  const results: Array<{ name: string; schedule: string; nextRun?: Date }> = [];

  for (const [jobName, jobConfig] of config.jobs) {
    if (jobConfig.schedule) {
      const repeatable = repeatables.find((r) => r.name === `schedule-${jobName}`);
      results.push({
        name: jobName,
        schedule: jobConfig.schedule,
        nextRun: repeatable?.next ? new Date(repeatable.next) : undefined,
      });
    }
  }

  return results;
}

export async function getRecentRuns(jobName?: string, limit = 50): Promise<JobExecution[]> {
  try {
    if (!stateManager) {
      stateManager = new StateManager(getRedisConnection());
    }

    return await stateManager.getRecentJobs(jobName, limit);
  } catch (error) {
    console.error("[Scheduler] Failed to load recent runs:", error);
    return [];
  }
}

export async function getRunningJobs(): Promise<
  Array<{
    jobName: string;
    executionId: string;
    queuedAt: number;
  }>
> {
  try {
    if (!backupQueue) {
      return [];
    }

    const active = await backupQueue.getActive();

    return active.map((job) => ({
      jobName: job.data.jobName,
      executionId: job.data.executionId,
      queuedAt: job.data.queuedAt,
    }));
  } catch (error) {
    console.error("[Scheduler] Failed to load running jobs:", error);
    return [];
  }
}

export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}> {
  try {
    if (!backupQueue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
    }

    const counts = await backupQueue.getJobCounts();
    return {
      waiting: (counts.waiting || 0) + (counts.prioritized || 0),
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: counts.paused || 0,
    };
  } catch (error) {
    console.error("[Scheduler] Failed to load queue stats:", error);
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
  }
}

export async function isJobActive(jobName: string): Promise<boolean> {
  try {
    if (!backupQueue) {
      return false;
    }

    const [waiting, active, prioritized] = await Promise.all([
      backupQueue.getWaiting(),
      backupQueue.getActive(),
      backupQueue.getJobs(["prioritized"]),
    ]);

    return (
      waiting.some((j) => j.data.jobName === jobName) ||
      active.some((j) => j.data.jobName === jobName) ||
      prioritized.some((j) => j.data.jobName === jobName)
    );
  } catch (error) {
    console.error(`[Scheduler] Failed to determine whether job "${jobName}" is active:`, error);
    return false;
  }
}

export function getBackupQueue(): Queue<BackupJobData> | null {
  return backupQueue;
}
