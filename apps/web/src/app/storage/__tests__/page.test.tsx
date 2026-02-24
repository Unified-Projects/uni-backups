/**
 * Storage Page Unit Tests
 *
 * Tests for the storage page including server list, repos view, and snapshots view.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StoragePage from "../page";
import type { Storage, StorageStats, Snapshot } from "@/lib/api";

// Mock the API module
vi.mock("@/lib/api", () => ({
  getStorage: vi.fn(),
  getStorageStats: vi.fn(),
  getSnapshots: vi.fn(),
  formatBytes: (bytes: number) => {
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { getStorage, getStorageStats, getSnapshots } from "@/lib/api";

// Helper to create query client for tests
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

// Wrapper component for testing
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("StoragePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ServerListView - loading state", () => {
    it("renders loading skeletons when data is loading", async () => {
      // Mock loading state by returning a pending promise
      vi.mocked(getStorage).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      // Check for page title
      expect(screen.getByText("Backup Servers")).toBeInTheDocument();
      expect(screen.getByText("Configured backup destinations")).toBeInTheDocument();

      // Check for skeleton elements
      const skeletons = document.querySelectorAll('[class*="animate-pulse"], .skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("ServerListView - server list", () => {
    const mockStorage: { storage: Storage[] } = {
      storage: [
        { name: "local", type: "local", path: "/backups" },
        { name: "s3-backup", type: "s3", bucket: "my-backups", region: "us-east-1" },
        { name: "sftp-server", type: "sftp", host: "backup.example.com", port: 22, path: "/backups" },
      ],
    };

    it("displays correct server count", async () => {
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("3 backup servers configured")).toBeInTheDocument();
    });

    it("displays singular form for single server", async () => {
      vi.mocked(getStorage).mockResolvedValue({
        storage: [{ name: "local", type: "local", path: "/backups" }],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 backup server configured")).toBeInTheDocument();
    });

    it("displays server cards with names", async () => {
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("local")).toBeInTheDocument();
      expect(screen.getByText("s3-backup")).toBeInTheDocument();
      expect(screen.getByText("sftp-server")).toBeInTheDocument();
    });

    it("displays server types correctly", async () => {
      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("local");
      expect(screen.getByText("LOCAL")).toBeInTheDocument();
      expect(screen.getByText("S3")).toBeInTheDocument();
      expect(screen.getByText("SFTP")).toBeInTheDocument();
    });

    it("shows empty state when no servers configured", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No backup servers configured")).toBeInTheDocument();
      expect(screen.getByText("Add backup servers via environment variables or config file.")).toBeInTheDocument();
    });
  });

  describe("ServerReposView - repos view", () => {
    const mockStorageStats: StorageStats = {
      storage: "local",
      totalSize: 5368709120,
      totalFileCount: 1234,
      totalSnapshots: 42,
      repoCount: 3,
      repos: [
        {
          repo: "postgres-backup",
          totalSize: 2147483648,
          totalFileCount: 500,
          snapshotsCount: 20,
        },
        {
          repo: "volume-backup",
          totalSize: 3221225472,
          totalFileCount: 734,
          snapshotsCount: 22,
        },
      ],
    };

    beforeEach(() => {
      // Override the default useSearchParams mock for this describe block
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local")
      );
    });

    it("displays heading with server name", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("local")).toBeInTheDocument();
      expect(screen.getByText("Repositories on this backup server")).toBeInTheDocument();
    });

    it("displays back button", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("local");
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("displays repository count stat", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("3")).toBeInTheDocument();
      expect(screen.getByText("Repositories")).toBeInTheDocument();
    });

    it("displays total snapshots stat", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("42")).toBeInTheDocument();
      expect(screen.getByText("Total Snapshots")).toBeInTheDocument();
    });

    it("displays total size stat", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("3");
      expect(screen.getByText("5.0 GB")).toBeInTheDocument();
      expect(screen.getByText("Total Size")).toBeInTheDocument();
    });

    it("displays total files stat", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("1,234")).toBeInTheDocument();
      expect(screen.getByText("Total Files")).toBeInTheDocument();
    });

    it("displays repo cards with names", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("postgres-backup")).toBeInTheDocument();
      expect(screen.getByText("volume-backup")).toBeInTheDocument();
    });

    it("displays repo cards with stats", async () => {
      vi.mocked(getStorageStats).mockResolvedValue(mockStorageStats);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("postgres-backup");
      expect(screen.getByText("20 snapshots")).toBeInTheDocument();
      expect(screen.getByText("22 snapshots")).toBeInTheDocument();
    });

    it("shows empty state when no repositories", async () => {
      vi.mocked(getStorageStats).mockResolvedValue({
        storage: "local",
        totalSize: 0,
        totalFileCount: 0,
        totalSnapshots: 0,
        repoCount: 0,
        repos: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No repositories found")).toBeInTheDocument();
      expect(screen.getByText("No backup repositories have been created on this server yet.")).toBeInTheDocument();
    });

    it("renders loading skeletons during repo loading", async () => {
      vi.mocked(getStorageStats).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("local");
      const skeletons = document.querySelectorAll('[class*="animate-pulse"], .skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("RepoSnapshotsView - snapshots view", () => {
    const mockSnapshots: { storage: string; repo: string; snapshots: Snapshot[] } = {
      storage: "local",
      repo: "postgres-backup",
      snapshots: [
        {
          id: "abc123def456",
          short_id: "abc123de",
          time: "2024-01-15T10:00:00Z",
          hostname: "server-1",
          paths: ["/var/lib/postgresql"],
          tags: ["daily", "postgres"],
        },
        {
          id: "def789ghi012",
          short_id: "def789gh",
          time: "2024-01-14T10:00:00Z",
          hostname: "server-1",
          paths: ["/var/lib/postgresql"],
          tags: ["daily"],
        },
        {
          id: "ghi345jkl678",
          short_id: "ghi345jk",
          time: "2024-01-13T10:00:00Z",
          hostname: "server-1",
          paths: ["/var/lib/postgresql"],
          tags: null,
        },
      ],
    };

    beforeEach(() => {
      // Override the default useSearchParams mock for this describe block
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local&repo=postgres-backup")
      );
    });

    it("displays heading with repo name", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("postgres-backup")).toBeInTheDocument();
      expect(screen.getByText("Snapshots in this repository")).toBeInTheDocument();
    });

    it("displays back button", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("postgres-backup");
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("displays snapshot count", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Backup Snapshots")).toBeInTheDocument();
      expect(screen.getByText("3 snapshots available")).toBeInTheDocument();
    });

    it("displays singular form for single snapshot", async () => {
      vi.mocked(getSnapshots).mockResolvedValue({
        storage: "local",
        repo: "postgres-backup",
        snapshots: [mockSnapshots.snapshots[0]],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 snapshot available")).toBeInTheDocument();
    });

    it("displays snapshot IDs in table", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("abc123de")).toBeInTheDocument();
      expect(screen.getByText("def789gh")).toBeInTheDocument();
      expect(screen.getByText("ghi345jk")).toBeInTheDocument();
    });

    it("displays snapshot table with columns", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("abc123de");
      expect(screen.getByText("ID")).toBeInTheDocument();
      expect(screen.getByText("Time")).toBeInTheDocument();
      expect(screen.getByText("Host")).toBeInTheDocument();
      expect(screen.getByText("Paths")).toBeInTheDocument();
      expect(screen.getByText("Tags")).toBeInTheDocument();
    });

    it("displays snapshot hostnames", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("abc123de");
      const hostnames = screen.getAllByText("server-1");
      expect(hostnames.length).toBeGreaterThanOrEqual(1);
    });

    it("displays snapshot tags", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("abc123de");
      expect(screen.getByText("daily")).toBeInTheDocument();
      expect(screen.getByText("postgres")).toBeInTheDocument();
    });

    it("shows loading state for snapshots", async () => {
      vi.mocked(getSnapshots).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Backup Snapshots")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows empty state when no snapshots", async () => {
      vi.mocked(getSnapshots).mockResolvedValue({
        storage: "local",
        repo: "postgres-backup",
        snapshots: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("0 snapshots available")).toBeInTheDocument();
    });

    it("displays breadcrumb navigation", async () => {
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("postgres-backup");
      const breadcrumb = document.querySelector('[class*="breadcrumb"]');
      expect(breadcrumb).toBeTruthy();
    });
  });

  describe("URL-driven view switching", () => {
    it("shows ServerListView by default (no search params)", async () => {
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams()
      );
      vi.mocked(getStorage).mockResolvedValue({
        storage: [{ name: "local", type: "local", path: "/backups" }],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Backup Servers")).toBeInTheDocument();
      expect(screen.getByText("Configured backup destinations")).toBeInTheDocument();
    });

    it("shows ServerReposView when server param present", async () => {
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local")
      );
      vi.mocked(getStorageStats).mockResolvedValue({
        storage: "local",
        totalSize: 0,
        totalFileCount: 0,
        totalSnapshots: 0,
        repoCount: 0,
        repos: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Repositories on this backup server")).toBeInTheDocument();
    });

    it("shows RepoSnapshotsView when server and repo params present", async () => {
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local&repo=test-repo")
      );
      vi.mocked(getSnapshots).mockResolvedValue({
        storage: "local",
        repo: "test-repo",
        snapshots: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      expect(await screen.findByText("test-repo")).toBeInTheDocument();
      expect(screen.getByText("Snapshots in this repository")).toBeInTheDocument();
    });
  });

  describe("refresh functionality", () => {
    it("shows refresh button in ServerReposView", async () => {
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local")
      );
      vi.mocked(getStorageStats).mockResolvedValue({
        storage: "local",
        totalSize: 0,
        totalFileCount: 0,
        totalSnapshots: 0,
        repoCount: 0,
        repos: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("Repositories on this backup server");
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });

    it("shows refresh button in RepoSnapshotsView", async () => {
      vi.mocked(require("next/navigation").useSearchParams).mockReturnValue(
        new URLSearchParams("server=local&repo=test-repo")
      );
      vi.mocked(getSnapshots).mockResolvedValue({
        storage: "local",
        repo: "test-repo",
        snapshots: [],
      });

      render(
        <TestWrapper>
          <StoragePage />
        </TestWrapper>
      );

      await screen.findByText("test-repo");
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });
  });
});
