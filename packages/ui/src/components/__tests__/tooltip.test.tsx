import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../tooltip";

describe("Tooltip", () => {
  const renderTooltip = (props = {}) => {
    return render(
      <TooltipProvider delayDuration={0}>
        <Tooltip {...props}>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip content</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  describe("rendering", () => {
    it("renders trigger", () => {
      renderTooltip();
      expect(screen.getByText("Hover me")).toBeInTheDocument();
    });

    it("does not show content initially", () => {
      renderTooltip();
      expect(screen.queryByText("Tooltip content")).not.toBeInTheDocument();
    });
  });

  describe("controlled state", () => {
    it("respects open prop", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip open={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Open content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        expect(screen.getByText("Open content")).toBeInTheDocument();
      });
    });

    it("respects defaultOpen prop", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Default open content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        expect(screen.getByText("Default open content")).toBeInTheDocument();
      });
    });
  });

  describe("styling", () => {
    it("applies content styling", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent data-testid="content">Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const content = screen.getByTestId("content");
        expect(content).toHaveClass("z-50");
        expect(content).toHaveClass("rounded-md");
      });
    });
  });

  describe("custom className", () => {
    it("applies custom className to trigger", () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="custom-class" data-testid="trigger">Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(screen.getByTestId("trigger")).toHaveClass("custom-class");
    });

    it("applies custom className to content", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent className="custom-class" data-testid="content">Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("content")).toHaveClass("custom-class");
      });
    });
  });

  describe("accessibility", () => {
    it("has tooltip role", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole("tooltip")).toBeInTheDocument();
      });
    });

    it("associates trigger with tooltip", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip defaultOpen={true}>
            <TooltipTrigger data-testid="trigger">Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const trigger = screen.getByTestId("trigger");
        expect(trigger).toHaveAttribute("aria-describedby");
      });
    });
  });
});
