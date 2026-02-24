import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator as _SelectSeparator,
} from "../select";

describe("Select", () => {
  const renderSelect = (props = {}) => {
    return render(
      <Select {...props}>
        <SelectTrigger>
          <SelectValue placeholder="Select option" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
          <SelectItem value="option3">Option 3</SelectItem>
        </SelectContent>
      </Select>
    );
  };

  describe("SelectTrigger", () => {
    it("renders trigger button", () => {
      renderSelect();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("displays placeholder", () => {
      renderSelect();
      expect(screen.getByText("Select option")).toBeInTheDocument();
    });

    it("applies styling classes", () => {
      renderSelect();
      const trigger = screen.getByRole("combobox");
      expect(trigger).toHaveClass("flex");
      expect(trigger).toHaveClass("h-10");
      expect(trigger).toHaveClass("w-full");
      expect(trigger).toHaveClass("rounded-md");
    });

    it("opens dropdown when clicked", () => {
      renderSelect();
      fireEvent.click(screen.getByRole("combobox"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  describe("SelectContent", () => {
    it("renders options when open", () => {
      renderSelect();
      fireEvent.click(screen.getByRole("combobox"));

      expect(screen.getByRole("option", { name: "Option 1" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Option 2" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Option 3" })).toBeInTheDocument();
    });
  });

  describe("SelectItem", () => {
    it("selects item on click", () => {
      const onValueChange = vi.fn();
      render(
        <Select onValueChange={onValueChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test Option</SelectItem>
          </SelectContent>
        </Select>
      );

      fireEvent.click(screen.getByRole("combobox"));
      fireEvent.click(screen.getByRole("option", { name: "Test Option" }));

      expect(onValueChange).toHaveBeenCalledWith("test");
    });

    it("renders check indicator when selected", () => {
      render(
        <Select value="selected">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="selected">Selected Option</SelectItem>
          </SelectContent>
        </Select>
      );

      fireEvent.click(screen.getByRole("combobox"));
      const selectedItem = screen.getByRole("option", { name: "Selected Option" });
      expect(selectedItem).toHaveAttribute("data-state", "checked");
    });

    it("supports disabled state", () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled" disabled>Disabled Option</SelectItem>
          </SelectContent>
        </Select>
      );

      fireEvent.click(screen.getByRole("combobox"));
      expect(screen.getByRole("option", { name: "Disabled Option" })).toHaveAttribute("data-disabled");
    });
  });

  describe("SelectGroup and SelectLabel", () => {
    it("renders grouped options", () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Group 1</SelectLabel>
              <SelectItem value="item1">Item 1</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      );

      fireEvent.click(screen.getByRole("combobox"));
      expect(screen.getByText("Group 1")).toBeInTheDocument();
    });
  });

  describe("controlled state", () => {
    it("displays selected value", () => {
      render(
        <Select value="option2">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
            <SelectItem value="option2">Option 2</SelectItem>
          </SelectContent>
        </Select>
      );

      expect(screen.getByText("Option 2")).toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("renders disabled trigger", () => {
      render(
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
          </SelectContent>
        </Select>
      );

      expect(screen.getByRole("combobox")).toBeDisabled();
    });
  });

  describe("custom className", () => {
    it("applies custom className to trigger", () => {
      render(
        <Select>
          <SelectTrigger className="custom-class" data-testid="trigger">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="option1">Option 1</SelectItem>
          </SelectContent>
        </Select>
      );

      expect(screen.getByTestId("trigger")).toHaveClass("custom-class");
    });
  });

  describe("accessibility", () => {
    it("has combobox role", () => {
      renderSelect();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("has listbox role when open", () => {
      renderSelect();
      fireEvent.click(screen.getByRole("combobox"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("options have option role", () => {
      renderSelect();
      fireEvent.click(screen.getByRole("combobox"));
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });
  });
});
