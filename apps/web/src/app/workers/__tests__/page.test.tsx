import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkersPage from "../page";

interface Worker {
  id: string;
  name: string;
  hostname: string;
  groups: string[];
  status: string;
  isHealthy: boolean;
  lastHeartbeat: number;
  currentJobs: string[];
  metrics?: {
    jobsProcessed: number;
    jobsFailed: number;
  };
}

interface WorkerGroup {
  groupId: string;
  workers: string[];
  primaryWorkerId: string | null;
  quorumSize: number;
  activeWorkers: string[];
  totalWorkers: number;
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

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function mockWorkersApi({
  workers = [],
  groups = [],
}: {
  workers?: Worker[];
  groups?: WorkerGroup[];
}) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/api/workers/groups")) {
      return jsonResponse({ groups });
    }

    if (url.endsWith("/api/workers")) {
      return jsonResponse({ workers });
    }

    return jsonResponse({ error: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WorkersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("10:05:00 AM");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders loading skeletons while worker data is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(
      <TestWrapper>
        <WorkersPage />
      </TestWrapper>
    );

    expect(screen.getByText("Workers")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="animate-pulse"], .skeleton').length).toBeGreaterThan(0);
  });

  it("renders worker groups, badge states, heartbeat formatting, and metrics", async () => {
    mockWorkersApi({
      workers: [
        {
          id: "worker-1",
          name: "alpha",
          hostname: "alpha.local",
          groups: ["db"],
          status: "healthy",
          isHealthy: true,
          lastHeartbeat: Date.UTC(2024, 0, 15, 10, 5, 0),
          currentJobs: ["backup-db"],
          metrics: {
            jobsProcessed: 12,
            jobsFailed: 1,
          },
        },
        {
          id: "worker-2",
          name: "beta",
          hostname: "beta.local",
          groups: ["db"],
          status: "degraded",
          isHealthy: true,
          lastHeartbeat: Date.UTC(2024, 0, 15, 10, 6, 0),
          currentJobs: [],
          metrics: {
            jobsProcessed: 8,
            jobsFailed: 2,
          },
        },
        {
          id: "worker-3",
          name: "gamma",
          hostname: "gamma.local",
          groups: [],
          status: "healthy",
          isHealthy: false,
          lastHeartbeat: Date.UTC(2024, 0, 15, 10, 7, 0),
          currentJobs: [],
        },
      ],
      groups: [
        {
          groupId: "db",
          workers: ["worker-1", "worker-2"],
          primaryWorkerId: "worker-1",
          quorumSize: 2,
          activeWorkers: ["worker-1"],
          totalWorkers: 2,
        },
      ],
    });

    render(
      <TestWrapper>
        <WorkersPage />
      </TestWrapper>
    );

    expect(await screen.findByText("3 workers registered")).toBeInTheDocument();

    const groupCard = screen.getByTestId("worker-group-db");
    expect(within(groupCard).getByText("db")).toBeInTheDocument();
    expect(within(groupCard).getByText("worker-1")).toBeInTheDocument();
    expect(within(groupCard).getByText("1 / 2")).toBeInTheDocument();
    expect(within(groupCard).getByText("2")).toBeInTheDocument();

    const healthyWorker = screen.getByTestId("worker-item-worker-1");
    expect(within(healthyWorker).getByText("Healthy")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("alpha.local")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("db")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("10:05:00 AM")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("Jobs (OK/Fail)")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("12")).toBeInTheDocument();
    expect(within(healthyWorker).getByText("1")).toBeInTheDocument();

    expect(within(screen.getByTestId("worker-item-worker-2")).getByText("Degraded")).toBeInTheDocument();
    expect(within(screen.getByTestId("worker-item-worker-3")).getByText("Offline")).toBeInTheDocument();
    expect(within(screen.getByTestId("worker-item-worker-3")).getByText("None")).toBeInTheDocument();
  });

  it("renders the no-workers empty state when both endpoints are empty", async () => {
    mockWorkersApi({});

    render(
      <TestWrapper>
        <WorkersPage />
      </TestWrapper>
    );

    expect(await screen.findByText("0 workers registered")).toBeInTheDocument();
    expect(screen.getByText("No workers registered")).toBeInTheDocument();
    expect(screen.queryByText("Worker Groups")).not.toBeInTheDocument();
  });
});
