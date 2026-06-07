export type SecurityEnv = {
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  IP_THROTTLE_WINDOW_SEC?: string;
  IP_THROTTLE_MAX?: string;
  MAX_BODY_BYTES?: string;
};

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

/** タイミング攻撃を緩和する定数時間比較 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function authorizeAdmin(request: Request, env: SecurityEnv): boolean {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const auth = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  return constantTimeEqual(auth.slice(prefix.length), token);
}

export function corsHeadersForRequest(
  request: Request,
  env: SecurityEnv,
): Record<string, string> {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const origin = request.headers.get("Origin");

  if (allowed.length === 0) {
    return {};
  }

  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    };
  }

  return {};
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

export async function hashIp(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function checkIpThrottle(
  env: SecurityEnv & { DB: D1Database },
  ipHash: string,
  route: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const windowSec = parsePositiveInt(env.IP_THROTTLE_WINDOW_SEC, 60);
  const maxRequests = parsePositiveInt(env.IP_THROTTLE_MAX, 120);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSec) * windowSec;

  const row = await env.DB.prepare(
    `SELECT window_start, count FROM ip_throttle WHERE ip_hash = ? AND route = ?`,
  )
    .bind(ipHash, route)
    .first<{ window_start: number; count: number }>();

  if (!row || row.window_start !== windowStart) {
    await env.DB.prepare(
      `INSERT INTO ip_throttle (ip_hash, route, window_start, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(ip_hash, route) DO UPDATE SET
         window_start = excluded.window_start,
         count = excluded.count`,
    )
      .bind(ipHash, route, windowStart)
      .run();
    return { allowed: true };
  }

  if (row.count >= maxRequests) {
    const retryAfterSec = windowStart + windowSec - now;
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  await env.DB.prepare(
    `UPDATE ip_throttle SET count = count + 1 WHERE ip_hash = ? AND route = ?`,
  )
    .bind(ipHash, route)
    .run();

  return { allowed: true };
}

export function maxBodyBytes(env: SecurityEnv): number {
  return parsePositiveInt(env.MAX_BODY_BYTES, 1024);
}

export async function readJsonBody<T>(
  request: Request,
  env: SecurityEnv,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const contentLength = request.headers.get("Content-Length");
  const maxBytes = maxBodyBytes(env);

  if (contentLength) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      return { ok: false, status: 413, error: "payload_too_large" };
    }
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }

  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
