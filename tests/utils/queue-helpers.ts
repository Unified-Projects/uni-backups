/**
 * Queue Test Helpers
 *
 * Utilities for testing BullMQ queue operations
 * in integration tests. Uses real Redis - no mocking.
 */

import { Queue, Worker, Job, QueueEvents, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import { QUEUES, QUEUE_CONFIG, JOB_PRIORITY } from "@uni-backups/queue";
import type { BackupJobData, PruneJobData } from "@uni-backups/queue";
import { createBullMQConnection, generateTestId, sleep } from "./test-services";

export interface TestQueues {
  backup: Queue;
  prune: Queue;
  scheduled: Queue;
  healthCheck: Queue;
  failover: Queue;
  connection: Redis;
}

/**
 * Create all test queues with a shared connection
 */
export function createAllTestQueues(connection?: Redis): TestQueues {
  const conn = connection || createBullMQConnection();

  return {
    backup: new Queue(QUEUES.BACKUP_JOBS, { connection: conn }),
    prune: new Queue(QUEUES.PRUNE_JOBS, { connection: conn }),
    scheduled: new Queue(QUEUES.BACKUP_SCHEDULED, { connection: conn }),
    healthCheck: new Queue(QUEUES.HEALTH_CHECKS, { connection: conn }),
    failover: new Queue(QUEUES.FAILOVER, { connection: conn }),
    connection: conn,
  };
}

/**
 * Create a single test queue
 */
export function createTestQueue(queueName: string, connection?: Redis): Queue {
  const conn = connection || createBullMQConnection();
  return new Queue(queueName, {
    connection: conn,
    ...QUEUE_CONFIG[queueName],
  });
}

/**
 * Cleanup all test queues
 */
export async function cleanupTestQueues(queues: TestQueues): Promise<void> {
  // Pause all queues before obliterate (required in BullMQ 5.66+)
  await queues.backup.pause();
  await queues.prune.pause();
  await queues.scheduled.pause();
  await queues.healthCheck.pause();
  await queues.failover.pause();

  // Obliterate all queues (remove all jobs and data)
  await queues.backup.obliterate({ force: true });
  await queues.prune.obliterate({ force: true });
  await queues.scheduled.obliterate({ force: true });
  await queues.healthCheck.obliterate({ force: true });
  await queues.failover.obliterate({ force: true });

  // Close queues
  await queues.backup.close();
  await queues.prune.close();
  await queues.scheduled.close();
  await queues.healthCheck.close();
  await queues.failover.close();

  // Close connection
  await queues.connection.quit();
}

/**
 * Cleanup a single queue
 */
export async function cleanupQueue(queue: Queue): Promise<void> {
  await queue.pause();
  await queue.obliterate({ force: true });
  await queue.close();
}

/**
 * Create a test backup job
 */
export async function createTestBackupJob(
  queue: Queue,
  data: Partial<BackupJobData> & { jobName: string },
  options?: JobsOptions
): Promise<Job<BackupJobData>> {
  const jobData: BackupJobData = {
    jobName: data.jobName,
    jobType: data.jobType || "folder",
    storageName: data.storageName || "test-storage",
    repoName: data.repoName || "test-repo",
    workerGroup: data.workerGroup || "default",
    triggerType: data.triggerType || "manual",
    sourcePath: data.sourcePath || "/tmp/test-source",
    tags: data.tags || ["test"],
    retention: data.retention,
    ...data,
  };

  const job = await queue.add(data.jobName, jobData, {
    priority: JOB_PRIORITY.NORMAL,
    ...QUEUE_CONFIG[QUEUES.BACKUP_JOBS]?.defaultJobOptions,
    ...options,
  });

  return job;
}

/**
 * Create a test prune job
 */
export async function createTestPruneJob(
  queue: Queue,
  data: Partial<PruneJobData> & { jobName: string },
  options?: JobsOptions
): Promise<Job<PruneJobData>> {
  const jobData: PruneJobData = {
    jobName: data.jobName,
    storageName: data.storageName || "test-storage",
    repoName: data.repoName || "test-repo",
    retention: data.retention || { last: 5 },
    tags: data.tags,
    ...data,
  };

  const job = await queue.add(`prune-${data.jobName}`, jobData, {
    priority: JOB_PRIORITY.LOW,
    ...QUEUE_CONFIG[QUEUES.PRUNE_JOBS]?.defaultJobOptions,
    ...options,
  });

  return job;
}

/**
 * Create multiple test jobs
 */
export async function createBulkTestJobs(
  queue: Queue,
  count: number,
  generator: (index: number) => { name: string; data: Record<string, unknown> }
): Promise<Job[]> {
  const jobs: Job[] = [];

  for (let i = 0; i < count; i++) {
    const { name, data } = generator(i);
    const job = await queue.add(name, data);
    jobs.push(job);
  }

  return jobs;
}

/**
 * Wait for a job to reach a specific state
 */
export async function waitForJobState(
  queue: Queue,
  jobId: string,
  targetState: "completed" | "failed" | "active" | "waiting" | "delayed",
  timeoutMs = 30000
): Promise<Job | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const job = await queue.getJob(jobId);

    if (!job) {
      await sleep(100);
      continue;
    }

    const state = await job.getState();

    if (state === targetState) {
      return job;
    }

    // Job completed or failed - exit even if not target state
    if (state === "completed" || state === "failed") {
      return job;
    }

    await sleep(100);
  }

  return null;
}

