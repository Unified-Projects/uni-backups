import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RestorePage from "../page";
import type { Storage, Snapshot, RestoreOperation } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getStorage: vi.fn(),
  getStorageRepos: vi.fn(),
  getSnapshots: vi.fn(),
  initiateRestore: vi.fn(),
  getRestoreStatus: vi.fn(),
  getRestoreOperations: vi.fn(),
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

import {
  getStorage,
  getStorageRepos,
  getSnapshots,
  initiateRestore,
  getRestoreOperations,
} from "@/lib/api";

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

describe("RestorePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockClear();
  });

  describe("loading state", () => {
    it("renders loading skeletons when data is loading", () => {
      vi.mocked(getStorage).mockImplementation(() => new Promise(() => {}));
      vi.mocked(getRestoreOperations).mockImplementation(() => new Promise(() => {}));

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(screen.getByText("Restore")).toBeInTheDocument();
      expect(screen.getByText("Restore files from backup snapshots")).toBeInTheDocument();
    });
  });

  describe("page title and description", () => {
    it("renders correct page title", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(screen.getByText("Restore")).toBeInTheDocument();
      expect(screen.getByText("Restore files from backup snapshots")).toBeInTheDocument();
    });

    it("renders New Restore card title", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("New Restore")).toBeInTheDocument();
      expect(screen.getByText("Select a snapshot and restore method")).toBeInTheDocument();
    });

    it("renders Recent Restores card title", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Recent Restores")).toBeInTheDocument();
      expect(screen.getByText("History of restore operations")).toBeInTheDocument();
    });
  });

  describe("form rendering", () => {
    it("shows storage selector", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [
          { name: "local", type: "local", path: "/backups" },
          { name: "s3", type: "s3", bucket: "my-bucket" },
        ],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Storage")).toBeInTheDocument();
      expect(screen.getByText("Select storage")).toBeInTheDocument();
    });

    it("shows repository selector", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Repository")).toBeInTheDocument();
      expect(screen.getByText("Select repository")).toBeInTheDocument();
    });

    it("shows snapshot selector", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Snapshot")).toBeInTheDocument();
      expect(screen.getByText("Select snapshot")).toBeInTheDocument();
    });

    it("shows paths input field", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Paths (optional)")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("e.g., /data/file.txt, /config (comma-separated)")).toBeInTheDocument();
    });

    it("shows restore method radio group", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Restore Method")).toBeInTheDocument();
      expect(screen.getByText("Download as archive")).toBeInTheDocument();
      expect(screen.getByText("Restore to path")).toBeInTheDocument();
    });

    it("shows Start Restore button", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Start Restore")).toBeInTheDocument();
    });
  });

  describe("cascading form behavior", () => {
    it("repository selector is disabled when no storage selected", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const repoTrigger = screen.getByRole("combobox", { name: /repository/i });
      expect(repoTrigger).toBeDisabled();
    });

    it("snapshot selector is disabled when no repository selected", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const snapshotTrigger = screen.getByRole("combobox", { name: /snapshot/i });
      expect(snapshotTrigger).toBeDisabled();
    });

    it("loads repositories when storage is selected", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockRepos = { storage: "local", repos: ["repo1", "repo2"] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const storageTrigger = screen.getByRole("combobox", { name: /storage/i });
      fireEvent.click(storageTrigger);

      const localOption = await screen.findByRole("option", { name: "local" });
      fireEvent.click(localOption);

      await waitFor(() => {
        expect(getStorageRepos).toHaveBeenCalledWith("local");
      });
    });

    it("loads snapshots when repository is selected", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockRepos = { storage: "local", repos: ["repo1"] };
      const mockSnapshots: { storage: string; repo: string; snapshots: Snapshot[] } = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123",
            short_id: "abc123",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const storageTrigger = screen.getByRole("combobox", { name: /storage/i });
      fireEvent.click(storageTrigger);
      const localOption = await screen.findByRole("option", { name: "local" });
      fireEvent.click(localOption);

      await waitFor(() => expect(getStorageRepos).toHaveBeenCalledWith("local"));

      const repoTrigger = screen.getByRole("combobox", { name: /repository/i });
      fireEvent.click(repoTrigger);
      const repo1Option = await screen.findByRole("option", { name: "repo1" });
      fireEvent.click(repo1Option);

      await waitFor(() => {
        expect(getSnapshots).toHaveBeenCalledWith("local", "repo1");
      });
    });
  });

  describe("restore method selection", () => {
    it("download method is selected by default", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Restore Method");

      const downloadRadio = screen.getByRole("radio", { name: /download as archive/i });
      expect(downloadRadio).toBeChecked();
    });

    it("does not show target path input when download method is selected", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Restore Method");

      expect(screen.queryByText("Target Path")).not.toBeInTheDocument();
    });

    it("shows target path input when path method is selected", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Restore Method");

      const pathRadio = screen.getByRole("radio", { name: /restore to path/i });
      fireEvent.click(pathRadio);

      expect(await screen.findByText("Target Path")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("/path/to/restore")).toBeInTheDocument();
    });

    it("shows helper text for target path", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Restore Method");

      const pathRadio = screen.getByRole("radio", { name: /restore to path/i });
      fireEvent.click(pathRadio);

      expect(await screen.findByText("Path must be mounted in the container")).toBeInTheDocument();
    });
  });

  describe("recent operations", () => {
    it("displays empty state when no operations", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("No restore operations yet")).toBeInTheDocument();
    });

    it("displays recent restore operations list", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "completed",
            startTime: "2024-01-15T10:00:00Z",
            endTime: "2024-01-15T10:05:00Z",
          },
          {
            id: "restore-2",
            storage: "s3",
            repo: "repo2",
            snapshotId: "def67890",
            paths: ["/data"],
            method: "path",
            target: "/restore/path",
            status: "running",
            startTime: "2024-01-15T11:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("abc12345", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("def67890", { exact: false })).toBeInTheDocument();
    });

    it("displays storage and repo for each operation", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "completed",
            startTime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("local/repo1")).toBeInTheDocument();
    });
  });

  describe("status badges", () => {
    it("shows Pending badge for pending operations", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "pending",
            startTime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Pending")).toBeInTheDocument();
    });

    it("shows Running badge for running operations", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "running",
            startTime: "2024-01-15T10:00:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Running")).toBeInTheDocument();
    });

    it("shows Completed badge for completed operations", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "completed",
            startTime: "2024-01-15T10:00:00Z",
            endTime: "2024-01-15T10:05:00Z",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Completed")).toBeInTheDocument();
    });

    it("shows Failed badge for failed operations", async () => {
      const mockStorage: { storage: Storage[] } = { storage: [] };
      const mockOperations: { operations: RestoreOperation[] } = {
        operations: [
          {
            id: "restore-1",
            storage: "local",
            repo: "repo1",
            snapshotId: "abc12345",
            paths: [],
            method: "download",
            status: "failed",
            startTime: "2024-01-15T10:00:00Z",
            endTime: "2024-01-15T10:02:00Z",
            message: "Restore failed",
          },
        ],
      };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      expect(await screen.findByText("Failed")).toBeInTheDocument();
    });
  });

  describe("form submission", () => {
    it("Start Restore button is disabled when form is incomplete", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      const startButton = await screen.findByRole("button", { name: /start restore/i });
      expect(startButton).toBeDisabled();
    });

    it("shows success toast on successful restore initiation", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockRepos = { storage: "local", repos: ["repo1"] };
      const mockSnapshots: { storage: string; repo: string; snapshots: Snapshot[] } = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123",
            short_id: "abc123",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);
      vi.mocked(initiateRestore).mockResolvedValue({
        id: "restore-123",
        status: "pending",
        message: "Restore initiated",
      });

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const storageTrigger = screen.getByRole("combobox", { name: /storage/i });
      fireEvent.click(storageTrigger);
      const localOption = await screen.findByRole("option", { name: "local" });
      fireEvent.click(localOption);

      await waitFor(() => expect(getStorageRepos).toHaveBeenCalled());

      const repoTrigger = screen.getByRole("combobox", { name: /repository/i });
      fireEvent.click(repoTrigger);
      const repo1Option = await screen.findByRole("option", { name: "repo1" });
      fireEvent.click(repo1Option);

      await waitFor(() => expect(getSnapshots).toHaveBeenCalled());

      const snapshotTrigger = screen.getByRole("combobox", { name: /snapshot/i });
      fireEvent.click(snapshotTrigger);
      const snapshotOption = await screen.findByRole("option", { name: /abc123/i });
      fireEvent.click(snapshotOption);

      const startButton = screen.getByRole("button", { name: /start restore/i });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Restore initiated",
            variant: "success",
          })
        );
      });
    });

    it("shows error toast on failed restore initiation", async () => {
      const mockStorage: { storage: Storage[] } = {
        storage: [{ name: "local", type: "local", path: "/backups" }],
      };
      const mockRepos = { storage: "local", repos: ["repo1"] };
      const mockSnapshots: { storage: string; repo: string; snapshots: Snapshot[] } = {
        storage: "local",
        repo: "repo1",
        snapshots: [
          {
            id: "abc123",
            short_id: "abc123",
            time: "2024-01-15T10:00:00Z",
            hostname: "server1",
            paths: ["/data"],
            tags: null,
          },
        ],
      };
      const mockOperations: { operations: RestoreOperation[] } = { operations: [] };

      vi.mocked(getStorage).mockResolvedValue(mockStorage);
      vi.mocked(getStorageRepos).mockResolvedValue(mockRepos);
      vi.mocked(getSnapshots).mockResolvedValue(mockSnapshots);
      vi.mocked(getRestoreOperations).mockResolvedValue(mockOperations);
      vi.mocked(initiateRestore).mockRejectedValue(new Error("Restore failed"));

      render(
        <TestWrapper>
          <RestorePage />
        </TestWrapper>
      );

      await screen.findByText("Storage");

      const storageTrigger = screen.getByRole("combobox", { name: /storage/i });
      fireEvent.click(storageTrigger);
      const localOption = await screen.findByRole("option", { name: "local" });
      fireEvent.click(localOption);

      await waitFor(() => expect(getStorageRepos).toHaveBeenCalled());

      const repoTrigger = screen.getByRole("combobox", { name: /repository/i });
      fireEvent.click(repoTrigger);
      const repo1Option = await screen.findByRole("option", { name: "repo1" });
      fireEvent.click(repo1Option);

      await waitFor(() => expect(getSnapshots).toHaveBeenCalled());

      const snapshotTrigger = screen.getByRole("combobox", { name: /snapshot/i });
      fireEvent.click(snapshotTrigger);
      const snapshotOption = await screen.findByRole("option", { name: /abc123/i });
      fireEvent.click(snapshotOption);

      const startButton = screen.getByRole("button", { name: /start restore/i });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Restore failed",
            variant: "destructive",
          })
        );
      });
    });
  });
});
