import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose as _DialogClose,
} from "../dialog";

describe("Dialog", () => {
  describe("DialogTrigger", () => {
    it("renders trigger button", () => {
      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
        </Dialog>
      );
      expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    });

    it("opens dialog when clicked", () => {
      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("DialogContent", () => {
    it("renders dialog content when open", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog Content</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("applies styling classes", () => {
      render(
        <Dialog open>
          <DialogContent data-testid="content">
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("content");
      expect(content).toHaveClass("fixed");
      expect(content).toHaveClass("z-50");
    });

    it("includes close button", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      // Close button has sr-only "Close" text
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });
  });

  describe("DialogHeader", () => {
    it("renders header element", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogHeader data-testid="header">
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("header")).toBeInTheDocument();
    });

    it("applies flex column layout", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogHeader data-testid="header">
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("header")).toHaveClass("flex");
      expect(screen.getByTestId("header")).toHaveClass("flex-col");
    });
  });

  describe("DialogFooter", () => {
    it("renders footer element", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogFooter data-testid="footer">Actions</DialogFooter>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("footer")).toBeInTheDocument();
    });

    it("applies flex layout", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogFooter data-testid="footer">Actions</DialogFooter>
          </DialogContent>
        </Dialog>
      );
      const footer = screen.getByTestId("footer");
      expect(footer).toHaveClass("flex");
    });
  });

  describe("DialogTitle", () => {
    it("renders title text", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>My Dialog Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByText("My Dialog Title")).toBeInTheDocument();
    });

    it("applies font styling", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle data-testid="title">Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      const title = screen.getByTestId("title");
      expect(title).toHaveClass("text-lg");
      expect(title).toHaveClass("font-semibold");
    });
  });

  describe("DialogDescription", () => {
    it("renders description text", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>This is a description</DialogDescription>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByText("This is a description")).toBeInTheDocument();
    });

    it("applies muted text styling", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription data-testid="desc">Description</DialogDescription>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("desc")).toHaveClass("text-muted-foreground");
    });
  });

  describe("controlled state", () => {
    it("opens when open prop is true", () => {
      render(
        <Dialog open={true}>
          <DialogContent>
            <DialogTitle>Open Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes when open prop is false", () => {
      render(
        <Dialog open={false}>
          <DialogContent>
            <DialogTitle>Closed Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("calls onOpenChange when toggled", () => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open={true} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("composition", () => {
    it("renders complete dialog", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Action</DialogTitle>
              <DialogDescription>Are you sure you want to continue?</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button>Cancel</button>
              <button>Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Confirm Action")).toBeInTheDocument();
      expect(screen.getByText("Are you sure you want to continue?")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className to DialogContent", () => {
      render(
        <Dialog open>
          <DialogContent className="custom-class" data-testid="content">
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("content")).toHaveClass("custom-class");
    });

    it("applies custom className to DialogHeader", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogHeader className="custom-class" data-testid="header">
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      expect(screen.getByTestId("header")).toHaveClass("custom-class");
    });
  });
});
