import {
  archiveAndDeleteStaleSessions,
  purgeExpiredSessionVisits,
  sessionVisitsRetentionSec,
} from "./db/visits";
import { parsePositiveInt } from "./security";
import { nowUnixSeconds } from "./time";
import type { Env } from "./types";

/** Cron で実行: 終了 visit の確定、期限切れ行の削除 */
export async function runVisitMaintenance(env: Env): Promise<void> {
  const now = nowUnixSeconds();
  const cutoff = now - parsePositiveInt(env.PRESENCE_WINDOW_SEC, 300);
  const visitRetentionSec = sessionVisitsRetentionSec(env);

  await archiveAndDeleteStaleSessions(env.DB, cutoff, visitRetentionSec);
  await purgeExpiredSessionVisits(env.DB, now);
  await env.DB.prepare(`DELETE FROM words WHERE expires_at < ?`).bind(now).run();
}
