import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../tabs";

describe("Tabs", () => {
  const renderTabs = (props = {}) => {
    return render(
      <Tabs defaultValue="tab1" {...props}>
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          <TabsTrigger value="tab3">Tab 3</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    );
  };

  describe("TabsList", () => {
    it("renders tabs list", () => {
      renderTabs();
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    it("applies styling classes", () => {
      renderTabs();
      const tabsList = screen.getByRole("tablist");
      expect(tabsList).toHaveClass("inline-flex");
      expect(tabsList).toHaveClass("items-center");
      expect(tabsList).toHaveClass("rounded-md");
    });
  });

  describe("TabsTrigger", () => {
    it("renders tab triggers", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: "Tab 1" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tab 2" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tab 3" })).toBeInTheDocument();
    });

    it("marks active tab as selected", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "false");
    });

    it("applies data-state attribute", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("data-state", "active");
      expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("data-state", "inactive");
    });

    it("changes active tab on click", async () => {
      const { container: _container } = renderTabs();
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });

      // Trigger pointerdown and click sequence for Radix
      fireEvent.pointerDown(tab2, { pointerType: "mouse" });
      fireEvent.click(tab2);

      // Check state updates
      await waitFor(() => {
        expect(tab2).toHaveAttribute("data-state", "active");
      });
    });

    it("supports disabled state", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2" disabled>Tab 2</TabsTrigger>
          </TabsList>
        </Tabs>
      );

      expect(screen.getByRole("tab", { name: "Tab 2" })).toBeDisabled();
    });
  });

  describe("TabsContent", () => {
    it("shows active tab content", () => {
      renderTabs();
      expect(screen.getByText("Content 1")).toBeInTheDocument();
    });

    it("hides inactive tab content", () => {
      renderTabs();
      expect(screen.queryByText("Content 2")).not.toBeInTheDocument();
      expect(screen.queryByText("Content 3")).not.toBeInTheDocument();
    });

    it("switches content when tab changes", async () => {
      renderTabs();
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });

      fireEvent.pointerDown(tab2, { pointerType: "mouse" });
      fireEvent.click(tab2);

      await waitFor(() => {
        expect(screen.getByText("Content 2")).toBeInTheDocument();
      });
    });

    it("has tabpanel role", () => {
      renderTabs();
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    });
  });

  describe("controlled state", () => {
    it("respects value prop", () => {
      render(
        <Tabs value="tab2">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>
      );

      expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Content 2")).toBeInTheDocument();
    });

    it("calls onValueChange when tab changes", async () => {
      const onValueChange = vi.fn();
      render(
        <Tabs defaultValue="tab1" onValueChange={onValueChange}>
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
        </Tabs>
      );

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      fireEvent.pointerDown(tab2, { pointerType: "mouse" });
      fireEvent.click(tab2);

      await waitFor(() => {
        expect(onValueChange).toHaveBeenCalledWith("tab2");
      });
    });
  });

  describe("custom className", () => {
    it("applies custom className to TabsList", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList className="custom-class" data-testid="list">
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          </TabsList>
        </Tabs>
      );

      expect(screen.getByTestId("list")).toHaveClass("custom-class");
    });

    it("applies custom className to TabsTrigger", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1" className="custom-class">Tab 1</TabsTrigger>
          </TabsList>
        </Tabs>
      );

      expect(screen.getByRole("tab")).toHaveClass("custom-class");
    });

    it("applies custom className to TabsContent", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1" className="custom-class" data-testid="content">
            Content
          </TabsContent>
        </Tabs>
      );

      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("supports keyboard navigation", () => {
      renderTabs();

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();

      expect(tab1).toHaveFocus();
    });

    it("tabs are properly labeled", () => {
      renderTabs();

      const tabs = screen.getAllByRole("tab");
      tabs.forEach((tab) => {
        expect(tab).toHaveAttribute("aria-controls");
      });
    });
  });
});
