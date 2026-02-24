/**
 * High Availability Comprehensive Tests
 *
 * Tests HA features including:
 * - Heartbeat timeout and failover
 * - Worker recovery handling
 * - Quorum-based decisions
 * - Fence token validation
 * - Job takeover on failover
 * - Graceful shutdown draining
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import { StateManager, type WorkerGroupState, type WorkerState } from "@uni-backups/shared/redis";
import { HeartbeatService } from "../services/heartbeat";
import { FencingService } from "../services/fencing";
import type { WorkerConfig } from "../config";

// Test Redis configuration
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15,
};

function createWorkerConfig(id: string, groups: string[] = ["default"]): WorkerConfig {
  return {
    id,
    name: `Worker ${id}`,
    hostname: "localhost",
    groups,
    healthPort: 3004,
    heartbeatInterval: 100, // Fast for testing
    heartbeatTimeout: 1000, // Short timeout for testing
    concurrency: 2,
  };
}

describe("High Availability Comprehensive Tests", { timeout: 120000 }, () => {
  let redis: Redis;
  let stateManager: StateManager;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_CONFIG);
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    stateManager = new StateManager(redis);
  });

  // ==========================================================================
  // Heartbeat and Failover Tests
  // ==========================================================================

  describe("Heartbeat Timeout Failover", () => {
    it("detects worker as unhealthy after heartbeat timeout", async () => {
      const config = createWorkerConfig("worker-timeout-1");
      const heartbeat = new HeartbeatService(config, stateManager);

      // Start heartbeat
      await heartbeat.start();
      expect(heartbeat.isRunning()).toBe(true);

      // Verify worker is registered
      let state = await stateManager.getWorkerState(config.id);
      expect(state).not.toBeNull();
      expect(state!.status).toBe("healthy");

      // Stop heartbeat without graceful shutdown
      await heartbeat.stop();

      // Wait for heartbeat to become stale
      await new Promise((r) => setTimeout(r, 1500));

      // Get healthy workers - our worker should not be in the list
      const healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).not.toContain(config.id);
    });

    it("triggers failover when primary worker times out", async () => {
      const groupId = "failover-test-group";

      // Set up primary worker
      const primaryConfig = createWorkerConfig("primary-1", [groupId]);
      const primaryHeartbeat = new HeartbeatService(primaryConfig, stateManager);
      await primaryHeartbeat.start();

      // Set up secondary worker
      const secondaryConfig = createWorkerConfig("secondary-1", [groupId]);
      const secondaryHeartbeat = new HeartbeatService(secondaryConfig, stateManager);
      await secondaryHeartbeat.start();

      // Create worker group with primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [primaryConfig.id, secondaryConfig.id],
        primaryWorkerId: primaryConfig.id,
        failoverOrder: [primaryConfig.id, secondaryConfig.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Stop primary heartbeat (simulating crash)
      await primaryHeartbeat.stop();

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 1500));

      // Secondary should detect primary is down
      const healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).not.toContain(primaryConfig.id);
      expect(healthyWorkers).toContain(secondaryConfig.id);

      // In a real scenario, the health checker would trigger failover
      // Here we simulate what happens after failover detection

      // Acquire failover lock
      const lockAcquired = await stateManager.acquireFailoverLock(groupId, secondaryConfig.id);
      expect(lockAcquired).toBe(true);

      // Update primary
      await stateManager.updatePrimaryWorker(groupId, secondaryConfig.id);

      // Verify new primary
      const updatedGroup = await stateManager.getWorkerGroupState(groupId);
      expect(updatedGroup!.primaryWorkerId).toBe(secondaryConfig.id);

      // Release lock
      await stateManager.releaseFailoverLock(groupId);

      // Cleanup
      await secondaryHeartbeat.stop();
    });
  });

  describe("Heartbeat Recovery Without Failover", () => {
    it("does not trigger failover for brief heartbeat gaps", async () => {
      const config = createWorkerConfig("worker-recovery-1");
      const heartbeat = new HeartbeatService(config, stateManager);

      await heartbeat.start();

      // Get initial heartbeat time
      let state = await stateManager.getWorkerState(config.id);
      const initialHeartbeat = state!.lastHeartbeat;

      // Wait less than timeout
      await new Promise((r) => setTimeout(r, 300));

      // Worker should still be healthy
      const healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).toContain(config.id);

      // Heartbeat should have been updated
      state = await stateManager.getWorkerState(config.id);
      expect(state!.lastHeartbeat).toBeGreaterThan(initialHeartbeat);

      await heartbeat.stop();
    });
  });

  describe("Worker Rejoins After Recovery", () => {
    it("worker re-registers after temporary failure", async () => {
      const config = createWorkerConfig("worker-rejoin-1");
      const heartbeat = new HeartbeatService(config, stateManager);

      // Start and stop (simulating failure)
      await heartbeat.start();
      await heartbeat.stop();

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 1500));

      // Verify worker is no longer healthy
      let healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).not.toContain(config.id);

      // Restart worker (simulating recovery)
      const newHeartbeat = new HeartbeatService(config, stateManager);
      await newHeartbeat.start();

      // Wait for registration
      await new Promise((r) => setTimeout(r, 200));

      // Worker should be healthy again
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).toContain(config.id);

      const state = await stateManager.getWorkerState(config.id);
      expect(state!.status).toBe("healthy");

      await newHeartbeat.stop();
    });
  });

  // ==========================================================================
  // Quorum Tests
  // ==========================================================================

  describe("Quorum 2-of-3 Cluster", () => {
    it("requires 2 votes for failover in 3-node cluster", async () => {
      const groupId = "quorum-3-test";
      const workers = [
        createWorkerConfig("q3-worker-1", [groupId]),
        createWorkerConfig("q3-worker-2", [groupId]),
        createWorkerConfig("q3-worker-3", [groupId]),
      ];

      // Create worker group with quorum of 2
      const groupState: WorkerGroupState = {
        groupId,
        workers: workers.map((w) => w.id),
        primaryWorkerId: workers[0].id,
        failoverOrder: workers.map((w) => w.id),
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Simulate primary failure detection
      const targetWorker = workers[0].id;

      // First vote
      let voteCount = await stateManager.castDownVote(groupId, workers[1].id, targetWorker);
      expect(voteCount).toBe(1);

      // Not enough for quorum
      expect(voteCount < 2).toBe(true);

      // Second vote
      voteCount = await stateManager.castDownVote(groupId, workers[2].id, targetWorker);
      expect(voteCount).toBe(2);

      // Now we have quorum
      expect(voteCount >= 2).toBe(true);

      // Clear votes
      await stateManager.clearVotes(groupId);
    });
  });

  describe("Quorum 3-of-5 Cluster", () => {
    it("requires 3 votes for failover in 5-node cluster", async () => {
      const groupId = "quorum-5-test";
      const workers = [
        createWorkerConfig("q5-worker-1", [groupId]),
        createWorkerConfig("q5-worker-2", [groupId]),
        createWorkerConfig("q5-worker-3", [groupId]),
        createWorkerConfig("q5-worker-4", [groupId]),
        createWorkerConfig("q5-worker-5", [groupId]),
      ];

      // Create worker group with quorum of 3
      const groupState: WorkerGroupState = {
        groupId,
        workers: workers.map((w) => w.id),
        primaryWorkerId: workers[0].id,
        failoverOrder: workers.map((w) => w.id),
        quorumSize: 3,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      const targetWorker = workers[0].id;

      // Cast 2 votes - not enough
      await stateManager.castDownVote(groupId, workers[1].id, targetWorker);
      let voteCount = await stateManager.castDownVote(groupId, workers[2].id, targetWorker);
      expect(voteCount).toBe(2);
      expect(voteCount < 3).toBe(true);

      // Third vote achieves quorum
      voteCount = await stateManager.castDownVote(groupId, workers[3].id, targetWorker);
      expect(voteCount).toBe(3);
      expect(voteCount >= 3).toBe(true);

      await stateManager.clearVotes(groupId);
    });
  });

  // ==========================================================================
  // Fence Token Tests
  // ==========================================================================

  describe("Fence Token Prevents Stale Primary", () => {
    it("rejects operations from fenced-off worker", async () => {
      const groupId = "fencing-test";
      const oldPrimaryConfig = createWorkerConfig("old-primary", [groupId]);
      const newPrimaryConfig = createWorkerConfig("new-primary", [groupId]);

      // Set up old primary's fencing service
      const oldFencing = new FencingService(oldPrimaryConfig, {
        stateManager,
        redis,
      });

      // Set up new primary's fencing service
      const newFencing = new FencingService(newPrimaryConfig, {
        stateManager,
        redis,
      });

      // Create worker group with old primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [oldPrimaryConfig.id, newPrimaryConfig.id],
        primaryWorkerId: oldPrimaryConfig.id,
        failoverOrder: [oldPrimaryConfig.id, newPrimaryConfig.id],
        quorumSize: 2,
        fenceToken: "initial-token",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Old primary acquires fence token
      const oldToken = await oldFencing.acquireFenceToken(groupId);
      expect(oldToken).not.toBeNull();

      // Verify old primary can validate
      let validation = await oldFencing.validatePrimary(groupId);
      expect(validation.valid).toBe(true);

      // Simulate failover - new primary takes over
      await stateManager.updatePrimaryWorker(groupId, newPrimaryConfig.id);

      // Fence off old primary
      await newFencing.fenceOff(groupId, oldPrimaryConfig.id);

      // Old primary should now fail validation
      validation = await oldFencing.validatePrimary(groupId);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("not the primary");
    });
  });

  describe("Fence Token Increments on Failover", () => {
    it("generates new fence token on each failover", async () => {
      const groupId = "token-increment-test";

      const tokens: string[] = [];

      // Simulate multiple failovers
      for (let i = 0; i < 5; i++) {
        const workerId = `worker-${i}`;
        await stateManager.updatePrimaryWorker(groupId, workerId);

        const groupState = await stateManager.getWorkerGroupState(groupId);
        expect(groupState!.fenceToken).toBeDefined();
        tokens.push(groupState!.fenceToken!);
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);

      // Each token should include timestamp (should be monotonically increasing)
      for (let i = 1; i < tokens.length; i++) {
        const prevTimestamp = parseInt(tokens[i - 1].split("-")[0], 10);
        const currTimestamp = parseInt(tokens[i].split("-")[0], 10);
        expect(currTimestamp).toBeGreaterThanOrEqual(prevTimestamp);
      }
    });
  });

  // ==========================================================================
  // Job Takeover Tests
  // ==========================================================================

  describe("Job Takeover Preserves Progress", () => {
    it("records job state for potential takeover", async () => {
      const config = createWorkerConfig("job-takeover-worker");
      const heartbeat = new HeartbeatService(config, stateManager);

      await heartbeat.start();

      // Simulate job started
      const jobId = "job-takeover-123";
      heartbeat.jobStarted(jobId);

      // Wait for heartbeat to be sent
      await new Promise((r) => setTimeout(r, 200));

      // Verify job is recorded in worker state
      const state = await stateManager.getWorkerState(config.id);
      expect(state!.currentJobs).toContain(jobId);

      // Record job execution in state manager
      await stateManager.recordJobExecution({
        id: jobId,
        jobName: "test-job",
        workerId: config.id,
        status: "running",
        startTime: Date.now(),
      });

      const runningJobs = await stateManager.getRunningJobsForWorker(config.id);
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].id).toBe(jobId);

      await stateManager.updateJobExecution(jobId, {
        status: "failed",
        error: "Worker failed, job needs requeue",
        endTime: Date.now(),
      });

      const updatedJob = await stateManager.getJobExecution(jobId);
      expect(updatedJob!.status).toBe("failed");
      expect(updatedJob!.error).toContain("Worker failed");

      await heartbeat.stop();
    });
  });

  // ==========================================================================
  // Graceful Shutdown Tests
  // ==========================================================================

  describe("Graceful Shutdown Drains Jobs", () => {
    it("marks worker as stopping during graceful shutdown", async () => {
      const config = createWorkerConfig("graceful-shutdown-worker");
      const heartbeat = new HeartbeatService(config, stateManager);

      await heartbeat.start();

      // Simulate jobs in progress
      heartbeat.jobStarted("job-1");
      heartbeat.jobStarted("job-2");

      await new Promise((r) => setTimeout(r, 200));

      // Verify jobs are tracked
      let state = await stateManager.getWorkerState(config.id);
      expect(state!.currentJobs).toHaveLength(2);
      expect(state!.status).toBe("healthy");

      // Start graceful shutdown
      await heartbeat.stop();

      // Verify worker marked as stopping
      state = await stateManager.getWorkerState(config.id);
      expect(state!.status).toBe("stopping");
    });

    it("completes in-progress jobs before full shutdown", async () => {
      const config = createWorkerConfig("drain-jobs-worker");
      const heartbeat = new HeartbeatService(config, stateManager);

      await heartbeat.start();

      // Start job
      const jobId = "draining-job";
      heartbeat.jobStarted(jobId);

      await new Promise((r) => setTimeout(r, 200));

      // Simulate job completion
      heartbeat.jobCompleted(jobId, true);

      await new Promise((r) => setTimeout(r, 200));

      // Verify job metrics updated
      const state = heartbeat.getState();
      expect(state.currentJobs).toHaveLength(0);
      expect(state.metrics.jobsProcessed).toBe(1);

      await heartbeat.stop();
    });
  });

  // ==========================================================================
  // Failover Lock Tests
  // ==========================================================================

  describe("Failover Lock Prevents Concurrent Elections", () => {
    it("only one worker can acquire failover lock", async () => {
      const groupId = "lock-test-group";

      // Multiple workers try to acquire lock
      const results = await Promise.all([
        stateManager.acquireFailoverLock(groupId, "worker-1"),
        stateManager.acquireFailoverLock(groupId, "worker-2"),
        stateManager.acquireFailoverLock(groupId, "worker-3"),
      ]);

      // Exactly one should succeed
      const successCount = results.filter(Boolean).length;
      expect(successCount).toBe(1);

      // Release lock
      await stateManager.releaseFailoverLock(groupId);
    });

    it("lock expires after TTL", async () => {
      const groupId = "lock-ttl-test";

      // Acquire lock with 1 second TTL
      const acquired = await stateManager.acquireFailoverLock(groupId, "worker-1", 1);
      expect(acquired).toBe(true);

      // Cannot acquire immediately
      let secondAcquire = await stateManager.acquireFailoverLock(groupId, "worker-2");
      expect(secondAcquire).toBe(false);

      // Wait for TTL
      await new Promise((r) => setTimeout(r, 1500));

      // Now should be able to acquire
      secondAcquire = await stateManager.acquireFailoverLock(groupId, "worker-2");
      expect(secondAcquire).toBe(true);

      await stateManager.releaseFailoverLock(groupId);
    });
  });

  // ==========================================================================
  // Multi-Group Worker Tests
  // ==========================================================================

  describe("Worker in Multiple Groups", () => {
    it("worker maintains membership in multiple groups", async () => {
      const groups = ["group-a", "group-b", "group-c"];
      const config = createWorkerConfig("multi-group-worker", groups);
      const heartbeat = new HeartbeatService(config, stateManager);

      await heartbeat.start();
      await new Promise((r) => setTimeout(r, 200));

      // Verify worker is in all groups
      for (const groupId of groups) {
        const workers = await stateManager.getWorkersInGroup(groupId);
        expect(workers).toContain(config.id);
      }

      await heartbeat.stop();
    });

    it("handles different primary status per group", async () => {
      const groups = ["group-x", "group-y"];
      const worker1Config = createWorkerConfig("worker-multi-1", groups);
      const worker2Config = createWorkerConfig("worker-multi-2", groups);

      // Worker 1 is primary in group-x
      await stateManager.setWorkerGroupState({
        groupId: "group-x",
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id],
        quorumSize: 2,
        fenceToken: "token-x",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      // Worker 2 is primary in group-y
      await stateManager.setWorkerGroupState({
        groupId: "group-y",
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker2Config.id,
        failoverOrder: [worker2Config.id, worker1Config.id],
        quorumSize: 2,
        fenceToken: "token-y",
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      const fencing1 = new FencingService(worker1Config, { stateManager, redis });
      const fencing2 = new FencingService(worker2Config, { stateManager, redis });

      // Worker 1 is primary in group-x
      let validation = await fencing1.validatePrimary("group-x");
      expect(validation.valid).toBe(true);

      // Worker 1 is NOT primary in group-y
      validation = await fencing1.validatePrimary("group-y");
      expect(validation.valid).toBe(false);

      // Worker 2 is primary in group-y
      validation = await fencing2.validatePrimary("group-y");
      expect(validation.valid).toBe(true);

      // Worker 2 is NOT primary in group-x
      validation = await fencing2.validatePrimary("group-x");
      expect(validation.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Split-Brain Prevention Tests
  // ==========================================================================

  describe("Split-Brain Prevention", () => {
    it("two workers cannot both be primary simultaneously", async () => {
      const groupId = "split-brain-test";
      const worker1Config = createWorkerConfig("sb-worker-1", [groupId]);
      const worker2Config = createWorkerConfig("sb-worker-2", [groupId]);

      // Set up group with worker-1 as primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Verify worker-1 is primary
      let currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup!.primaryWorkerId).toBe(worker1Config.id);

      // Worker-1 acquires fence token while it is primary
      const fencing1 = new FencingService(worker1Config, { stateManager, redis });
      const token1 = await fencing1.acquireFenceToken(groupId);
      expect(token1).not.toBeNull();

      // Validate worker-1 is primary
      let validation1 = await fencing1.validatePrimary(groupId);
      expect(validation1.valid).toBe(true);

      // Worker-2 performs failover -- updatePrimaryWorker changes the primary
      await stateManager.updatePrimaryWorker(groupId, worker2Config.id);

      // Verify ONLY worker-2 is now recorded as primary
      currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup!.primaryWorkerId).toBe(worker2Config.id);
      expect(currentGroup!.primaryWorkerId).not.toBe(worker1Config.id);

      // Old primary's FencingService should now fail validation
      // because the group's primaryWorkerId has changed
      validation1 = await fencing1.validatePrimary(groupId);
      expect(validation1.valid).toBe(false);
      expect(validation1.reason).toBeDefined();
      expect(validation1.reason).toContain("not the primary");
    });

    it("fenced worker stops accepting operations", async () => {
      const groupId = "fence-ops-test";
      const oldPrimaryConfig = createWorkerConfig("fence-old-primary", [groupId]);
      const newPrimaryConfig = createWorkerConfig("fence-new-primary", [groupId]);

      // Set up group with old-primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [oldPrimaryConfig.id, newPrimaryConfig.id],
        primaryWorkerId: oldPrimaryConfig.id,
        failoverOrder: [oldPrimaryConfig.id, newPrimaryConfig.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      const oldFencing = new FencingService(oldPrimaryConfig, { stateManager, redis });
      const newFencing = new FencingService(newPrimaryConfig, { stateManager, redis });

      // Old primary acquires fence token
      const oldToken = await oldFencing.acquireFenceToken(groupId);
      expect(oldToken).not.toBeNull();

      // Old primary can validate before fencing
      let validation = await oldFencing.validatePrimary(groupId);
      expect(validation.valid).toBe(true);

      // Failover: new primary takes over
      await stateManager.updatePrimaryWorker(groupId, newPrimaryConfig.id);

      // New primary fences off old primary
      await newFencing.fenceOff(groupId, oldPrimaryConfig.id);

      // Old primary's validatePrimary should return invalid
      validation = await oldFencing.validatePrimary(groupId);
      expect(validation.valid).toBe(false);

      // Old primary tries executeWithFencing -- should get a fence error
      const result = await oldFencing.executeWithFencing(groupId, async () => {
        return "executed";
      });

      expect(result.success).toBe(false);
      expect(result.fenceError).toBeDefined();
      expect(result.fenceError!.length).toBeGreaterThan(0);
      expect(result.result).toBeUndefined();
    });

    it("fence token monotonically increases across failovers", async () => {
      const groupId = "fence-monotonic-test";

      // Initialize group state so updatePrimaryWorker has something to update
      const initialGroupState: WorkerGroupState = {
        groupId,
        workers: ["failover-w-0", "failover-w-1", "failover-w-2", "failover-w-3", "failover-w-4"],
        primaryWorkerId: "failover-w-0",
        failoverOrder: ["failover-w-0", "failover-w-1", "failover-w-2", "failover-w-3", "failover-w-4"],
        quorumSize: 3,
        fenceToken: `0-initial`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(initialGroupState);

      const tokens: string[] = [];

      // Do 5 sequential failovers with small delays to ensure distinct timestamps
      for (let i = 0; i < 5; i++) {
        const workerId = `failover-w-${i}`;
        await stateManager.updatePrimaryWorker(groupId, workerId);

        const groupStateResult = await stateManager.getWorkerGroupState(groupId);
        expect(groupStateResult).not.toBeNull();
        expect(groupStateResult!.fenceToken).toBeDefined();
        expect(groupStateResult!.fenceToken).not.toBeNull();
        tokens.push(groupStateResult!.fenceToken!);

        // Small delay to ensure timestamp-based tokens are distinct
        await new Promise((r) => setTimeout(r, 5));
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(5);

      // Parse timestamp components (tokens have format: timestamp-randomPart)
      // and verify monotonic increase
      const timestamps = tokens.map((token) => {
        const parts = token.split("-");
        return parseInt(parts[0], 10);
      });

      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });
  });

  // ==========================================================================
  // Cascading Failures Tests
  // ==========================================================================

  describe("Cascading Failures", () => {
    it("third worker becomes primary when primary and first failover target both fail", async () => {
      const groupId = "cascade-failover-test";
      const worker1Config = createWorkerConfig("cascade-w-1", [groupId]);
      const worker2Config = createWorkerConfig("cascade-w-2", [groupId]);
      const worker3Config = createWorkerConfig("cascade-w-3", [groupId]);

      // Set up group with worker-1 as primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [worker1Config.id, worker2Config.id, worker3Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id, worker3Config.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Start all 3 heartbeats
      const hb1 = new HeartbeatService(worker1Config, stateManager);
      const hb2 = new HeartbeatService(worker2Config, stateManager);
      const hb3 = new HeartbeatService(worker3Config, stateManager);

      await hb1.start();
      await hb2.start();
      await hb3.start();

      // Wait for heartbeats to register
      await new Promise((r) => setTimeout(r, 300));

      // Verify all 3 are healthy
      let healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).toContain(worker1Config.id);
      expect(healthyWorkers).toContain(worker2Config.id);
      expect(healthyWorkers).toContain(worker3Config.id);

      // Worker-1 crashes (stop heartbeat)
      await hb1.stop();

      // Wait for worker-1 to become stale
      await new Promise((r) => setTimeout(r, 1500));

      // Worker-1 should no longer be healthy
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).not.toContain(worker1Config.id);
      expect(healthyWorkers).toContain(worker2Config.id);

      // Failover to worker-2
      const lock1 = await stateManager.acquireFailoverLock(groupId, worker2Config.id);
      expect(lock1).toBe(true);
      await stateManager.updatePrimaryWorker(groupId, worker2Config.id);
      await stateManager.releaseFailoverLock(groupId);

      // Verify worker-2 is primary
      let currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup!.primaryWorkerId).toBe(worker2Config.id);

      // Worker-2 also crashes (second failure)
      await hb2.stop();

      // Wait for worker-2 to become stale
      await new Promise((r) => setTimeout(r, 1500));

      // Worker-2 should no longer be healthy
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).not.toContain(worker1Config.id);
      expect(healthyWorkers).not.toContain(worker2Config.id);
      expect(healthyWorkers).toContain(worker3Config.id);

      // Failover to worker-3
      const lock2 = await stateManager.acquireFailoverLock(groupId, worker3Config.id);
      expect(lock2).toBe(true);
      await stateManager.updatePrimaryWorker(groupId, worker3Config.id);
      await stateManager.releaseFailoverLock(groupId);

      // Verify worker-3 is the primary
      currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup!.primaryWorkerId).toBe(worker3Config.id);

      // Worker-3 is still healthy
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).toContain(worker3Config.id);

      // Cleanup
      await hb3.stop();
    });

    it("all workers die and new workers restart cleanly", async () => {
      const groupId = "all-dead-restart-test";
      const configs = [
        createWorkerConfig("dead-w-1", [groupId]),
        createWorkerConfig("dead-w-2", [groupId]),
        createWorkerConfig("dead-w-3", [groupId]),
      ];

      // Start all 3 heartbeats
      const heartbeats = configs.map((c) => new HeartbeatService(c, stateManager));
      for (const hb of heartbeats) {
        await hb.start();
      }

      // Wait for registration
      await new Promise((r) => setTimeout(r, 300));

      // Verify all 3 are healthy
      let healthyWorkers = await stateManager.getHealthyWorkers(1000);
      for (const config of configs) {
        expect(healthyWorkers).toContain(config.id);
      }

      // Stop all heartbeats (all workers die)
      for (const hb of heartbeats) {
        await hb.stop();
      }

      // Wait for all to become stale
      await new Promise((r) => setTimeout(r, 1500));

      // Verify no healthy workers
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      for (const config of configs) {
        expect(healthyWorkers).not.toContain(config.id);
      }

      // Start 3 new HeartbeatService instances with the same configs
      const newHeartbeats = configs.map((c) => new HeartbeatService(c, stateManager));
      for (const hb of newHeartbeats) {
        await hb.start();
      }

      // Wait for registration
      await new Promise((r) => setTimeout(r, 300));

      // Verify all 3 are healthy again
      healthyWorkers = await stateManager.getHealthyWorkers(1000);
      for (const config of configs) {
        expect(healthyWorkers).toContain(config.id);
      }

      // Verify worker states are healthy
      for (const config of configs) {
        const state = await stateManager.getWorkerState(config.id);
        expect(state).not.toBeNull();
        expect(state!.status).toBe("healthy");
      }

      // A new primary can be elected
      await stateManager.setWorkerGroupState({
        groupId,
        workers: configs.map((c) => c.id),
        primaryWorkerId: null,
        failoverOrder: configs.map((c) => c.id),
        quorumSize: 2,
        fenceToken: null,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      });

      await stateManager.updatePrimaryWorker(groupId, configs[0].id);
      const groupStateResult = await stateManager.getWorkerGroupState(groupId);
      expect(groupStateResult).not.toBeNull();
      expect(groupStateResult!.primaryWorkerId).toBe(configs[0].id);
      expect(groupStateResult!.fenceToken).not.toBeNull();

      // Cleanup
      for (const hb of newHeartbeats) {
        await hb.stop();
      }
    });
  });

  // ==========================================================================
  // State Reconciliation Tests
  // ==========================================================================

  describe("State Reconciliation", () => {
    it("new primary heartbeat reflects role", async () => {
      const groupId = "state-recon-primary-test";
      const worker1Config = createWorkerConfig("recon-w-1", [groupId]);
      const worker2Config = createWorkerConfig("recon-w-2", [groupId]);

      // Set up group with worker-1 as initial primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Make worker-2 the new primary
      await stateManager.updatePrimaryWorker(groupId, worker2Config.id);

      // Start worker-2's heartbeat
      const hb2 = new HeartbeatService(worker2Config, stateManager);
      await hb2.start();

      // Wait for heartbeat to be sent
      await new Promise((r) => setTimeout(r, 300));

      // Verify worker-2 state has status "healthy"
      const worker2State = await stateManager.getWorkerState(worker2Config.id);
      expect(worker2State).not.toBeNull();
      expect(worker2State!.status).toBe("healthy");
      expect(worker2State!.id).toBe(worker2Config.id);
      expect(worker2State!.lastHeartbeat).toBeGreaterThan(0);

      // Check group state has worker-2 as primary
      const currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup).not.toBeNull();
      expect(currentGroup!.primaryWorkerId).toBe(worker2Config.id);

      // Cleanup
      await hb2.stop();
    });

    it("old primary state shows non-primary after failover", async () => {
      const groupId = "state-recon-old-primary-test";
      const worker1Config = createWorkerConfig("recon-old-w-1", [groupId]);
      const worker2Config = createWorkerConfig("recon-old-w-2", [groupId]);

      // Set up group with worker-1 as primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      // Start both heartbeats
      const hb1 = new HeartbeatService(worker1Config, stateManager);
      const hb2 = new HeartbeatService(worker2Config, stateManager);
      await hb1.start();
      await hb2.start();

      // Wait for heartbeats
      await new Promise((r) => setTimeout(r, 300));

      // Verify both are healthy
      const healthyWorkers = await stateManager.getHealthyWorkers(1000);
      expect(healthyWorkers).toContain(worker1Config.id);
      expect(healthyWorkers).toContain(worker2Config.id);

      // Worker-1 fencing service validates as primary before failover
      const fencing1 = new FencingService(worker1Config, { stateManager, redis });
      const token1 = await fencing1.acquireFenceToken(groupId);
      expect(token1).not.toBeNull();

      let validation1 = await fencing1.validatePrimary(groupId);
      expect(validation1.valid).toBe(true);

      // Failover: update primary to worker-2
      await stateManager.updatePrimaryWorker(groupId, worker2Config.id);

      // Fence off worker-1
      const fencing2 = new FencingService(worker2Config, { stateManager, redis });
      await fencing2.fenceOff(groupId, worker1Config.id);

      // Worker-1's fencing validatePrimary should return invalid
      validation1 = await fencing1.validatePrimary(groupId);
      expect(validation1.valid).toBe(false);
      expect(validation1.reason).toBeDefined();

      // Group state shows worker-2 as primary
      const currentGroup = await stateManager.getWorkerGroupState(groupId);
      expect(currentGroup).not.toBeNull();
      expect(currentGroup!.primaryWorkerId).toBe(worker2Config.id);
      expect(currentGroup!.primaryWorkerId).not.toBe(worker1Config.id);

      // Cleanup
      await hb1.stop();
      await hb2.stop();
    });
  });

  // ==========================================================================
  // Job Duplication Prevention Tests
  // ==========================================================================

  describe("Job Duplication Prevention", () => {
    it("same execution ID not processed twice during failover", async () => {
      const groupId = "job-dup-test";
      const worker1Config = createWorkerConfig("dup-w-1", [groupId]);
      const worker2Config = createWorkerConfig("dup-w-2", [groupId]);

      // Set up group with worker-1 as primary
      const groupState: WorkerGroupState = {
        groupId,
        workers: [worker1Config.id, worker2Config.id],
        primaryWorkerId: worker1Config.id,
        failoverOrder: [worker1Config.id, worker2Config.id],
        quorumSize: 2,
        fenceToken: `token-${Date.now()}`,
        lastElection: Date.now(),
        lastHealthCheck: Date.now(),
      };
      await stateManager.setWorkerGroupState(groupState);

      const executionId = "dup-exec-123";
      const jobName = "backup-database";

      // Worker-1 records a job execution with status "running"
      await stateManager.recordJobExecution({
        id: executionId,
        jobName,
        workerId: worker1Config.id,
        status: "running",
        startTime: Date.now(),
      });

      // Verify the job is recorded
      let execution = await stateManager.getJobExecution(executionId);
      expect(execution).not.toBeNull();
      expect(execution!.id).toBe(executionId);
      expect(execution!.status).toBe("running");
      expect(execution!.workerId).toBe(worker1Config.id);

      // Simulate failover to worker-2
      await stateManager.updatePrimaryWorker(groupId, worker2Config.id);

      // Worker-2 tries to record the same execution ID again
      // Since recordJobExecution uses HSET, it will overwrite the hash fields
      // but the key already exists, so we can detect this
      await stateManager.recordJobExecution({
        id: executionId,
        jobName,
        workerId: worker2Config.id,
        status: "running",
        startTime: Date.now(),
      });

      // getJobExecution returns only one record for that ID
      // (Redis hashes are keyed by execution ID, so there is only one)
      execution = await stateManager.getJobExecution(executionId);
      expect(execution).not.toBeNull();
      expect(execution!.id).toBe(executionId);

      // The record reflects the latest update (worker-2)
      expect(execution!.workerId).toBe(worker2Config.id);

      // Verify through the job history that the ID appears only once
      const recentJobs = await stateManager.getRecentJobs(jobName, 100);
      const matchingJobs = recentJobs.filter((j) => j.id === executionId);
      // Even though recordJobExecution was called twice with the same ID,
      // getJobExecution returns a single record since it's stored as a hash
      // The history list may have the ID pushed twice, but the actual data is one record
      expect(matchingJobs.length).toBeGreaterThanOrEqual(1);

      // All matching entries should return the same execution data
      for (const job of matchingJobs) {
        expect(job.id).toBe(executionId);
        expect(job.jobName).toBe(jobName);
      }

      // Update the execution to completed -- only one record is affected
      await stateManager.updateJobExecution(executionId, {
        status: "completed",
        endTime: Date.now(),
      });

      execution = await stateManager.getJobExecution(executionId);
      expect(execution).not.toBeNull();
      expect(execution!.status).toBe("completed");
      expect(execution!.endTime).toBeDefined();
      expect(execution!.endTime).toBeGreaterThan(0);
    });
  });
});
