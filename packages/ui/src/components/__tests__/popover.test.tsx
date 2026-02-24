import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "../popover";

describe("Popover", () => {
  const renderPopover = (props = {}) => {
    return render(
      <Popover {...props}>
        <PopoverTrigger>Open Popover</PopoverTrigger>
        <PopoverContent>Popover content here</PopoverContent>
      </Popover>
    );
  };

  describe("rendering", () => {
    it("renders trigger", () => {
      renderPopover();
      expect(screen.getByText("Open Popover")).toBeInTheDocument();
    });

    it("does not show content initially", () => {
      renderPopover();
      expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("shows content when trigger is clicked", async () => {
      renderPopover();

      fireEvent.click(screen.getByText("Open Popover"));

      await waitFor(() => {
        expect(screen.getByText("Popover content here")).toBeInTheDocument();
      });
    });

    it("hides content when trigger is clicked again", async () => {
      renderPopover();

      fireEvent.click(screen.getByText("Open Popover"));
      await waitFor(() => {
        expect(screen.getByText("Popover content here")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Open Popover"));
      await waitFor(() => {
        expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
      });
    });

    it("closes when clicking outside", async () => {
      renderPopover();

      fireEvent.click(screen.getByText("Open Popover"));
      await waitFor(() => {
        expect(screen.getByText("Popover content here")).toBeInTheDocument();
      });

      fireEvent.pointerDown(document.body);
      await waitFor(() => {
        expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
      });
    });

    it("closes on escape key", async () => {
      renderPopover();

      fireEvent.click(screen.getByText("Open Popover"));
      await waitFor(() => {
        expect(screen.getByText("Popover content here")).toBeInTheDocument();
      });

      fireEvent.keyDown(document.body, { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByText("Popover content here")).not.toBeInTheDocument();
      });
    });
  });

  describe("controlled state", () => {
    it("respects open prop", async () => {
      render(
        <Popover open={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent>Controlled content</PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByText("Controlled content")).toBeInTheDocument();
      });
    });

    it("respects defaultOpen prop", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent>Default open content</PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByText("Default open content")).toBeInTheDocument();
      });
    });
  });

  describe("styling", () => {
    it("applies content styling", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent data-testid="content">Content</PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        const content = screen.getByTestId("content");
        expect(content).toHaveClass("z-50");
        expect(content).toHaveClass("w-72");
        expect(content).toHaveClass("rounded-md");
        expect(content).toHaveClass("border");
        expect(content).toHaveClass("p-4");
      });
    });
  });

  describe("custom className", () => {
    it("applies custom className to trigger", () => {
      render(
        <Popover>
          <PopoverTrigger className="custom-class" data-testid="trigger">
            Open Popover
          </PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      expect(screen.getByTestId("trigger")).toHaveClass("custom-class");
    });

    it("applies custom className to content", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent className="custom-class" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByTestId("content")).toHaveClass("custom-class");
      });
    });
  });

  describe("positioning", () => {
    it("supports align prop", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent align="start" data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByTestId("content")).toBeInTheDocument();
      });
    });

    it("supports sideOffset prop", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent sideOffset={10} data-testid="content">
            Content
          </PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByTestId("content")).toBeInTheDocument();
      });
    });
  });

  describe("PopoverAnchor", () => {
    it("renders anchor element", () => {
      render(
        <Popover>
          <PopoverAnchor data-testid="anchor">
            <span>Anchor Element</span>
          </PopoverAnchor>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>Content</PopoverContent>
        </Popover>
      );

      expect(screen.getByTestId("anchor")).toBeInTheDocument();
      expect(screen.getByText("Anchor Element")).toBeInTheDocument();
    });
  });

  describe("complex content", () => {
    it("renders complex content within popover", async () => {
      render(
        <Popover defaultOpen={true}>
          <PopoverTrigger>Open Popover</PopoverTrigger>
          <PopoverContent>
            <div>
              <h3>Popover Title</h3>
              <p>Popover description text</p>
              <button>Action Button</button>
            </div>
          </PopoverContent>
        </Popover>
      );

      await waitFor(() => {
        expect(screen.getByText("Popover Title")).toBeInTheDocument();
        expect(screen.getByText("Popover description text")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Action Button" })).toBeInTheDocument();
      });
    });
  });

  describe("accessibility", () => {
    it("can be focused", () => {
      renderPopover();
      const trigger = screen.getByText("Open Popover");
      trigger.focus();
      expect(trigger).toHaveFocus();
    });

    it("supports keyboard to open", async () => {
      renderPopover();
      const trigger = screen.getByText("Open Popover");

      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Popover content here")).toBeInTheDocument();
      });
    });
  });
});
