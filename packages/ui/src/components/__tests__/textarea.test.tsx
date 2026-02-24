import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Textarea } from "../textarea";

describe("Textarea", () => {
  describe("rendering", () => {
    it("renders textarea element", () => {
      render(<Textarea />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders with placeholder", () => {
      render(<Textarea placeholder="Enter description" />);
      expect(screen.getByPlaceholderText("Enter description")).toBeInTheDocument();
    });

    it("renders with default value", () => {
      render(<Textarea defaultValue="initial text" />);
      expect(screen.getByRole("textbox")).toHaveValue("initial text");
    });

    it("applies base styling", () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveClass("rounded-md");
      expect(textarea).toHaveClass("border");
    });
  });

  describe("interactions", () => {
    it("calls onChange handler when value changes", () => {
      const onChange = vi.fn();
      render(<Textarea onChange={onChange} />);

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "new text" } });

      expect(onChange).toHaveBeenCalled();
    });

    it("updates value on user input", () => {
      render(<Textarea />);
      const textarea = screen.getByRole("textbox");

      fireEvent.change(textarea, { target: { value: "typed text" } });

      expect(textarea).toHaveValue("typed text");
    });

    it("supports multiline input", () => {
      render(<Textarea />);
      const textarea = screen.getByRole("textbox");
      const multilineText = "Line 1\nLine 2\nLine 3";

      fireEvent.change(textarea, { target: { value: multilineText } });

      expect(textarea).toHaveValue(multilineText);
    });
  });

  describe("states", () => {
    it("renders disabled state", () => {
      render(<Textarea disabled />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("renders readonly state", () => {
      render(<Textarea readOnly />);
      expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    });

    it("renders required state", () => {
      render(<Textarea required />);
      expect(screen.getByRole("textbox")).toBeRequired();
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Textarea className="custom-class" data-testid="textarea" />);
      expect(screen.getByTestId("textarea")).toHaveClass("custom-class");
    });
  });

  describe("HTML attributes", () => {
    it("supports rows attribute", () => {
      render(<Textarea rows={5} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("rows", "5");
    });

    it("supports cols attribute", () => {
      render(<Textarea cols={40} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("cols", "40");
    });

    it("supports maxLength attribute", () => {
      render(<Textarea maxLength={500} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("maxLength", "500");
    });

    it("supports name attribute", () => {
      render(<Textarea name="description" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("name", "description");
    });
  });

  describe("accessibility", () => {
    it("supports aria-label", () => {
      render(<Textarea aria-label="Description" />);
      expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    });

    it("can be associated with label", () => {
      render(
        <>
          <label htmlFor="desc">Description</label>
          <Textarea id="desc" />
        </>
      );
      expect(screen.getByLabelText("Description")).toBeInTheDocument();
    });
  });
});
