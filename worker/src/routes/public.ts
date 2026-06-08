import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { optionalUuidToBlob, uuidToBlob } from "../db/binary";
import { budgetGuard } from "../middleware/budget";
import { ipThrottleGuard } from "../middleware/ipThrottle";
import { originGuard } from "../middleware/origin";
import { attachSession, resolveSession } from "../middleware/session";
import { parsePositiveInt } from "../security";
import { nowUnixSeconds } from "../time";
import type { AppEnv } from "../types";

const wordSchema = z.object({
  text: z.string().trim().min(1).max(24),
});

export const publicRoutes = new Hono<AppEnv>();

const publicGuards = [originGuard, ipThrottleGuard, budgetGuard] as const;

/** 古いセッション削除は全リクエストではなく間引く */
function shouldPurgePresence(now: number): boolean {
  return (now & 7) === 0;
}

publicRoutes.get("/presence", ...publicGuards, async (c) => {
  const sessionId = resolveSession(c);
  const sessionBlob = uuidToBlob(sessionId);
  const now = nowUnixSeconds();
  const windowSec = parsePositiveInt(c.env.PRESENCE_WINDOW_SEC, 300);
  const cutoff = now - windowSec;

  await c.env.DB.prepare(
    `INSERT INTO active_sessions (session_id, last_seen_at) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(sessionBlob, now)
    .run();

  if (shouldPurgePresence(now)) {
    await c.env.DB.prepare(`DELETE FROM active_sessions WHERE last_seen_at < ?`)
      .bind(cutoff)
      .run();
  }

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM active_sessions WHERE last_seen_at >= ?`,
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
    const now = nowUnixSeconds();
    const rateSec = parsePositiveInt(c.env.WORD_RATE_LIMIT_SEC, 30);
    const retentionSec = parsePositiveInt(c.env.WORDS_RETENTION_SEC, 31_536_000);

    const rateRow = await c.env.DB.prepare(
      `SELECT last_posted_at FROM word_post_cooldowns WHERE ip_hash = ?`,
    )
      .bind(ipHash)
      .first<{ last_posted_at: number }>();

    if (rateRow && now - rateRow.last_posted_at < rateSec) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const idBlob = uuidToBlob(crypto.randomUUID());
    const sessionBlob = optionalUuidToBlob(sessionId);
    const expiresAt = now + retentionSec;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO word_entries (id, body, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(idBlob, text, sessionBlob, now, expiresAt),
      c.env.DB.prepare(
        `INSERT INTO word_post_cooldowns (ip_hash, last_posted_at) VALUES (?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET last_posted_at = excluded.last_posted_at`,
      ).bind(ipHash, now),
      c.env.DB.prepare(`DELETE FROM word_entries WHERE expires_at < ?`).bind(
        now,
      ),
    ]);

    attachSession(c, sessionId);
    return c.json({ ok: true, online: true });
  },
);
