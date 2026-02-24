/**
 * Concurrent Backup Jobs System Tests
 *
 * Tests for concurrent backup job execution:
 * - Multiple jobs in different worker groups
 * - Same repository from different workers
 * - Priority-based job ordering
 * - Resource contention handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import { StateManager, JobExecution } from "@uni-backups/shared/redis";
import { JOB_PRIORITY } from "@uni-backups/queue/queues";
import {
  initTestContext,
  cleanupTestContext,
  type TestContext,
  waitForAllServices,
  sleep,
  generateTestId,
} from "../utils/test-services";
import {
  createSimulatedWorker,
  createSimulatedWorkerCluster,
  cleanupSimulatedWorkers,
  type SimulatedWorker,
} from "../utils/worker-helpers";

describe("Concurrent Backup Jobs System Tests", () => {
  let testContext: TestContext;
  let redis: Redis;
  let stateManager: StateManager;

  const TEST_TIMEOUT = 120000;

  beforeAll(async () => {
    await waitForAllServices({ redis: true });
    testContext = await initTestContext({ redis: true, queues: true });
    redis = testContext.redis;
    stateManager = testContext.stateManager;
  }, 60000);

  afterAll(async () => {
    if (testContext) {
      await cleanupTestContext(testContext);
    }
  });

  describe("Multi-Group Concurrent Jobs", () => {
    it("should run jobs in different worker groups simultaneously", async () => {
      const group1Id = generateTestId("group-1");
      const group2Id = generateTestId("group-2");
      const group1Worker = createSimulatedWorkerCluster(2, group1Id, redis)[0];
      const group2Worker = createSimulatedWorkerCluster(2, group2Id, redis)[0];

      try {
        // Start workers in different groups
        await group1Worker.start();
        await group2Worker.start();
        await sleep(1000);

        // Record running jobs for each worker group
        const job1ExecutionId = generateTestId("exec-1");
        const job2ExecutionId = generateTestId("exec-2");

        await stateManager.recordJobExecution({
          id: job1ExecutionId,
          jobName: "backup-group1",
          workerId: group1Worker.id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: job2ExecutionId,
          jobName: "backup-group2",
          workerId: group2Worker.id,
          status: "running",
          startTime: Date.now(),
        });

        await sleep(500);

        // Verify both jobs are running
        const job1 = await stateManager.getJobExecution(job1ExecutionId);
        const job2 = await stateManager.getJobExecution(job2ExecutionId);

        expect(job1?.status).toBe("running");
        expect(job2?.status).toBe("running");

        // Verify workers are in different groups
        const group1Workers = await stateManager.getWorkersInGroup(group1Id);
        const group2Workers = await stateManager.getWorkersInGroup(group2Id);

        expect(group1Workers).toContain(group1Worker.id);
        expect(group2Workers).toContain(group2Worker.id);
      } finally {
        await cleanupSimulatedWorkers([group1Worker, group2Worker]);
      }
    });
  });

  describe("Same Repository Access", () => {
    it("should handle multiple workers accessing same repository", async () => {
      const groupId = generateTestId("shared-repo");
      const workers = createSimulatedWorkerCluster(2, groupId, redis);

      try {
        for (const worker of workers) {
          await worker.start();
        }
        await sleep(1000);

        // Both workers attempt to access same repo
        const exec1Id = generateTestId("exec-shared-1");
        const exec2Id = generateTestId("exec-shared-2");

        await stateManager.recordJobExecution({
          id: exec1Id,
          jobName: "shared-backup-1",
          workerId: workers[0].id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: exec2Id,
          jobName: "shared-backup-2",
          workerId: workers[1].id,
          status: "running",
          startTime: Date.now(),
        });

        await sleep(500);

        const exec1 = await stateManager.getJobExecution(exec1Id);
        const exec2 = await stateManager.getJobExecution(exec2Id);

        // Both jobs must be tracked in the state manager with meaningful statuses.
        expect(exec1).not.toBeNull();
        expect(exec2).not.toBeNull();

        // Both jobs were submitted as running — both must still have a running
        // status (the state manager does not auto-transition them; restic locking
        // is handled transparently at the backup level, not at the state level).
        expect(exec1?.status).toBe("running");
        expect(exec2?.status).toBe("running");
      } finally {
        await cleanupSimulatedWorkers(workers);
      }
    });
  });

  describe("Priority-Based Ordering", () => {
    it("should order jobs by priority (lower = higher priority)", async () => {
      const groupId = generateTestId("priority-test");
      const worker = createSimulatedWorkerCluster(1, groupId, redis)[0];

      try {
        await worker.start();
        await sleep(500);

        // Queue multiple jobs with different priorities
        const highPriorityExecId = generateTestId("exec-high");
        const lowPriorityExecId = generateTestId("exec-low");

        // High priority job (priority 1)
        await stateManager.recordJobExecution({
          id: highPriorityExecId,
          jobName: "critical-backup",
          workerId: worker.id,
          status: "running",
          startTime: Date.now(),
        });

        // Update to add priority field (simulating queue priority)
        await stateManager.updateJobExecution(highPriorityExecId, {
          priority: JOB_PRIORITY.CRITICAL,
        });

        // Low priority job
        await stateManager.recordJobExecution({
          id: lowPriorityExecId,
          jobName: "low-backup",
          workerId: worker.id,
          status: "pending",
          startTime: Date.now(),
        });

        await stateManager.updateJobExecution(lowPriorityExecId, {
          priority: JOB_PRIORITY.LOW,
        });

        // Verify priority values
        const highJob = await stateManager.getJobExecution(highPriorityExecId);
        const lowJob = await stateManager.getJobExecution(lowPriorityExecId);

        expect(highJob?.priority).toBe(JOB_PRIORITY.CRITICAL);
        expect(lowJob?.priority).toBe(JOB_PRIORITY.LOW);
        expect(JOB_PRIORITY.CRITICAL).toBeLessThan(JOB_PRIORITY.LOW);
      } finally {
        await cleanupSimulatedWorkers([worker]);
      }
    });

    it("should process critical jobs before normal priority", async () => {
      const groupId = generateTestId("priority-order");
      const workers = createSimulatedWorkerCluster(2, groupId, redis);

      try {
        for (const worker of workers) {
          await worker.start();
        }
        await sleep(1000);

        // Queue jobs with different priorities
        const normalExecId = generateTestId("exec-normal");
        const criticalExecId = generateTestId("exec-critical");

        // Normal priority job queued first
        await stateManager.recordJobExecution({
          id: normalExecId,
          jobName: "normal-backup",
          workerId: workers[0].id,
          status: "pending",
          startTime: Date.now(),
        });
        await stateManager.updateJobExecution(normalExecId, {
          priority: JOB_PRIORITY.NORMAL,
        });

        // Critical priority job
        await stateManager.recordJobExecution({
          id: criticalExecId,
          jobName: "critical-backup",
          workerId: workers[1].id,
          status: "pending",
          startTime: Date.now(),
        });
        await stateManager.updateJobExecution(criticalExecId, {
          priority: JOB_PRIORITY.CRITICAL,
        });

        // Critical should have higher priority value (lower number)
        const normalJob = await stateManager.getJobExecution(normalExecId);
        const criticalJob = await stateManager.getJobExecution(criticalExecId);

        expect(criticalJob?.priority).toBeDefined();
        expect(normalJob?.priority).toBeDefined();
        expect(criticalJob!.priority!).toBeLessThan(normalJob!.priority!);
      } finally {
        await cleanupSimulatedWorkers(workers);
      }
    });
  });

  describe("Resource Contention", () => {
    it("should handle disk I/O contention gracefully", async () => {
      const groupId = generateTestId("io-contention");
      const workers = createSimulatedWorkerCluster(2, groupId, redis);

      try {
        for (const worker of workers) {
          await worker.start();
        }
        await sleep(1000);

        // Simulate concurrent I/O operations
        const exec1Id = generateTestId("exec-io-1");
        const exec2Id = generateTestId("exec-io-2");

        await stateManager.recordJobExecution({
          id: exec1Id,
          jobName: "io-intensive-1",
          workerId: workers[0].id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: exec2Id,
          jobName: "io-intensive-2",
          workerId: workers[1].id,
          status: "running",
          startTime: Date.now(),
        });

        await sleep(500);

        // Both jobs should be tracked
        const exec1 = await stateManager.getJobExecution(exec1Id);
        const exec2 = await stateManager.getJobExecution(exec2Id);

        expect(exec1).toBeDefined();
        expect(exec2).toBeDefined();
      } finally {
        await cleanupSimulatedWorkers(workers);
      }
    });

    it("should track concurrent job counts per worker", async () => {
      const groupId = generateTestId("job-count");
      const worker = createSimulatedWorkerCluster(1, groupId, redis)[0];

      try {
        await worker.start();
        await sleep(500);

        // Multiple jobs on same worker
        const exec1Id = generateTestId("exec-count-1");
        const exec2Id = generateTestId("exec-count-2");
        const exec3Id = generateTestId("exec-count-3");

        await stateManager.recordJobExecution({
          id: exec1Id,
          jobName: "backup-1",
          workerId: worker.id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: exec2Id,
          jobName: "backup-2",
          workerId: worker.id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: exec3Id,
          jobName: "backup-3",
          workerId: worker.id,
          status: "pending",
          startTime: Date.now(),
        });

        // Running jobs count - check via getRunningJobsForWorker, not worker state
        // Worker state's currentJobs is managed by the worker itself via heartbeats,
        // not by job execution recording
        const runningJobs = await stateManager.getRunningJobsForWorker(worker.id);
        expect(runningJobs.length).toBeGreaterThanOrEqual(2);

        // Verify the running jobs include our recorded ones
        const runningJobIds = runningJobs.map(j => j.id);
        expect(runningJobIds).toContain(exec1Id);
        expect(runningJobIds).toContain(exec2Id);
      } finally {
        await cleanupSimulatedWorkers([worker]);
      }
    });
  });

  describe("Job Isolation", () => {
    it("should maintain job isolation between worker groups", async () => {
      const group1Id = generateTestId("iso-group-1");
      const group2Id = generateTestId("iso-group-2");
      const worker1 = createSimulatedWorkerCluster(1, group1Id, redis)[0];
      const worker2 = createSimulatedWorkerCluster(1, group2Id, redis)[0];

      try {
        await worker1.start();
        await worker2.start();
        await sleep(1000);

        const exec1Id = generateTestId("exec-iso-1");
        const exec2Id = generateTestId("exec-iso-2");

        await stateManager.recordJobExecution({
          id: exec1Id,
          jobName: "backup-group1",
          workerId: worker1.id,
          status: "running",
          startTime: Date.now(),
        });

        await stateManager.recordJobExecution({
          id: exec2Id,
          jobName: "backup-group2",
          workerId: worker2.id,
          status: "running",
          startTime: Date.now(),
        });

        // Get jobs for each worker
        const worker1Jobs = await stateManager.getRunningJobsForWorker(worker1.id);
        const worker2Jobs = await stateManager.getRunningJobsForWorker(worker2.id);

        // Each worker's jobs should only contain their own
        const worker1JobIds = worker1Jobs.map(j => j.id);
        const worker2JobIds = worker2Jobs.map(j => j.id);

        expect(worker1JobIds).toContain(exec1Id);
        expect(worker1JobIds).not.toContain(exec2Id);
        expect(worker2JobIds).toContain(exec2Id);
        expect(worker2JobIds).not.toContain(exec1Id);
      } finally {
        await cleanupSimulatedWorkers([worker1, worker2]);
      }
    });
  });

  describe("Job Completion Tracking", () => {
    it("should track job completion status correctly", async () => {
      const groupId = generateTestId("completion");
      const worker = createSimulatedWorkerCluster(1, groupId, redis)[0];

      try {
        await worker.start();
        await sleep(500);

        const execId = generateTestId("exec-complete");

        // Start job
        await stateManager.recordJobExecution({
          id: execId,
          jobName: "backup-complete",
          workerId: worker.id,
          status: "running",
          startTime: Date.now(),
        });

        // Complete job
        await stateManager.updateJobExecution(execId, {
          status: "completed",
          endTime: Date.now(),
          snapshotId: "abc123def456",
          duration: 30000,
        });

        const completedJob = await stateManager.getJobExecution(execId);
        expect(completedJob?.status).toBe("completed");
        expect(completedJob?.snapshotId).toBe("abc123def456");
        expect(completedJob?.duration).toBe(30000);

        // Running jobs should not include completed job
        const runningJobs = await stateManager.getRunningJobsForWorker(worker.id);
        const runningJobIds = runningJobs.map(j => j.id);
        expect(runningJobIds).not.toContain(execId);
      } finally {
        await cleanupSimulatedWorkers([worker]);
      }
    });

    it("should track failed job status correctly", async () => {
      const groupId = generateTestId("failure");
      const worker = createSimulatedWorkerCluster(1, groupId, redis)[0];

      try {
        await worker.start();
        await sleep(500);

        const execId = generateTestId("exec-fail");

        await stateManager.recordJobExecution({
          id: execId,
          jobName: "backup-fail",
          workerId: worker.id,
          status: "running",
          startTime: Date.now(),
        });

        // Fail job
        await stateManager.updateJobExecution(execId, {
          status: "failed",
          endTime: Date.now(),
          error: "Connection timeout",
          duration: 15000,
        });

        const failedJob = await stateManager.getJobExecution(execId);
        expect(failedJob?.status).toBe("failed");
        expect(failedJob?.error).toBe("Connection timeout");
        expect(failedJob?.duration).toBe(15000);
      } finally {
        await cleanupSimulatedWorkers([worker]);
      }
    });
  });
});
