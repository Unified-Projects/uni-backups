import { Hono } from "hono";
import { getApiToken } from "@uni-backups/shared/config";
import { clearSession, createSession, isAuthenticated, validateLoginToken } from "../security/auth";
import { isTestEnvironment } from "../runtime";

const auth = new Hono();

auth.get("/session", (c) => {
  if (!getApiToken() && !isTestEnvironment()) {
    return c.json({ authenticated: false, configured: false }, 503);
  }

  return c.json({
    authenticated: isAuthenticated(c),
    configured: true,
  });
});

auth.post("/session", async (c) => {
  if (!getApiToken() && !isTestEnvironment()) {
    return c.json({ error: "API authentication is not configured" }, 503);
  }

  let body: { token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!validateLoginToken(body.token)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  createSession(c);
  return c.json({ authenticated: true });
});

auth.delete("/session", (c) => {
  clearSession(c);
  return c.json({ authenticated: false });
});

export default auth;
