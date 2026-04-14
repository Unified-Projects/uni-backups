import type { MiddlewareHandler } from "hono";

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const rateLimitWindows = new Map<string, RateLimitWindow>();

function getClientIdentifier(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return headers.get("x-real-ip") || null;
}

function getRule(method: string, path: string): RateLimitRule {
  if (path === "/api/auth/session" && method === "POST") {
    return { limit: 10, windowMs: 15 * 60 * 1000 };
  }

  if (path === "/api/restore" && method === "POST") {
    return { limit: 5, windowMs: 60 * 1000 };
  }

  if (
    method !== "GET" ||
    path.endsWith("/check") ||
    path.endsWith("/unlock") ||
    path.endsWith("/status") ||
    path.endsWith("/stats")
  ) {
    return { limit: 30, windowMs: 60 * 1000 };
  }

  return { limit: 240, windowMs: 60 * 1000 };
}

export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const clientIdentifier = getClientIdentifier(c.req.raw.headers);

    // Direct local/test traffic often has no forwarded client IP, which would
    // otherwise collapse all requests into one shared bucket.
    if (!clientIdentifier) {
      await next();
      return;
    }

    const method = c.req.method.toUpperCase();
    const path = c.req.path;
    const rule = getRule(method, path);
    const key = `${clientIdentifier}:${method}:${path}`;
    const now = Date.now();
    const window = rateLimitWindows.get(key);

    if (!window || window.resetAt <= now) {
      rateLimitWindows.set(key, {
        count: 1,
        resetAt: now + rule.windowMs,
      });
      await next();
      return;
    }

    if (window.count >= rule.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      c.header("Retry-After", retryAfterSeconds.toString());
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfterSeconds,
        },
        429
      );
    }

    window.count += 1;
    rateLimitWindows.set(key, window);
    await next();
  };
}
