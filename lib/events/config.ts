/** ランダムイベント — 本番（静かさ優先） */
export const EVENT_CONFIG_PRODUCTION = {
  initialDelayMs: 45_000,
  minIntervalMs: 90_000,
  maxIntervalMs: 300_000,
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
