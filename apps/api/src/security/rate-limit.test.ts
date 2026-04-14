import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { rateLimitMiddleware } from "./rate-limit";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", rateLimitMiddleware());
  app.post("/api/restore", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimitMiddleware", () => {
  it("does not rate limit requests without forwarded client headers", async () => {
    const app = buildApp();

    for (let i = 0; i < 6; i += 1) {
      const res = await app.request("/api/restore", { method: "POST" });
      expect(res.status).toBe(200);
    }
  });

  it("still rate limits requests when a forwarded client IP is present", async () => {
    const app = buildApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await app.request("/api/restore", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request("/api/restore", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(limited.status).toBe(429);
  });
});
