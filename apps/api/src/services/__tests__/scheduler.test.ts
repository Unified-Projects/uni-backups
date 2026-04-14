/**
 * Scheduler unit tests -- fully mocked BullMQ and Redis
 *
 * Tests scheduler logic in isolation without any real Redis connection.
 * For integration tests against real Redis, see scheduler.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks -- must be declared before any import that touches these modules
// ---------------------------------------------------------------------------

const mockJobs = new Map<string, any>();
const mockStorage = new Map<string, any>();
const SCHEDULE_TRIGGER_QUEUE = "backup-scheduled";

vi.mock("@uni-backups/shared/config", () => ({
  getConfig: vi.fn(() => ({
    jobs: mockJobs,
    storage: mockStorage,
  })),
}));

vi.mock("@uni-backups/queue", () => ({
  QUEUES: { BACKUP_JOBS: "backup-jobs", BACKUP_SCHEDULED: "backup-scheduled" },
  getQueueConfig: vi.fn(() => ({
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
  })),
}));

const createMockQueue = () => ({
  waitUntilReady: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue({ id: "test-id" }),
  close: vi.fn().mockResolvedValue(undefined),
  getRepeatableJobs: vi.fn().mockResolvedValue([]),
  removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
  getActive: vi.fn().mockResolvedValue([]),
  getWaiting: vi.fn().mockResolvedValue([]),
  getJobs: vi.fn().mockResolvedValue([]),
  getJobCounts: vi.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
  }),
  on: vi.fn(),
});

const createMockQueueEvents = () => ({
  waitUntilReady: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
});

const createMockWorker = () => ({
  waitUntilReady: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
});

let mockBackupQueue = createMockQueue();
let mockTriggerQueue = createMockQueue();
let mockQueueEvents = createMockQueueEvents();
let mockScheduleWorker = createMockWorker();
let scheduleProcessor: ((job: { data: { jobName: string } }) => Promise<void>) | null = null;

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (name: string) {
    return name === SCHEDULE_TRIGGER_QUEUE ? mockTriggerQueue : mockBackupQueue;
  }),
  QueueEvents: vi.fn(function () { return mockQueueEvents; }),
  Worker: vi.fn(function (name: string, processor: (job: { data: { jobName: string } }) => Promise<void>) {
    if (name === SCHEDULE_TRIGGER_QUEUE) {
      scheduleProcessor = processor;
      return mockScheduleWorker;
    }
    return createMockWorker();
  }),
}));

vi.mock("@uni-backups/shared/redis", () => ({
  getBullMQConnection: vi.fn(() => ({})),
  getRedisConnection: vi.fn(() => ({})),
  StateManager: vi.fn().mockImplementation(function () {
    return { getRecentJobs: vi.fn().mockResolvedValue([]) };
  }),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all vi.mock calls
// ---------------------------------------------------------------------------

import {
  initScheduler,
  stopScheduler,
  syncSchedules,
  queueJob,
  getScheduledJobs,
  getRunningJobs,
  getQueueStats,
  isJobActive,
  getBackupQueue,
} from "../scheduler";

import { Queue, QueueEvents, Worker } from "bullmq";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addJobToConfig(
  name: string,
  overrides: Record<string, any> = {},
): void {
  mockJobs.set(name, {
    storage: "local-storage",
    schedule: "0 2 * * *",
    repo: "my-repo",
    worker_group: "default",
    priority: 10,
    ...overrides,
  });
}

function addStorageToConfig(
  name = "local-storage",
  overrides: Record<string, any> = {},
): void {
  mockStorage.set(name, {
    name,
    type: "local",
    path: "/backups",
    ...overrides,
  });
}

describe("Scheduler (unit)", () => {
  beforeEach(() => {
    mockBackupQueue = createMockQueue();
    mockTriggerQueue = createMockQueue();
    mockQueueEvents = createMockQueueEvents();
    mockScheduleWorker = createMockWorker();
    scheduleProcessor = null;

    (Queue as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (name: string) {
        return name === SCHEDULE_TRIGGER_QUEUE ? mockTriggerQueue : mockBackupQueue;
      },
    );
    (QueueEvents as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return mockQueueEvents; },
    );
    (Worker as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (name: string, processor: (job: { data: { jobName: string } }) => Promise<void>) {
        if (name === SCHEDULE_TRIGGER_QUEUE) {
          scheduleProcessor = processor;
          return mockScheduleWorker;
        }
        return createMockWorker();
      },
    );

    mockJobs.clear();
    mockStorage.clear();
  });

  afterEach(async () => {
    await stopScheduler();
    vi.clearAllMocks();
  });

  describe("initScheduler", () => {
    it("creates backup and schedule trigger queues", async () => {
      await initScheduler();

      expect(Queue).toHaveBeenCalledTimes(2);
      const queueNames = (Queue as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
      );
      expect(queueNames).toContain("backup-jobs");
      expect(queueNames).toContain(SCHEDULE_TRIGGER_QUEUE);
    });

    it("creates QueueEvents listener for the backup queue", async () => {
      await initScheduler();

      expect(QueueEvents).toHaveBeenCalledTimes(1);
      expect((QueueEvents as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("backup-jobs");
    });

    it("creates a schedule trigger worker", async () => {
      await initScheduler();

      expect(Worker).toHaveBeenCalledWith(
        SCHEDULE_TRIGGER_QUEUE,
        expect.any(Function),
        expect.objectContaining({
          concurrency: 1,
        }),
      );
      expect(mockScheduleWorker.waitUntilReady).toHaveBeenCalled();
    });

    it("calls syncSchedules on init using the trigger queue", async () => {
      addJobToConfig("sync-on-init-job");
      addStorageToConfig();

      await initScheduler();

      expect(mockTriggerQueue.getRepeatableJobs).toHaveBeenCalled();
      expect(mockTriggerQueue.add).toHaveBeenCalledWith(
        "schedule-sync-on-init-job",
        expect.objectContaining({ jobName: "sync-on-init-job" }),
        expect.objectContaining({
          repeat: expect.objectContaining({ pattern: "0 2 * * *" }),
        }),
      );
    });

    it("sets up completed and failed event handlers on queue events", async () => {
      await initScheduler();

      const eventNames = mockQueueEvents.on.mock.calls.map(
        (call) => call[0],
      );
      expect(eventNames).toContain("completed");
      expect(eventNames).toContain("failed");
    });
  });

  describe("syncSchedules", () => {
    it("adds repeatable jobs for all scheduled jobs in config", async () => {
      await initScheduler();
      mockTriggerQueue.add.mockClear();

      addJobToConfig("job-alpha", { schedule: "0 1 * * *" });
      addJobToConfig("job-beta", { schedule: "0 3 * * *" });
      addStorageToConfig();

      await syncSchedules();

      expect(mockTriggerQueue.add).toHaveBeenCalledWith(
        "schedule-job-alpha",
        expect.objectContaining({ jobName: "job-alpha" }),
        expect.objectContaining({
          repeat: expect.objectContaining({ pattern: "0 1 * * *" }),
        }),
      );
      expect(mockTriggerQueue.add).toHaveBeenCalledWith(
        "schedule-job-beta",
        expect.objectContaining({ jobName: "job-beta" }),
        expect.objectContaining({
          repeat: expect.objectContaining({ pattern: "0 3 * * *" }),
        }),
      );
    });

    it("removes existing repeatable before re-adding", async () => {
      await initScheduler();

      mockTriggerQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule-existing-job", key: "repeat:existing-job:key", pattern: "0 1 * * *" },
      ]);
      mockTriggerQueue.add.mockClear();

      addJobToConfig("existing-job", { schedule: "0 5 * * *" });
      addStorageToConfig();

      await syncSchedules();

      expect(mockTriggerQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "repeat:existing-job:key",
      );
      expect(mockTriggerQueue.add).toHaveBeenCalledWith(
        "schedule-existing-job",
        expect.objectContaining({ jobName: "existing-job" }),
        expect.objectContaining({
          repeat: expect.objectContaining({ pattern: "0 5 * * *" }),
        }),
      );
    });

    it("removes repeatables for jobs no longer in config", async () => {
      await initScheduler();

      mockTriggerQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule-removed-job", key: "repeat:removed-key", pattern: "0 6 * * *" },
      ]);

      await syncSchedules();

      expect(mockTriggerQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "repeat:removed-key",
      );
    });

    it("skips jobs without a schedule field", async () => {
      await initScheduler();
      mockTriggerQueue.add.mockClear();

      addJobToConfig("no-schedule-job", { schedule: undefined });
      addStorageToConfig();

      await syncSchedules();

      const scheduledNames = mockTriggerQueue.add.mock.calls.map(
        (call) => call[0],
      );
      expect(scheduledNames).not.toContain("schedule-no-schedule-job");
    });

    it("throws if scheduler is not initialized", async () => {
      await stopScheduler();

      await expect(syncSchedules()).rejects.toThrow("Scheduler not initialized");
    });

    it("uses unique repeat keys when schedules share the same cron", async () => {
      await initScheduler();
      mockTriggerQueue.add.mockClear();

      addJobToConfig("job-a", { schedule: "0 2 * * *" });
      addJobToConfig("job-b", { schedule: "0 2 * * *" });
      addJobToConfig("job-c", { schedule: "0 2 * * *" });
      addStorageToConfig();

      await syncSchedules();

      expect(mockTriggerQueue.add).toHaveBeenCalledTimes(3);

      const addCalls = mockTriggerQueue.add.mock.calls;
      const jobA = addCalls.find((call) => call[0] === "schedule-job-a");
      const jobB = addCalls.find((call) => call[0] === "schedule-job-b");
      const jobC = addCalls.find((call) => call[0] === "schedule-job-c");

      expect(jobA).toBeDefined();
      expect(jobB).toBeDefined();
      expect(jobC).toBeDefined();
      expect((jobA![2] as any).repeat.key).toBe("schedule-job-a");
      expect((jobB![2] as any).repeat.key).toBe("schedule-job-b");
      expect((jobC![2] as any).repeat.key).toBe("schedule-job-c");
    });
  });

  describe("queueJob", () => {
    it("queues a job for immediate execution and returns executionId", async () => {
      addJobToConfig("manual-run");
      addStorageToConfig();
      await initScheduler();

      mockBackupQueue.add.mockClear();
      const result = await queueJob("manual-run");

      expect(result.queued).toBe(true);
      expect(result.executionId).toBeTruthy();
      expect(result.message).toContain("queued");
      expect(mockBackupQueue.add).toHaveBeenCalledWith(
        "backup-manual-run",
        expect.objectContaining({
          executionId: result.executionId,
          jobName: "manual-run",
          triggeredBy: "manual",
        }),
        expect.objectContaining({
          jobId: result.executionId,
        }),
      );
    });

    it("returns queued:false when scheduler is not initialized", async () => {
      await stopScheduler();

      const result = await queueJob("any-job");

      expect(result).toEqual({
        executionId: "",
        queued: false,
        message: "Scheduler not initialized",
      });
    });

    it("returns queued:false when job is not found in config", async () => {
      await initScheduler();

      const result = await queueJob("nonexistent-job");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("returns queued:false when storage is missing for the job", async () => {
      addJobToConfig("missing-storage-job", { storage: "does-not-exist" });
      await initScheduler();

      const result = await queueJob("missing-storage-job");

      expect(result.queued).toBe(false);
      expect(result.message).toContain("Storage");
      expect(result.message).toContain("does-not-exist");
    });

    it("generates unique executionIds across calls", async () => {
      addJobToConfig("unique-id-job");
      addStorageToConfig();
      await initScheduler();

      const result1 = await queueJob("unique-id-job");
      const result2 = await queueJob("unique-id-job");

      expect(result1.executionId).not.toBe(result2.executionId);
      expect(result1.executionId.length).toBeGreaterThan(0);
      expect(result2.executionId.length).toBeGreaterThan(0);
    });

    it('passes the "manual" trigger source through to backup jobs', async () => {
      addJobToConfig("trigger-manual");
      addStorageToConfig();
      await initScheduler();
      mockBackupQueue.add.mockClear();

      await queueJob("trigger-manual", "manual");

      expect(mockBackupQueue.add).toHaveBeenCalledWith(
        "backup-trigger-manual",
        expect.objectContaining({ triggeredBy: "manual" }),
        expect.any(Object),
      );
    });

    it('passes the "failover" trigger source through to backup jobs', async () => {
      addJobToConfig("trigger-failover");
      addStorageToConfig();
      await initScheduler();
      mockBackupQueue.add.mockClear();

      await queueJob("trigger-failover", "failover");

      expect(mockBackupQueue.add).toHaveBeenCalledWith(
        "backup-trigger-failover",
        expect.objectContaining({ triggeredBy: "failover" }),
        expect.any(Object),
      );
    });

    it("re-queues schedule trigger jobs with fresh execution metadata", async () => {
      addJobToConfig("trigger-schedule");
      addStorageToConfig();
      await initScheduler();
      mockBackupQueue.add.mockClear();

      expect(scheduleProcessor).toBeTypeOf("function");
      await scheduleProcessor!({ data: { jobName: "trigger-schedule" } });

      expect(mockBackupQueue.add).toHaveBeenCalledWith(
        "backup-trigger-schedule",
        expect.objectContaining({
          jobName: "trigger-schedule",
          triggeredBy: "schedule",
          executionId: expect.any(String),
          queuedAt: expect.any(Number),
        }),
        expect.objectContaining({
          jobId: expect.any(String),
        }),
      );
    });
  });

  describe("getScheduledJobs", () => {
    it("returns scheduled jobs from the trigger queue repeatables", async () => {
      addJobToConfig("sched-a", { schedule: "0 2 * * *" });
      addJobToConfig("sched-b", { schedule: "0 4 * * *" });
      addStorageToConfig();
      await initScheduler();

      mockTriggerQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule-sched-a", key: "k1", pattern: "0 2 * * *", next: Date.now() + 60000 },
        { name: "schedule-sched-b", key: "k2", pattern: "0 4 * * *", next: Date.now() + 120000 },
      ]);

      const jobs = await getScheduledJobs();

      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe("sched-a");
      expect(jobs[0].nextRun).toBeInstanceOf(Date);
      expect(jobs[1].name).toBe("sched-b");
    });

    it("returns empty array when not initialized", async () => {
      await stopScheduler();

      const jobs = await getScheduledJobs();

      expect(jobs).toEqual([]);
    });
  });

  describe("getRunningJobs", () => {
    it("returns active jobs from the backup queue", async () => {
      await initScheduler();

      mockBackupQueue.getActive.mockResolvedValue([
        {
          data: {
            jobName: "running-job-1",
            executionId: "exec-1",
            queuedAt: 1700000000000,
          },
        },
        {
          data: {
            jobName: "running-job-2",
            executionId: "exec-2",
            queuedAt: 1700000001000,
          },
        },
      ]);

      const running = await getRunningJobs();

      expect(running).toEqual([
        {
          jobName: "running-job-1",
          executionId: "exec-1",
          queuedAt: 1700000000000,
        },
        {
          jobName: "running-job-2",
          executionId: "exec-2",
          queuedAt: 1700000001000,
        },
      ]);
    });

    it("returns empty array when not initialized", async () => {
      await stopScheduler();

      const running = await getRunningJobs();

      expect(running).toEqual([]);
    });
  });

  describe("getQueueStats", () => {
    it("returns queue counts from the backup queue", async () => {
      await initScheduler();

      mockBackupQueue.getJobCounts.mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: 0,
      });

      const stats = await getQueueStats();

      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: 0,
      });
    });

    it("returns zeros when not initialized", async () => {
      await stopScheduler();

      const stats = await getQueueStats();

      expect(stats).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      });
    });
  });

  describe("isJobActive", () => {
    it("returns true when the job is waiting", async () => {
      await initScheduler();

      mockBackupQueue.getWaiting.mockResolvedValue([
        { data: { jobName: "waiting-job" } },
      ]);
      mockBackupQueue.getActive.mockResolvedValue([]);
      mockBackupQueue.getJobs.mockResolvedValue([]);

      const result = await isJobActive("waiting-job");

      expect(result).toBe(true);
    });

    it("returns true when the job is active", async () => {
      await initScheduler();

      mockBackupQueue.getWaiting.mockResolvedValue([]);
      mockBackupQueue.getActive.mockResolvedValue([
        { data: { jobName: "active-job" } },
      ]);
      mockBackupQueue.getJobs.mockResolvedValue([]);

      const result = await isJobActive("active-job");

      expect(result).toBe(true);
    });

    it("returns false when the job is nowhere in the queue", async () => {
      await initScheduler();

      mockBackupQueue.getWaiting.mockResolvedValue([]);
      mockBackupQueue.getActive.mockResolvedValue([]);
      mockBackupQueue.getJobs.mockResolvedValue([]);

      const result = await isJobActive("ghost-job");

      expect(result).toBe(false);
    });

    it("returns false when not initialized", async () => {
      await stopScheduler();

      const result = await isJobActive("any-job");

      expect(result).toBe(false);
    });
  });

  describe("stopScheduler", () => {
    it("closes both queues, the schedule worker, and queue events", async () => {
      await initScheduler();

      await stopScheduler();

      expect(mockQueueEvents.close).toHaveBeenCalledTimes(1);
      expect(mockScheduleWorker.close).toHaveBeenCalledTimes(1);
      expect(mockTriggerQueue.close).toHaveBeenCalledTimes(1);
      expect(mockBackupQueue.close).toHaveBeenCalledTimes(1);
    });

    it("sets internal references to null", async () => {
      await initScheduler();
      expect(getBackupQueue()).not.toBeNull();

      await stopScheduler();

      expect(getBackupQueue()).toBeNull();
    });

    it("can be called multiple times without error", async () => {
      await initScheduler();

      await stopScheduler();
      await stopScheduler();

      expect(mockQueueEvents.close).toHaveBeenCalledTimes(1);
      expect(mockScheduleWorker.close).toHaveBeenCalledTimes(1);
      expect(mockTriggerQueue.close).toHaveBeenCalledTimes(1);
      expect(mockBackupQueue.close).toHaveBeenCalledTimes(1);
    });
  });
});
