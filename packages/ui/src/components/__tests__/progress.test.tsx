import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Progress } from "../progress";

describe("Progress", () => {
  describe("rendering", () => {
    it("renders progress element", () => {
      render(<Progress value={50} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("applies base styling", () => {
      render(<Progress value={50} data-testid="progress" />);
      const progress = screen.getByTestId("progress");
      expect(progress).toHaveClass("h-4");
      expect(progress).toHaveClass("w-full");
      expect(progress).toHaveClass("rounded-full");
    });
  });

  describe("value", () => {
    it("sets data-value attribute", () => {
      render(<Progress value={75} />);
      // Radix Progress uses data-value instead of aria-valuenow
      expect(screen.getByRole("progressbar")).toHaveAttribute("data-value", "75");
    });

    it("handles 0% value", () => {
      render(<Progress value={0} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("data-value", "0");
    });

    it("handles 100% value", () => {
      render(<Progress value={100} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("data-value", "100");
    });

    it("handles undefined value (indeterminate)", () => {
      render(<Progress />);
      const progress = screen.getByRole("progressbar");
      // Without value, Radix sets data-state to indeterminate
      expect(progress).toHaveAttribute("data-state", "indeterminate");
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Progress value={50} className="custom-class" data-testid="progress" />);
      expect(screen.getByTestId("progress")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Progress value={50} className="custom-class" data-testid="progress" />);
      const progress = screen.getByTestId("progress");
      expect(progress).toHaveClass("custom-class");
      expect(progress).toHaveClass("rounded-full");
    });
  });

  describe("accessibility", () => {
    it("has progressbar role", () => {
      render(<Progress value={50} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("supports aria-label", () => {
      render(<Progress value={50} aria-label="Loading progress" />);
      expect(screen.getByRole("progressbar", { name: "Loading progress" })).toBeInTheDocument();
    });

    it("supports aria-describedby", () => {
      render(
        <>
          <Progress value={50} aria-describedby="progress-help" />
          <span id="progress-help">50% complete</span>
        </>
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-describedby", "progress-help");
    });
  });

  describe("styling states", () => {
    it("applies background styling", () => {
      render(<Progress value={50} data-testid="progress" />);
      expect(screen.getByTestId("progress")).toHaveClass("bg-secondary");
    });

    it("applies overflow-hidden for indicator", () => {
      render(<Progress value={50} data-testid="progress" />);
      expect(screen.getByTestId("progress")).toHaveClass("overflow-hidden");
    });
  });
});
