import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../button";

describe("Button", () => {
  describe("rendering", () => {
    it("renders button with text content", () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
    });

    it("renders with default variant and size classes", () => {
      render(<Button>Default</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-primary");
      expect(button).toHaveClass("h-10");
    });

    it("renders children correctly", () => {
      render(
        <Button>
          <span data-testid="child">Child Element</span>
        </Button>
      );
      expect(screen.getByTestId("child")).toBeInTheDocument();
    });
  });

  describe("variants", () => {
    it("applies default variant styles", () => {
      render(<Button variant="default">Default</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-primary");
    });

    it("applies destructive variant styles", () => {
      render(<Button variant="destructive">Delete</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-destructive");
    });

    it("applies outline variant styles", () => {
      render(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole("button")).toHaveClass("border");
    });

    it("applies secondary variant styles", () => {
      render(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-secondary");
    });

    it("applies ghost variant styles", () => {
      render(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole("button")).toHaveClass("hover:bg-accent");
    });

    it("applies link variant styles", () => {
      render(<Button variant="link">Link</Button>);
      expect(screen.getByRole("button")).toHaveClass("text-primary");
    });
  });

  describe("sizes", () => {
    it("applies default size", () => {
      render(<Button size="default">Default Size</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-10");
    });

    it("applies sm size", () => {
      render(<Button size="sm">Small</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-9");
    });

    it("applies lg size", () => {
      render(<Button size="lg">Large</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-11");
    });

    it("applies icon size", () => {
      render(<Button size="icon">I</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("h-10");
      expect(button).toHaveClass("w-10");
    });
  });

  describe("interactions", () => {
    it("calls onClick handler when clicked", () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Click</Button>);

      fireEvent.click(screen.getByRole("button"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when disabled", () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick} disabled>Click</Button>);

      fireEvent.click(screen.getByRole("button"));

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("states", () => {
    it("renders disabled state", () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("applies disabled styles", () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole("button")).toHaveClass("disabled:opacity-50");
    });
  });

  describe("asChild prop", () => {
    it("renders as Slot when asChild is true", () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      const link = screen.getByRole("link", { name: "Link Button" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/test");
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Button className="custom-class">Custom</Button>);
      expect(screen.getByRole("button")).toHaveClass("custom-class");
    });

    it("merges custom className with variant classes", () => {
      render(<Button className="custom-class" variant="destructive">Custom</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("custom-class");
      expect(button).toHaveClass("bg-destructive");
    });
  });

  describe("accessibility", () => {
    it("supports aria-label", () => {
      render(<Button aria-label="Close dialog">X</Button>);
      expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
    });

    it("supports aria-disabled", () => {
      render(<Button aria-disabled="true">Disabled</Button>);
      expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("type attribute", () => {
    it("defaults to button type", () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    });

    it("supports submit type", () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
    });

    it("supports reset type", () => {
      render(<Button type="reset">Reset</Button>);
      expect(screen.getByRole("button")).toHaveAttribute("type", "reset");
    });
  });
});
