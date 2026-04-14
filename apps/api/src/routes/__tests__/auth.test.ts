import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import auth from "../auth";

vi.mock("@uni-backups/shared/config", () => ({
  getApiToken: vi.fn(),
}));

vi.mock("../../security/auth", () => ({
  clearSession: vi.fn(),
  createSession: vi.fn(),
  isAuthenticated: vi.fn(),
  validateLoginToken: vi.fn(),
}));

import { getApiToken } from "@uni-backups/shared/config";
import { clearSession, createSession, isAuthenticated, validateLoginToken } from "../../security/auth";

describe("Auth API Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/auth", auth);
    process.env.NODE_ENV = "test";
  });

  it("returns current session state", async () => {
    vi.mocked(getApiToken).mockReturnValue("secret-token");
    vi.mocked(isAuthenticated).mockReturnValue(true);

    const res = await app.request("/auth/session");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ authenticated: true, configured: true });
  });

  it("creates a session when credentials are valid", async () => {
    vi.mocked(getApiToken).mockReturnValue("secret-token");
    vi.mocked(validateLoginToken).mockReturnValue(true);
    vi.mocked(createSession).mockReturnValue(true);

    const res = await app.request("/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "secret-token" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalled();
    expect(json).toEqual({ authenticated: true });
  });

  it("rejects invalid credentials", async () => {
    vi.mocked(getApiToken).mockReturnValue("secret-token");
    vi.mocked(validateLoginToken).mockReturnValue(false);

    const res = await app.request("/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Invalid credentials");
  });

  it("clears the session on logout", async () => {
    const res = await app.request("/auth/session", { method: "DELETE" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(clearSession).toHaveBeenCalled();
    expect(json).toEqual({ authenticated: false });
  });
});
