import type { BudgetEnv } from "./budget";
import type { SecurityEnv } from "./security";

export type Env = BudgetEnv &
  SecurityEnv & {
    DB: D1Database;
    PRESENCE_WINDOW_SEC?: string;
    WORDS_RETENTION_SEC?: string;
    WORD_RATE_LIMIT_SEC?: string;
  };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    ipHash: Uint8Array;
    sessionId: string;
  };
};
