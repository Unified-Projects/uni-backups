import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Providers } from "../providers";

// Mock the dependencies
vi.mock("@tanstack/react-query", () => ({
  QueryClient: vi.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="query-client-provider">{children}</div>
  ),
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="theme-provider">{children}</div>
  ),
}));

describe("Providers", () => {
  describe("rendering", () => {
    it("renders children", () => {
      render(
        <Providers>
          <div>Test child content</div>
        </Providers>
      );

      expect(screen.getByText("Test child content")).toBeInTheDocument();
    });

    it("renders multiple children", () => {
      render(
        <Providers>
          <div>Child 1</div>
          <div>Child 2</div>
        </Providers>
      );

      expect(screen.getByText("Child 1")).toBeInTheDocument();
      expect(screen.getByText("Child 2")).toBeInTheDocument();
    });
  });

  describe("provider wrapping", () => {
    it("wraps children with QueryClientProvider", () => {
      render(
        <Providers>
          <div>Content</div>
        </Providers>
      );

      expect(screen.getByTestId("query-client-provider")).toBeInTheDocument();
    });

    it("wraps children with ThemeProvider", () => {
      render(
        <Providers>
          <div>Content</div>
        </Providers>
      );

      expect(screen.getByTestId("theme-provider")).toBeInTheDocument();
    });

    it("providers are nested correctly (QueryClient wraps ThemeProvider)", () => {
      render(
        <Providers>
          <div>Content</div>
        </Providers>
      );

      const queryProvider = screen.getByTestId("query-client-provider");
      const themeProvider = screen.getByTestId("theme-provider");

      // ThemeProvider should be inside QueryClientProvider
      expect(queryProvider.contains(themeProvider)).toBe(true);
    });
  });

  describe("QueryClient configuration", () => {
    it("re-renders without error", () => {
      const { rerender } = render(
        <Providers>
          <div>Content</div>
        </Providers>
      );

      // Re-render shouldn't cause any issues
      rerender(
        <Providers>
          <div>Updated content</div>
        </Providers>
      );

      expect(screen.getByText("Updated content")).toBeInTheDocument();
    });
  });

  describe("children types", () => {
    it("handles string children", () => {
      render(<Providers>Simple text</Providers>);

      expect(screen.getByText("Simple text")).toBeInTheDocument();
    });

    it("handles element children", () => {
      render(
        <Providers>
          <button>Click me</button>
        </Providers>
      );

      expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
    });

    it("handles nested elements", () => {
      render(
        <Providers>
          <div>
            <span>Nested content</span>
          </div>
        </Providers>
      );

      expect(screen.getByText("Nested content")).toBeInTheDocument();
    });

    it("handles null children", () => {
      render(<Providers>{null}</Providers>);

      // Should render without crashing
      expect(screen.getByTestId("query-client-provider")).toBeInTheDocument();
    });
  });
});
