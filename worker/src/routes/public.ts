import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { budgetGuard } from "../middleware/budget";
import { ipThrottleGuard } from "../middleware/ipThrottle";
import { originGuard } from "../middleware/origin";
import { attachSession, resolveSession } from "../middleware/session";
import { parsePositiveInt } from "../security";
import type { AppEnv } from "../types";

const wordSchema = z.object({
  text: z.string().trim().min(1).max(24),
});

export const publicRoutes = new Hono<AppEnv>();

const publicGuards = [originGuard, ipThrottleGuard, budgetGuard] as const;

publicRoutes.get("/presence", ...publicGuards, async (c) => {
  const sessionId = resolveSession(c);
  const now = Math.floor(Date.now() / 1000);
  const windowSec = parsePositiveInt(c.env.PRESENCE_WINDOW_SEC, 300);

  await c.env.DB.prepare(
    `INSERT INTO heartbeats (session_id, last_seen) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`,
  )
    .bind(sessionId, now)
    .run();

  const cutoff = now - windowSec;

  await c.env.DB.prepare(`DELETE FROM heartbeats WHERE last_seen < ?`)
    .bind(cutoff)
    .run();

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM heartbeats WHERE last_seen >= ?`,
  )
    .bind(cutoff)
    .first<{ count: number }>();

  const count = countRow?.count ?? 0;
  attachSession(c, sessionId);

  return c.json({ online: true, mode: "online", count });
});

publicRoutes.post(
  "/words",
  ...publicGuards,
  zValidator("json", wordSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_text" }, 400);
    }
  }),
  async (c) => {
    const { text } = c.req.valid("json");

    if (/https?:\/\//i.test(text)) {
      return c.json({ error: "url_not_allowed" }, 400);
    }

    const sessionId = resolveSession(c);
    const ipHash = c.get("ipHash");
    const now = Math.floor(Date.now() / 1000);
    const rateSec = parsePositiveInt(c.env.WORD_RATE_LIMIT_SEC, 30);

    const rateRow = await c.env.DB.prepare(
      `SELECT last_post FROM rate_limits WHERE ip_hash = ?`,
    )
      .bind(ipHash)
      .first<{ last_post: number }>();

    if (rateRow && now - rateRow.last_post < rateSec) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const id = crypto.randomUUID();
    const maxStored = parsePositiveInt(c.env.WORDS_MAX_STORED, 10_000);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO words (id, text, session_id, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(id, text, sessionId, now),
      c.env.DB.prepare(
        `INSERT INTO rate_limits (ip_hash, last_post) VALUES (?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET last_post = excluded.last_post`,
      ).bind(ipHash, now),
      c.env.DB.prepare(
        `DELETE FROM words WHERE id NOT IN (
           SELECT id FROM words ORDER BY created_at DESC LIMIT ?
         )`,
      ).bind(maxStored),
    ]);

    attachSession(c, sessionId);
    return c.json({ ok: true, online: true });
  },
);
