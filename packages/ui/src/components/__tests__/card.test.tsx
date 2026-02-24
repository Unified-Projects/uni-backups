import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../card";

describe("Card", () => {
  describe("Card component", () => {
    it("renders card element", () => {
      render(<Card data-testid="card">Content</Card>);
      expect(screen.getByTestId("card")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText("Card Content")).toBeInTheDocument();
    });

    it("applies default styling", () => {
      render(<Card data-testid="card">Content</Card>);
      const card = screen.getByTestId("card");
      expect(card).toHaveClass("rounded-lg");
      expect(card).toHaveClass("border");
      expect(card).toHaveClass("shadow-sm");
    });

    it("applies custom className", () => {
      render(<Card data-testid="card" className="custom-class">Content</Card>);
      expect(screen.getByTestId("card")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Card data-testid="card" className="custom-class">Content</Card>);
      const card = screen.getByTestId("card");
      expect(card).toHaveClass("custom-class");
      expect(card).toHaveClass("rounded-lg");
    });
  });

  describe("CardHeader component", () => {
    it("renders header element", () => {
      render(<CardHeader data-testid="header">Header</CardHeader>);
      expect(screen.getByTestId("header")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<CardHeader>Header Content</CardHeader>);
      expect(screen.getByText("Header Content")).toBeInTheDocument();
    });

    it("applies flex column layout", () => {
      render(<CardHeader data-testid="header">Header</CardHeader>);
      expect(screen.getByTestId("header")).toHaveClass("flex");
      expect(screen.getByTestId("header")).toHaveClass("flex-col");
    });

    it("applies padding", () => {
      render(<CardHeader data-testid="header">Header</CardHeader>);
      expect(screen.getByTestId("header")).toHaveClass("p-6");
    });

    it("applies custom className", () => {
      render(<CardHeader data-testid="header" className="custom-class">Header</CardHeader>);
      expect(screen.getByTestId("header")).toHaveClass("custom-class");
    });
  });

  describe("CardTitle component", () => {
    it("renders as h3 element", () => {
      render(<CardTitle>Title</CardTitle>);
      expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<CardTitle>Card Title</CardTitle>);
      expect(screen.getByText("Card Title")).toBeInTheDocument();
    });

    it("applies font styling", () => {
      render(<CardTitle data-testid="title">Title</CardTitle>);
      const title = screen.getByTestId("title");
      expect(title).toHaveClass("font-semibold");
      expect(title).toHaveClass("text-2xl");
    });

    it("applies custom className", () => {
      render(<CardTitle data-testid="title" className="custom-class">Title</CardTitle>);
      expect(screen.getByTestId("title")).toHaveClass("custom-class");
    });
  });

  describe("CardDescription component", () => {
    it("renders paragraph element", () => {
      render(<CardDescription>Description</CardDescription>);
      expect(screen.getByText("Description")).toBeInTheDocument();
    });

    it("applies muted foreground text", () => {
      render(<CardDescription data-testid="desc">Description</CardDescription>);
      expect(screen.getByTestId("desc")).toHaveClass("text-muted-foreground");
    });

    it("applies small text size", () => {
      render(<CardDescription data-testid="desc">Description</CardDescription>);
      expect(screen.getByTestId("desc")).toHaveClass("text-sm");
    });

    it("applies custom className", () => {
      render(<CardDescription data-testid="desc" className="custom-class">Description</CardDescription>);
      expect(screen.getByTestId("desc")).toHaveClass("custom-class");
    });
  });

  describe("CardContent component", () => {
    it("renders content element", () => {
      render(<CardContent data-testid="content">Content</CardContent>);
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<CardContent>Card Body Content</CardContent>);
      expect(screen.getByText("Card Body Content")).toBeInTheDocument();
    });

    it("applies padding", () => {
      render(<CardContent data-testid="content">Content</CardContent>);
      const content = screen.getByTestId("content");
      expect(content).toHaveClass("p-6");
      expect(content).toHaveClass("pt-0");
    });

    it("applies custom className", () => {
      render(<CardContent data-testid="content" className="custom-class">Content</CardContent>);
      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });
  });

  describe("CardFooter component", () => {
    it("renders footer element", () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>);
      expect(screen.getByTestId("footer")).toBeInTheDocument();
    });

    it("renders children", () => {
      render(<CardFooter>Footer Content</CardFooter>);
      expect(screen.getByText("Footer Content")).toBeInTheDocument();
    });

    it("applies flex layout", () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>);
      expect(screen.getByTestId("footer")).toHaveClass("flex");
      expect(screen.getByTestId("footer")).toHaveClass("items-center");
    });

    it("applies padding", () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>);
      const footer = screen.getByTestId("footer");
      expect(footer).toHaveClass("p-6");
      expect(footer).toHaveClass("pt-0");
    });

    it("applies custom className", () => {
      render(<CardFooter data-testid="footer" className="custom-class">Footer</CardFooter>);
      expect(screen.getByTestId("footer")).toHaveClass("custom-class");
    });
  });

  describe("Card composition", () => {
    it("renders complete card with all sub-components", () => {
      render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Test Card</CardTitle>
            <CardDescription>This is a description</CardDescription>
          </CardHeader>
          <CardContent>Main content goes here</CardContent>
          <CardFooter>Footer actions</CardFooter>
        </Card>
      );

      expect(screen.getByTestId("card")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Test Card" })).toBeInTheDocument();
      expect(screen.getByText("This is a description")).toBeInTheDocument();
      expect(screen.getByText("Main content goes here")).toBeInTheDocument();
      expect(screen.getByText("Footer actions")).toBeInTheDocument();
    });

    it("supports nested content", () => {
      render(
        <Card>
          <CardContent>
            <div data-testid="nested">
              <p>Nested paragraph</p>
            </div>
          </CardContent>
        </Card>
      );

      expect(screen.getByTestId("nested")).toBeInTheDocument();
      expect(screen.getByText("Nested paragraph")).toBeInTheDocument();
    });
  });
});
