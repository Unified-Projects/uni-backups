import { Hono } from "hono";
import { getRedisConnection } from "@uni-backups/shared/redis";
import { StateManager } from "@uni-backups/shared/redis";
import { getAllWorkerGroups } from "@uni-backups/shared/config";
import type { WorkerState, WorkerGroupState } from "@uni-backups/queue";

const workers = new Hono();

function getStateManager(): StateManager {
  return new StateManager(getRedisConnection());
}

workers.get("/", async (c) => {
  const sm = getStateManager();
  const allWorkers = await sm.getAllWorkers();

  const healthyWorkerIds = new Set(await sm.getHealthyWorkers());

  return c.json({
    workers: allWorkers.map((worker) => {
      const isHealthy = healthyWorkerIds.has(worker.id);
      return {
        id: worker.id,
        name: worker.name,
        hostname: worker.hostname,
        groups: worker.groups,
        status: isHealthy ? worker.status : "offline",
        isHealthy,
        lastHeartbeat: worker.lastHeartbeat,
        currentJobs: worker.currentJobs,
        metrics: worker.metrics,
      };
    }),
  });
});

// List worker groups (must be before /:id to prevent matching "groups" as an id)
workers.get("/groups", async (c) => {
  const sm = getStateManager();

  const configGroups = getAllWorkerGroups();

  const groups = await Promise.all(
    configGroups.map(async ({ name, config }) => {
      const state = await sm.getWorkerGroupState(name);
      const workersInGroup = await sm.getWorkersInGroup(name);
      const healthyWorkers = new Set(await sm.getHealthyWorkers());

      return {
        groupId: name,
        id: name,
        workers: workersInGroup,
        primaryWorkerId: state?.primaryWorkerId || null,
        quorumSize: config.quorum_size || 1,
        config: {
          workers: config.workers,
          primary: config.primary,
          failoverOrder: config.failover_order,
          quorumSize: config.quorum_size,
        },
        state: state
          ? {
              primaryWorkerId: state.primaryWorkerId,
              fenceToken: state.fenceToken,
              lastElection: state.lastElection ? new Date(state.lastElection) : null,
              lastHealthCheck: state.lastHealthCheck
                ? new Date(state.lastHealthCheck)
                : null,
            }
          : null,
        activeWorkers: workersInGroup.filter((w) => healthyWorkers.has(w)),
        totalWorkers: workersInGroup.length,
      };
    })
  );

  return c.json({ groups });
});

// Get a specific worker group (must be before /:id)
workers.get("/groups/:groupId", async (c) => {
  const groupId = c.req.param("groupId");
  const sm = getStateManager();

  const state = await sm.getWorkerGroupState(groupId);
  const workersInGroup = await sm.getWorkersInGroup(groupId);
  const healthyWorkers = new Set(await sm.getHealthyWorkers());

  const workerDetails = await Promise.all(
    workersInGroup.map(async (workerId) => {
      const worker = await sm.getWorkerState(workerId);
      if (!worker) return null;
      const isHealthy = healthyWorkers.has(worker.id);
      return {
        id: worker.id,
        name: worker.name,
        status: isHealthy ? worker.status : "offline",
        isHealthy,
        lastHeartbeat: worker.lastHeartbeat,
      };
    })
  );

  return c.json({
    id: groupId,
    state: state
      ? {
          primaryWorkerId: state.primaryWorkerId,
          failoverOrder: state.failoverOrder,
          quorumSize: state.quorumSize,
          fenceToken: state.fenceToken,
          lastElection: state.lastElection ? new Date(state.lastElection) : null,
          lastHealthCheck: state.lastHealthCheck
            ? new Date(state.lastHealthCheck)
            : null,
        }
      : null,
    workers: workerDetails.filter(Boolean),
    healthyCount: workersInGroup.filter((w) => healthyWorkers.has(w)).length,
    totalCount: workersInGroup.length,
  });
});

workers.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sm = getStateManager();
  const worker = await sm.getWorkerState(id);

  if (!worker) {
    return c.json({ error: `Worker "${id}" not found` }, 404);
  }

  const healthyWorkerIds = new Set(await sm.getHealthyWorkers());

  const isHealthy = healthyWorkerIds.has(worker.id);
  return c.json({
    id: worker.id,
    name: worker.name,
    hostname: worker.hostname,
    groups: worker.groups,
    status: isHealthy ? worker.status : "offline",
    isHealthy,
    lastHeartbeat: new Date(worker.lastHeartbeat),
    currentJobs: worker.currentJobs,
    metrics: worker.metrics,
  });
});

workers.post("/groups/:groupId/failover", async (c) => {
  const groupId = c.req.param("groupId");
  const sm = getStateManager();

  const state = await sm.getWorkerGroupState(groupId);
  if (!state) {
    return c.json({ error: `Worker group "${groupId}" not found` }, 404);
  }

  // Parse body AFTER existence check so missing/invalid body doesn't cause 500 before 404
  let body: { newPrimaryId?: string } = {};
  try {
    body = await c.req.json<{ newPrimaryId?: string }>();
  } catch {
    // Empty or invalid body is fine - use defaults
  }

  const healthyWorkers = new Set(await sm.getHealthyWorkers());
  const workersInGroup = await sm.getWorkersInGroup(groupId);
  const eligibleWorkers = workersInGroup.filter((w) => healthyWorkers.has(w));

  if (eligibleWorkers.length === 0) {
    return c.json({ error: "No healthy workers available for failover" }, 503);
  }

  let newPrimaryId = body.newPrimaryId;

  if (!newPrimaryId) {
    // Use failover order if available, otherwise pick first healthy worker
    if (state.failoverOrder.length > 0) {
      newPrimaryId = state.failoverOrder.find((w) => healthyWorkers.has(w));
    }
    if (!newPrimaryId) {
      newPrimaryId = eligibleWorkers[0];
    }
  }

  if (!healthyWorkers.has(newPrimaryId)) {
    return c.json({ error: `Worker "${newPrimaryId}" is not healthy` }, 400);
  }

  const lockAcquired = await sm.acquireFailoverLock(groupId, "api-manual");
  if (!lockAcquired) {
    return c.json({ error: "Failover already in progress" }, 409);
  }

  try {
    await sm.updatePrimaryWorker(groupId, newPrimaryId);
    await sm.clearVotes(groupId);

    return c.json({
      success: true,
      groupId,
      previousPrimary: state.primaryWorkerId,
      newPrimary: newPrimaryId,
      message: `Failover completed. New primary: ${newPrimaryId}`,
    });
  } finally {
    await sm.releaseFailoverLock(groupId);
  }
});

workers.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const sm = getStateManager();

  const worker = await sm.getWorkerState(id);
  if (!worker) {
    return c.json({ error: `Worker "${id}" not found` }, 404);
  }

  await sm.removeWorker(id);

  return c.json({
    success: true,
    message: `Worker "${id}" removed from registry`,
  });
});

export default workers;
