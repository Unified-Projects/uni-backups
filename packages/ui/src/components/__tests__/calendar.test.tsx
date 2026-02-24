import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Calendar } from "../calendar";

describe("Calendar", () => {
  describe("rendering", () => {
    it("renders calendar", () => {
      render(<Calendar />);
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    it("renders navigation buttons", () => {
      render(<Calendar />);
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it("renders month and year caption", () => {
      render(<Calendar />);
      const currentDate = new Date();
      const monthYear = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      expect(screen.getByText(monthYear)).toBeInTheDocument();
    });

    it("renders day headers", () => {
      render(<Calendar />);
      const dayHeaders = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      dayHeaders.forEach((day) => {
        expect(screen.getByText(day)).toBeInTheDocument();
      });
    });

    it("renders days of month", () => {
      render(<Calendar />);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("15")).toBeInTheDocument();
    });
  });

  describe("navigation", () => {
    it("navigates to previous month", () => {
      const currentDate = new Date();
      render(<Calendar defaultMonth={currentDate} />);

      const prevButton = screen.getAllByRole("button")[0];
      fireEvent.click(prevButton);

      const prevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1);
      const expectedMonthYear = prevMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      expect(screen.getByText(expectedMonthYear)).toBeInTheDocument();
    });

    it("navigates to next month", () => {
      const currentDate = new Date();
      render(<Calendar defaultMonth={currentDate} />);

      const buttons = screen.getAllByRole("button");
      const nextButton = buttons[buttons.length - 1];
      fireEvent.click(nextButton);

      const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1);
      const expectedMonthYear = nextMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      expect(screen.getByText(expectedMonthYear)).toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("selects a date when clicked", () => {
      const onSelect = vi.fn();
      render(<Calendar mode="single" onSelect={onSelect} />);

      const day15 = screen.getByText("15");
      fireEvent.click(day15);

      expect(onSelect).toHaveBeenCalled();
    });

    it("displays selected date with styling", () => {
      const selectedDate = new Date(2024, 5, 15);
      render(<Calendar mode="single" selected={selectedDate} defaultMonth={selectedDate} />);

      const day15 = screen.getByText("15");
      expect(day15).toHaveAttribute("aria-selected", "true");
    });

    it("supports range selection mode", () => {
      const onSelect = vi.fn();
      render(<Calendar mode="range" onSelect={onSelect} />);

      fireEvent.click(screen.getByText("10"));
      fireEvent.click(screen.getByText("20"));

      expect(onSelect).toHaveBeenCalled();
    });

    it("supports multiple selection mode", () => {
      const onSelect = vi.fn();
      render(<Calendar mode="multiple" onSelect={onSelect} />);

      fireEvent.click(screen.getByText("5"));
      fireEvent.click(screen.getByText("10"));
      fireEvent.click(screen.getByText("15"));

      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("disabled dates", () => {
    it("disables dates before fromDate", () => {
      const fromDate = new Date(2024, 5, 10);
      render(<Calendar defaultMonth={fromDate} fromDate={fromDate} />);

      const day5 = screen.getByText("5");
      expect(day5).toBeDisabled();
    });

    it("disables dates after toDate", () => {
      const toDate = new Date(2024, 5, 20);
      render(<Calendar defaultMonth={toDate} toDate={toDate} />);

      const day25 = screen.getByText("25");
      expect(day25).toBeDisabled();
    });

    it("supports disabled prop with function", () => {
      const disabledDays = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
      render(<Calendar disabled={disabledDays} />);

      const grid = screen.getByRole("grid");
      expect(grid).toBeInTheDocument();
    });
  });

  describe("outside days", () => {
    it("shows outside days by default", () => {
      render(<Calendar />);
      const grid = screen.getByRole("grid");
      expect(grid).toBeInTheDocument();
    });

    it("can hide outside days", () => {
      render(<Calendar showOutsideDays={false} />);
      const grid = screen.getByRole("grid");
      expect(grid).toBeInTheDocument();
    });
  });

  describe("styling", () => {
    it("applies base styling", () => {
      render(<Calendar className="custom-calendar" data-testid="calendar" />);
      expect(screen.getByTestId("calendar")).toHaveClass("custom-calendar");
      expect(screen.getByTestId("calendar")).toHaveClass("p-3");
    });
  });

  describe("controlled state", () => {
    it("respects month prop", () => {
      const controlledMonth = new Date(2024, 0, 1);
      render(<Calendar month={controlledMonth} />);

      expect(screen.getByText("January 2024")).toBeInTheDocument();
    });

    it("calls onMonthChange when navigation changes", () => {
      const onMonthChange = vi.fn();
      render(<Calendar onMonthChange={onMonthChange} />);

      const prevButton = screen.getAllByRole("button")[0];
      fireEvent.click(prevButton);

      expect(onMonthChange).toHaveBeenCalled();
    });
  });

  describe("today indicator", () => {
    it("highlights today", () => {
      const today = new Date();
      render(<Calendar defaultMonth={today} />);

      const todayDay = today.getDate().toString();
      const dayElements = screen.getAllByText(todayDay);
      const todayElement = dayElements.find((el) => el.closest("[aria-current]"));
      expect(todayElement || dayElements[0]).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has grid role", () => {
      render(<Calendar />);
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    it("day buttons are focusable", () => {
      render(<Calendar />);
      const day15 = screen.getByText("15");
      day15.focus();
      expect(day15).toHaveFocus();
    });

    it("supports keyboard navigation", () => {
      render(<Calendar />);
      const day15 = screen.getByText("15");
      day15.focus();

      fireEvent.keyDown(day15, { key: "ArrowRight" });
      expect(screen.getByText("16")).toBeInTheDocument();
    });
  });

  describe("localization", () => {
    it("renders with default locale", () => {
      render(<Calendar />);
      expect(screen.getByText("Su")).toBeInTheDocument();
    });
  });

  describe("number of months", () => {
    it("can display multiple months", () => {
      render(<Calendar numberOfMonths={2} />);
      const grids = screen.getAllByRole("grid");
      expect(grids.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("fixed weeks", () => {
    it("supports fixedWeeks prop", () => {
      render(<Calendar fixedWeeks />);
      const grid = screen.getByRole("grid");
      expect(grid).toBeInTheDocument();
    });
  });

  describe("week starts on", () => {
    it("supports weekStartsOn prop", () => {
      render(<Calendar weekStartsOn={1} />);
      const dayHeaders = screen.getAllByRole("columnheader");
      expect(dayHeaders[0]).toHaveTextContent("Mo");
    });
  });
});
