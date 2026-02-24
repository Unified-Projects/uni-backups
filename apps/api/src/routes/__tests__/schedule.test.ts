import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import schedule from "../schedule";

// Mock dependencies
vi.mock("../../services/scheduler", () => ({
  getScheduledJobs: vi.fn(),
  getRecentRuns: vi.fn(),
  getRunningJobs: vi.fn(),
}));

import { getScheduledJobs, getRecentRuns, getRunningJobs } from "../../services/scheduler";

describe("Schedule API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/schedule", schedule);
  });

  describe("GET /schedule", () => {
    it("returns scheduled jobs, running jobs, and recent runs", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([
        { name: "daily-backup", schedule: "0 0 * * *", nextRun: new Date("2024-01-02T00:00:00Z") },
        { name: "hourly-backup", schedule: "0 * * * *", nextRun: new Date("2024-01-01T01:00:00Z") },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "running-job", queuedAt: Date.now(), executionId: "exec-1" },
      ]);
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "completed-job",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          status: "completed",
          duration: 10000,
          snapshotId: "snap-123",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.scheduled).toHaveLength(2);
      expect(json.running).toHaveLength(1);
      expect(json.recent).toHaveLength(1);
    });

    it("returns scheduled jobs with name, schedule, and nextRun", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([
        { name: "test-job", schedule: "0 * * * *", nextRun: new Date("2024-01-01T01:00:00Z") },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.scheduled[0]).toHaveProperty("name");
      expect(json.scheduled[0]).toHaveProperty("schedule");
      expect(json.scheduled[0]).toHaveProperty("nextRun");
    });

    it("returns running jobs with name and queuedAt", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "running-job", queuedAt: Date.now(), executionId: "exec-1" },
      ]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.running[0]).toHaveProperty("name");
      expect(json.running[0]).toHaveProperty("queuedAt");
    });

    it("returns recent runs with full details", async () => {
      const startTime = Date.now() - 10000;
      const endTime = Date.now();

      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "test-job",
          startTime,
          endTime,
          status: "completed",
          duration: 10000,
          snapshotId: "snap-123",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.recent[0]).toHaveProperty("id");
      expect(json.recent[0]).toHaveProperty("name");
      expect(json.recent[0]).toHaveProperty("startTime");
      expect(json.recent[0]).toHaveProperty("status");
      expect(json.recent[0]).toHaveProperty("duration");
      expect(json.recent[0]).toHaveProperty("snapshotId");
      expect(json.recent[0]).toHaveProperty("workerId");
    });

    it("handles empty results", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.scheduled).toEqual([]);
      expect(json.running).toEqual([]);
      expect(json.recent).toEqual([]);
    });
  });

  describe("GET /schedule/running", () => {
    it("returns list of running jobs", async () => {
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "job-1", queuedAt: Date.now(), executionId: "exec-1" },
        { jobName: "job-2", queuedAt: Date.now() - 5000, executionId: "exec-2" },
      ]);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.running).toHaveLength(2);
    });

    it("includes executionId in running jobs", async () => {
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "job-1", queuedAt: Date.now(), executionId: "exec-123" },
      ]);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(json.running[0].executionId).toBe("exec-123");
    });

    it("handles no running jobs", async () => {
      vi.mocked(getRunningJobs).mockResolvedValue([]);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.running).toEqual([]);
    });
  });

  describe("GET /schedule/history", () => {
    it("returns recent runs for all jobs", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "job-1",
          startTime: Date.now(),
          status: "completed",
          workerId: "worker-1",
        },
        {
          id: "run-2",
          jobName: "job-2",
          startTime: Date.now() - 10000,
          status: "failed",
          error: "Something went wrong",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toHaveLength(2);
    });

    it("filters by job name when provided", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history?job=specific-job");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // Verify the route passed the job name filter through to the service
      expect(getRecentRuns).toHaveBeenCalledWith("specific-job", 50);
    });

    it("uses custom limit when provided", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history?limit=10");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // Verify the route parsed the limit param and forwarded it to the service
      expect(getRecentRuns).toHaveBeenCalledWith(undefined, 10);
    });

    it("combines job filter and limit", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history?job=test-job&limit=25");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // Verify the route forwards both params simultaneously
      expect(getRecentRuns).toHaveBeenCalledWith("test-job", 25);
    });

    it("uses default limit of 50", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // Verify the route defaults to 50 when no limit param is given
      expect(getRecentRuns).toHaveBeenCalledWith(undefined, 50);
    });

    it("includes error message for failed runs", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "failed-job",
          startTime: Date.now(),
          status: "failed",
          error: "Repository locked",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history[0].error).toBe("Repository locked");
    });

    it("handles runs without endTime", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "running-job",
          startTime: Date.now(),
          status: "running",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history[0].endTime).toBeUndefined();
    });

    it("handles invalid limit parameter", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history?limit=invalid");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // parseInt("invalid", 10) === NaN; the route passes it straight through.
      // Assert the exact call args so any future "sanitise limit" change is caught.
      expect(getRecentRuns).toHaveBeenCalledWith(undefined, NaN);
    });

    it("handles very large limit values", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule/history?limit=1000");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.history).toEqual([]);
      // Route must parse and forward the full numeric value without capping it
      expect(getRecentRuns).toHaveBeenCalledWith(undefined, 1000);
    });

    it("includes snapshotId when present", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "backup-job",
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          status: "completed",
          duration: 10000,
          snapshotId: "abc123def456",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history[0].snapshotId).toBe("abc123def456");
    });

    it("includes duration when present", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "backup-job",
          startTime: Date.now() - 30000,
          endTime: Date.now(),
          status: "completed",
          duration: 30000,
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history[0].duration).toBe(30000);
    });
  });

  describe("GET /schedule - Additional Edge Cases", () => {
    it("formats dates correctly in response", async () => {
      const nextRun = new Date("2024-06-15T10:00:00Z");
      const queuedAt = Date.now();

      vi.mocked(getScheduledJobs).mockResolvedValue([
        { name: "test-job", schedule: "0 10 * * *", nextRun },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "running-job", queuedAt, executionId: "exec-1" },
      ]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.scheduled[0].nextRun).toBeDefined();
      expect(new Date(json.running[0].queuedAt).getTime()).toBe(queuedAt);
    });

    it("handles large number of scheduled jobs", async () => {
      const scheduledJobs = Array.from({ length: 50 }, (_, i) => ({
        name: `job-${i}`,
        schedule: `${i % 60} * * * *`,
        nextRun: new Date(),
      }));

      vi.mocked(getScheduledJobs).mockResolvedValue(scheduledJobs);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.scheduled).toHaveLength(50);
    });

    it("handles multiple running jobs", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "job-1", queuedAt: Date.now(), executionId: "exec-1" },
        { jobName: "job-2", queuedAt: Date.now() - 5000, executionId: "exec-2" },
        { jobName: "job-3", queuedAt: Date.now() - 10000, executionId: "exec-3" },
      ]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.running).toHaveLength(3);
    });

    it("includes all fields for recent runs", async () => {
      const startTime = Date.now() - 60000;
      const endTime = Date.now() - 30000;

      vi.mocked(getScheduledJobs).mockResolvedValue([]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-123",
          jobName: "full-backup",
          startTime,
          endTime,
          status: "completed",
          duration: 30000,
          snapshotId: "snapshot-abc",
          workerId: "worker-primary",
        },
      ]);

      const res = await app.request("/schedule");
      const json = await res.json();

      const run = json.recent[0];
      expect(run.id).toBe("run-123");
      expect(run.name).toBe("full-backup");
      expect(new Date(run.startTime).getTime()).toBe(startTime);
      expect(new Date(run.endTime).getTime()).toBe(endTime);
      expect(run.status).toBe("completed");
      expect(run.duration).toBe(30000);
      expect(run.snapshotId).toBe("snapshot-abc");
      expect(run.workerId).toBe("worker-primary");
    });

    it("handles different cron schedule formats", async () => {
      vi.mocked(getScheduledJobs).mockResolvedValue([
        { name: "hourly", schedule: "0 * * * *", nextRun: new Date() },
        { name: "daily", schedule: "0 2 * * *", nextRun: new Date() },
        { name: "weekly", schedule: "0 3 * * 0", nextRun: new Date() },
        { name: "monthly", schedule: "0 4 1 * *", nextRun: new Date() },
      ]);
      vi.mocked(getRunningJobs).mockResolvedValue([]);
      vi.mocked(getRecentRuns).mockResolvedValue([]);

      const res = await app.request("/schedule");
      const json = await res.json();

      expect(json.scheduled.find((s: any) => s.name === "hourly").schedule).toBe("0 * * * *");
      expect(json.scheduled.find((s: any) => s.name === "daily").schedule).toBe("0 2 * * *");
      expect(json.scheduled.find((s: any) => s.name === "weekly").schedule).toBe("0 3 * * 0");
      expect(json.scheduled.find((s: any) => s.name === "monthly").schedule).toBe("0 4 1 * *");
    });
  });

  describe("GET /schedule/running - Additional Edge Cases", () => {
    it("includes all running job fields", async () => {
      const queuedTime = Date.now() - 30000;

      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "long-running-job", queuedAt: queuedTime, executionId: "exec-long-123" },
      ]);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(json.running[0].name).toBe("long-running-job");
      expect(json.running[0].executionId).toBe("exec-long-123");
      expect(new Date(json.running[0].queuedAt).getTime()).toBe(queuedTime);
    });

    it("handles concurrent jobs from same worker", async () => {
      vi.mocked(getRunningJobs).mockResolvedValue([
        { jobName: "job-a", queuedAt: Date.now(), executionId: "exec-a" },
        { jobName: "job-b", queuedAt: Date.now(), executionId: "exec-b" },
      ]);

      const res = await app.request("/schedule/running");
      const json = await res.json();

      expect(json.running).toHaveLength(2);
      const executionIds = json.running.map((r: any) => r.executionId);
      expect(executionIds).toContain("exec-a");
      expect(executionIds).toContain("exec-b");
    });
  });

  describe("GET /schedule/history - Status Types", () => {
    it("handles all status types", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        {
          id: "run-1",
          jobName: "job-1",
          startTime: Date.now(),
          status: "completed",
          workerId: "worker-1",
        },
        {
          id: "run-2",
          jobName: "job-2",
          startTime: Date.now(),
          status: "failed",
          error: "Timeout",
          workerId: "worker-1",
        },
        {
          id: "run-3",
          jobName: "job-3",
          startTime: Date.now(),
          status: "running",
          workerId: "worker-1",
        },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history.filter((r: any) => r.status === "completed")).toHaveLength(1);
      expect(json.history.filter((r: any) => r.status === "failed")).toHaveLength(1);
      expect(json.history.filter((r: any) => r.status === "running")).toHaveLength(1);
    });

    it("preserves run order from getRecentRuns", async () => {
      vi.mocked(getRecentRuns).mockResolvedValue([
        { id: "run-1", jobName: "first", startTime: Date.now(), status: "completed", workerId: "w1" },
        { id: "run-2", jobName: "second", startTime: Date.now() - 1000, status: "completed", workerId: "w1" },
        { id: "run-3", jobName: "third", startTime: Date.now() - 2000, status: "completed", workerId: "w1" },
      ]);

      const res = await app.request("/schedule/history");
      const json = await res.json();

      expect(json.history[0].jobName).toBe("first");
      expect(json.history[1].jobName).toBe("second");
      expect(json.history[2].jobName).toBe("third");
    });
  });
});
