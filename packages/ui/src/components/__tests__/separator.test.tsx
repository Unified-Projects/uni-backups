import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Separator } from "../separator";

describe("Separator", () => {
  describe("rendering", () => {
    it("renders separator element", () => {
      render(<Separator data-testid="separator" />);
      expect(screen.getByTestId("separator")).toBeInTheDocument();
    });

    it("renders as horizontal by default", () => {
      render(<Separator data-testid="separator" />);
      expect(screen.getByTestId("separator")).toHaveAttribute("data-orientation", "horizontal");
    });
  });

  describe("orientation", () => {
    it("renders horizontal separator", () => {
      render(<Separator orientation="horizontal" data-testid="separator" />);
      const separator = screen.getByTestId("separator");
      expect(separator).toHaveAttribute("data-orientation", "horizontal");
    });

    it("renders vertical separator", () => {
      render(<Separator orientation="vertical" data-testid="separator" />);
      const separator = screen.getByTestId("separator");
      expect(separator).toHaveAttribute("data-orientation", "vertical");
    });

    it("applies horizontal sizing classes", () => {
      render(<Separator orientation="horizontal" data-testid="separator" />);
      const separator = screen.getByTestId("separator");
      expect(separator).toHaveClass("h-[1px]");
      expect(separator).toHaveClass("w-full");
    });

    it("applies vertical sizing classes", () => {
      render(<Separator orientation="vertical" data-testid="separator" />);
      const separator = screen.getByTestId("separator");
      expect(separator).toHaveClass("h-full");
      expect(separator).toHaveClass("w-[1px]");
    });
  });

  describe("decorative", () => {
    it("is decorative by default (has role=none)", () => {
      render(<Separator data-testid="separator" />);
      // Radix Separator defaults to decorative=true which sets role="none"
      expect(screen.getByTestId("separator")).toHaveAttribute("role", "none");
    });

    it("can be made non-decorative", () => {
      render(<Separator decorative={false} />);
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });
  });

  describe("styling", () => {
    it("applies shrink-0 class", () => {
      render(<Separator data-testid="separator" />);
      expect(screen.getByTestId("separator")).toHaveClass("shrink-0");
    });

    it("applies bg-border class", () => {
      render(<Separator data-testid="separator" />);
      expect(screen.getByTestId("separator")).toHaveClass("bg-border");
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Separator className="custom-class" data-testid="separator" />);
      expect(screen.getByTestId("separator")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Separator className="my-4" data-testid="separator" />);
      const separator = screen.getByTestId("separator");
      expect(separator).toHaveClass("my-4");
      expect(separator).toHaveClass("shrink-0");
    });
  });

  describe("accessibility", () => {
    it("has separator role when not decorative", () => {
      render(<Separator decorative={false} />);
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("supports aria-label when not decorative", () => {
      render(<Separator decorative={false} aria-label="Section divider" />);
      expect(screen.getByRole("separator", { name: "Section divider" })).toBeInTheDocument();
    });
  });
});
