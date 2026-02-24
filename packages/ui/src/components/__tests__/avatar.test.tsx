import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar, AvatarImage, AvatarFallback } from "../avatar";

describe("Avatar", () => {
  describe("Avatar component", () => {
    it("renders avatar container", () => {
      render(<Avatar data-testid="avatar" />);
      expect(screen.getByTestId("avatar")).toBeInTheDocument();
    });

    it("applies base styling", () => {
      render(<Avatar data-testid="avatar" />);
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveClass("h-10");
      expect(avatar).toHaveClass("w-10");
      expect(avatar).toHaveClass("rounded-full");
    });

    it("applies flex and overflow styling", () => {
      render(<Avatar data-testid="avatar" />);
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveClass("relative");
      expect(avatar).toHaveClass("flex");
      expect(avatar).toHaveClass("shrink-0");
      expect(avatar).toHaveClass("overflow-hidden");
    });
  });

  describe("AvatarImage component", () => {
    it("renders image with src", () => {
      render(
        <Avatar>
          <AvatarImage src="/test-image.jpg" alt="Test user" />
        </Avatar>
      );
      expect(screen.getByRole("img", { name: "Test user" })).toBeInTheDocument();
    });

    it("applies image styling", () => {
      render(
        <Avatar>
          <AvatarImage src="/test.jpg" alt="Test" data-testid="avatar-image" />
        </Avatar>
      );
      const img = screen.getByTestId("avatar-image");
      expect(img).toHaveClass("aspect-square");
      expect(img).toHaveClass("h-full");
      expect(img).toHaveClass("w-full");
    });
  });

  describe("AvatarFallback component", () => {
    it("renders fallback content", () => {
      render(
        <Avatar>
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
      );
      expect(screen.getByText("JD")).toBeInTheDocument();
    });

    it("applies fallback styling", () => {
      render(
        <Avatar>
          <AvatarFallback data-testid="fallback">JD</AvatarFallback>
        </Avatar>
      );
      const fallback = screen.getByTestId("fallback");
      expect(fallback).toHaveClass("flex");
      expect(fallback).toHaveClass("h-full");
      expect(fallback).toHaveClass("w-full");
      expect(fallback).toHaveClass("items-center");
      expect(fallback).toHaveClass("justify-center");
      expect(fallback).toHaveClass("rounded-full");
    });

    it("applies muted background", () => {
      render(
        <Avatar>
          <AvatarFallback data-testid="fallback">JD</AvatarFallback>
        </Avatar>
      );
      expect(screen.getByTestId("fallback")).toHaveClass("bg-muted");
    });
  });

  describe("composition", () => {
    it("renders avatar with image and fallback", () => {
      render(
        <Avatar data-testid="avatar">
          <AvatarImage src="/user.jpg" alt="John Doe" />
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
      );

      expect(screen.getByTestId("avatar")).toBeInTheDocument();
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    it("shows fallback when no image src", () => {
      render(
        <Avatar>
          <AvatarFallback>AB</AvatarFallback>
        </Avatar>
      );
      expect(screen.getByText("AB")).toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className to Avatar", () => {
      render(<Avatar className="custom-class" data-testid="avatar" />);
      expect(screen.getByTestId("avatar")).toHaveClass("custom-class");
    });

    it("applies custom className to AvatarImage", () => {
      render(
        <Avatar>
          <AvatarImage src="/test.jpg" alt="Test" className="custom-class" data-testid="img" />
        </Avatar>
      );
      expect(screen.getByTestId("img")).toHaveClass("custom-class");
    });

    it("applies custom className to AvatarFallback", () => {
      render(
        <Avatar>
          <AvatarFallback className="custom-class" data-testid="fallback">FB</AvatarFallback>
        </Avatar>
      );
      expect(screen.getByTestId("fallback")).toHaveClass("custom-class");
    });
  });

  describe("sizes via className", () => {
    it("can be made smaller with className", () => {
      render(<Avatar className="h-8 w-8" data-testid="avatar" />);
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveClass("h-8");
      expect(avatar).toHaveClass("w-8");
    });

    it("can be made larger with className", () => {
      render(<Avatar className="h-16 w-16" data-testid="avatar" />);
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveClass("h-16");
      expect(avatar).toHaveClass("w-16");
    });
  });
});
