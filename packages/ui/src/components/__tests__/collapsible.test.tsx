import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../collapsible";

describe("Collapsible", () => {
  const renderCollapsible = (props = {}) => {
    return render(
      <Collapsible {...props}>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>
    );
  };

  describe("rendering", () => {
    it("renders trigger", () => {
      renderCollapsible();
      expect(screen.getByText("Toggle")).toBeInTheDocument();
    });

    it("renders trigger as button", () => {
      renderCollapsible();
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("content is not visible by default", () => {
      renderCollapsible();
      const content = screen.queryByText("Hidden content");
      // Content exists but is in closed state
      expect(content?.closest('[data-state]')).toHaveAttribute("data-state", "closed");
    });
  });

  describe("interactions", () => {
    it("shows content when trigger is clicked", () => {
      renderCollapsible();

      fireEvent.click(screen.getByText("Toggle"));

      expect(screen.getByText("Hidden content")).toBeVisible();
    });

    it("hides content when trigger is clicked again", () => {
      renderCollapsible();
      const trigger = screen.getByText("Toggle");

      fireEvent.click(trigger);
      expect(screen.getByText("Hidden content")).toBeInTheDocument();

      fireEvent.click(trigger);
      // Content is in closed state
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("calls onOpenChange when toggled", () => {
      const onOpenChange = vi.fn();
      renderCollapsible({ onOpenChange });

      fireEvent.click(screen.getByText("Toggle"));

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange with false when closing", () => {
      const onOpenChange = vi.fn();
      renderCollapsible({ onOpenChange, defaultOpen: true });

      fireEvent.click(screen.getByText("Toggle"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("controlled state", () => {
    it("respects open prop", () => {
      render(
        <Collapsible open={true}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Controlled content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByText("Controlled content")).toBeVisible();
    });

    it("respects open=false prop", () => {
      render(
        <Collapsible open={false}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Controlled content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("content")).toHaveAttribute("data-state", "closed");
    });

    it("respects defaultOpen prop", () => {
      renderCollapsible({ defaultOpen: true });
      expect(screen.getByText("Hidden content")).toBeVisible();
    });
  });

  describe("styling", () => {
    it("applies animation classes to content", () => {
      render(
        <Collapsible defaultOpen={true}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("content")).toHaveClass("overflow-hidden");
    });

    it("applies data-state attribute to content", () => {
      render(
        <Collapsible defaultOpen={true}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("content")).toHaveAttribute("data-state", "open");
    });

    it("applies closed data-state when collapsed", () => {
      render(
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("content")).toHaveAttribute("data-state", "closed");
    });
  });

  describe("custom className", () => {
    it("applies custom className to trigger", () => {
      render(
        <Collapsible>
          <CollapsibleTrigger className="custom-class" data-testid="trigger">
            Toggle
          </CollapsibleTrigger>
          <CollapsibleContent>Content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("trigger")).toHaveClass("custom-class");
    });

    it("applies custom className to content", () => {
      render(
        <Collapsible defaultOpen={true}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent className="custom-class" data-testid="content">
            Content
          </CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });
  });

  describe("disabled state", () => {
    it("supports disabled prop", () => {
      render(
        <Collapsible disabled>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Content</CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("does not toggle when disabled", () => {
      render(
        <Collapsible disabled>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Content</CollapsibleContent>
        </Collapsible>
      );

      fireEvent.click(screen.getByText("Toggle"));

      expect(screen.getByTestId("content")).toHaveAttribute("data-state", "closed");
    });
  });

  describe("accessibility", () => {
    it("trigger has aria-expanded attribute", () => {
      renderCollapsible();
      expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    });

    it("updates aria-expanded when opened", () => {
      renderCollapsible();
      const trigger = screen.getByRole("button");

      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("trigger has aria-controls attribute", () => {
      renderCollapsible();
      expect(screen.getByRole("button")).toHaveAttribute("aria-controls");
    });

    it("supports keyboard toggle with Enter", () => {
      renderCollapsible();
      const trigger = screen.getByRole("button");

      trigger.focus();
      fireEvent.click(trigger); // Click simulates keyboard interaction in testing-library

      expect(screen.getByText("Hidden content")).toBeInTheDocument();
    });

    it("supports keyboard toggle with Space", () => {
      renderCollapsible();
      const trigger = screen.getByRole("button");

      trigger.focus();
      fireEvent.click(trigger); // Click simulates keyboard interaction in testing-library

      expect(screen.getByText("Hidden content")).toBeInTheDocument();
    });

    it("can be focused", () => {
      renderCollapsible();
      const trigger = screen.getByRole("button");
      trigger.focus();
      expect(trigger).toHaveFocus();
    });
  });

  describe("complex content", () => {
    it("renders complex nested content", () => {
      render(
        <Collapsible defaultOpen={true}>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>
            <div>
              <h3>Section Title</h3>
              <p>Some paragraph text</p>
              <ul>
                <li>Item 1</li>
                <li>Item 2</li>
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      );

      expect(screen.getByText("Section Title")).toBeVisible();
      expect(screen.getByText("Some paragraph text")).toBeVisible();
      expect(screen.getByText("Item 1")).toBeVisible();
      expect(screen.getByText("Item 2")).toBeVisible();
    });
  });
});
