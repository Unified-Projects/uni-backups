import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";

// Mock usePathname with configurable return value
const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/");
  });

  describe("rendering", () => {
    it("renders the logo and title", () => {
      render(<Sidebar />);

      expect(screen.getByText("Uni-Backups")).toBeInTheDocument();
      expect(screen.getByAltText("Uni-Backups")).toBeInTheDocument();
    });

    it("renders version number", () => {
      render(<Sidebar />);

      expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    });
  });

  describe("navigation items", () => {
    it("renders all navigation items", () => {
      render(<Sidebar />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Jobs")).toBeInTheDocument();
      expect(screen.getByText("Snapshots")).toBeInTheDocument();
      expect(screen.getByText("Backup Servers")).toBeInTheDocument();
      expect(screen.getByText("Restore")).toBeInTheDocument();
      expect(screen.getByText("Schedule")).toBeInTheDocument();
    });

    it("renders navigation items as links", () => {
      render(<Sidebar />);

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink).toHaveAttribute("href", "/");

      const jobsLink = screen.getByRole("link", { name: /jobs/i });
      expect(jobsLink).toHaveAttribute("href", "/jobs");

      const snapshotsLink = screen.getByRole("link", { name: /snapshots/i });
      expect(snapshotsLink).toHaveAttribute("href", "/snapshots");

      const backupServersLink = screen.getByRole("link", { name: /backup servers/i });
      expect(backupServersLink).toHaveAttribute("href", "/storage");

      const restoreLink = screen.getByRole("link", { name: /restore/i });
      expect(restoreLink).toHaveAttribute("href", "/restore");

      const scheduleLink = screen.getByRole("link", { name: /schedule/i });
      expect(scheduleLink).toHaveAttribute("href", "/schedule");
    });

    it("renders icons for each navigation item", () => {
      render(<Sidebar />);

      // Each link should have an SVG icon
      const links = screen.getAllByRole("link");
      links.forEach((link) => {
        const svg = link.querySelector("svg");
        expect(svg).toBeInTheDocument();
      });
    });
  });

  describe("active state - root path", () => {
    it("highlights Dashboard when on root path", () => {
      mockUsePathname.mockReturnValue("/");
      render(<Sidebar />);

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink).toHaveClass("bg-primary");
    });

    it("does not highlight other links when on root path", () => {
      mockUsePathname.mockReturnValue("/");
      render(<Sidebar />);

      const jobsLink = screen.getByRole("link", { name: /jobs/i });
      expect(jobsLink).not.toHaveClass("bg-primary");
    });
  });

  describe("active state - jobs path", () => {
    it("highlights Jobs when on /jobs", () => {
      mockUsePathname.mockReturnValue("/jobs");
      render(<Sidebar />);

      const jobsLink = screen.getByRole("link", { name: /jobs/i });
      expect(jobsLink).toHaveClass("bg-primary");
    });

    it("highlights Jobs when on nested /jobs/something", () => {
      mockUsePathname.mockReturnValue("/jobs/backup-job-1");
      render(<Sidebar />);

      const jobsLink = screen.getByRole("link", { name: /jobs/i });
      expect(jobsLink).toHaveClass("bg-primary");
    });

    it("does not highlight Dashboard when on /jobs", () => {
      mockUsePathname.mockReturnValue("/jobs");
      render(<Sidebar />);

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink).not.toHaveClass("bg-primary");
    });
  });

  describe("active state - storage path", () => {
    it("highlights Backup Servers when on /storage", () => {
      mockUsePathname.mockReturnValue("/storage");
      render(<Sidebar />);

      const backupServersLink = screen.getByRole("link", { name: /backup servers/i });
      expect(backupServersLink).toHaveClass("bg-primary");
    });
  });

  describe("active state - snapshots path", () => {
    it("highlights Snapshots when on /snapshots", () => {
      mockUsePathname.mockReturnValue("/snapshots");
      render(<Sidebar />);

      const snapshotsLink = screen.getByRole("link", { name: /snapshots/i });
      expect(snapshotsLink).toHaveClass("bg-primary");
    });
  });

  describe("active state - restore path", () => {
    it("highlights Restore when on /restore", () => {
      mockUsePathname.mockReturnValue("/restore");
      render(<Sidebar />);

      const restoreLink = screen.getByRole("link", { name: /restore/i });
      expect(restoreLink).toHaveClass("bg-primary");
    });
  });

  describe("active state - schedule path", () => {
    it("highlights Schedule when on /schedule", () => {
      mockUsePathname.mockReturnValue("/schedule");
      render(<Sidebar />);

      const scheduleLink = screen.getByRole("link", { name: /schedule/i });
      expect(scheduleLink).toHaveClass("bg-primary");
    });
  });

  describe("styling", () => {
    it("inactive links have muted styling", () => {
      mockUsePathname.mockReturnValue("/");
      render(<Sidebar />);

      const jobsLink = screen.getByRole("link", { name: /jobs/i });
      expect(jobsLink).toHaveClass("text-muted-foreground");
    });

    it("active links have primary styling", () => {
      mockUsePathname.mockReturnValue("/");
      render(<Sidebar />);

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink).toHaveClass("text-primary-foreground");
    });

    it("sidebar has correct width", () => {
      render(<Sidebar />);

      const sidebar = document.querySelector(".w-64");
      expect(sidebar).toBeInTheDocument();
    });

    it("sidebar has border on the right", () => {
      render(<Sidebar />);

      const sidebar = document.querySelector(".border-r");
      expect(sidebar).toBeInTheDocument();
    });
  });
});
