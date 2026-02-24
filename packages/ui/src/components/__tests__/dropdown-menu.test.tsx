import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../dropdown-menu";

describe("DropdownMenu", () => {
  const renderDropdownMenu = (props = {}) => {
    return render(
      <DropdownMenu {...props}>
        <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuItem>Item 2</DropdownMenuItem>
          <DropdownMenuItem>Item 3</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  describe("rendering", () => {
    it("renders trigger", () => {
      renderDropdownMenu();
      expect(screen.getByText("Open Menu")).toBeInTheDocument();
    });

    it("does not show content initially", () => {
      renderDropdownMenu();
      expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("shows content when trigger is clicked", async () => {
      renderDropdownMenu();

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
        expect(screen.getByText("Item 2")).toBeInTheDocument();
        expect(screen.getByText("Item 3")).toBeInTheDocument();
      });
    });

    it("calls onClick when item is selected", async () => {
      const onClick = vi.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onClick}>Clickable Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        fireEvent.click(screen.getByText("Clickable Item"));
      });

      expect(onClick).toHaveBeenCalled();
    });

    it("closes menu after item selection", async () => {
      renderDropdownMenu();

      fireEvent.click(screen.getByText("Open Menu"));
      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Item 1"));

      await waitFor(() => {
        expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
      });
    });

    it("closes on escape key", async () => {
      renderDropdownMenu();

      fireEvent.click(screen.getByText("Open Menu"));
      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
      });

      fireEvent.keyDown(document.body, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
      });
    });
  });

  describe("DropdownMenuLabel", () => {
    it("renders label", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("My Account")).toBeInTheDocument();
      });
    });

    it("applies label styling", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel data-testid="label">Label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("label")).toHaveClass("font-semibold");
      });
    });

    it("supports inset prop", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel inset data-testid="label">Label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("label")).toHaveClass("pl-8");
      });
    });
  });

  describe("DropdownMenuSeparator", () => {
    it("renders separator", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuSeparator data-testid="separator" />
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("separator")).toBeInTheDocument();
      });
    });

    it("applies separator styling", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSeparator data-testid="separator" />
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("separator")).toHaveClass("h-px");
        expect(screen.getByTestId("separator")).toHaveClass("bg-muted");
      });
    });
  });

  describe("DropdownMenuShortcut", () => {
    it("renders shortcut text", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              Save
              <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
      });
    });

    it("applies shortcut styling", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              Save
              <DropdownMenuShortcut data-testid="shortcut">Ctrl+S</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("shortcut")).toHaveClass("ml-auto");
        expect(screen.getByTestId("shortcut")).toHaveClass("text-xs");
      });
    });
  });

  describe("DropdownMenuCheckboxItem", () => {
    it("renders checkbox item", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={true}>
              Show Toolbar
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Show Toolbar")).toBeInTheDocument();
      });
    });

    it("calls onCheckedChange when toggled", async () => {
      const onCheckedChange = vi.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
              Show Toolbar
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        fireEvent.click(screen.getByText("Show Toolbar"));
      });

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });

  describe("DropdownMenuRadioGroup", () => {
    it("renders radio items", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="light">
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Light")).toBeInTheDocument();
        expect(screen.getByText("Dark")).toBeInTheDocument();
        expect(screen.getByText("System")).toBeInTheDocument();
      });
    });

    it("calls onValueChange when selection changes", async () => {
      const onValueChange = vi.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="light" onValueChange={onValueChange}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        fireEvent.click(screen.getByText("Dark"));
      });

      expect(onValueChange).toHaveBeenCalledWith("dark");
    });
  });

  describe("DropdownMenuGroup", () => {
    it("renders grouped items", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Account")).toBeInTheDocument();
        expect(screen.getByText("Profile")).toBeInTheDocument();
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
    });
  });

  describe("submenu", () => {
    it("renders submenu trigger", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
                <DropdownMenuItem>Sub Item 2</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("More Options")).toBeInTheDocument();
      });
    });
  });

  describe("disabled state", () => {
    it("supports disabled items", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem disabled>Disabled Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByText("Disabled Item")).toHaveAttribute("data-disabled");
      });
    });
  });

  describe("custom className", () => {
    it("applies custom className to content", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent className="custom-class" data-testid="content">
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("content")).toHaveClass("custom-class");
      });
    });

    it("applies custom className to item", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem className="custom-class" data-testid="item">Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("item")).toHaveClass("custom-class");
      });
    });
  });

  describe("styling", () => {
    it("applies content styling", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="content">
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        const content = screen.getByTestId("content");
        expect(content).toHaveClass("z-50");
        expect(content).toHaveClass("rounded-md");
        expect(content).toHaveClass("border");
      });
    });

    it("applies item styling", async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem data-testid="item">Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getByTestId("item")).toHaveClass("rounded-sm");
        expect(screen.getByTestId("item")).toHaveClass("text-sm");
      });
    });
  });

  describe("accessibility", () => {
    it("menu items have menuitem role", async () => {
      renderDropdownMenu();

      fireEvent.click(screen.getByText("Open Menu"));

      await waitFor(() => {
        expect(screen.getAllByRole("menuitem")).toHaveLength(3);
      });
    });

    it("trigger can be focused", () => {
      renderDropdownMenu();
      const trigger = screen.getByText("Open Menu");
      trigger.focus();
      expect(trigger).toHaveFocus();
    });
  });
});
