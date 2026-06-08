import { parsePositiveInt } from "../security";

export type VisitEnv = {
  DB: D1Database;
  SESSION_VISITS_RETENTION_SEC?: string;
};

export function sessionVisitsRetentionSec(env: VisitEnv): number {
  return parsePositiveInt(env.SESSION_VISITS_RETENTION_SEC, 31_536_000);
}

export async function archiveVisit(
  db: D1Database,
  sessionId: string,
  startedAt: number,
  endedAt: number,
  retentionSec: number,
): Promise<void> {
  const durationSec = Math.max(0, endedAt - startedAt);
  const expiresAt = endedAt + retentionSec;
  await db
    .prepare(
      `INSERT INTO session_visits (id, session_id, started_at, ended_at, duration_sec, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), sessionId, startedAt, endedAt, durationSec, expiresAt)
    .run();
}

export async function purgeExpiredSessionVisits(
  db: D1Database,
  now: number,
): Promise<void> {
  await db
    .prepare(`DELETE FROM session_visits WHERE expires_at < ?`)
    .bind(now)
    .run();
}

/** 窓外の active_sessions を session_visits に確定してから削除 */
export async function archiveAndDeleteStaleSessions(
  db: D1Database,
  cutoff: number,
  retentionSec: number,
): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT session_id, visit_started_at, last_seen_at
       FROM active_sessions WHERE last_seen_at < ?`,
    )
    .bind(cutoff)
    .all<{
      session_id: string;
      visit_started_at: number | null;
      last_seen_at: number;
    }>();

  for (const row of rows.results ?? []) {
    const startedAt = row.visit_started_at ?? row.last_seen_at;
    await archiveVisit(db, row.session_id, startedAt, row.last_seen_at, retentionSec);
  }

  await db
    .prepare(`DELETE FROM active_sessions WHERE last_seen_at < ?`)
    .bind(cutoff)
    .run();
}

export async function upsertPresence(
  db: D1Database,
  sessionId: string,
  now: number,
  cutoff: number,
  retentionSec: number,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT visit_started_at, last_seen_at FROM active_sessions WHERE session_id = ?`,
    )
    .bind(sessionId)
    .first<{ visit_started_at: number | null; last_seen_at: number }>();

  if (!row) {
    await db
      .prepare(
        `INSERT INTO active_sessions (session_id, visit_started_at, last_seen_at) VALUES (?, ?, ?)`,
      )
      .bind(sessionId, now, now)
      .run();
    return;
  }

  if (row.last_seen_at < cutoff) {
    const startedAt = row.visit_started_at ?? row.last_seen_at;
    await archiveVisit(db, sessionId, startedAt, row.last_seen_at, retentionSec);
    await db
      .prepare(
        `UPDATE active_sessions SET visit_started_at = ?, last_seen_at = ? WHERE session_id = ?`,
      )
      .bind(now, now, sessionId)
      .run();
    return;
  }

  await db
    .prepare(`UPDATE active_sessions SET last_seen_at = ? WHERE session_id = ?`)
    .bind(now, sessionId)
    .run();
}

export function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

export function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
