import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { SESSION_COOKIE } from "../constants";
import { normalizeSessionId } from "../security";
import type { AppEnv } from "../types";

export function resolveSession(c: Context<AppEnv>): string {
  const fromCookie = normalizeSessionId(getCookie(c, SESSION_COOKIE));
  return fromCookie ?? crypto.randomUUID();
}

export function attachSession(c: Context<AppEnv>, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30,
    secure: c.req.header("x-forwarded-proto") === "https",
  });
}
