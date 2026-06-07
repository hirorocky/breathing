export type BudgetEnv = {
  DB: D1Database;
  BUDGET_ENABLED?: string;
  BUDGET_DAILY_REQUESTS?: string;
  BUDGET_MONTHLY_REQUESTS?: string;
  STATIC_ONLY_MODE?: string;
};

export type BudgetCheck = {
  allowed: boolean;
  reason?: "static_only_mode" | "daily_limit" | "monthly_limit";
  dailyCount?: number;
  monthlyCount?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
};

function utcDayKey(now = new Date()): string {
  return `day:${now.toISOString().slice(0, 10)}`;
}

function utcMonthKey(now = new Date()): string {
  return `month:${now.toISOString().slice(0, 7)}`;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isStaticOnlyForced(env: BudgetEnv): boolean {
  return env.STATIC_ONLY_MODE === "1" || env.STATIC_ONLY_MODE === "true";
}

export async function checkBudget(env: BudgetEnv): Promise<BudgetCheck> {
  if (isStaticOnlyForced(env)) {
    return { allowed: false, reason: "static_only_mode" };
  }

  if (env.BUDGET_ENABLED === "0" || env.BUDGET_ENABLED === "false") {
    return { allowed: true };
  }

  const dailyLimit = parseLimit(env.BUDGET_DAILY_REQUESTS, 90_000);
  const monthlyLimit = parseLimit(env.BUDGET_MONTHLY_REQUESTS, 9_000_000);
  const dayKey = utcDayKey();
  const monthKey = utcMonthKey();

  const usage = await env.DB.prepare(
    `SELECT period_key, count FROM api_usage WHERE period_key IN (?, ?)`,
  )
    .bind(dayKey, monthKey)
    .all<{ period_key: string; count: number }>();

  const counts = new Map(
    (usage.results ?? []).map((row) => [row.period_key, row.count]),
  );
  const dailyCount = counts.get(dayKey) ?? 0;
  const monthlyCount = counts.get(monthKey) ?? 0;

  if (dailyCount >= dailyLimit) {
    return {
      allowed: false,
      reason: "daily_limit",
      dailyCount,
      monthlyCount,
      dailyLimit,
      monthlyLimit,
    };
  }

  if (monthlyCount >= monthlyLimit) {
    return {
      allowed: false,
      reason: "monthly_limit",
      dailyCount,
      monthlyCount,
      dailyLimit,
      monthlyLimit,
    };
  }

  return {
    allowed: true,
    dailyCount,
    monthlyCount,
    dailyLimit,
    monthlyLimit,
  };
}

/** 予算内のときだけ呼ぶ。利用者向け API 1 回につき 1 カウント。 */
export async function recordApiUsage(env: BudgetEnv): Promise<void> {
  if (
    isStaticOnlyForced(env) ||
    env.BUDGET_ENABLED === "0" ||
    env.BUDGET_ENABLED === "false"
  ) {
    return;
  }

  const dayKey = utcDayKey();
  const monthKey = utcMonthKey();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_usage (period_key, count) VALUES (?, 1)
       ON CONFLICT(period_key) DO UPDATE SET count = count + 1`,
    ).bind(dayKey),
    env.DB.prepare(
      `INSERT INTO api_usage (period_key, count) VALUES (?, 1)
       ON CONFLICT(period_key) DO UPDATE SET count = count + 1`,
    ).bind(monthKey),
  ]);
}
