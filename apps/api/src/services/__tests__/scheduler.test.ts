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

vi.mock("@uni-backups/shared/config", () => ({
  getConfig: vi.fn(() => ({
    jobs: mockJobs,
    storage: mockStorage,
  })),
}));

vi.mock("@uni-backups/queue", () => ({
  QUEUES: { BACKUP_JOBS: "backup-jobs" },
  getQueueConfig: vi.fn(() => ({
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
  })),
}));

// Build mock instances that are accessible from test code via __mockQueue / __mockQueueEvents
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

let mockQueue = createMockQueue();
let mockQueueEvents = createMockQueueEvents();

vi.mock("bullmq", () => ({
  Queue: vi.fn(function () { return mockQueue; }),
  QueueEvents: vi.fn(function () { return mockQueueEvents; }),
  get __mockQueue() {
    return mockQueue;
  },
  get __mockQueueEvents() {
    return mockQueueEvents;
  },
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

import { Queue, QueueEvents } from "bullmq";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Scheduler (unit)", () => {
  beforeEach(() => {
    // Fresh mock instances for every test so call counts reset
    mockQueue = createMockQueue();
    mockQueueEvents = createMockQueueEvents();
    (Queue as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return mockQueue; },
    );
    (QueueEvents as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return mockQueueEvents; },
    );

    mockJobs.clear();
    mockStorage.clear();
  });

  afterEach(async () => {
    await stopScheduler();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // initScheduler
  // -----------------------------------------------------------------------
  describe("initScheduler", () => {
    it("creates queue with correct name and options", async () => {
      await initScheduler();

      expect(Queue).toHaveBeenCalledTimes(1);
      const callArgs = (Queue as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(callArgs[0]).toBe("backup-jobs");
      expect(callArgs[1]).toHaveProperty("connection");
      expect(callArgs[1]).toHaveProperty("defaultJobOptions");
    });

    it("creates QueueEvents listener", async () => {
      await initScheduler();

      expect(QueueEvents).toHaveBeenCalledTimes(1);
      const callArgs = (QueueEvents as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(callArgs[0]).toBe("backup-jobs");
    });

    it("calls syncSchedules on init", async () => {
      addJobToConfig("sync-on-init-job");
      addStorageToConfig();

      await initScheduler();

      // syncSchedules calls getRepeatableJobs and then add for each scheduled job
      expect(mockQueue.getRepeatableJobs).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith(
        "schedule:sync-on-init-job",
        expect.objectContaining({ jobName: "sync-on-init-job" }),
        expect.objectContaining({
          repeat: { pattern: "0 2 * * *" },
        }),
      );
    });

    it("sets up completed and failed event handlers on queue events", async () => {
      await initScheduler();

      const onCalls = mockQueueEvents.on.mock.calls;
      const eventNames = onCalls.map(
        (c: [string, (...args: any[]) => void]) => c[0],
      );
      expect(eventNames).toContain("completed");
      expect(eventNames).toContain("failed");
    });
  });

  // -----------------------------------------------------------------------
  // syncSchedules
  // -----------------------------------------------------------------------
  describe("syncSchedules", () => {
    it("adds repeatable jobs for all scheduled jobs in config", async () => {
      await initScheduler();
      mockQueue.add.mockClear();

      addJobToConfig("job-alpha", { schedule: "0 1 * * *" });
      addJobToConfig("job-beta", { schedule: "0 3 * * *" });
      addStorageToConfig();

      await syncSchedules();

      expect(mockQueue.add).toHaveBeenCalledWith(
        "schedule:job-alpha",
        expect.objectContaining({ jobName: "job-alpha" }),
        expect.objectContaining({ repeat: { pattern: "0 1 * * *" } }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        "schedule:job-beta",
        expect.objectContaining({ jobName: "job-beta" }),
        expect.objectContaining({ repeat: { pattern: "0 3 * * *" } }),
      );
    });

    it("removes existing repeatable before re-adding (update)", async () => {
      await initScheduler();

      // Simulate an existing repeatable in the queue
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule:existing-job", key: "repeat:existing-job:key", pattern: "0 1 * * *" },
      ]);
      mockQueue.add.mockClear();

      addJobToConfig("existing-job", { schedule: "0 5 * * *" });
      addStorageToConfig();

      await syncSchedules();

      // The old key should have been removed first
      expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "repeat:existing-job:key",
      );
      // Then the new schedule should be added
      expect(mockQueue.add).toHaveBeenCalledWith(
        "schedule:existing-job",
        expect.objectContaining({ jobName: "existing-job" }),
        expect.objectContaining({ repeat: { pattern: "0 5 * * *" } }),
      );
    });

    it("removes repeatables for jobs no longer in config", async () => {
      await initScheduler();

      // Simulate a repeatable that no longer has a corresponding config entry
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule:removed-job", key: "repeat:removed-key", pattern: "0 6 * * *" },
      ]);

      // Config is empty -- the job was removed
      await syncSchedules();

      expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "repeat:removed-key",
      );
    });

    it("skips jobs without a schedule field", async () => {
      await initScheduler();
      mockQueue.add.mockClear();

      addJobToConfig("no-schedule-job", { schedule: undefined });
      addStorageToConfig();

      await syncSchedules();

      const addCalls = mockQueue.add.mock.calls;
      const scheduledNames = addCalls.map(
        (c: [string, ...any[]]) => c[0],
      );
      expect(scheduledNames).not.toContain("schedule:no-schedule-job");
    });

    it("throws if scheduler not initialized", async () => {
      // stopScheduler was already called in afterEach, but let's be explicit
      await stopScheduler();

      await expect(syncSchedules()).rejects.toThrow("Scheduler not initialized");
    });
  });

  // -----------------------------------------------------------------------
  // queueJob
  // -----------------------------------------------------------------------
  describe("queueJob", () => {
    it("queues a job for immediate execution and returns executionId", async () => {
      addJobToConfig("manual-run");
      addStorageToConfig();
      await initScheduler();

      mockQueue.add.mockClear();
      const result = await queueJob("manual-run");

      expect(result.queued).toBe(true);
      expect(result.executionId).toBeTruthy();
      expect(typeof result.executionId).toBe("string");
      expect(result.executionId.length).toBeGreaterThan(0);
      expect(result.message).toContain("queued");

      // Verify backupQueue.add was called with the correct name pattern
      expect(mockQueue.add).toHaveBeenCalledWith(
        "backup:manual-run",
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

    it("returns queued:false with message when scheduler not initialized", async () => {
      await stopScheduler();

      const result = await queueJob("any-job");

      expect(result.queued).toBe(false);
      expect(result.executionId).toBe("");
      expect(result.message).toBe("Scheduler not initialized");
    });

    it("returns queued:false when job not found in config", async () => {
      await initScheduler();

      const result = await queueJob("nonexistent-job");

      expect(result.queued).toBe(false);
      expect(result.executionId).toBe("");
      expect(result.message).toContain("not found");
    });

    it("returns queued:false when storage not found for job", async () => {
      addJobToConfig("missing-storage-job", { storage: "does-not-exist" });
      // Deliberately do NOT add the storage config
      await initScheduler();

      const result = await queueJob("missing-storage-job");

      expect(result.queued).toBe(false);
      expect(result.executionId).toBe("");
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

    it('passes correct triggeredBy value "manual"', async () => {
      addJobToConfig("trigger-manual");
      addStorageToConfig();
      await initScheduler();
      mockQueue.add.mockClear();

      await queueJob("trigger-manual", "manual");

      expect(mockQueue.add).toHaveBeenCalledWith(
        "backup:trigger-manual",
        expect.objectContaining({ triggeredBy: "manual" }),
        expect.any(Object),
      );
    });

    it('passes correct triggeredBy value "failover"', async () => {
      addJobToConfig("trigger-failover");
      addStorageToConfig();
      await initScheduler();
      mockQueue.add.mockClear();

      await queueJob("trigger-failover", "failover");

      expect(mockQueue.add).toHaveBeenCalledWith(
        "backup:trigger-failover",
        expect.objectContaining({ triggeredBy: "failover" }),
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getScheduledJobs
  // -----------------------------------------------------------------------
  describe("getScheduledJobs", () => {
    it("returns scheduled jobs list from repeatables", async () => {
      addJobToConfig("sched-a", { schedule: "0 2 * * *" });
      addJobToConfig("sched-b", { schedule: "0 4 * * *" });
      addStorageToConfig();
      await initScheduler();

      mockQueue.getRepeatableJobs.mockResolvedValue([
        { name: "schedule:sched-a", key: "k1", pattern: "0 2 * * *", next: Date.now() + 60000 },
        { name: "schedule:sched-b", key: "k2", pattern: "0 4 * * *", next: Date.now() + 120000 },
      ]);

      const jobs = await getScheduledJobs();

      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe("sched-a");
      expect(jobs[0].schedule).toBe("0 2 * * *");
      expect(jobs[0].nextRun).toBeInstanceOf(Date);
      expect(jobs[1].name).toBe("sched-b");
      expect(jobs[1].schedule).toBe("0 4 * * *");
    });

    it("returns empty array when not initialized", async () => {
      await stopScheduler();

      const jobs = await getScheduledJobs();

      expect(jobs).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getRunningJobs
  // -----------------------------------------------------------------------
  describe("getRunningJobs", () => {
    it("returns active jobs from queue", async () => {
      await initScheduler();

      mockQueue.getActive.mockResolvedValue([
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

      expect(running).toHaveLength(2);
      expect(running[0]).toEqual({
        jobName: "running-job-1",
        executionId: "exec-1",
        queuedAt: 1700000000000,
      });
      expect(running[1]).toEqual({
        jobName: "running-job-2",
        executionId: "exec-2",
        queuedAt: 1700000001000,
      });
    });

    it("returns empty array when not initialized", async () => {
      await stopScheduler();

      const running = await getRunningJobs();

      expect(running).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getQueueStats
  // -----------------------------------------------------------------------
  describe("getQueueStats", () => {
    it("returns queue counts", async () => {
      await initScheduler();

      mockQueue.getJobCounts.mockResolvedValue({
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

  // -----------------------------------------------------------------------
  // isJobActive
  // -----------------------------------------------------------------------
  describe("isJobActive", () => {
    it("returns true when job is in waiting queue", async () => {
      await initScheduler();

      mockQueue.getWaiting.mockResolvedValue([
        { data: { jobName: "waiting-job" } },
      ]);
      mockQueue.getActive.mockResolvedValue([]);

      const result = await isJobActive("waiting-job");

      expect(result).toBe(true);
    });

    it("returns true when job is in active queue", async () => {
      await initScheduler();

      mockQueue.getWaiting.mockResolvedValue([]);
      mockQueue.getActive.mockResolvedValue([
        { data: { jobName: "active-job" } },
      ]);

      const result = await isJobActive("active-job");

      expect(result).toBe(true);
    });

    it("returns false when job is nowhere", async () => {
      await initScheduler();

      mockQueue.getWaiting.mockResolvedValue([]);
      mockQueue.getActive.mockResolvedValue([]);

      const result = await isJobActive("ghost-job");

      expect(result).toBe(false);
    });

    it("returns false when not initialized", async () => {
      await stopScheduler();

      const result = await isJobActive("any-job");

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // stopScheduler
  // -----------------------------------------------------------------------
  describe("stopScheduler", () => {
    it("closes queue and events", async () => {
      await initScheduler();

      await stopScheduler();

      expect(mockQueueEvents.close).toHaveBeenCalledTimes(1);
      expect(mockQueue.close).toHaveBeenCalledTimes(1);
    });

    it("sets internal references to null (getBackupQueue returns null after stop)", async () => {
      await initScheduler();
      expect(getBackupQueue()).not.toBeNull();

      await stopScheduler();

      expect(getBackupQueue()).toBeNull();
    });

    it("can be called multiple times without error (double stop safety)", async () => {
      await initScheduler();

      await stopScheduler();
      await stopScheduler();

      // close should only have been called once each because the second
      // stopScheduler call sees null references and skips closing
      expect(mockQueueEvents.close).toHaveBeenCalledTimes(1);
      expect(mockQueue.close).toHaveBeenCalledTimes(1);
    });
  });
});
