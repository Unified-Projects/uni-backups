import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobsPage from "../page";
import type { Job } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getJobs: vi.fn(),
  getJobHistory: vi.fn(),
  runJob: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockToast = vi.fn();
vi.mock("@uni-backups/ui/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { getJobs, runJob } from "@/lib/api";

function paginatedJobs(jobs: Job[]) {
  return {
    jobs,
    pagination: {
      page: 1,
      pageSize: 20,
      total: jobs.length,
      totalPages: Math.ceil(jobs.length / 20) || 1,
    },
  };
}

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

describe("JobsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockClear();
  });

  describe("loading state", () => {
    it("renders loading skeletons when data is loading", () => {
      vi.mocked(getJobs).mockImplementation(() => new Promise(() => {}));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(screen.getByText("Backup Jobs")).toBeInTheDocument();
      expect(screen.getByText("Manage and monitor your backup jobs")).toBeInTheDocument();

      // Check for skeleton elements
      const skeletons = document.querySelectorAll('[class*="animate-pulse"], .skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("table rendering", () => {
    const mockJobsList: Job[] = [
      {
        name: "daily-backup",
        type: "volume",
        storage: "local",
        repo: "daily-backup",
        source: "/data/volumes",
        schedule: "0 2 * * *",
        isRunning: false,
        lastRun: { status: "success", startTime: "2024-01-15T02:00:00Z", endTime: "2024-01-15T02:15:00Z" },
      },
      {
        name: "postgres-backup",
        type: "postgres",
        storage: "s3",
        repo: "postgres",
        host: "db.example.com",
        database: "myapp",
        schedule: "0 0 * * *",
        isRunning: true,
        lastRun: null,
      },
      {
        name: "manual-job",
        type: "folder",
        storage: "local",
        repo: "manual-job",
        source: "/home/user/documents",
        schedule: null,
        isRunning: false,
        lastRun: null,
      },
    ];
    const mockJobs = paginatedJobs(mockJobsList);

    it("renders jobs table with all columns", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("All Jobs")).toBeInTheDocument();

      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Type")).toBeInTheDocument();
      expect(screen.getByText("Source")).toBeInTheDocument();
      expect(screen.getByText("Destination")).toBeInTheDocument();
      expect(screen.getByText("Schedule")).toBeInTheDocument();
      expect(screen.getByText("Last Run")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    it("displays job names", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      // Job names appear in multiple places (table row + breadcrumb/other sections)
      const dailyBackups = await screen.findAllByText("daily-backup");
      expect(dailyBackups.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("postgres-backup").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("manual-job").length).toBeGreaterThanOrEqual(1);
    });

    it("displays job count in description", async () => {
      vi.mocked(getJobs).mockResolvedValue(mockJobs);

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("3 backup jobs configured")).toBeInTheDocument();
    });

    it("displays singular job count for one job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([mockJobsList[0]]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 backup job configured")).toBeInTheDocument();
    });
  });

  describe("JobTypeBadge", () => {
    it("displays volume type badge", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "vol", type: "volume", storage: "local", repo: "vol", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("volume")).toBeInTheDocument();
    });

    it("displays folder type badge", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "my-folder-job", type: "folder", storage: "local", repo: "folder-repo", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      await screen.findByText("my-folder-job");
      expect(screen.getByText("folder")).toBeInTheDocument();
    });

    it("displays postgres type badge", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "pg", type: "postgres", storage: "local", repo: "pg", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("postgres")).toBeInTheDocument();
    });

    it("displays mariadb type badge", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "maria", type: "mariadb", storage: "local", repo: "maria", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("mariadb")).toBeInTheDocument();
    });

    it("displays redis type badge", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "my-redis-job", type: "redis", storage: "local", repo: "redis-repo", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      await screen.findByText("my-redis-job");
      expect(screen.getByText("redis")).toBeInTheDocument();
    });
  });

  describe("JobStatusBadge", () => {
    it("shows running status for running job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: true, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Running")).toBeInTheDocument();
    });

    it("shows success status for completed job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "volume",
          storage: "local",
          repo: "job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "success", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:05:00Z" },
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Success")).toBeInTheDocument();
    });

    it("shows failed status for failed job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "volume",
          storage: "local",
          repo: "job",
          schedule: null,
          isRunning: false,
          lastRun: { status: "failed", startTime: "2024-01-15T10:00:00Z", endTime: "2024-01-15T10:02:00Z" },
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Failed")).toBeInTheDocument();
    });

    it("shows never run status for new job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Never run")).toBeInTheDocument();
    });
  });

  describe("run button", () => {
    it("shows Run Now button", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Run Now")).toBeInTheDocument();
    });

    it("shows Running... when job is running", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: true, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Running...")).toBeInTheDocument();
    });

    it("disables button when job is running", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: true, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      const runButton = await screen.findByRole("button", { name: /Running/i });
      expect(runButton).toBeDisabled();
    });

    it("has clickable run button for idle job", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "test-job", type: "volume", storage: "local", repo: "test-job", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      const runButton = await screen.findByRole("button", { name: /Run Now/i });
      expect(runButton).not.toBeDisabled();
    });

    it("shows success toast on successful run", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "test-job", type: "volume", storage: "local", repo: "test-job", schedule: null, isRunning: false, lastRun: null },
      ]));
      vi.mocked(runJob).mockResolvedValue({ name: "test-job", status: "queued", message: "Job started" });

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      const runButton = await screen.findByRole("button", { name: /Run Now/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Backup started",
            variant: "success",
          })
        );
      });
    });

    it("shows error toast on failed run", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "test-job", type: "volume", storage: "local", repo: "test-job", schedule: null, isRunning: false, lastRun: null },
      ]));
      vi.mocked(runJob).mockRejectedValue(new Error("Job already running"));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      const runButton = await screen.findByRole("button", { name: /Run Now/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to start backup",
            variant: "destructive",
          })
        );
      });
    });
  });

  describe("empty state", () => {
    it("shows empty state message when no jobs", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(
        await screen.findByText("No backup jobs configured. Add jobs via environment variables or config file.")
      ).toBeInTheDocument();
    });
  });

  describe("schedule display", () => {
    it("shows schedule for scheduled jobs", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "volume",
          storage: "local",
          repo: "job",
          schedule: "0 3 * * *",
          isRunning: false,
          lastRun: null,
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("0 3 * * *")).toBeInTheDocument();
    });

    it("shows Manual for jobs without schedule", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Manual")).toBeInTheDocument();
    });
  });

  describe("source display", () => {
    it("shows source path for folder/volume jobs", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "folder",
          storage: "local",
          repo: "job",
          source: "/data/backups",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("/data/backups")).toBeInTheDocument();
    });

    it("shows host and database for database jobs", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "postgres",
          storage: "local",
          repo: "job",
          host: "db.example.com",
          database: "production",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("db.example.com")).toBeInTheDocument();
      expect(screen.getByText("production")).toBeInTheDocument();
    });
  });

  describe("destination display", () => {
    it("shows storage and repo", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        {
          name: "job",
          type: "volume",
          storage: "my-storage",
          repo: "my-repo",
          schedule: null,
          isRunning: false,
          lastRun: null,
        },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("my-storage")).toBeInTheDocument();
      expect(screen.getByText("my-repo")).toBeInTheDocument();
    });
  });

  describe("last run display", () => {
    it("shows Never for jobs without last run", async () => {
      vi.mocked(getJobs).mockResolvedValue(paginatedJobs([
        { name: "job", type: "volume", storage: "local", repo: "job", schedule: null, isRunning: false, lastRun: null },
      ]));

      render(
        <TestWrapper>
          <JobsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Never")).toBeInTheDocument();
    });
  });
});
