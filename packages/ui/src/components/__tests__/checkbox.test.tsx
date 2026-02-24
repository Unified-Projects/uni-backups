import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Checkbox } from "../checkbox";

describe("Checkbox", () => {
  describe("rendering", () => {
    it("renders checkbox element", () => {
      render(<Checkbox />);
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("renders unchecked by default", () => {
      render(<Checkbox />);
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("applies base styling", () => {
      render(<Checkbox data-testid="checkbox" />);
      const checkbox = screen.getByTestId("checkbox");
      expect(checkbox).toHaveClass("h-4");
      expect(checkbox).toHaveClass("w-4");
      expect(checkbox).toHaveClass("rounded-sm");
    });
  });

  describe("states", () => {
    it("renders checked state when defaultChecked", () => {
      render(<Checkbox defaultChecked />);
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("renders controlled checked state", () => {
      render(<Checkbox checked={true} />);
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("renders controlled unchecked state", () => {
      render(<Checkbox checked={false} />);
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("renders disabled state", () => {
      render(<Checkbox disabled />);
      expect(screen.getByRole("checkbox")).toBeDisabled();
    });

    it("applies disabled styling", () => {
      render(<Checkbox disabled data-testid="checkbox" />);
      expect(screen.getByTestId("checkbox")).toHaveClass("disabled:opacity-50");
    });
  });

  describe("interactions", () => {
    it("toggles checked state on click (uncontrolled)", () => {
      render(<Checkbox />);
      const checkbox = screen.getByRole("checkbox");

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it("calls onCheckedChange when toggled", () => {
      const onCheckedChange = vi.fn();
      render(<Checkbox onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("checkbox"));

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it("does not toggle when disabled", () => {
      const onCheckedChange = vi.fn();
      render(<Checkbox disabled onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("checkbox"));

      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Checkbox className="custom-class" data-testid="checkbox" />);
      expect(screen.getByTestId("checkbox")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Checkbox className="custom-class" data-testid="checkbox" />);
      const checkbox = screen.getByTestId("checkbox");
      expect(checkbox).toHaveClass("custom-class");
      expect(checkbox).toHaveClass("rounded-sm");
    });
  });

  describe("accessibility", () => {
    it("supports aria-label", () => {
      render(<Checkbox aria-label="Accept terms" />);
      expect(screen.getByRole("checkbox", { name: "Accept terms" })).toBeInTheDocument();
    });

    it("supports aria-describedby", () => {
      render(
        <>
          <Checkbox aria-describedby="terms-help" />
          <span id="terms-help">You must accept the terms</span>
        </>
      );
      expect(screen.getByRole("checkbox")).toHaveAttribute("aria-describedby", "terms-help");
    });

    it("can be focused via keyboard", () => {
      render(<Checkbox data-testid="checkbox" />);
      const checkbox = screen.getByTestId("checkbox");

      checkbox.focus();
      expect(checkbox).toHaveFocus();
    });

    it("supports required attribute", () => {
      render(<Checkbox required />);
      expect(screen.getByRole("checkbox")).toBeRequired();
    });
  });

  describe("HTML attributes", () => {
    it("supports name attribute", () => {
      const { container } = render(<Checkbox name="terms" data-testid="checkbox" />);
      // Radix Checkbox puts name on a hidden input element, not the button
      const hiddenInput = container.querySelector('input[name="terms"]');
      expect(hiddenInput).toBeInTheDocument();
    });

    it("supports id attribute", () => {
      render(<Checkbox id="terms-checkbox" />);
      expect(screen.getByRole("checkbox")).toHaveAttribute("id", "terms-checkbox");
    });

    it("supports value attribute", () => {
      render(<Checkbox value="accepted" data-testid="checkbox" />);
      expect(screen.getByTestId("checkbox")).toHaveAttribute("value", "accepted");
    });
  });

  describe("with label", () => {
    it("can be associated with label via id", () => {
      render(
        <>
          <label htmlFor="checkbox-1">Accept terms</label>
          <Checkbox id="checkbox-1" />
        </>
      );
      expect(screen.getByLabelText("Accept terms")).toBeInTheDocument();
    });
  });
});
