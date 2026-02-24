import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatDistanceToNow, formatDuration } from "./utils";

describe("utils", () => {
  describe("formatBytes", () => {
    it("formats sizes with units", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
    });
  });

  describe("formatDistanceToNow", () => {
    it("returns human friendly relative time", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

      expect(formatDistanceToNow(new Date("2023-12-31T23:59:30Z"))).toBe("just now");
      expect(formatDistanceToNow(new Date("2023-12-31T23:50:00Z"))).toBe("10m ago");
      expect(formatDistanceToNow(new Date("2023-12-31T12:00:00Z"))).toBe("12h ago");

      vi.useRealTimers();
    });
  });

  describe("formatDuration", () => {
    it("formats elapsed time between dates", () => {
      const start = new Date("2024-01-01T00:00:00Z");
      const end = new Date("2024-01-01T01:05:10Z");

      expect(formatDuration(start, end)).toBe("1h 5m");
      expect(formatDuration(start, new Date("2024-01-01T00:03:04Z"))).toBe("3m 4s");
      expect(formatDuration(start, new Date("2024-01-01T00:00:45Z"))).toBe("45s");
    });
  });
});
