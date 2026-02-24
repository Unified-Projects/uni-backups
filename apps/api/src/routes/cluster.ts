import { Hono } from "hono";
import { getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import { getQueueStats, getScheduledJobs, getRunningJobs } from "../services/scheduler";

const cluster = new Hono();

function getStateManager(): StateManager {
  return new StateManager(getRedisConnection());
}

cluster.get("/status", async (c) => {
  const sm = getStateManager();

  const allWorkers = await sm.getAllWorkers();
  const healthyWorkers = await sm.getHealthyWorkers();

  const queueStats = await getQueueStats();

  const scheduledJobs = await getScheduledJobs();

  const runningJobs = await getRunningJobs();

  let status: "healthy" | "degraded" | "unhealthy";
  if (healthyWorkers.length === 0) {
    status = "unhealthy";
  } else if (healthyWorkers.length < allWorkers.length) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    workers: {
      total: allWorkers.length,
      healthy: healthyWorkers.length,
      unhealthy: allWorkers.length - healthyWorkers.length,
    },
    queues: {
      backup: {
        waiting: queueStats.waiting,
        active: queueStats.active,
        completed: queueStats.completed,
        failed: queueStats.failed,
        delayed: queueStats.delayed,
      },
    },
    jobs: {
      scheduled: scheduledJobs.length,
      running: runningJobs.length,
    },
  });
});

cluster.get("/metrics", async (c) => {
  const sm = getStateManager();

  const allWorkers = await sm.getAllWorkers();
  const healthyWorkerIds = new Set(await sm.getHealthyWorkers());

  const aggregatedMetrics = {
    totalJobsProcessed: 0,
    totalJobsFailed: 0,
    activeJobs: 0,
  };

  for (const worker of allWorkers) {
    aggregatedMetrics.totalJobsProcessed += worker.metrics.jobsProcessed || 0;
    aggregatedMetrics.totalJobsFailed += worker.metrics.jobsFailed || 0;
    aggregatedMetrics.activeJobs += worker.currentJobs.length;
  }

  const queueStats = await getQueueStats();

  const recentJobs = await sm.getRecentJobs(undefined, 20);

  // Compute effective status per worker (same logic as workers list endpoint)
  const workersWithEffectiveStatus = allWorkers.map((w) => ({
    ...w,
    effectiveStatus: healthyWorkerIds.has(w.id) ? w.status : "offline",
  }));

  return c.json({
    timestamp: new Date().toISOString(),
    totalWorkers: allWorkers.length,
    workers: {
      total: allWorkers.length,
      healthy: healthyWorkerIds.size,
      byStatus: {
        healthy: allWorkers.filter((w) => healthyWorkerIds.has(w.id) && w.status === "healthy").length,
        starting: allWorkers.filter((w) => w.status === "starting").length,
        degraded: allWorkers.filter((w) => w.status === "degraded").length,
        stopping: allWorkers.filter((w) => w.status === "stopping").length,
        offline: allWorkers.filter((w) => w.status === "offline").length,
      },
      details: workersWithEffectiveStatus.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.effectiveStatus,
        isHealthy: healthyWorkerIds.has(w.id),
        currentJobs: w.currentJobs.length,
        jobsProcessed: w.metrics.jobsProcessed,
        jobsFailed: w.metrics.jobsFailed,
      })),
    },
    queues: {
      backup: queueStats,
    },
    jobs: {
      aggregated: aggregatedMetrics,
      recent: recentJobs.map((j) => ({
        id: j.id,
        jobName: j.jobName,
        workerId: j.workerId,
        status: j.status,
        startTime: new Date(j.startTime),
        endTime: j.endTime ? new Date(j.endTime) : null,
        duration: j.duration,
      })),
    },
  });
});

cluster.get("/health", async (c) => {
  const sm = getStateManager();
  const healthyWorkers = await sm.getHealthyWorkers();

  if (healthyWorkers.length === 0) {
    return c.json(
      {
        status: "unhealthy",
        message: "No healthy workers available",
      },
      503
    );
  }

  return c.json({
    status: "healthy",
    workers: healthyWorkers.length,
  });
});

cluster.get("/ready", async (c) => {
  try {
    const redis = getRedisConnection();
    await redis.ping();

    return c.json({ ready: true });
  } catch (error) {
    return c.json(
      {
        ready: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      503
    );
  }
});

cluster.get("/groups", async (c) => {
  const sm = getStateManager();
  const allGroups = await sm.getAllWorkerGroups();
  const healthyWorkerIds = new Set(await sm.getHealthyWorkers());

  const groupHealth = await Promise.all(
    allGroups.map(async (group) => {
      const workersInGroup = await sm.getWorkersInGroup(group.groupId);
      const healthyInGroup = workersInGroup.filter((w) => healthyWorkerIds.has(w));
      const hasQuorum = healthyInGroup.length >= group.quorumSize;
      const primaryHealthy = group.primaryWorkerId
        ? healthyWorkerIds.has(group.primaryWorkerId)
        : false;

      let status: "healthy" | "degraded" | "critical";
      if (!hasQuorum) {
        status = "critical";
      } else if (!primaryHealthy) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      return {
        id: group.groupId,
        status,
        hasQuorum,
        primaryWorkerId: group.primaryWorkerId,
        primaryHealthy,
        workers: {
          total: workersInGroup.length,
          healthy: healthyInGroup.length,
          quorumRequired: group.quorumSize,
        },
        lastElection: group.lastElection ? new Date(group.lastElection) : null,
      };
    })
  );

  return c.json({ groups: groupHealth });
});

export default cluster;
