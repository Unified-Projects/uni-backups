import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "../label";

describe("Label", () => {
  describe("rendering", () => {
    it("renders label element", () => {
      render(<Label>Field Label</Label>);
      expect(screen.getByText("Field Label")).toBeInTheDocument();
    });

    it("renders children correctly", () => {
      render(<Label>Label Text</Label>);
      expect(screen.getByText("Label Text")).toBeInTheDocument();
    });

    it("applies base styling", () => {
      render(<Label data-testid="label">Label</Label>);
      const label = screen.getByTestId("label");
      expect(label).toHaveClass("text-sm");
      expect(label).toHaveClass("font-medium");
    });
  });

  describe("htmlFor attribute", () => {
    it("supports htmlFor attribute", () => {
      render(<Label htmlFor="email">Email</Label>);
      expect(screen.getByText("Email")).toHaveAttribute("for", "email");
    });

    it("associates with input via htmlFor", () => {
      render(
        <>
          <Label htmlFor="username">Username</Label>
          <input id="username" />
        </>
      );
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Label className="custom-class" data-testid="label">Label</Label>);
      expect(screen.getByTestId("label")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Label className="custom-class" data-testid="label">Label</Label>);
      const label = screen.getByTestId("label");
      expect(label).toHaveClass("custom-class");
      expect(label).toHaveClass("text-sm");
    });
  });

  describe("peer styling", () => {
    it("supports peer-disabled styling", () => {
      render(<Label data-testid="label">Label</Label>);
      expect(screen.getByTestId("label")).toHaveClass("peer-disabled:opacity-70");
    });
  });

  describe("composition", () => {
    it("renders with required indicator", () => {
      render(
        <Label>
          Email <span data-testid="required">*</span>
        </Label>
      );
      expect(screen.getByTestId("required")).toBeInTheDocument();
    });

    it("renders with nested elements", () => {
      render(
        <Label>
          <span data-testid="icon">Icon</span>
          Label Text
        </Label>
      );
      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText("Label Text")).toBeInTheDocument();
    });
  });
});
