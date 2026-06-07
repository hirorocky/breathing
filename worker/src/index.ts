import {
  checkBudget,
  isStaticOnlyForced,
  recordApiUsage,
  type BudgetEnv,
} from "./budget";
import { corsPreflight, json, staticOnlyResponse } from "./responses";
import {
  authorizeAdmin,
  checkIpThrottle,
  hashIp,
  isOriginAllowed,
  normalizeSessionId,
  parsePositiveInt,
  readJsonBody,
  type SecurityEnv,
} from "./security";

export interface Env extends BudgetEnv, SecurityEnv {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  PRESENCE_WINDOW_SEC?: string;
  WORDS_MAX_STORED?: string;
  WORD_RATE_LIMIT_SEC?: string;
}

const SESSION_COOKIE = "breathing_sid";
const MAX_WORD_LEN = 24;

function sessionFromRequest(request: Request): string {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  const fromCookie = normalizeSessionId(match?.[1]);
  if (fromCookie) return fromCookie;
  return crypto.randomUUID();
}

function withSessionCookie(
  response: Response,
  sessionId: string,
  request: Request,
): Response {
  const secure =
    new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function requirePublicApi(
  request: Request,
  env: Env,
  route: string,
): Promise<Response | null> {
  if (!isOriginAllowed(request, env)) {
    return json(request, env, { error: "forbidden_origin" }, 403);
  }

  const ipHash = await hashIp(request);
  const throttle = await checkIpThrottle(env, ipHash, route);
  if (!throttle.allowed) {
    return json(
      request,
      env,
      { error: "rate_limited" },
      429,
      throttle.retryAfterSec
        ? { "Retry-After": String(throttle.retryAfterSec) }
        : {},
    );
  }

  const budget = await checkBudget(env);
  if (!budget.allowed) {
    return staticOnlyResponse(
      request,
      env,
      budget.reason ?? "budget_exceeded",
      {
        dailyCount: budget.dailyCount,
        monthlyCount: budget.monthlyCount,
        dailyLimit: budget.dailyLimit,
        monthlyLimit: budget.monthlyLimit,
      },
    );
  }
  await recordApiUsage(env);
  return null;
}

async function handlePresence(request: Request, env: Env): Promise<Response> {
  const blocked = await requirePublicApi(request, env, "presence");
  if (blocked) return blocked;

  const sessionId = sessionFromRequest(request);
  const now = Math.floor(Date.now() / 1000);
  const windowSec = parsePositiveInt(env.PRESENCE_WINDOW_SEC, 300);

  await env.DB.prepare(
    `INSERT INTO heartbeats (session_id, last_seen) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`,
  )
    .bind(sessionId, now)
    .run();

  const cutoff = now - windowSec;

  await env.DB.prepare(`DELETE FROM heartbeats WHERE last_seen < ?`)
    .bind(cutoff)
    .run();

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM heartbeats WHERE last_seen >= ?`,
  )
    .bind(cutoff)
    .first<{ count: number }>();

  const count = countRow?.count ?? 0;

  return withSessionCookie(
    json(request, env, { online: true, mode: "online", count }),
    sessionId,
    request,
  );
}

async function handlePostWord(request: Request, env: Env): Promise<Response> {
  const blocked = await requirePublicApi(request, env, "words");
  if (blocked) return blocked;

  const parsed = await readJsonBody<{ text?: string }>(request, env);
  if (!parsed.ok) {
    return json(request, env, { error: parsed.error }, parsed.status);
  }

  const text = (parsed.data.text ?? "").trim();
  if (text.length < 1 || text.length > MAX_WORD_LEN) {
    return json(request, env, { error: "invalid_text" }, 400);
  }

  if (/https?:\/\//i.test(text)) {
    return json(request, env, { error: "url_not_allowed" }, 400);
  }

  const sessionId = sessionFromRequest(request);
  const ipHash = await hashIp(request);
  const now = Math.floor(Date.now() / 1000);
  const rateSec = parsePositiveInt(env.WORD_RATE_LIMIT_SEC, 30);

  const rateRow = await env.DB.prepare(
    `SELECT last_post FROM rate_limits WHERE ip_hash = ?`,
  )
    .bind(ipHash)
    .first<{ last_post: number }>();

  if (rateRow && now - rateRow.last_post < rateSec) {
    return json(request, env, { error: "rate_limited" }, 429);
  }

  const id = crypto.randomUUID();
  const maxStored = parsePositiveInt(env.WORDS_MAX_STORED, 10_000);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO words (id, text, session_id, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(id, text, sessionId, now),
    env.DB.prepare(
      `INSERT INTO rate_limits (ip_hash, last_post) VALUES (?, ?)
       ON CONFLICT(ip_hash) DO UPDATE SET last_post = excluded.last_post`,
    ).bind(ipHash, now),
    env.DB.prepare(
      `DELETE FROM words WHERE id NOT IN (
         SELECT id FROM words ORDER BY created_at DESC LIMIT ?
       )`,
    ).bind(maxStored),
  ]);

  return withSessionCookie(
    json(request, env, { ok: true, online: true }),
    sessionId,
    request,
  );
}

async function handleAdminStats(
  request: Request,
  env: Env,
): Promise<Response> {
  const dayKey = `day:${new Date().toISOString().slice(0, 10)}`;
  const monthKey = `month:${new Date().toISOString().slice(0, 7)}`;

  const usage = await env.DB.prepare(
    `SELECT period_key, count FROM api_usage WHERE period_key IN (?, ?)`,
  )
    .bind(dayKey, monthKey)
    .all<{ period_key: string; count: number }>();

  const wordCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM words`,
  ).first<{ count: number }>();

  const counts = Object.fromEntries(
    (usage.results ?? []).map((row) => [row.period_key, row.count]),
  );

  return json(request, env, {
    staticOnlyMode: isStaticOnlyForced(env),
    apiUsage: counts,
    wordsStored: wordCount?.count ?? 0,
    dailyLimit: env.BUDGET_DAILY_REQUESTS ?? "90000",
    monthlyLimit: env.BUDGET_MONTHLY_REQUESTS ?? "9000000",
  });
}

async function handleAdminWords(
  request: Request,
  env: Env,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, text, session_id, created_at FROM words ORDER BY created_at DESC LIMIT 500`,
  ).all();

  return json(request, env, { words: rows.results ?? [] });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/presence" && request.method === "GET") {
        return handlePresence(request, env);
      }

      if (path === "/api/words" && request.method === "POST") {
        return handlePostWord(request, env);
      }

      if (path === "/api/admin/stats" && request.method === "GET") {
        if (!authorizeAdmin(request, env)) {
          return json(request, env, { error: "unauthorized" }, 401);
        }
        return handleAdminStats(request, env);
      }

      if (path === "/api/admin/words" && request.method === "GET") {
        if (!authorizeAdmin(request, env)) {
          return json(request, env, { error: "unauthorized" }, 401);
        }
        return handleAdminWords(request, env);
      }

      return json(request, env, { error: "not_found" }, 404);
    } catch (error) {
      console.error(error);
      return json(request, env, { error: "internal_error" }, 500);
    }
  },
};
