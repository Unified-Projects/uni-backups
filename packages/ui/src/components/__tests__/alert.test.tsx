import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertTitle, AlertDescription } from "../alert";

describe("Alert", () => {
  describe("Alert component", () => {
    it("renders alert element", () => {
      render(<Alert>Alert content</Alert>);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<Alert>Alert message</Alert>);
      expect(screen.getByText("Alert message")).toBeInTheDocument();
    });

    it("applies base styling", () => {
      render(<Alert data-testid="alert">Alert</Alert>);
      const alert = screen.getByTestId("alert");
      expect(alert).toHaveClass("rounded-lg");
      expect(alert).toHaveClass("border");
    });
  });

  describe("variants", () => {
    it("applies default variant styles", () => {
      render(<Alert data-testid="alert">Default</Alert>);
      expect(screen.getByTestId("alert")).toHaveClass("bg-background");
    });

    it("applies destructive variant styles", () => {
      render(<Alert variant="destructive" data-testid="alert">Error</Alert>);
      expect(screen.getByTestId("alert")).toHaveClass("border-destructive/50");
    });
  });

  describe("AlertTitle component", () => {
    it("renders title element", () => {
      render(<AlertTitle>Title</AlertTitle>);
      expect(screen.getByText("Title")).toBeInTheDocument();
    });

    it("applies font styling", () => {
      render(<AlertTitle data-testid="title">Title</AlertTitle>);
      const title = screen.getByTestId("title");
      expect(title).toHaveClass("font-medium");
    });
  });

  describe("AlertDescription component", () => {
    it("renders description element", () => {
      render(<AlertDescription>Description text</AlertDescription>);
      expect(screen.getByText("Description text")).toBeInTheDocument();
    });

    it("applies text styling", () => {
      render(<AlertDescription data-testid="desc">Description</AlertDescription>);
      expect(screen.getByTestId("desc")).toHaveClass("text-sm");
    });
  });

  describe("composition", () => {
    it("renders complete alert with title and description", () => {
      render(
        <Alert>
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>This is a warning message</AlertDescription>
        </Alert>
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Warning")).toBeInTheDocument();
      expect(screen.getByText("This is a warning message")).toBeInTheDocument();
    });

    it("renders alert with icon and content", () => {
      render(
        <Alert>
          <span data-testid="icon">Icon</span>
          <AlertTitle>Alert Title</AlertTitle>
          <AlertDescription>Alert description here</AlertDescription>
        </Alert>
      );

      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText("Alert Title")).toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className to Alert", () => {
      render(<Alert className="custom-class" data-testid="alert">Alert</Alert>);
      expect(screen.getByTestId("alert")).toHaveClass("custom-class");
    });

    it("applies custom className to AlertTitle", () => {
      render(<AlertTitle className="custom-class" data-testid="title">Title</AlertTitle>);
      expect(screen.getByTestId("title")).toHaveClass("custom-class");
    });

    it("applies custom className to AlertDescription", () => {
      render(<AlertDescription className="custom-class" data-testid="desc">Desc</AlertDescription>);
      expect(screen.getByTestId("desc")).toHaveClass("custom-class");
    });
  });
});
