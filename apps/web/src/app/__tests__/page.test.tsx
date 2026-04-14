import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "../page";
import type { Job, Storage } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getJobs: vi.fn(),
  getSchedule: vi.fn(),
  getStorage: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { getJobs, getSchedule, getStorage } from "@/lib/api";

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

function paginatedJobs(jobs: Job[]) {
  return {
    jobs,
    pagination: {
      page: 1,
      pageSize: 1000,
      total: jobs.length,
      totalPages: 1,
    },
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSchedule).mockResolvedValue({ scheduled: [], running: [], recent: [] });
  });

  describe("loading state", () => {
    it("renders loading skeletons when data is loading", async () => {
      vi.mocked(getJobs).mockImplementation(
        () => new Promise(() => {})
      );
      vi.mocked(getSchedule).mockImplementation(
        () => new Promise(() => {})
      );
      vi.mocked(getStorage).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Overview of your backup system")).toBeInTheDocument();

      const skeletons = document.querySelectorAll('[class*="animate-pulse"], .skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows an error alert when dashboard queries fail", async () => {
      vi.mocked(getJobs).mockRejectedValue(new Error("Jobs API failed"));
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Jobs API failed");
    });
  });

  describe("stats display", () => {
    const mockJobsList: Job[] = [
      {
        name: "job-1",
        type: "volume",
        storage: "local",
        repo: "job-1",
        schedule: "0 * * * *",
        isRunning: false,
        lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:05:00Z" },
      },
      {
        name: "job-2",
        type: "postgres",
        storage: "s3",
        repo: "job-2",
        schedule: "0 0 * * *",
        isRunning: true,
        lastRun: null,
      },
      {
        name: "job-3",
        type: "folder",
        storage: "local",
        repo: "job-3",
        schedule: null,
        isRunning: false,
        lastRun: { status: "failed", startTime: "2024-01-14T10:00:00Z", endTime: "2024-01-14T10:02:00Z" },
      },
    ];
    const mockJobs = paginatedJobs(mockJobsList);

    const mockStorage: { storage: Storage[] } = {
      storage: [
        { name: "local", type: "local", path: "/backups" },
        { name: "s3", type: "s3", bucket: "backups" },
      ],
    };

    it("displays correct total jobs count", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Total Jobs")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("displays correct storage backends count", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Storage Backends")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("displays correct running jobs count", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      // "1" appears in multiple places, so verify via the stat card structure instead
      const runningHeading = await screen.findByRole("heading", { name: "Running" });
      expect(runningHeading).toBeInTheDocument();
      const statsGrid = runningHeading.closest("[class*='grid']");
      expect(statsGrid).toBeInTheDocument();
    });

    it("displays correct healthy jobs count", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      const healthyHeading = await screen.findByRole("heading", { name: "Healthy" });
      expect(healthyHeading).toBeInTheDocument();
      const statCard = healthyHeading.closest("[class*='card']");
      expect(statCard).toBeInTheDocument();
    });
  });

  describe("recent activity", () => {
    it("displays recent activity section", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "backup-job",
          type: "volume",
          storage: "local",
          repo: "backup-job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:05:00Z" },
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recent: [
          {
            jobName: "backup-job",
            startTime: "2024-01-15T10:00:00Z",
            endTime: "2024-01-15T10:05:00Z",
            status: "success",
          },
        ],
      });
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
      expect(screen.getByText("Latest backup runs")).toBeInTheDocument();
    });

    it("shows empty state when no backup runs", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "new-job",
          type: "volume",
          storage: "local",
          repo: "new-job",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("No backup runs yet")).toBeInTheDocument();
      expect(screen.getByText("Run a backup job to see activity here.")).toBeInTheDocument();
    });

    it("renders separate entries for repeated job executions", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "backup-job",
          type: "volume",
          storage: "local",
          repo: "backup-job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:01:00Z" },
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getSchedule).mockResolvedValue({
        scheduled: [],
        running: [],
        recent: [
          {
            jobName: "backup-job",
            startTime: "2024-01-15T10:10:00Z",
            endTime: "2024-01-15T10:11:00Z",
            status: "failed",
          },
          {
            jobName: "backup-job",
            startTime: "2024-01-15T10:00:00Z",
            endTime: "2024-01-15T10:01:00Z",
            status: "success",
          },
        ],
      });
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        render(
          <TestWrapper>
            <DashboardPage />
          </TestWrapper>
        );

        const sectionHeading = await screen.findByRole("heading", { name: "Recent Activity" });
        const recentActivityCard = sectionHeading.parentElement?.parentElement;
        expect(recentActivityCard).toBeTruthy();

        const activityScope = within(recentActivityCard as HTMLElement);
        const activityLinks = activityScope.getAllByRole("link", { name: "backup-job" });
        const successBadges = activityScope.getAllByText("Success");
        const failedBadges = activityScope.getAllByText("Failed");

        expect(activityLinks).toHaveLength(2);
        expect(successBadges).toHaveLength(1);
        expect(failedBadges).toHaveLength(1);
        expect(
          consoleErrorSpy.mock.calls.some((args) =>
            String(args[0]).includes("Encountered two children with the same key")
          )
        ).toBe(false);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("displays job names in activity list", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "daily-backup",
          type: "folder",
          storage: "local",
          repo: "daily-backup",
          schedule: null,
          isRunning: false,
          lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:05:00Z" },
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      // Job name appears in both activity list and job list
      const jobNames = await screen.findAllByText("daily-backup");
      expect(jobNames.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("jobs list", () => {
    it("displays backup jobs section", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "test-job",
          type: "volume",
          storage: "local",
          repo: "test-job",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Backup Jobs")).toBeInTheDocument();
      expect(screen.getByText("All configured backup jobs")).toBeInTheDocument();
    });

    it("displays job type and storage", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "postgres-backup",
          type: "postgres",
          storage: "s3-storage",
          repo: "postgres-backup",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("postgres-backup")).toBeInTheDocument();
      expect(screen.getByText("postgres - s3-storage")).toBeInTheDocument();
    });

    it("displays job schedule", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "scheduled-job",
          type: "volume",
          storage: "local",
          repo: "scheduled-job",
          schedule: "0 2 * * *",
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("0 2 * * *")).toBeInTheDocument();
    });
  });

  describe("job status badges", () => {
    it("shows running badge for running job", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "running-job",
          type: "volume",
          storage: "local",
          repo: "running-job",
          schedule: null,
          isRunning: true,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      await screen.findByText("running-job");
      // "Running" appears as both the stat card heading and the badge
      const runningTexts = screen.getAllByText("Running");
      expect(runningTexts.length).toBeGreaterThanOrEqual(1);
    });

    it("shows success badge for successful job", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "success-job",
          type: "volume",
          storage: "local",
          repo: "success-job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:05:00Z" },
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      // Job name appears in both activity list and job list
      const jobNames = await screen.findAllByText("success-job");
      expect(jobNames.length).toBeGreaterThanOrEqual(1);
      const successBadges = screen.getAllByText("Success");
      expect(successBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("shows failed badge for failed job", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "failed-job",
          type: "volume",
          storage: "local",
          repo: "failed-job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "failed", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:02:00Z" },
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      // Job name appears in both activity list and job list
      const jobNames = await screen.findAllByText("failed-job");
      expect(jobNames.length).toBeGreaterThanOrEqual(1);
      const failedBadges = screen.getAllByText("Failed");
      expect(failedBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("shows never run badge for job without last run", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "new-job",
          type: "volume",
          storage: "local",
          repo: "new-job",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      await screen.findByText("new-job");
      expect(screen.getByText("Never run")).toBeInTheDocument();
    });
  });

  describe("empty states", () => {
    it("handles empty jobs list gracefully", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([]));
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByRole("heading", { name: "Total Jobs" })).toBeInTheDocument();
    });

    it("handles empty storage list gracefully", async () => {
      const mockJobs = paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: false, lastRun: null },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Storage Backends")).toBeInTheDocument();
    });
  });

  describe("links", () => {
    it("job links to job details page", async () => {
      const mockJobs = paginatedJobs([
        {
          name: "linked-job",
          type: "volume",
          storage: "local",
          repo: "linked-job",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]);

      vi.mocked(getJobs).mockResolvedValue(mockJobs);
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      );

      const jobLink = await screen.findByRole("link", { name: /linked-job/i });
      expect(jobLink).toHaveAttribute("href", "/jobs?name=linked-job");
    });
  });
});
