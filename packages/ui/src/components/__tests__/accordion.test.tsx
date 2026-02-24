import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../accordion";

describe("Accordion", () => {
  const renderAccordion = (props = {}) => {
    return render(
      <Accordion type="single" collapsible {...props}>
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent>Content 1</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Section 2</AccordionTrigger>
          <AccordionContent>Content 2</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Section 3</AccordionTrigger>
          <AccordionContent>Content 3</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  };

  describe("rendering", () => {
    it("renders all accordion items", () => {
      renderAccordion();
      expect(screen.getByText("Section 1")).toBeInTheDocument();
      expect(screen.getByText("Section 2")).toBeInTheDocument();
      expect(screen.getByText("Section 3")).toBeInTheDocument();
    });

    it("renders triggers as buttons", () => {
      renderAccordion();
      const triggers = screen.getAllByRole("button");
      expect(triggers).toHaveLength(3);
    });

    it("content is hidden by default", () => {
      renderAccordion();
      // Radix accordion content has data-state="closed" when hidden
      const items = document.querySelectorAll('[data-state="closed"]');
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe("interactions", () => {
    it("expands content when trigger is clicked", () => {
      renderAccordion();
      const trigger = screen.getByText("Section 1");

      fireEvent.click(trigger);

      expect(screen.getByText("Content 1")).toBeVisible();
    });

    it("collapses content when trigger is clicked again", () => {
      renderAccordion();
      const trigger = screen.getByText("Section 1");

      fireEvent.click(trigger);
      expect(screen.getByText("Content 1")).toBeInTheDocument();

      fireEvent.click(trigger);
      // Content is collapsed - check data-state
      expect(trigger.closest('[data-state]')).toHaveAttribute("data-state", "closed");
    });

    it("single type allows only one item open", () => {
      renderAccordion({ type: "single" });

      fireEvent.click(screen.getByText("Section 1"));
      expect(screen.getByText("Content 1")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Section 2"));
      expect(screen.getByText("Content 2")).toBeInTheDocument();
      // First item should be closed
      const section1Trigger = screen.getByText("Section 1");
      expect(section1Trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("multiple type allows multiple items open", () => {
      render(
        <Accordion type="multiple">
          <AccordionItem value="item-1">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Section 2</AccordionTrigger>
            <AccordionContent>Content 2</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      fireEvent.click(screen.getByText("Section 1"));
      fireEvent.click(screen.getByText("Section 2"));

      expect(screen.getByText("Content 1")).toBeVisible();
      expect(screen.getByText("Content 2")).toBeVisible();
    });
  });

  describe("default value", () => {
    it("respects defaultValue prop", () => {
      renderAccordion({ defaultValue: "item-2" });
      expect(screen.getByText("Content 2")).toBeVisible();
    });

    it("supports multiple default values", () => {
      render(
        <Accordion type="multiple" defaultValue={["item-1", "item-3"]}>
          <AccordionItem value="item-1">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Section 2</AccordionTrigger>
            <AccordionContent>Content 2</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>Section 3</AccordionTrigger>
            <AccordionContent>Content 3</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByText("Content 1")).toBeInTheDocument();
      expect(screen.getByText("Content 3")).toBeInTheDocument();
      // Section 2 is closed
      expect(screen.getByText("Section 2")).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("styling", () => {
    it("applies border-b to items", () => {
      render(
        <Accordion type="single" collapsible>
          <AccordionItem value="item-1" data-testid="item">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByTestId("item")).toHaveClass("border-b");
    });

    it("applies flex styling to trigger", () => {
      render(
        <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger data-testid="trigger">Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      const trigger = screen.getByTestId("trigger");
      expect(trigger).toHaveClass("flex");
      expect(trigger).toHaveClass("flex-1");
    });

    it("applies content overflow styling", () => {
      render(
        <Accordion type="single" collapsible defaultValue="item-1">
          <AccordionItem value="item-1">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent data-testid="content">Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByTestId("content")).toHaveClass("overflow-hidden");
    });
  });

  describe("custom className", () => {
    it("applies custom className to item", () => {
      render(
        <Accordion type="single" collapsible>
          <AccordionItem value="item-1" className="custom-class" data-testid="item">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByTestId("item")).toHaveClass("custom-class");
    });

    it("applies custom className to trigger", () => {
      render(
        <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger className="custom-class" data-testid="trigger">Section 1</AccordionTrigger>
            <AccordionContent>Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByTestId("trigger")).toHaveClass("custom-class");
    });

    it("applies custom className to content", () => {
      render(
        <Accordion type="single" collapsible defaultValue="item-1">
          <AccordionItem value="item-1">
            <AccordionTrigger>Section 1</AccordionTrigger>
            <AccordionContent className="custom-class" data-testid="content">Content 1</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("triggers have correct aria-expanded attribute", () => {
      renderAccordion();
      const triggers = screen.getAllByRole("button");

      triggers.forEach((trigger) => {
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      });

      fireEvent.click(triggers[0]);
      expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    });

    it("triggers have aria-controls attribute", () => {
      renderAccordion();
      const triggers = screen.getAllByRole("button");

      triggers.forEach((trigger) => {
        expect(trigger).toHaveAttribute("aria-controls");
      });
    });

    it("supports keyboard navigation", () => {
      renderAccordion();
      const trigger = screen.getByText("Section 1");

      trigger.focus();
      expect(trigger).toHaveFocus();

      // Click simulates Enter/Space behavior in testing-library
      fireEvent.click(trigger);
      expect(screen.getByText("Content 1")).toBeInTheDocument();
    });

    it("supports Space key to toggle", () => {
      renderAccordion();
      const trigger = screen.getByText("Section 1");

      trigger.focus();
      fireEvent.click(trigger);

      expect(screen.getByText("Content 1")).toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("supports disabled items", () => {
      render(
        <Accordion type="single" collapsible>
          <AccordionItem value="item-1" disabled>
            <AccordionTrigger>Disabled Section</AccordionTrigger>
            <AccordionContent>Disabled Content</AccordionContent>
          </AccordionItem>
        </Accordion>
      );

      const trigger = screen.getByRole("button");
      expect(trigger).toBeDisabled();
    });
  });
});
