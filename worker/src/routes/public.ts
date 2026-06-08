import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  archiveAndDeleteStaleSessions,
  purgeExpiredSessionVisits,
  sessionVisitsRetentionSec,
  upsertPresence,
} from "../db/visits";
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
  const now = nowUnixSeconds();
  const windowSec = parsePositiveInt(c.env.PRESENCE_WINDOW_SEC, 300);
  const cutoff = now - windowSec;
  const visitRetentionSec = sessionVisitsRetentionSec(c.env);

  await upsertPresence(c.env.DB, sessionId, now, cutoff, visitRetentionSec);

  if (shouldPurgePresence(now)) {
    await archiveAndDeleteStaleSessions(c.env.DB, cutoff, visitRetentionSec);
    await purgeExpiredSessionVisits(c.env.DB, now);
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
    const now = nowUnixSeconds();
    const retentionSec = parsePositiveInt(c.env.WORDS_RETENTION_SEC, 31_536_000);

    const id = crypto.randomUUID();
    const expiresAt = now + retentionSec;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO words (id, text, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, text, sessionId, now, expiresAt),
      c.env.DB.prepare(`DELETE FROM words WHERE expires_at < ?`).bind(now),
      c.env.DB.prepare(`DELETE FROM session_visits WHERE expires_at < ?`).bind(
        now,
      ),
    ]);

    attachSession(c, sessionId);
    return c.json({ ok: true, online: true });
  },
);
