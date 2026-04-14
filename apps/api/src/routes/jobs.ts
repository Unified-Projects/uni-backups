import { Hono } from "hono";
import { getAllJobs, getJob, getStorage, getConfig, addJob, updateJob, removeJob, isConfigDirty, saveConfig } from "@uni-backups/shared/config";
import { JobConfigSchema } from "@uni-backups/shared/config";
import {
  queueJob,
  getRecentRuns,
  isJobActive,
  getRunningJobs,
  getQueueStats,
  syncSchedules,
  initScheduler,
} from "../services/scheduler";
import * as restic from "../services/restic";
import { isTestEnvironment } from "../runtime";

const jobs = new Hono();

jobs.get("/", async (c) => {
  const limitParam = c.req.query("limit");
  if (limitParam !== undefined) {
    const limitNum = Number(limitParam);
    if (!Number.isInteger(limitNum) || limitNum < 1 || isNaN(limitNum) || limitParam.trim() === "") {
      return c.json({ error: "Invalid 'limit' parameter: must be a positive integer" }, 400);
    }
  }

  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = parseInt(c.req.query("pageSize") || "20", 10);
  const sortBy = c.req.query("sortBy") || "name";
  const sortOrder = c.req.query("sortOrder") || "asc";

  const allJobs = getAllJobs();
  const running = await getRunningJobs();
  const runningNames = new Set(running.map((r) => r.jobName));

  const jobsWithStatus = await Promise.all(
    allJobs.map(async ({ name, config }) => {
      const recentRuns = await getRecentRuns(name, 1);
      const lastRun = recentRuns[0];

      return {
        name,
        type: config.type,
        storage: config.storage,
        repo: config.repo || name,
        schedule: config.schedule || null,
        retention: config.retention,
        workerGroup: config.worker_group,
        isRunning: runningNames.has(name),
        lastRun: lastRun
          ? {
              id: lastRun.id,
              startTime: new Date(lastRun.startTime),
              endTime: lastRun.endTime ? new Date(lastRun.endTime) : undefined,
              status: lastRun.status,
              duration: lastRun.duration,
              snapshotId: lastRun.snapshotId,
              workerId: lastRun.workerId,
            }
          : null,
        // Type-specific info
        ...(config.type === "volume" || config.type === "folder"
          ? { source: config.source }
          : {}),
        ...(config.type === "postgres"
          ? { database: config.database, host: config.host }
          : {}),
        ...(config.type === "mariadb"
          ? { database: config.database, host: config.host }
          : {}),
        ...(config.type === "redis" ? { host: config.host } : {}),
      };
    })
  );

  const sortedJobs = [...jobsWithStatus].sort((a, b) => {
    let aVal: string | number | Date | null;
    let bVal: string | number | Date | null;

    switch (sortBy) {
      case "type":
        aVal = a.type;
        bVal = b.type;
        break;
      case "storage":
        aVal = a.storage;
        bVal = b.storage;
        break;
      case "lastRun":
        aVal = a.lastRun?.startTime ? new Date(a.lastRun.startTime).getTime() : 0;
        bVal = b.lastRun?.startTime ? new Date(b.lastRun.startTime).getTime() : 0;
        break;
      case "status":
        // Sort order: running > completed > failed > never run
        const statusOrder = (job: typeof a) => {
          if (job.isRunning) return 3;
          if (!job.lastRun) return 0;
          return job.lastRun.status === "completed" || job.lastRun.status === "success" ? 2 : 1;
        };
        aVal = statusOrder(a);
        bVal = statusOrder(b);
        break;
      default:
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
    }

    if (aVal === bVal) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    const comparison = aVal < bVal ? -1 : 1;
    return sortOrder === "desc" ? -comparison : comparison;
  });

  const total = sortedJobs.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paginatedJobs = sortedJobs.slice(start, start + pageSize);

  return c.json({
    jobs: paginatedJobs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  });
});

