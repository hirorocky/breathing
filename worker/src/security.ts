export type SecurityEnv = {
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  IP_THROTTLE_WINDOW_SEC?: string;
  IP_THROTTLE_MAX?: string;
  MAX_BODY_BYTES?: string;
};

import type { RouteId } from "./db/routes";
import { nowUnixSeconds } from "./time";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id);
}

export function normalizeSessionId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return isValidSessionId(trimmed) ? trimmed : null;
}

export function isOriginAllowed(
  request: Request,
  env: SecurityEnv,
): boolean {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowed.length === 0) {
    return true;
  }

  const origin = request.headers.get("Origin");
  if (origin) {
    return allowed.includes(origin);
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return allowed.includes(refOrigin);
    } catch {
      return false;
    }
  }

  return false;
}

/** SHA-256 の先頭 16 バイト（D1 BLOB 用） */
export async function hashIp(request: Request): Promise<Uint8Array> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest).slice(0, 16);
}

export async function checkIpThrottle(
  env: SecurityEnv & { DB: D1Database },
  ipHash: Uint8Array,
  routeId: RouteId,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const windowSec = parsePositiveInt(env.IP_THROTTLE_WINDOW_SEC, 60);
  const maxRequests = parsePositiveInt(env.IP_THROTTLE_MAX, 120);
  const now = nowUnixSeconds();
  const windowStart = Math.floor(now / windowSec) * windowSec;

  const row = await env.DB.prepare(
    `SELECT window_start, request_count FROM ip_request_windows WHERE ip_hash = ? AND route_id = ?`,
  )
    .bind(ipHash, routeId)
    .first<{ window_start: number; request_count: number }>();

  if (!row || row.window_start !== windowStart) {
    await env.DB.prepare(
      `INSERT INTO ip_request_windows (ip_hash, route_id, window_start, request_count) VALUES (?, ?, ?, 1)
       ON CONFLICT(ip_hash, route_id) DO UPDATE SET
         window_start = excluded.window_start,
         request_count = excluded.request_count`,
    )
      .bind(ipHash, routeId, windowStart)
      .run();
    return { allowed: true };
  }

  if (row.request_count >= maxRequests) {
    const retryAfterSec = windowStart + windowSec - now;
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  await env.DB.prepare(
    `UPDATE ip_request_windows SET request_count = request_count + 1 WHERE ip_hash = ? AND route_id = ?`,
  )
    .bind(ipHash, routeId)
    .run();

  return { allowed: true };
}
