import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RadioGroup, RadioGroupItem } from "../radio-group";
import { Label } from "../label";

describe("RadioGroup", () => {
  describe("rendering", () => {
    it("renders radio group", () => {
      render(
        <RadioGroup defaultValue="option1">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });

    it("renders radio items", () => {
      render(
        <RadioGroup defaultValue="option1">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });
  });

  describe("selection", () => {
    it("selects default value", () => {
      render(
        <RadioGroup defaultValue="option2">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      const radios = screen.getAllByRole("radio");
      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
    });

    it("changes selection on click", () => {
      render(
        <RadioGroup defaultValue="option1">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      const radios = screen.getAllByRole("radio");

      fireEvent.click(radios[1]);

      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
    });

    it("calls onValueChange when selection changes", () => {
      const onValueChange = vi.fn();
      render(
        <RadioGroup defaultValue="option1" onValueChange={onValueChange}>
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );

      fireEvent.click(screen.getAllByRole("radio")[1]);

      expect(onValueChange).toHaveBeenCalledWith("option2");
    });
  });

  describe("controlled state", () => {
    it("respects controlled value", () => {
      render(
        <RadioGroup value="option2">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      const radios = screen.getAllByRole("radio");
      expect(radios[1]).toBeChecked();
    });
  });

  describe("disabled state", () => {
    it("disables all items when group is disabled", () => {
      render(
        <RadioGroup disabled defaultValue="option1">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" />
        </RadioGroup>
      );
      const radios = screen.getAllByRole("radio");
      expect(radios[0]).toBeDisabled();
      expect(radios[1]).toBeDisabled();
    });

    it("supports disabled individual items", () => {
      render(
        <RadioGroup defaultValue="option1">
          <RadioGroupItem value="option1" />
          <RadioGroupItem value="option2" disabled />
        </RadioGroup>
      );
      const radios = screen.getAllByRole("radio");
      expect(radios[0]).not.toBeDisabled();
      expect(radios[1]).toBeDisabled();
    });
  });

  describe("styling", () => {
    it("applies grid layout by default", () => {
      render(
        <RadioGroup data-testid="group">
          <RadioGroupItem value="option1" />
        </RadioGroup>
      );
      expect(screen.getByTestId("group")).toHaveClass("grid");
    });

    it("applies item styling", () => {
      render(
        <RadioGroup>
          <RadioGroupItem value="option1" data-testid="item" />
        </RadioGroup>
      );
      const item = screen.getByTestId("item");
      expect(item).toHaveClass("h-4");
      expect(item).toHaveClass("w-4");
      expect(item).toHaveClass("rounded-full");
    });
  });

  describe("with labels", () => {
    it("works with labels", () => {
      render(
        <RadioGroup defaultValue="option1">
          <div>
            <RadioGroupItem value="option1" id="option1" />
            <Label htmlFor="option1">Option 1</Label>
          </div>
          <div>
            <RadioGroupItem value="option2" id="option2" />
            <Label htmlFor="option2">Option 2</Label>
          </div>
        </RadioGroup>
      );

      expect(screen.getByLabelText("Option 1")).toBeInTheDocument();
      expect(screen.getByLabelText("Option 2")).toBeInTheDocument();
    });

    it("selects radio when label is clicked", () => {
      render(
        <RadioGroup defaultValue="option1">
          <div>
            <RadioGroupItem value="option1" id="option1" />
            <Label htmlFor="option1">Option 1</Label>
          </div>
          <div>
            <RadioGroupItem value="option2" id="option2" />
            <Label htmlFor="option2">Option 2</Label>
          </div>
        </RadioGroup>
      );

      fireEvent.click(screen.getByText("Option 2"));
      expect(screen.getByLabelText("Option 2")).toBeChecked();
    });
  });

  describe("custom className", () => {
    it("applies custom className to group", () => {
      render(
        <RadioGroup className="custom-class" data-testid="group">
          <RadioGroupItem value="option1" />
        </RadioGroup>
      );
      expect(screen.getByTestId("group")).toHaveClass("custom-class");
    });

    it("applies custom className to item", () => {
      render(
        <RadioGroup>
          <RadioGroupItem value="option1" className="custom-class" data-testid="item" />
        </RadioGroup>
      );
      expect(screen.getByTestId("item")).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("has radiogroup role", () => {
      render(
        <RadioGroup>
          <RadioGroupItem value="option1" />
        </RadioGroup>
      );
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    });

    it("supports aria-label", () => {
      render(
        <RadioGroup aria-label="Choose an option">
          <RadioGroupItem value="option1" />
        </RadioGroup>
      );
      expect(screen.getByRole("radiogroup", { name: "Choose an option" })).toBeInTheDocument();
    });

    it("supports required attribute", () => {
      render(
        <RadioGroup required>
          <RadioGroupItem value="option1" />
        </RadioGroup>
      );
      expect(screen.getByRole("radiogroup")).toBeRequired();
    });
  });
});
