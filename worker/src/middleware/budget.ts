import { createMiddleware } from "hono/factory";
import { checkBudget, recordApiUsage } from "../budget";
import type { AppEnv } from "../types";

export const budgetGuard = createMiddleware<AppEnv>(async (c, next) => {
  const budget = await checkBudget(c.env);

  if (!budget.allowed) {
    return c.json(
      {
        online: false,
        mode: "static_only",
        reason: budget.reason ?? "budget_exceeded",
        dailyCount: budget.dailyCount,
        monthlyCount: budget.monthlyCount,
        dailyLimit: budget.dailyLimit,
        monthlyLimit: budget.monthlyLimit,
      },
      503,
      {
        "X-Breathing-Mode": "static-only",
        "Retry-After": "3600",
      },
    );
  }

  await recordApiUsage(c.env);
  await next();
});
