/** ランダムイベントのタイミング。静かさ優先で間隔は長め */
export const EVENT_CONFIG = {
  /** 最初のイベントまでの待ち時間 */
  initialDelayMs: 1_000,
  /** イベント間の最短待ち */
  minIntervalMs: 1_000,
  /** イベント間の最長待ち */
  maxIntervalMs: 3_000,
} as const;