/**
 * Wait for a job to complete (success or failure)
 */
export async function waitForJobCompletion(
  queue: Queue,
  jobId: string,
  timeoutMs = 30000
): Promise<{ job: Job | null; success: boolean }> {
  const job = await waitForJobState(queue, jobId, "completed", timeoutMs);

  if (!job) {
    return { job: null, success: false };
  }

  const state = await job.getState();
  return { job, success: state === "completed" };
}

/**
 * Wait for all jobs in queue to complete
 */
export async function waitForQueueDrained(
  queue: Queue,
  timeoutMs = 60000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const counts = await queue.getJobCounts();
    const pending = counts.waiting + counts.active + counts.delayed;

    if (pending === 0) {
      return true;
    }

    await sleep(200);
  }

  return false;
}

export interface TestWorker {
  worker: Worker;
  processedJobs: Job[];
  failedJobs: Job[];
  stop(): Promise<void>;
}

/**
 * Create a test worker that processes jobs
 */
export function createTestWorker(
  queueName: string,
  processor: (job: Job) => Promise<unknown>,
  connection?: Redis
): TestWorker {
  const conn = connection || createBullMQConnection();
  const processedJobs: Job[] = [];
  const failedJobs: Job[] = [];

  const worker = new Worker(
    queueName,
    async (job) => {
      try {
        const result = await processor(job);
        processedJobs.push(job);
        return result;
      } catch (error) {
        failedJobs.push(job);
        throw error;
      }
    },
    { connection: conn }
  );

  return {
    worker,
    processedJobs,
    failedJobs,
    async stop(): Promise<void> {
      await worker.close();
    },
  };
}

/**
 * Create a simple passthrough worker (always succeeds)
 */
export function createPassthroughWorker(
  queueName: string,
  connection?: Redis,
  delayMs = 0
): TestWorker {
  return createTestWorker(
    queueName,
    async (job) => {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      return { success: true, jobId: job.id };
    },
    connection
  );
}

/**
 * Create a worker that always fails
 */
export function createFailingWorker(
  queueName: string,
  errorMessage = "Intentional test failure",
  connection?: Redis
): TestWorker {
  return createTestWorker(
    queueName,
    async () => {
      throw new Error(errorMessage);
    },
    connection
  );
}

/**
 * Create a worker with conditional processing
 */
export function createConditionalWorker(
  queueName: string,
  shouldSucceed: (job: Job) => boolean,
  connection?: Redis
): TestWorker {
  return createTestWorker(
    queueName,
    async (job) => {
      if (shouldSucceed(job)) {
        return { success: true, jobId: job.id };
      }
      throw new Error("Conditional failure");
    },
    connection
  );
}

/**
 * Get comprehensive queue statistics
 */
export async function getQueueStats(queue: Queue): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
}> {
  const counts = await queue.getJobCounts();

  return {
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
    delayed: counts.delayed || 0,
    paused: counts.paused || 0,
    total:
      (counts.waiting || 0) +
      (counts.active || 0) +
      (counts.completed || 0) +
      (counts.failed || 0) +
      (counts.delayed || 0),
  };
}

