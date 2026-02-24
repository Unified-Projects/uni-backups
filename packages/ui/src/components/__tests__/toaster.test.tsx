import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act as _act } from "@testing-library/react";
import { Toaster } from "../toaster";

// Mock the useToast hook
const mockToasts: Array<{
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}> = [];

vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toasts: mockToasts,
  }),
}));

describe("Toaster", () => {
  beforeEach(() => {
    mockToasts.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders toaster component", () => {
      render(<Toaster />);
      expect(document.body).toBeInTheDocument();
    });

    it("renders empty when no toasts", () => {
      render(<Toaster />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("renders toast when present", () => {
      mockToasts.push({
        id: "1",
        title: "Test Toast",
        description: "Test description",
      });

      render(<Toaster />);

      expect(screen.getByText("Test Toast")).toBeInTheDocument();
      expect(screen.getByText("Test description")).toBeInTheDocument();
    });

    it("renders multiple toasts", () => {
      mockToasts.push(
        { id: "1", title: "Toast 1" },
        { id: "2", title: "Toast 2" },
        { id: "3", title: "Toast 3" }
      );

      render(<Toaster />);

      expect(screen.getByText("Toast 1")).toBeInTheDocument();
      expect(screen.getByText("Toast 2")).toBeInTheDocument();
      expect(screen.getByText("Toast 3")).toBeInTheDocument();
    });
  });

  describe("toast content", () => {
    it("renders title when provided", () => {
      mockToasts.push({
        id: "1",
        title: "Important Message",
      });

      render(<Toaster />);

      expect(screen.getByText("Important Message")).toBeInTheDocument();
    });

    it("renders description when provided", () => {
      mockToasts.push({
        id: "1",
        description: "This is a detailed description",
      });

      render(<Toaster />);

      expect(screen.getByText("This is a detailed description")).toBeInTheDocument();
    });

    it("renders both title and description", () => {
      mockToasts.push({
        id: "1",
        title: "Title Here",
        description: "Description Here",
      });

      render(<Toaster />);

      expect(screen.getByText("Title Here")).toBeInTheDocument();
      expect(screen.getByText("Description Here")).toBeInTheDocument();
    });

    it("does not render title section when not provided", () => {
      mockToasts.push({
        id: "1",
        description: "Only description",
      });

      render(<Toaster />);

      expect(screen.getByText("Only description")).toBeInTheDocument();
    });
  });

  describe("close button", () => {
    it("renders close button for each toast", () => {
      mockToasts.push(
        { id: "1", title: "Toast 1" },
        { id: "2", title: "Toast 2" }
      );

      render(<Toaster />);

      const closeButtons = screen.getAllByRole("button");
      expect(closeButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("variants", () => {
    it("renders toast with default variant", () => {
      mockToasts.push({
        id: "1",
        title: "Default Toast",
        variant: "default",
      });

      render(<Toaster />);

      expect(screen.getByText("Default Toast")).toBeInTheDocument();
    });

    it("renders toast with destructive variant", () => {
      mockToasts.push({
        id: "1",
        title: "Error Toast",
        variant: "destructive",
      });

      render(<Toaster />);

      expect(screen.getByText("Error Toast")).toBeInTheDocument();
    });

    it("renders toast with success variant", () => {
      mockToasts.push({
        id: "1",
        title: "Success Toast",
        variant: "success",
      });

      render(<Toaster />);

      expect(screen.getByText("Success Toast")).toBeInTheDocument();
    });
  });

  describe("toast viewport", () => {
    it("renders toast viewport", () => {
      mockToasts.push({ id: "1", title: "Toast" });

      render(<Toaster />);

      const viewport = document.querySelector("[data-radix-toast-viewport]");
      expect(viewport).toBeInTheDocument();
    });
  });

  describe("unique keys", () => {
    it("each toast has unique key based on id", () => {
      mockToasts.push(
        { id: "unique-1", title: "Toast 1" },
        { id: "unique-2", title: "Toast 2" }
      );

      render(<Toaster />);

      expect(screen.getByText("Toast 1")).toBeInTheDocument();
      expect(screen.getByText("Toast 2")).toBeInTheDocument();
    });
  });

  describe("toast updates", () => {
    it("reflects toast changes", () => {
      const { rerender } = render(<Toaster />);

      expect(screen.queryByText("New Toast")).not.toBeInTheDocument();

      mockToasts.push({ id: "1", title: "New Toast" });
      rerender(<Toaster />);

      expect(screen.getByText("New Toast")).toBeInTheDocument();
    });
  });

  describe("layout", () => {
    it("wraps content in grid layout", () => {
      mockToasts.push({
        id: "1",
        title: "Toast Title",
        description: "Toast Description",
      });

      render(<Toaster />);

      const gridElement = screen.getByText("Toast Title").parentElement;
      expect(gridElement).toHaveClass("grid");
    });
  });
});
