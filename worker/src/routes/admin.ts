import { bearerAuth } from "hono/bearer-auth";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { isStaticOnlyForced } from "../budget";
import { blobToUuid, optionalBlobToUuid } from "../db/binary";
import { USAGE_GRANULARITY } from "../db/usage";
import { utcDayStartUnix, utcMonthStartUnix } from "../time";
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
    `SELECT granularity, period_start, request_count FROM api_usage_buckets
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
      request_count: number;
    }>();

  const counts = new Map(
    (usage.results ?? []).map((row) => [row.granularity, row.request_count]),
  );

  const wordCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM word_entries`,
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
    `SELECT id, body, session_id, created_at, expires_at
     FROM word_entries ORDER BY created_at DESC LIMIT 500`,
  ).all<{
    id: ArrayBuffer;
    body: string;
    session_id: ArrayBuffer | null;
    created_at: number;
    expires_at: number;
  }>();

  const words = (rows.results ?? []).map((row) => ({
    id: blobToUuid(row.id),
    text: row.body,
    session_id: optionalBlobToUuid(row.session_id),
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));

  return c.json({ words });
});