/**
 * Verify queue is empty (no pending jobs)
 */
export async function verifyQueueEmpty(queue: Queue): Promise<boolean> {
  const counts = await queue.getJobCounts();
  return counts.waiting === 0 && counts.active === 0 && counts.delayed === 0;
}

/**
 * Get jobs by state
 */
export async function getJobsByState(
  queue: Queue,
  state: "waiting" | "active" | "completed" | "failed" | "delayed",
  start = 0,
  end = 100
): Promise<Job[]> {
  switch (state) {
    case "waiting":
      return queue.getWaiting(start, end);
    case "active":
      return queue.getActive(start, end);
    case "completed":
      return queue.getCompleted(start, end);
    case "failed":
      return queue.getFailed(start, end);
    case "delayed":
      return queue.getDelayed(start, end);
    default:
      return [];
  }
}

/**
 * Create queue event listener for testing
 */
export function createQueueEventListener(queue: Queue, connection?: Redis): {
  events: QueueEvents;
  completedJobs: string[];
  failedJobs: string[];
  close: () => Promise<void>;
} {
  const conn = connection || createBullMQConnection();
  const events = new QueueEvents(queue.name, { connection: conn });
  const completedJobs: string[] = [];
  const failedJobs: string[] = [];

  events.on("completed", ({ jobId }) => {
    completedJobs.push(jobId);
  });

  events.on("failed", ({ jobId }) => {
    failedJobs.push(jobId);
  });

  return {
    events,
    completedJobs,
    failedJobs,
    async close(): Promise<void> {
      await events.close();
    },
  };
}

/**
 * Create a repeatable job (for schedule testing)
 */
export async function createRepeatableJob(
  queue: Queue,
  name: string,
  data: Record<string, unknown>,
  pattern: string // cron pattern
): Promise<Job> {
  return queue.add(name, data, {
    repeat: { pattern },
  });
}

/**
 * Get all repeatable jobs
 */
export async function getRepeatableJobs(queue: Queue): Promise<{ key: string; name: string; cron: string }[]> {
  const repeatables = await queue.getRepeatableJobs();
  return repeatables.map((r) => ({
    key: r.key,
    name: r.name || "",
    cron: r.pattern || "",
  }));
}

/**
 * Remove a repeatable job
 */
export async function removeRepeatableJob(
  queue: Queue,
  name: string,
  pattern: string
): Promise<boolean> {
  return queue.removeRepeatable(name, { pattern });
}

/**
 * Remove all repeatable jobs
 */
export async function removeAllRepeatableJobs(queue: Queue): Promise<void> {
  const repeatables = await queue.getRepeatableJobs();
  for (const repeatable of repeatables) {
    await queue.removeRepeatableByKey(repeatable.key);
  }
}

export interface QueueTestContext {
  queues: TestQueues;
  workers: TestWorker[];
  eventListeners: ReturnType<typeof createQueueEventListener>[];
}

/**
 * Create a full queue test context
 */
export function createQueueTestContext(connection?: Redis): QueueTestContext {
  const queues = createAllTestQueues(connection);

  return {
    queues,
    workers: [],
    eventListeners: [],
  };
}

/**
 * Cleanup queue test context
 */
export async function cleanupQueueTestContext(context: QueueTestContext): Promise<void> {
  // Stop all workers
  for (const worker of context.workers) {
    await worker.stop();
  }

  // Close event listeners
  for (const listener of context.eventListeners) {
    await listener.close();
  }

  // Cleanup queues
  await cleanupTestQueues(context.queues);
}

/**
 * Add a worker to the context
 */
export function addWorkerToContext(
  context: QueueTestContext,
  queueName: string,
  processor: (job: Job) => Promise<unknown>
): TestWorker {
  const worker = createTestWorker(queueName, processor, context.queues.connection);
  context.workers.push(worker);
  return worker;
}

/**
 * Add an event listener to the context
 */
export function addEventListenerToContext(
  context: QueueTestContext,
  queue: Queue
): ReturnType<typeof createQueueEventListener> {
  const listener = createQueueEventListener(queue, context.queues.connection);
  context.eventListeners.push(listener);
  return listener;
}
