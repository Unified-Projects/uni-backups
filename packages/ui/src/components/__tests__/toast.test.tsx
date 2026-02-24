import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
} from "../toast";

describe("Toast", () => {
  const renderToast = (props = {}) => {
    return render(
      <ToastProvider>
        <Toast open={true} {...props}>
          <ToastTitle>Toast Title</ToastTitle>
          <ToastDescription>Toast description text</ToastDescription>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
  };

  describe("rendering", () => {
    it("renders toast when open", () => {
      renderToast();
      expect(screen.getByText("Toast Title")).toBeInTheDocument();
      expect(screen.getByText("Toast description text")).toBeInTheDocument();
    });

    it("does not render when closed", () => {
      render(
        <ToastProvider>
          <Toast open={false}>
            <ToastTitle>Hidden Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.queryByText("Hidden Toast")).not.toBeInTheDocument();
    });
  });

  describe("ToastTitle", () => {
    it("renders title", () => {
      renderToast();
      expect(screen.getByText("Toast Title")).toBeInTheDocument();
    });

    it("applies title styling", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle data-testid="title">Title</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("title")).toHaveClass("text-sm");
      expect(screen.getByTestId("title")).toHaveClass("font-semibold");
    });
  });

  describe("ToastDescription", () => {
    it("renders description", () => {
      renderToast();
      expect(screen.getByText("Toast description text")).toBeInTheDocument();
    });

    it("applies description styling", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastDescription data-testid="desc">Description</ToastDescription>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("desc")).toHaveClass("text-sm");
      expect(screen.getByTestId("desc")).toHaveClass("opacity-90");
    });
  });

  describe("ToastClose", () => {
    it("renders close button", () => {
      renderToast();
      const closeButton = screen.getByRole("button");
      expect(closeButton).toBeInTheDocument();
    });

    it("closes toast when clicked", async () => {
      const onOpenChange = vi.fn();
      render(
        <ToastProvider>
          <Toast open={true} onOpenChange={onOpenChange}>
            <ToastTitle>Toast</ToastTitle>
            <ToastClose />
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("ToastAction", () => {
    it("renders action button", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle>Toast</ToastTitle>
            <ToastAction altText="Undo action">Undo</ToastAction>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    });

    it("calls onClick when action is clicked", async () => {
      const onClick = vi.fn();
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle>Toast</ToastTitle>
            <ToastAction altText="Undo action" onClick={onClick}>Undo</ToastAction>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));

      expect(onClick).toHaveBeenCalled();
    });

    it("applies action styling", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle>Toast</ToastTitle>
            <ToastAction altText="Action" data-testid="action">Action</ToastAction>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("action")).toHaveClass("inline-flex");
      expect(screen.getByTestId("action")).toHaveClass("rounded-md");
    });
  });

  describe("variants", () => {
    it("renders default variant", () => {
      render(
        <ToastProvider>
          <Toast open={true} variant="default" data-testid="toast">
            <ToastTitle>Default Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("toast")).toHaveClass("bg-background");
    });

    it("renders destructive variant", () => {
      render(
        <ToastProvider>
          <Toast open={true} variant="destructive" data-testid="toast">
            <ToastTitle>Error Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("toast")).toHaveClass("destructive");
    });

    it("renders success variant", () => {
      render(
        <ToastProvider>
          <Toast open={true} variant="success" data-testid="toast">
            <ToastTitle>Success Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("toast")).toHaveClass("border-green-200");
    });
  });

  describe("styling", () => {
    it("applies base toast styling", () => {
      render(
        <ToastProvider>
          <Toast open={true} data-testid="toast">
            <ToastTitle>Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      const toast = screen.getByTestId("toast");
      expect(toast).toHaveClass("pointer-events-auto");
      expect(toast).toHaveClass("rounded-md");
      expect(toast).toHaveClass("border");
      expect(toast).toHaveClass("shadow-lg");
    });
  });

  describe("ToastViewport", () => {
    it("renders viewport", () => {
      render(
        <ToastProvider>
          <ToastViewport data-testid="viewport" />
        </ToastProvider>
      );

      expect(screen.getByTestId("viewport")).toBeInTheDocument();
    });

    it("applies viewport styling", () => {
      render(
        <ToastProvider>
          <ToastViewport data-testid="viewport" />
        </ToastProvider>
      );

      const viewport = screen.getByTestId("viewport");
      expect(viewport).toHaveClass("fixed");
      expect(viewport).toHaveClass("z-[100]");
    });
  });

  describe("custom className", () => {
    it("applies custom className to toast", () => {
      render(
        <ToastProvider>
          <Toast open={true} className="custom-class" data-testid="toast">
            <ToastTitle>Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("toast")).toHaveClass("custom-class");
    });

    it("applies custom className to title", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle className="custom-class" data-testid="title">Title</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("title")).toHaveClass("custom-class");
    });

    it("applies custom className to description", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastDescription className="custom-class" data-testid="desc">Description</ToastDescription>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("desc")).toHaveClass("custom-class");
    });

    it("applies custom className to viewport", () => {
      render(
        <ToastProvider>
          <ToastViewport className="custom-class" data-testid="viewport" />
        </ToastProvider>
      );

      expect(screen.getByTestId("viewport")).toHaveClass("custom-class");
    });
  });

  describe("duration", () => {
    it("supports duration prop via provider", () => {
      render(
        <ToastProvider duration={5000}>
          <Toast open={true}>
            <ToastTitle>Timed Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByText("Timed Toast")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has appropriate role", () => {
      render(
        <ToastProvider>
          <Toast open={true}>
            <ToastTitle>Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("close button is keyboard accessible", () => {
      renderToast();
      const closeButton = screen.getByRole("button");
      closeButton.focus();
      expect(closeButton).toHaveFocus();
    });
  });

  describe("swipe gestures", () => {
    it("applies swipe animation classes", () => {
      render(
        <ToastProvider swipeDirection="right">
          <Toast open={true} data-testid="toast">
            <ToastTitle>Swipeable Toast</ToastTitle>
          </Toast>
          <ToastViewport />
        </ToastProvider>
      );

      expect(screen.getByTestId("toast")).toBeInTheDocument();
    });
  });
});
