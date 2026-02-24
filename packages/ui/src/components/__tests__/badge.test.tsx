import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, badgeVariants } from "../badge";

describe("Badge", () => {
  describe("rendering", () => {
    it("renders badge element", () => {
      render(<Badge>Badge</Badge>);
      expect(screen.getByText("Badge")).toBeInTheDocument();
    });

    it("renders children correctly", () => {
      render(<Badge>Badge Content</Badge>);
      expect(screen.getByText("Badge Content")).toBeInTheDocument();
    });

    it("renders as div by default", () => {
      render(<Badge data-testid="badge">Badge</Badge>);
      expect(screen.getByTestId("badge").tagName).toBe("DIV");
    });
  });

  describe("variants", () => {
    it("applies default variant styles", () => {
      render(<Badge data-testid="badge">Default</Badge>);
      expect(screen.getByTestId("badge")).toHaveClass("bg-primary");
    });

    it("applies secondary variant styles", () => {
      render(<Badge variant="secondary" data-testid="badge">Secondary</Badge>);
      expect(screen.getByTestId("badge")).toHaveClass("bg-secondary");
    });

    it("applies destructive variant styles", () => {
      render(<Badge variant="destructive" data-testid="badge">Destructive</Badge>);
      expect(screen.getByTestId("badge")).toHaveClass("bg-destructive");
    });

    it("applies outline variant styles", () => {
      render(<Badge variant="outline" data-testid="badge">Outline</Badge>);
      expect(screen.getByTestId("badge")).toHaveClass("text-foreground");
    });
  });

  describe("styling", () => {
    it("applies base styling", () => {
      render(<Badge data-testid="badge">Badge</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("inline-flex");
      expect(badge).toHaveClass("rounded-full");
      expect(badge).toHaveClass("text-xs");
    });

    it("applies custom className", () => {
      render(<Badge className="custom-class" data-testid="badge">Badge</Badge>);
      expect(screen.getByTestId("badge")).toHaveClass("custom-class");
    });

    it("merges custom className with variant classes", () => {
      render(<Badge className="custom-class" variant="secondary" data-testid="badge">Badge</Badge>);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("custom-class");
      expect(badge).toHaveClass("bg-secondary");
    });
  });

  describe("badgeVariants function", () => {
    it("returns default variant classes", () => {
      const classes = badgeVariants({ variant: "default" });
      expect(classes).toContain("bg-primary");
    });

    it("returns secondary variant classes", () => {
      const classes = badgeVariants({ variant: "secondary" });
      expect(classes).toContain("bg-secondary");
    });

    it("returns destructive variant classes", () => {
      const classes = badgeVariants({ variant: "destructive" });
      expect(classes).toContain("bg-destructive");
    });

    it("returns outline variant classes", () => {
      const classes = badgeVariants({ variant: "outline" });
      expect(classes).toContain("text-foreground");
    });
  });

  describe("composition", () => {
    it("renders with icon", () => {
      render(
        <Badge>
          <span data-testid="icon">*</span>
          Badge with Icon
        </Badge>
      );
      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText("Badge with Icon")).toBeInTheDocument();
    });

    it("supports multiple children", () => {
      render(
        <Badge data-testid="badge">
          <span>Icon</span>
          <span>Text</span>
          <span>More</span>
        </Badge>
      );
      expect(screen.getByTestId("badge").children).toHaveLength(3);
    });
  });
});
