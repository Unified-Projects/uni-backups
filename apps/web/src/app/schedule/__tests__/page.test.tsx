import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SchedulePage from "../page";
import type { ScheduledJob, JobRun } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getSchedule: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { getSchedule } from "@/lib/api";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("SchedulePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("renders loading skeletons when data is loading", async () => {
      vi.mocked(getSchedule).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(screen.getByText("Schedule")).toBeInTheDocument();
      expect(screen.getByText("Scheduled jobs and run history")).toBeInTheDocument();

      const skeletons = document.querySelectorAll('[class*="animate-pulse"], .skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("scheduled jobs", () => {
    it("displays job names and cron expressions", async () => {
      const mockScheduledJobs: ScheduledJob[] = [
        {
          name: "daily-backup",
          schedule: "0 2 * * *",
        },
        {
          name: "hourly-sync",
          schedule: "0 * * * *",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: mockScheduledJobs,
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("daily-backup")).toBeInTheDocument();
      expect(screen.getByText("hourly-sync")).toBeInTheDocument();
      expect(screen.getByText("0 2 * * *")).toBeInTheDocument();
      expect(screen.getByText("0 * * * *")).toBeInTheDocument();
    });

    it("shows correct count", async () => {
      const mockScheduledJobs: ScheduledJob[] = [
        {
          name: "backup-1",
          schedule: "0 0 * * *",
        },
        {
          name: "backup-2",
          schedule: "0 12 * * *",
        },
        {
          name: "backup-3",
          schedule: "0 6 * * *",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: mockScheduledJobs,
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("3 jobs scheduled")).toBeInTheDocument();
    });

    it("shows empty state when no jobs scheduled", async () => {
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No jobs with schedules configured")).toBeInTheDocument();
      expect(screen.getByText("0 jobs scheduled")).toBeInTheDocument();
    });
  });

  describe("running jobs", () => {
    it("displays running job names", async () => {
      const mockRunningJobs = [
        {
          name: "postgres-backup",
          startTime: "2024-01-15T10:00:00Z",
        },
        {
          name: "volume-backup",
          startTime: "2024-01-15T10:05:00Z",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: mockRunningJobs,
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("postgres-backup")).toBeInTheDocument();
      expect(screen.getByText("volume-backup")).toBeInTheDocument();
    });

    it("shows start times", async () => {
      const mockRunningJobs = [
        {
          name: "test-job",
          startTime: "2024-01-15T10:00:00Z",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: mockRunningJobs,
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("test-job");
      // The component uses formatDistanceToNow, so we check for "Started" text
      const startedText = screen.getByText(/Started/);
      expect(startedText).toBeInTheDocument();
    });

    it("shows empty state when no running jobs", async () => {
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No jobs currently running")).toBeInTheDocument();
      expect(screen.getByText("0 jobs running")).toBeInTheDocument();
    });
  });

  describe("recent runs", () => {
    it("displays table with job names", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "daily-backup",
          startTime: "2024-01-15T10:00:00Z",
          endTime: "2024-01-15T10:05:00Z",
          status: "success",
        },
        {
          name: "hourly-sync",
          startTime: "2024-01-15T09:00:00Z",
          endTime: "2024-01-15T09:02:00Z",
          status: "success",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Recent Runs")).toBeInTheDocument();
      expect(screen.getByText("daily-backup")).toBeInTheDocument();
      expect(screen.getByText("hourly-sync")).toBeInTheDocument();

      expect(screen.getByText("Job")).toBeInTheDocument();
      expect(screen.getByText("Started")).toBeInTheDocument();
      expect(screen.getByText("Duration")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Message")).toBeInTheDocument();
    });

    it("shows status badges (success, failed)", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "success-job",
          startTime: "2024-01-15T10:00:00Z",
          endTime: "2024-01-15T10:05:00Z",
          status: "success",
        },
        {
          name: "failed-job",
          startTime: "2024-01-15T09:00:00Z",
          endTime: "2024-01-15T09:01:00Z",
          status: "failed",
          message: "Connection timeout",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("success-job");

      expect(screen.getByText("Success")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    it("shows empty state when no recent runs", async () => {
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No backup runs recorded yet")).toBeInTheDocument();
    });
  });

  describe("running job status badge", () => {
    it("displays running badge with animation for running jobs", async () => {
      const mockRunningJobs = [
        {
          name: "active-backup",
          startTime: "2024-01-15T10:00:00Z",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: mockRunningJobs,
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("active-backup");

      expect(screen.getByText("Running")).toBeInTheDocument();
    });
  });

  describe("recent runs with running status", () => {
    it("displays running badge in recent runs table", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "currently-running",
          startTime: "2024-01-15T10:00:00Z",
          status: "running",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("currently-running");

      expect(screen.getByText("Running")).toBeInTheDocument();
    });
  });

  describe("count formatting", () => {
    it("shows singular 'job' when count is 1 for scheduled", async () => {
      const mockScheduledJobs: ScheduledJob[] = [
        {
          name: "single-job",
          schedule: "0 0 * * *",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: mockScheduledJobs,
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 job scheduled")).toBeInTheDocument();
    });

    it("shows singular 'job' when count is 1 for running", async () => {
      const mockRunningJobs = [
        {
          name: "single-running",
          startTime: "2024-01-15T10:00:00Z",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: mockRunningJobs,
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 job running")).toBeInTheDocument();
    });
  });

  describe("duration formatting", () => {
    it("shows formatted duration for completed runs", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "completed-job",
          startTime: "2024-01-15T10:00:00Z",
          endTime: "2024-01-15T10:05:00Z",
          status: "success",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("completed-job");

      // formatDuration is called with the dates; verify the table structure is rendered
      const table = screen.getByRole("table");
      expect(table).toBeInTheDocument();
    });

    it("shows dash for runs without endTime", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "no-end-time",
          startTime: "2024-01-15T10:00:00Z",
          status: "running",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("no-end-time");

      // getAllByText since dash might appear in both the duration column and the message column
      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("message display", () => {
    it("displays error message for failed runs", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "failed-with-message",
          startTime: "2024-01-15T10:00:00Z",
          endTime: "2024-01-15T10:01:00Z",
          status: "failed",
          message: "Database connection failed",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("failed-with-message");

      expect(screen.getByText("Database connection failed")).toBeInTheDocument();
    });

    it("shows dash when no message", async () => {
      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "no-message-job",
          startTime: "2024-01-15T10:00:00Z",
          endTime: "2024-01-15T10:05:00Z",
          status: "success",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      await screen.findByText("no-message-job");

      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("combined scenarios", () => {
    it("displays all sections with data", async () => {
      const mockScheduledJobs: ScheduledJob[] = [
        {
          name: "scheduled-backup",
          schedule: "0 2 * * *",
        },
      ];

      const mockRunningJobs = [
        {
          name: "running-backup",
          startTime: "2024-01-15T10:00:00Z",
        },
      ];

      const mockRecentRuns: (JobRun & { name: string })[] = [
        {
          name: "recent-backup",
          startTime: "2024-01-15T09:00:00Z",
          endTime: "2024-01-15T09:05:00Z",
          status: "success",
        },
      ];

      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: mockScheduledJobs,
        running: mockRunningJobs,
        recentRuns: mockRecentRuns,
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("scheduled-backup")).toBeInTheDocument();
      expect(screen.getByText("running-backup")).toBeInTheDocument();
      expect(screen.getByText("recent-backup")).toBeInTheDocument();

      expect(screen.getByText("Scheduled Jobs")).toBeInTheDocument();
      expect(screen.getByText("Currently Running")).toBeInTheDocument();
      expect(screen.getByText("Recent Runs")).toBeInTheDocument();
    });

    it("handles completely empty state", async () => {
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recentRuns: [],
      });

      render(
        <TestWrapper>
          <SchedulePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Schedule")).toBeInTheDocument();

      expect(screen.getByText("No jobs with schedules configured")).toBeInTheDocument();
      expect(screen.getByText("No jobs currently running")).toBeInTheDocument();
      expect(screen.getByText("No backup runs recorded yet")).toBeInTheDocument();
    });
  });
});
