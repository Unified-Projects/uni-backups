import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  getSchedule: vi.fn(),
}));

vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");

  return {
    ...actual,
    formatDistanceToNow: vi.fn(() => "2h ago"),
  };
});

import SchedulePage from "../page";

import { getSchedule } from "@/lib/api";

type ScheduleResponse = Awaited<ReturnType<typeof getSchedule>>;

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

function buildScheduleResponse(
  overrides: Partial<ScheduleResponse> = {}
): ScheduleResponse {
  return {
    scheduled: [],
    running: [],
    recent: [],
    ...overrides,
  };
}

describe("SchedulePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading skeletons while the schedule query is pending", () => {
    vi.mocked(getSchedule).mockImplementation(() => new Promise(() => {}));

    render(
      <TestWrapper>
        <SchedulePage />
      </TestWrapper>
    );

    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Scheduled jobs and run history")).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="animate-pulse"], .skeleton').length).toBeGreaterThan(0);
  });

  it("renders scheduled jobs, running jobs, and recent runs from the production payload shape", async () => {
    vi.mocked(getSchedule).mockResolvedValue(
      buildScheduleResponse({
        scheduled: [
          { name: "daily-backup", schedule: "0 2 * * *" },
          { name: "hourly-sync", schedule: "0 * * * *" },
        ],
        running: [
          { name: "postgres-backup", startTime: "2024-01-15T10:00:00Z" },
        ],
        recent: [
          {
            jobName: "nightly-backup",
            startTime: "2024-01-15T09:00:00Z",
            endTime: "2024-01-15T09:05:00Z",
            status: "failed",
            message: "Connection timeout",
          },
          {
            jobName: "hourly-sync",
            startTime: "2024-01-15T08:00:00Z",
            endTime: "2024-01-15T08:02:00Z",
            status: "success",
          },
        ],
      })
    );

    render(
      <TestWrapper>
        <SchedulePage />
      </TestWrapper>
    );

    expect(await screen.findByText("daily-backup")).toBeInTheDocument();
    expect(screen.getByText("2 jobs scheduled")).toBeInTheDocument();
    expect(screen.getByText("1 job running")).toBeInTheDocument();
    expect(screen.getByText("postgres-backup")).toBeInTheDocument();
    expect(screen.getByText("Started 2h ago")).toBeInTheDocument();

    const recentRunsTable = screen.getByRole("table");
    expect(within(recentRunsTable).getByText("nightly-backup")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("hourly-sync")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("Connection timeout")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("5m 0s")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("2m 0s")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("renders empty states when there are no scheduled, running, or recent jobs", async () => {
    vi.mocked(getSchedule).mockResolvedValue(buildScheduleResponse());

    render(
      <TestWrapper>
        <SchedulePage />
      </TestWrapper>
    );

    expect(await screen.findByText("No jobs with schedules configured")).toBeInTheDocument();
    expect(screen.getByText("No jobs currently running")).toBeInTheDocument();
    expect(screen.getByText("No backup runs recorded yet")).toBeInTheDocument();
    expect(screen.getByText("0 jobs scheduled")).toBeInTheDocument();
    expect(screen.getByText("0 jobs running")).toBeInTheDocument();
  });

  it("shows running recent runs without end times or messages using the real recent payload keys", async () => {
    vi.mocked(getSchedule).mockResolvedValue(
      buildScheduleResponse({
        recent: [
          {
            jobName: "currently-running",
            startTime: "2024-01-15T11:59:30Z",
            status: "running",
          },
        ],
      })
    );

    render(
      <TestWrapper>
        <SchedulePage />
      </TestWrapper>
    );

    const recentRunsTable = await screen.findByRole("table");
    const row = within(recentRunsTable).getByText("currently-running").closest("tr");

    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Running")).toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByText("-")).toHaveLength(2);
  });

  it("renders separate recent-run rows for multiple executions of the same job", async () => {
    vi.mocked(getSchedule).mockResolvedValue(
      buildScheduleResponse({
        recent: [
          {
            jobName: "scheduled-job",
            startTime: "2024-01-15T11:00:00Z",
            endTime: "2024-01-15T11:01:00Z",
            status: "success",
          },
          {
            jobName: "scheduled-job",
            startTime: "2024-01-15T11:00:00Z",
            endTime: "2024-01-15T11:02:00Z",
            status: "failed",
            message: "Lock timeout",
          },
        ],
      })
    );

    render(
      <TestWrapper>
        <SchedulePage />
      </TestWrapper>
    );

    const recentRunsTable = await screen.findByRole("table");
    expect(within(recentRunsTable).getAllByText("scheduled-job")).toHaveLength(2);
    expect(within(recentRunsTable).getByText("Success")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("Failed")).toBeInTheDocument();
    expect(within(recentRunsTable).getByText("Lock timeout")).toBeInTheDocument();
  });
});
