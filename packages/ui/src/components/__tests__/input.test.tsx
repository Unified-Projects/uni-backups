import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../input";

describe("Input", () => {
  describe("rendering", () => {
    it("renders input element", () => {
      render(<Input />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders with placeholder", () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
    });

    it("renders with default value", () => {
      render(<Input defaultValue="initial" />);
      expect(screen.getByRole("textbox")).toHaveValue("initial");
    });
  });

  describe("types", () => {
    it("renders text input by default", () => {
      render(<Input />);
      expect(screen.getByRole("textbox")).toHaveAttribute("type", "text");
    });

    it("renders email input", () => {
      render(<Input type="email" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("type", "email");
    });

    it("renders password input", () => {
      render(<Input type="password" />);
      const input = document.querySelector('input[type="password"]');
      expect(input).toBeInTheDocument();
    });

    it("renders number input", () => {
      render(<Input type="number" />);
      expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    });

    it("renders search input", () => {
      render(<Input type="search" />);
      expect(screen.getByRole("searchbox")).toBeInTheDocument();
    });

    it("renders tel input", () => {
      render(<Input type="tel" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("type", "tel");
    });

    it("renders url input", () => {
      render(<Input type="url" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("type", "url");
    });
  });

  describe("interactions", () => {
    it("calls onChange handler when value changes", () => {
      const onChange = vi.fn();
      render(<Input onChange={onChange} />);

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "test" } });

      expect(onChange).toHaveBeenCalled();
    });

    it("calls onFocus handler when focused", () => {
      const onFocus = vi.fn();
      render(<Input onFocus={onFocus} />);

      fireEvent.focus(screen.getByRole("textbox"));

      expect(onFocus).toHaveBeenCalled();
    });

    it("calls onBlur handler when blurred", () => {
      const onBlur = vi.fn();
      render(<Input onBlur={onBlur} />);

      fireEvent.blur(screen.getByRole("textbox"));

      expect(onBlur).toHaveBeenCalled();
    });

    it("updates value on user input", () => {
      render(<Input />);
      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "new value" } });

      expect(input).toHaveValue("new value");
    });
  });

  describe("controlled/uncontrolled", () => {
    it("works as controlled input", () => {
      render(<Input value="controlled" onChange={() => {}} />);
      expect(screen.getByRole("textbox")).toHaveValue("controlled");
    });

    it("works as uncontrolled input with defaultValue", () => {
      render(<Input defaultValue="default" />);
      expect(screen.getByRole("textbox")).toHaveValue("default");
    });
  });

  describe("states", () => {
    it("renders disabled state", () => {
      render(<Input disabled />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("renders readonly state", () => {
      render(<Input readOnly />);
      expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    });

    it("renders required state", () => {
      render(<Input required />);
      expect(screen.getByRole("textbox")).toBeRequired();
    });

    it("applies disabled styles", () => {
      render(<Input disabled />);
      expect(screen.getByRole("textbox")).toHaveClass("disabled:opacity-50");
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<Input className="custom-class" />);
      expect(screen.getByRole("textbox")).toHaveClass("custom-class");
    });

    it("merges custom className with default classes", () => {
      render(<Input className="custom-class" />);
      const input = screen.getByRole("textbox");
      expect(input).toHaveClass("custom-class");
      expect(input).toHaveClass("rounded-md");
    });
  });

  describe("accessibility", () => {
    it("supports aria-label", () => {
      render(<Input aria-label="Email address" />);
      expect(screen.getByRole("textbox", { name: "Email address" })).toBeInTheDocument();
    });

    it("supports aria-describedby", () => {
      render(
        <>
          <Input aria-describedby="help-text" />
          <span id="help-text">Enter your email</span>
        </>
      );
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-describedby", "help-text");
    });

    it("supports aria-invalid", () => {
      render(<Input aria-invalid="true" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("HTML attributes", () => {
    it("supports name attribute", () => {
      render(<Input name="email" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("name", "email");
    });

    it("supports id attribute", () => {
      render(<Input id="email-input" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("id", "email-input");
    });

    it("supports maxLength attribute", () => {
      render(<Input maxLength={50} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("maxLength", "50");
    });

    it("supports minLength attribute", () => {
      render(<Input minLength={5} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("minLength", "5");
    });

    it("supports pattern attribute", () => {
      render(<Input pattern="[A-Za-z]+" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("pattern", "[A-Za-z]+");
    });

    it("supports autoComplete attribute", () => {
      render(<Input autoComplete="email" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("autoComplete", "email");
    });
  });

  describe("ref forwarding", () => {
    it("forwards ref to input element", () => {
      const ref = vi.fn();
      render(<Input ref={ref} />);
      expect(ref).toHaveBeenCalled();
    });
  });
});
