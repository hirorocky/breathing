/** ランダムイベント — 本番（静かさ優先） */
export const EVENT_CONFIG_PRODUCTION = {
  initialDelayMs: 30_000,
  minIntervalMs: 60_000,
  maxIntervalMs: 180_000,
  /** 深夜帯（21:00〜3:00）は間隔をさらに短く */
  deepNightIntervalScale: 0.65,
} as const;

/** ランダムイベント — debug 用（短間隔） */
export const EVENT_CONFIG_DEBUG = {
  initialDelayMs: 1_000,
  minIntervalMs: 1_000,
  maxIntervalMs: 3_000,
} as const;

export type EventTimingConfig =
  | typeof EVENT_CONFIG_PRODUCTION
  | typeof EVENT_CONFIG_DEBUG;

export function getEventConfig(debug: boolean): EventTimingConfig {
  return debug ? EVENT_CONFIG_DEBUG : EVENT_CONFIG_PRODUCTION;
}