jobs.get("/:name", async (c) => {
  const name = c.req.param("name");
  const jobConfig = getJob(name);

  if (!jobConfig) {
    return c.json({ error: `Job "${sanitizeName(name)}" not found` }, 404);
  }

  const recentRuns = await getRecentRuns(name, 10);
  const isActive = await isJobActive(name);

  const mappedRuns = recentRuns.map((r) => ({
    id: r.id,
    startTime: new Date(r.startTime),
    endTime: r.endTime ? new Date(r.endTime) : undefined,
    status: r.status,
    duration: r.duration,
    snapshotId: r.snapshotId,
    error: r.error,
    workerId: r.workerId,
  }));

  return c.json({
    name,
    config: {
      type: jobConfig.type,
      storage: jobConfig.storage,
      repo: jobConfig.repo || name,
      schedule: jobConfig.schedule,
      retention: jobConfig.retention,
      tags: jobConfig.tags,
      exclude: jobConfig.exclude,
      workerGroup: jobConfig.worker_group,
      priority: jobConfig.priority,
      timeout: jobConfig.timeout,
      ...(jobConfig.type === "volume" || jobConfig.type === "folder"
        ? { source: jobConfig.source }
        : {}),
      ...(jobConfig.type === "postgres"
        ? {
            host: jobConfig.host,
            port: jobConfig.port,
            database: jobConfig.database,
            user: jobConfig.user,
            all_databases: jobConfig.all_databases,
          }
        : {}),
      ...(jobConfig.type === "mariadb"
        ? {
            host: jobConfig.host,
            port: jobConfig.port,
            database: jobConfig.database,
            user: jobConfig.user,
            all_databases: jobConfig.all_databases,
          }
        : {}),
      ...(jobConfig.type === "redis"
        ? {
            host: jobConfig.host,
            port: jobConfig.port,
          }
        : {}),
    },
    isActive,
    isRunning: isActive,
    recentRuns: mappedRuns,
    lastRun: mappedRuns[0] ?? null,
  });
});

function sanitizeName(name: string): string {
  return name.replace(/[<>"'&]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      case "&": return "&amp;";
      default: return c;
    }
  });
}

function logJobsRouteError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const prefix = `[Jobs API] ${operation} failed`;

  if (context) {
    console.error(prefix, context);
  } else {
    console.error(prefix);
  }

  console.error(error);

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}

function buildJobsErrorPayload(message: string, error: unknown): Record<string, unknown> {
  if (!isTestEnvironment()) {
    return { error: message };
  }

  if (error instanceof Error) {
    return {
      error: message,
      details: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause instanceof Error ? error.cause.message : error.cause,
      },
    };
  }

  return {
    error: message,
    details: {
      raw: String(error),
    },
  };
}

function isSchedulerNotInitializedError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("Scheduler not initialized");
  }

  return false;
}

async function syncSchedulesWithRecovery(): Promise<void> {
  try {
    await syncSchedules();
  } catch (error) {
    if (!isSchedulerNotInitializedError(error)) {
      throw error;
    }

    await initScheduler();
    await syncSchedules();
  }
}

async function queueJobWithRecovery(
  name: string,
  triggeredBy: Parameters<typeof queueJob>[1]
): ReturnType<typeof queueJob> {
  let result = await queueJob(name, triggeredBy);

  if (result.queued || !result.message.includes("Scheduler not initialized")) {
    return result;
  }

  await initScheduler();
  result = await queueJob(name, triggeredBy);
  return result;
}

