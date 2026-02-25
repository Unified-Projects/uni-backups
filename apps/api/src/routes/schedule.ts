import { Hono } from "hono";
import { getScheduledJobs, getRecentRuns, getRunningJobs } from "../services/scheduler";

const schedule = new Hono();

schedule.get("/", async (c) => {
  const scheduled = await getScheduledJobs();
  const running = await getRunningJobs();
  const recent = await getRecentRuns(undefined, 20);

  return c.json({
    scheduled: scheduled.map((s) => ({
      name: s.name,
      schedule: s.schedule,
      nextRun: s.nextRun,
    })),
    running: running.map((r) => ({
      name: r.jobName,
      queuedAt: new Date(r.queuedAt),
    })),
    recent: recent.map((r) => ({
      id: r.id,
      name: r.jobName,
      jobName: r.jobName,
      startTime: new Date(r.startTime),
      endTime: r.endTime ? new Date(r.endTime) : undefined,
      status: r.status,
      duration: r.duration,
      snapshotId: r.snapshotId,
      workerId: r.workerId,
      message: r.error,
    })),
  });
});

schedule.get("/running", async (c) => {
  const running = await getRunningJobs();

  return c.json({
    running: running.map((r) => ({
      name: r.jobName,
      executionId: r.executionId,
      queuedAt: new Date(r.queuedAt),
    })),
  });
});

schedule.get("/history", async (c) => {
  const fromParam = c.req.query("from");
  if (fromParam !== undefined) {
    const fromDate = new Date(fromParam);
    if (isNaN(fromDate.getTime())) {
      return c.json({ error: "Invalid 'from' parameter: must be a valid date" }, 400);
    }
  }

  const jobName = c.req.query("job");
  const limit = parseInt(c.req.query("limit") || "50", 10);

  const runs = await getRecentRuns(jobName || undefined, limit);

  return c.json({
    history: runs.map((r) => ({
      id: r.id,
      jobName: r.jobName,
      startTime: new Date(r.startTime),
      endTime: r.endTime ? new Date(r.endTime) : undefined,
      status: r.status,
      duration: r.duration,
      snapshotId: r.snapshotId,
      error: r.error,
      workerId: r.workerId,
    })),
  });
});

schedule.get("/stats", async (c) => {
  // Get runs from the last 30 days
  const allRuns = await getRecentRuns(undefined, 1000);

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const runs7d = allRuns.filter((r) => r.startTime >= sevenDaysAgo);
  const runs30d = allRuns.filter((r) => r.startTime >= thirtyDaysAgo);

  const calculateSuccessRate = (runs: typeof allRuns) => {
    if (runs.length === 0) return 100;
    const successful = runs.filter((r) => r.status === "completed" || r.status === "success").length;
    return Math.round((successful / runs.length) * 100);
  };

  const calculateAverageDuration = (runs: typeof allRuns) => {
    const completedRuns = runs.filter((r) => r.duration !== undefined && r.duration > 0);
    if (completedRuns.length === 0) return 0;
    const totalDuration = completedRuns.reduce((sum, r) => sum + (r.duration || 0), 0);
    return Math.round(totalDuration / completedRuns.length);
  };

  const failed7d = runs7d.filter((r) => r.status === "failed").length;
  const failed30d = runs30d.filter((r) => r.status === "failed").length;

  return c.json({
    successRate7d: calculateSuccessRate(runs7d),
    successRate30d: calculateSuccessRate(runs30d),
    totalBackups7d: runs7d.length,
    totalBackups30d: runs30d.length,
    failedBackups7d: failed7d,
    failedBackups30d: failed30d,
    averageDuration7d: calculateAverageDuration(runs7d),
    averageDuration30d: calculateAverageDuration(runs30d),
  });
});

export default schedule;
