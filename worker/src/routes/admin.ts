import { bearerAuth } from "hono/bearer-auth";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { isStaticOnlyForced } from "../budget";
import { USAGE_GRANULARITY } from "../db/usage";
import {
  medianOf,
  percentileOf,
} from "../db/visits";
import { nowUnixSeconds, utcDayStartUnix, utcMonthStartUnix } from "../time";
import type { AppEnv } from "../types";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) {
    throw new HTTPException(401, {
      message: "unauthorized",
      res: c.json({ error: "unauthorized" }, 401),
    });
  }
  const auth = bearerAuth({ token }) as MiddlewareHandler<AppEnv>;
  return auth(c, next);
});

adminRoutes.get("/stats", async (c) => {
  const dayStart = utcDayStartUnix();
  const monthStart = utcMonthStartUnix();

  const usage = await c.env.DB.prepare(
    `SELECT granularity, period_start, count FROM api_usage
     WHERE (granularity = ? AND period_start = ?)
        OR (granularity = ? AND period_start = ?)`,
  )
    .bind(
      USAGE_GRANULARITY.day,
      dayStart,
      USAGE_GRANULARITY.month,
      monthStart,
    )
    .all<{
      granularity: number;
      period_start: number;
      count: number;
    }>();

  const counts = new Map(
    (usage.results ?? []).map((row) => [row.granularity, row.count]),
  );

  const wordCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM words`,
  ).first<{ count: number }>();

  return c.json({
    staticOnlyMode: isStaticOnlyForced(c.env),
    apiUsage: {
      daily: {
        periodStart: dayStart,
        count: counts.get(USAGE_GRANULARITY.day) ?? 0,
      },
      monthly: {
        periodStart: monthStart,
        count: counts.get(USAGE_GRANULARITY.month) ?? 0,
      },
    },
    wordsStored: wordCount?.count ?? 0,
    dailyLimit: c.env.BUDGET_DAILY_REQUESTS ?? "90000",
    monthlyLimit: c.env.BUDGET_MONTHLY_REQUESTS ?? "9000000",
  });
});

adminRoutes.get("/words", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, text, session_id, created_at, expires_at
     FROM words ORDER BY created_at DESC LIMIT 500`,
  ).all<{
    id: string;
    text: string;
    session_id: string | null;
    created_at: number;
    expires_at: number;
  }>();

  const words = (rows.results ?? []).map((row) => ({
    id: row.id,
    text: row.text,
    session_id: row.session_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));

  return c.json({ words });
});

adminRoutes.get("/session-stats", async (c) => {
  const now = nowUnixSeconds();
  const dayAgo = now - 86_400;

  const stored = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM session_visits`,
  ).first<{ count: number }>();

  const durations = await c.env.DB.prepare(
    `SELECT duration_sec FROM session_visits WHERE ended_at >= ? ORDER BY duration_sec`,
  )
    .bind(dayAgo)
    .all<{ duration_sec: number }>();

  const values = (durations.results ?? []).map((row) => row.duration_sec);

  return c.json({
    visitsStored: stored?.count ?? 0,
    last24h: {
      visitCount: values.length,
      medianDurationSec: medianOf(values),
      p90DurationSec: percentileOf(values, 90),
    },
  });
});
