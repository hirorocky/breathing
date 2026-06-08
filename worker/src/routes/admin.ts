import { bearerAuth } from "hono/bearer-auth";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { isStaticOnlyForced } from "../budget";
import { utcDayKey, utcMonthKey } from "../time";
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
  const dayKey = utcDayKey();
  const monthKey = utcMonthKey();

  const usage = await c.env.DB.prepare(
    `SELECT period_key, count FROM api_usage WHERE period_key IN (?, ?)`,
  )
    .bind(dayKey, monthKey)
    .all<{ period_key: string; count: number }>();

  const wordCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM words`,
  ).first<{ count: number }>();

  const counts = Object.fromEntries(
    (usage.results ?? []).map((row) => [row.period_key, row.count]),
  );

  return c.json({
    staticOnlyMode: isStaticOnlyForced(c.env),
    apiUsage: counts,
    wordsStored: wordCount?.count ?? 0,
    dailyLimit: c.env.BUDGET_DAILY_REQUESTS ?? "90000",
    monthlyLimit: c.env.BUDGET_MONTHLY_REQUESTS ?? "9000000",
  });
});

adminRoutes.get("/words", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, text, session_id, created_at FROM words ORDER BY created_at DESC LIMIT 500`,
  ).all();

  return c.json({ words: rows.results ?? [] });
});
