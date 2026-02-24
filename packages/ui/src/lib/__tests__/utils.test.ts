import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn utility function", () => {
  describe("basic class merging", () => {
    it("merges multiple class strings", () => {
      const result = cn("foo", "bar");
      expect(result).toBe("foo bar");
    });

    it("handles single class", () => {
      const result = cn("foo");
      expect(result).toBe("foo");
    });

    it("handles empty input", () => {
      const result = cn();
      expect(result).toBe("");
    });

    it("handles undefined values", () => {
      const result = cn("foo", undefined, "bar");
      expect(result).toBe("foo bar");
    });

    it("handles null values", () => {
      const result = cn("foo", null, "bar");
      expect(result).toBe("foo bar");
    });

    it("handles false values", () => {
      const result = cn("foo", false, "bar");
      expect(result).toBe("foo bar");
    });
  });

  describe("conditional classes", () => {
    it("includes class when condition is true", () => {
      const isActive = true;
      const result = cn("base", isActive && "active");
      expect(result).toBe("base active");
    });

    it("excludes class when condition is false", () => {
      const isActive = false;
      const result = cn("base", isActive && "active");
      expect(result).toBe("base");
    });

    it("handles ternary conditions", () => {
      const isError = true;
      const result = cn("base", isError ? "text-red-500" : "text-green-500");
      expect(result).toBe("base text-red-500");
    });
  });

  describe("tailwind class conflict resolution", () => {
    it("resolves padding conflicts (last wins)", () => {
      const result = cn("p-4", "p-2");
      expect(result).toBe("p-2");
    });

    it("resolves margin conflicts", () => {
      const result = cn("m-4", "m-8");
      expect(result).toBe("m-8");
    });

    it("resolves text color conflicts", () => {
      const result = cn("text-red-500", "text-blue-500");
      expect(result).toBe("text-blue-500");
    });

    it("resolves background color conflicts", () => {
      const result = cn("bg-white", "bg-black");
      expect(result).toBe("bg-black");
    });

    it("keeps non-conflicting classes", () => {
      const result = cn("p-4", "m-2", "text-red-500");
      expect(result).toBe("p-4 m-2 text-red-500");
    });

    it("resolves flex direction conflicts", () => {
      const result = cn("flex-row", "flex-col");
      expect(result).toBe("flex-col");
    });

    it("resolves width conflicts", () => {
      const result = cn("w-full", "w-1/2");
      expect(result).toBe("w-1/2");
    });

    it("resolves display conflicts", () => {
      const result = cn("block", "flex");
      expect(result).toBe("flex");
    });
  });

  describe("object syntax", () => {
    it("handles object with boolean values", () => {
      const result = cn({
        "base-class": true,
        "active-class": true,
        "disabled-class": false,
      });
      expect(result).toBe("base-class active-class");
    });

    it("handles mixed array and object", () => {
      const result = cn("base", { active: true, disabled: false });
      expect(result).toBe("base active");
    });
  });

  describe("array syntax", () => {
    it("handles array of classes", () => {
      const result = cn(["foo", "bar", "baz"]);
      expect(result).toBe("foo bar baz");
    });

    it("handles nested arrays", () => {
      const result = cn(["foo", ["bar", "baz"]]);
      expect(result).toBe("foo bar baz");
    });
  });

  describe("complex scenarios", () => {
    it("handles real-world button example", () => {
      const variant = "primary";
      const size = "lg";
      const disabled = false;

      const result = cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        variant === "primary" && "bg-blue-500 text-white",
        variant === "secondary" && "bg-gray-200 text-gray-900",
        size === "sm" && "px-2 py-1 text-sm",
        size === "lg" && "px-4 py-2 text-lg",
        disabled && "opacity-50 cursor-not-allowed"
      );

      expect(result).toContain("bg-blue-500");
      expect(result).toContain("text-white");
      expect(result).toContain("px-4");
      expect(result).toContain("py-2");
      expect(result).not.toContain("opacity-50");
    });

    it("handles className override pattern", () => {
      const baseClasses = "p-4 bg-white text-black";
      const overrideClasses = "p-2 text-red-500";

      const result = cn(baseClasses, overrideClasses);

      expect(result).toContain("p-2");
      expect(result).not.toContain("p-4");
      expect(result).toContain("bg-white");
      expect(result).toContain("text-red-500");
      expect(result).not.toContain("text-black");
    });
  });
});
