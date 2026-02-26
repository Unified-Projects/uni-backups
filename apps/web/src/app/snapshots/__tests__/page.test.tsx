/**
 * Snapshots Page Unit Tests
 *
 * Tests for the snapshots page including storage/repo/snapshot selectors,
 * snapshot list table, and file browser functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SnapshotsPage from "../page";
import type { Storage, Snapshot, FileEntry } from "@/lib/api";

// Mock the API module
vi.mock("@/lib/api", () => ({
  getStorage: vi.fn(),
  getStorageRepos: vi.fn(),
  getSnapshots: vi.fn(),
  listSnapshotFiles: vi.fn(),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock next/navigation with custom search params
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual("next/navigation");
  return {
    ...actual,
    useSearchParams: () => mockSearchParams,
  };
});

import { getStorage, getStorageRepos, getSnapshots, listSnapshotFiles } from "@/lib/api";

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

describe("SnapshotsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
  });

  describe("loading state", () => {
    it("renders loading skeletons when data is loading", async () => {
      vi.mocked(getStorage).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Snapshots")).toBeInTheDocument();
      expect(screen.getByText("Browse backup snapshots and files")).toBeInTheDocument();
    });
  });

  describe("page title and description", () => {
    it("renders page title and description correctly", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Snapshots")).toBeInTheDocument();
      expect(screen.getByText("Browse backup snapshots and files")).toBeInTheDocument();
      expect(screen.getByText("Select Snapshot")).toBeInTheDocument();
      expect(screen.getByText("Choose a storage, repository, and snapshot to browse")).toBeInTheDocument();
    });
  });

  describe("storage selector", () => {
    it("displays available storage options", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [
          { name: "local", type: "local", path: "/backups" },
          { name: "s3", type: "s3", bucket: "backups" },
          { name: "sftp", type: "sftp", host: "backup.example.com" },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Storage")).toBeInTheDocument();
      expect(screen.getByText("Select storage")).toBeInTheDocument();
    });

    it("renders storage label", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Storage")).toBeInTheDocument();
    });
  });

  describe("repository selector", () => {
    it("displays repository label", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Repository")).toBeInTheDocument();
    });

    it("shows repository placeholder when no storage selected", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Select repository")).toBeInTheDocument();
    });
  });

  describe("snapshot selector", () => {
    it("displays snapshot label", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Snapshot")).toBeInTheDocument();
    });

    it("shows snapshot placeholder when no repository selected", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Select snapshot")).toBeInTheDocument();
    });
  });

  describe("snapshot list table", () => {
    it("displays table when snapshots are loaded", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: ["daily", "prod"],
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Available Snapshots")).toBeInTheDocument();
      expect(screen.getByText("1 snapshot in repo1")).toBeInTheDocument();
    });

    it("shows snapshot IDs in table", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("abc123de")).toBeInTheDocument();
    });

    it("shows snapshot timestamps", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("abc123de")).toBeInTheDocument();
      });

      const date = new Date("2024-01-15T10:00:00Z");
      const formattedDate = date.toLocaleString();
      expect(screen.getByText(formattedDate)).toBeInTheDocument();
    });

    it("shows snapshot hostnames", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("server1")).toBeInTheDocument();
    });

    it("shows snapshot tags", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: ["daily", "prod"],
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("daily")).toBeInTheDocument();
      expect(screen.getByText("prod")).toBeInTheDocument();
    });

    it("displays Browse button for each snapshot", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Browse")).toBeInTheDocument();
    });

    it("displays table headers correctly", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("abc123de")).toBeInTheDocument();
      });

      expect(screen.getByText("ID")).toBeInTheDocument();
      expect(screen.getByText("Time")).toBeInTheDocument();
      expect(screen.getByText("Hostname")).toBeInTheDocument();
      expect(screen.getByText("Tags")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    it("displays multiple snapshots", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: ["daily"],
          },
          {
            id: "def456ghi789",
            short_id: "def456gh",
            time: "2024-01-14T10:00:00Z",
            hostname: "server2",
            paths: ["/var"],
            tags: ["hourly"],
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("2 snapshots in repo1")).toBeInTheDocument();
      expect(screen.getByText("abc123de")).toBeInTheDocument();
      expect(screen.getByText("def456gh")).toBeInTheDocument();
      expect(screen.getByText("server1")).toBeInTheDocument();
      expect(screen.getByText("server2")).toBeInTheDocument();
    });
  });

  describe("file browser", () => {
    it("displays entries when browsing a snapshot", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [
          {
            name: "documents",
            type: "dir" as const,
            path: "/documents",
            size: 0,
            mtime: "2024-01-15T10:00:00Z",
          },
          {
            name: "readme.txt",
            type: "file" as const,
            path: "/readme.txt",
            size: 1024,
            mtime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("documents")).toBeInTheDocument();
      expect(screen.getByText("readme.txt")).toBeInTheDocument();
    });

    it("shows breadcrumbs navigation", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        const buttons = screen.getAllByRole("button");
        const rootButton = buttons.find((btn) => btn.textContent === "/");
        expect(rootButton).toBeInTheDocument();
      });
    });

    it("shows empty directory state", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("This directory is empty")).toBeInTheDocument();
    });

    it("displays file browser table headers", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [
          {
            name: "file.txt",
            type: "file" as const,
            path: "/file.txt",
            size: 1024,
            mtime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeInTheDocument();
      });

      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Size")).toBeInTheDocument();
      expect(screen.getByText("Modified")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    it("displays directories and files with correct icons", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [
          {
            name: "folder",
            type: "dir" as const,
            path: "/folder",
            size: 0,
            mtime: "2024-01-15T10:00:00Z",
          },
          {
            name: "file.txt",
            type: "file" as const,
            path: "/file.txt",
            size: 2048,
            mtime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("folder")).toBeInTheDocument();
      expect(screen.getByText("file.txt")).toBeInTheDocument();
    });

    it("displays snapshot details in card header", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Snapshot abc123de")).toBeInTheDocument();
      expect(screen.getByText("local/repo1")).toBeInTheDocument();
    });

    it("displays Restore button in file browser", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Restore")).toBeInTheDocument();
    });

    it("filters out entries with empty names", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [
          { name: "", type: "file" as const, path: "/empty", size: 0, mtime: "2024-01-15T10:00:00Z" },
          { name: "   ", type: "file" as const, path: "/whitespace", size: 0, mtime: "2024-01-15T10:00:00Z" },
          { name: "valid.txt", type: "file" as const, path: "/valid.txt", size: 1024, mtime: "2024-01-15T10:00:00Z" },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("valid.txt")).toBeInTheDocument();
      expect(screen.queryByText("empty")).not.toBeInTheDocument();
      expect(screen.queryByText("whitespace")).not.toBeInTheDocument();
    });

    it("filters out entries with invalid dates", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [
          { name: "epoch.txt", type: "file" as const, path: "/epoch.txt", size: 0, mtime: "1970-01-01T00:00:00Z" },
          { name: "invalid.txt", type: "file" as const, path: "/invalid.txt", size: 0, mtime: "invalid-date" },
          { name: "valid.txt", type: "file" as const, path: "/valid.txt", size: 1024, mtime: "2024-01-15T10:00:00Z" },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("valid.txt")).toBeInTheDocument();
      expect(screen.queryByText("epoch.txt")).not.toBeInTheDocument();
      expect(screen.queryByText("invalid.txt")).not.toBeInTheDocument();
    });
  });

  describe("URL pre-population", () => {
    it("pre-populates storage from searchParams", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);

      mockSearchParams.set("storage", "local");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(getStorageRepos).toHaveBeenCalledWith("local");
      });
    });

    it("pre-populates repo from searchParams", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(getSnapshots).toHaveBeenCalledWith("local", "repo1");
      });
    });

    it("pre-populates snapshot from searchParams", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      const mockFiles = {
        storage: "local",
        repo: "repo1",
        snapshotId: "abc123de",
        path: "/",
        entries: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(listSnapshotFiles).mockResolvedValue(mockFiles);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");
      mockSearchParams.set("id", "abc123de");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(listSnapshotFiles).toHaveBeenCalledWith("local", "repo1", "abc123de", "/");
      });
    });
  });

  describe("empty states", () => {
    it("handles empty snapshots list gracefully", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(getSnapshots).toHaveBeenCalled();
      });

      expect(screen.queryByText("Available Snapshots")).not.toBeInTheDocument();
    });

    it("handles empty storage list gracefully", async () => {
      vi.mocked(getStorage).mockResolvedValue({ storage: [] });

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("Select storage")).toBeInTheDocument();
    });
  });

  describe("snapshot count display", () => {
    it("displays singular form for one snapshot", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("1 snapshot in repo1")).toBeInTheDocument();
    });

    it("displays plural form for multiple snapshots", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };

      const mockRepos = { storage: "local", repos: ["repo1"] };

      const mockSnapshots = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123def456",
            short_id: "abc123de",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
          {
            id: "def456ghi789",
            short_id: "def456gh",
            time: "2024-01-14T10:00:00Z",
            hostname: "server2",
            paths: ["/var"],
            tags: null,
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);

      mockSearchParams.set("storage", "local");
      mockSearchParams.set("repo", "repo1");

      render(
        <TestWrapper>
          <SnapshotsPage />
        </TestWrapper>
      );

      expect(await screen.findByText("2 snapshots in repo1")).toBeInTheDocument();
    });
  });
});