jobs.post("/:name/run", async (c) => {
  const name = c.req.param("name");
  const jobConfig = getJob(name);

  if (!jobConfig) {
    return c.json({ error: `Job "${sanitizeName(name)}" not found` }, 404);
  }

  const isActive = await isJobActive(name);
  if (isActive) {
    return c.json({ error: `Job "${name}" is already queued or running`, status: "already_running", name }, 409);
  }

  try {
    const result = await queueJobWithRecovery(name, "manual");

    if (!result.queued) {
      const error = new Error(result.message);
      logJobsRouteError("queue job", error, { jobName: name, triggeredBy: "manual" });
      return c.json(buildJobsErrorPayload(result.message, error), 500);
    }

    return c.json({
      name,
      executionId: result.executionId,
      status: "queued",
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to queue job "${name}"`;
    logJobsRouteError("queue job", error, { jobName: name, triggeredBy: "manual" });
    return c.json(buildJobsErrorPayload(message, error), 500);
  }
});

jobs.get("/:name/history", async (c) => {
  const name = c.req.param("name");
  const jobConfig = getJob(name);

  if (!jobConfig) {
    return c.json({ error: `Job "${sanitizeName(name)}" not found` }, 404);
  }

  const storage = getStorage(jobConfig.storage);
  if (!storage) {
    return c.json({ error: `Storage "${jobConfig.storage}" not found` }, 500);
  }

  const repoName = jobConfig.repo || name;
  const resticPassword = getConfig().resticPassword;

  const result = await restic.listSnapshots(storage, repoName, resticPassword, {
    tags: [name],
  });

  if (!result.success) {
    return c.json({ error: result.message }, 500);
  }

  return c.json({
    name,
    repo: repoName,
    storage: jobConfig.storage,
    snapshots:
      result.snapshots?.map((s) => ({
        id: s.id,
        short_id: s.short_id,
        time: s.time,
        hostname: s.hostname,
        paths: s.paths,
        tags: s.tags,
      })) || [],
  });
});

jobs.get("/queue/stats", async (c) => {
  const stats = await getQueueStats();
  return c.json(stats);
});

function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

jobs.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { name, ...jobFields } = body as { name?: string } & Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    return c.json({ error: "Job name is required", field: "name" }, 400);
  }

  if (!jobFields.type) {
    return c.json({ error: "Job type is required", field: "type" }, 400);
  }

  if (!jobFields.storage || typeof jobFields.storage !== "string") {
    return c.json({ error: "Storage is required", field: "storage" }, 400);
  }

  const storage = getStorage(jobFields.storage as string);
  if (!storage) {
    return c.json({ error: `Storage "${jobFields.storage}" not found`, field: "storage" }, 400);
  }

  if (jobFields.schedule && typeof jobFields.schedule === "string" && !isValidCron(jobFields.schedule)) {
    return c.json({ error: "Invalid cron expression", field: "schedule" }, 400);
  }

  const parsed = JobConfigSchema.safeParse(jobFields);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return c.json({ error: firstError.message, field: firstError.path.join(".") }, 400);
  }

  const trimmedName = name.trim();
  const existingJob = getJob(trimmedName);

  if (existingJob) {
    updateJob(trimmedName, parsed.data);
    try {
      await syncSchedulesWithRecovery();
    } catch (error) {
      updateJob(trimmedName, existingJob);
      const message = error instanceof Error ? error.message : "Failed to sync schedules";
      logJobsRouteError("update job via POST", error, { jobName: trimmedName });
      return c.json(buildJobsErrorPayload(message, error), 500);
    }

    return c.json({ name: trimmedName, status: "updated", message: `Job "${trimmedName}" updated successfully` }, 200);
  }

  addJob(trimmedName, parsed.data);
  try {
    await syncSchedulesWithRecovery();
  } catch (error) {
    removeJob(trimmedName);
    const message = error instanceof Error ? error.message : "Failed to sync schedules";
    logJobsRouteError("create job", error, { jobName: trimmedName });
    return c.json(buildJobsErrorPayload(message, error), 500);
  }

  return c.json({ name: trimmedName, status: "created", message: `Job "${trimmedName}" created successfully` }, 201);
});

jobs.put("/:name", async (c) => {
  const name = c.req.param("name");
  const existing = getJob(name);

  if (!existing) {
    return c.json({ error: `Job "${sanitizeName(name)}" not found` }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (body.storage && typeof body.storage === "string") {
    const storageConfig = getStorage(body.storage);
    if (!storageConfig) {
      return c.json({ error: `Storage "${body.storage}" not found`, field: "storage" }, 400);
    }
  }

  if (body.schedule && typeof body.schedule === "string" && !isValidCron(body.schedule)) {
    return c.json({ error: "Invalid cron expression", field: "schedule" }, 400);
  }

  const merged = { ...existing, ...body };
  const parsed = JobConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return c.json({ error: firstError.message, field: firstError.path.join(".") }, 400);
  }

  updateJob(name, parsed.data);
  try {
    await syncSchedulesWithRecovery();
  } catch (error) {
    updateJob(name, existing);
    const message = error instanceof Error ? error.message : "Failed to sync schedules";
    logJobsRouteError("update job", error, { jobName: name });
    return c.json(buildJobsErrorPayload(message, error), 500);
  }

  return c.json({ name, status: "updated", message: `Job "${name}" updated successfully` });
});

jobs.delete("/:name", async (c) => {
  const name = c.req.param("name");
  const existing = getJob(name);

  if (!existing) {
    return c.json({ error: `Job "${sanitizeName(name)}" not found` }, 404);
  }

  const isActive = await isJobActive(name);
  if (isActive) {
    return c.json({ error: `Cannot delete running job "${sanitizeName(name)}"` }, 409);
  }

  removeJob(name);
  try {
    await syncSchedulesWithRecovery();
  } catch (error) {
    updateJob(name, existing);
    const message = error instanceof Error ? error.message : "Failed to sync schedules";
    logJobsRouteError("delete job", error, { jobName: name });
    return c.json(buildJobsErrorPayload(message, error), 500);
  }

  return c.json({ name, status: "deleted", message: `Job "${name}" deleted successfully` });
});

jobs.get("/config/dirty", (c) => {
  return c.json({ dirty: isConfigDirty() });
});

jobs.post("/config/save", async (c) => {
  try {
    saveConfig();
    return c.json({ success: true, message: "Config saved successfully" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save config";
    logJobsRouteError("save config", err);
    return c.json(buildJobsErrorPayload(msg, err), 500);
  }
});

export default jobs;
