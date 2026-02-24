import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "../skeleton";

describe("Skeleton", () => {
  describe("rendering", () => {
    it("renders skeleton element", () => {
      render(<Skeleton data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    });

    it("renders as div by default", () => {
      render(<Skeleton data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton").tagName).toBe("DIV");
    });
  });

  describe("styling", () => {
    it("applies animate-pulse class", () => {
      render(<Skeleton data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("animate-pulse");
    });

    it("applies rounded-md class", () => {
      render(<Skeleton data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("rounded-md");
    });

    it("applies muted background", () => {
      render(<Skeleton data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("bg-muted");
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Skeleton className="custom-class" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Skeleton className="w-20 h-4" data-testid="skeleton" />);
      const skeleton = screen.getByTestId("skeleton");
      expect(skeleton).toHaveClass("w-20");
      expect(skeleton).toHaveClass("h-4");
      expect(skeleton).toHaveClass("animate-pulse");
    });
  });

  describe("dimensions", () => {
    it("supports width class", () => {
      render(<Skeleton className="w-[100px]" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("w-[100px]");
    });

    it("supports height class", () => {
      render(<Skeleton className="h-[20px]" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("h-[20px]");
    });
  });

  describe("shapes", () => {
    it("can be made circular", () => {
      render(<Skeleton className="rounded-full" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("rounded-full");
    });

    it("can override rounded-md", () => {
      render(<Skeleton className="rounded-lg" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveClass("rounded-lg");
    });
  });

  describe("composition", () => {
    it("can be used for text placeholders", () => {
      render(
        <div data-testid="text-skeleton">
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      );
      expect(screen.getByTestId("text-skeleton").children).toHaveLength(2);
    });

    it("can be used for avatar placeholder", () => {
      render(<Skeleton className="h-12 w-12 rounded-full" data-testid="avatar-skeleton" />);
      const skeleton = screen.getByTestId("avatar-skeleton");
      expect(skeleton).toHaveClass("h-12");
      expect(skeleton).toHaveClass("w-12");
      expect(skeleton).toHaveClass("rounded-full");
    });

    it("can be used for card placeholder", () => {
      render(
        <div data-testid="card-skeleton">
          <Skeleton className="h-[125px] w-full" />
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      );
      expect(screen.getByTestId("card-skeleton").children).toHaveLength(3);
    });
  });

  describe("HTML attributes", () => {
    it("supports aria-hidden", () => {
      render(<Skeleton aria-hidden="true" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveAttribute("aria-hidden", "true");
    });

    it("supports aria-label", () => {
      render(<Skeleton aria-label="Loading content" data-testid="skeleton" />);
      expect(screen.getByTestId("skeleton")).toHaveAttribute("aria-label", "Loading content");
    });
  });
});
