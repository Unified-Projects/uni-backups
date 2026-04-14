import { createHmac, timingSafeEqual } from "crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getApiToken, getSessionTtlMs } from "@uni-backups/shared/config";
import { isTestEnvironment } from "../runtime";

const SESSION_COOKIE = "uni_backups_session";
const PUBLIC_API_PATHS = new Set(["/api/auth/session"]);

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSigningSecret(): string | undefined {
  return getApiToken();
}

function signSession(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function createSessionToken(secret: string): string {
  const expiresAt = Date.now() + getSessionTtlMs();
  const payload = expiresAt.toString();
  const signature = signSession(payload, secret);
  return `${payload}.${signature}`;
}

function validateSessionToken(session: string | undefined, secret: string): boolean {
  if (!session) {
    return false;
  }

  const [expiresAt, signature] = session.split(".", 2);
  if (!expiresAt || !signature) {
    return false;
  }

  const expiresAtNumber = Number(expiresAt);
  if (!Number.isFinite(expiresAtNumber) || expiresAtNumber <= Date.now()) {
    return false;
  }

  return secureCompare(signSession(expiresAt, secret), signature);
}

export function isAuthenticated(c: Context): boolean {
  const token = getSigningSecret();
  if (!token) {
    return isTestEnvironment();
  }

  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const bearerToken = authorization.slice("Bearer ".length).trim();
    if (secureCompare(bearerToken, token)) {
      return true;
    }
  }

  return validateSessionToken(getCookie(c, SESSION_COOKIE), token);
}

export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    if (!isAuthenticated(c)) {
      const token = getSigningSecret();
      const error =
        token || isTestEnvironment()
          ? "Authentication required"
          : "API authentication is not configured";
      const status = token || isTestEnvironment() ? 401 : 503;
      return c.json({ error }, status);
    }

    await next();
  };
}

export function createSession(c: Context): boolean {
  const token = getSigningSecret();
  if (!token) {
    return false;
  }

  setCookie(c, SESSION_COOKIE, createSessionToken(token), {
    httpOnly: true,
    sameSite: "Strict",
    secure: c.req.url.startsWith("https://"),
    path: "/",
    maxAge: Math.floor(getSessionTtlMs() / 1000),
  });

  return true;
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
  });
}

export function validateLoginToken(candidate: string | undefined): boolean {
  const token = getSigningSecret();
  if (!token || !candidate) {
    return false;
  }

  return secureCompare(candidate, token);
}
