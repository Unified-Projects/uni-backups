import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Switch } from "../switch";

describe("Switch", () => {
  describe("rendering", () => {
    it("renders switch element", () => {
      render(<Switch />);
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });

    it("renders unchecked by default", () => {
      render(<Switch />);
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    });

    it("applies base styling", () => {
      render(<Switch data-testid="switch" />);
      const switchEl = screen.getByTestId("switch");
      expect(switchEl).toHaveClass("h-6");
      expect(switchEl).toHaveClass("w-11");
      expect(switchEl).toHaveClass("rounded-full");
    });
  });

  describe("states", () => {
    it("renders checked state when defaultChecked", () => {
      render(<Switch defaultChecked />);
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    });

    it("renders controlled checked state", () => {
      render(<Switch checked={true} />);
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    });

    it("renders controlled unchecked state", () => {
      render(<Switch checked={false} />);
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    });

    it("renders disabled state", () => {
      render(<Switch disabled />);
      expect(screen.getByRole("switch")).toBeDisabled();
    });

    it("applies data-state attribute", () => {
      render(<Switch defaultChecked data-testid="switch" />);
      expect(screen.getByTestId("switch")).toHaveAttribute("data-state", "checked");
    });
  });

  describe("interactions", () => {
    it("toggles checked state on click (uncontrolled)", () => {
      render(<Switch />);
      const switchEl = screen.getByRole("switch");

      fireEvent.click(switchEl);
      expect(switchEl).toHaveAttribute("aria-checked", "true");

      fireEvent.click(switchEl);
      expect(switchEl).toHaveAttribute("aria-checked", "false");
    });

    it("calls onCheckedChange when toggled", () => {
      const onCheckedChange = vi.fn();
      render(<Switch onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it("does not toggle when disabled", () => {
      const onCheckedChange = vi.fn();
      render(<Switch disabled onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Switch className="custom-class" data-testid="switch" />);
      expect(screen.getByTestId("switch")).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("supports aria-label", () => {
      render(<Switch aria-label="Toggle notifications" />);
      expect(screen.getByRole("switch", { name: "Toggle notifications" })).toBeInTheDocument();
    });

    it("can be focused via keyboard", () => {
      render(<Switch data-testid="switch" />);
      const switchEl = screen.getByTestId("switch");

      switchEl.focus();
      expect(switchEl).toHaveFocus();
    });

    it("supports required attribute", () => {
      render(<Switch required />);
      // Radix Switch uses aria-required on the button element
      expect(screen.getByRole("switch")).toHaveAttribute("aria-required", "true");
    });
  });

  describe("HTML attributes", () => {
    it("supports name attribute", () => {
      const { container } = render(<Switch name="notifications" data-testid="switch" />);
      // Radix Switch puts name on a hidden input element, not the button
      const hiddenInput = container.querySelector('input[name="notifications"]');
      expect(hiddenInput).toBeInTheDocument();
    });

    it("supports id attribute", () => {
      render(<Switch id="theme-switch" />);
      expect(screen.getByRole("switch")).toHaveAttribute("id", "theme-switch");
    });
  });

  describe("with label", () => {
    it("can be associated with label via id", () => {
      render(
        <>
          <label htmlFor="notifications-switch">Enable notifications</label>
          <Switch id="notifications-switch" />
        </>
      );
      expect(screen.getByLabelText("Enable notifications")).toBeInTheDocument();
    });
  });
});
