import type { JobsOptions } from "bullmq";

export const QUEUES = {
  BACKUP_JOBS: "backup-jobs",
  BACKUP_SCHEDULED: "backup-scheduled",
  PRUNE_JOBS: "prune-jobs",
  RESTORE_JOBS: "restore-jobs",
  HEALTH_CHECKS: "health-checks",
  FAILOVER: "failover-jobs",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 5,
  NORMAL: 10,
  LOW: 20,
} as const;

export type JobPriority = (typeof JOB_PRIORITY)[keyof typeof JOB_PRIORITY];

export const QUEUE_CONFIG: Record<string, { defaultJobOptions: JobsOptions }> = {
  [QUEUES.BACKUP_JOBS]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30000, // 30 seconds initial delay
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60, // Keep completed jobs for 7 days
        count: 1000, // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60, // Keep failed jobs for 30 days
        count: 5000, // Keep last 5000 failed jobs
      },
    },
  },
  [QUEUES.BACKUP_SCHEDULED]: {
    defaultJobOptions: {
      attempts: 1, // Scheduled triggers don't retry
      removeOnComplete: {
        age: 24 * 60 * 60, // Keep for 1 day
        count: 100,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 500,
      },
    },
  },
  [QUEUES.PRUNE_JOBS]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 60000, // 1 minute delay between retries
      },
      removeOnComplete: {
        age: 7 * 24 * 60 * 60,
        count: 500,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 1000,
      },
    },
  },
  [QUEUES.RESTORE_JOBS]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30000,
      },
      removeOnComplete: {
        age: 14 * 24 * 60 * 60, // Keep for 14 days
        count: 500,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 1000,
      },
    },
  },
  [QUEUES.HEALTH_CHECKS]: {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: {
        age: 60 * 60, // Keep failed health checks for 1 hour
        count: 100,
      },
    },
  },
  [QUEUES.FAILOVER]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 5000, // 5 second delay
      },
      removeOnComplete: {
        age: 30 * 24 * 60 * 60,
        count: 100,
      },
      removeOnFail: {
        age: 30 * 24 * 60 * 60,
        count: 100,
      },
    },
  },
};

export function getQueueConfig(queueName: QueueName): JobsOptions {
  return QUEUE_CONFIG[queueName]?.defaultJobOptions ?? {};
}
