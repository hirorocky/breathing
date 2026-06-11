/** 微反応のタイミング定数 */
export const INTERACTION = {
  /** hover 反応の CSS transition */
  hoverDelayMs: 400,
  /** 中心 click から boost 開始まで */
  breathClickDelayMs: 0,
  /** 中心 click のクールダウン */
  breathClickCooldownMs: 200,
  /** ripple / 連打抑制 */
  rippleDebounceMs: 120,
  /** 一呼吸 boost の長さ（約 1 サイクル） */
  touchBoostDurationMs: 8_000,
  /** boost 量（ring scale 加算） */
  touchBoostAmount: 0.08,
  /** hover 時 glow 加算 opacity */
  hoverGlowAmount: 0.05,
  /** orb hover opacity 加算 */
  orbHoverBoost: 0.15,
  orbHoverDelayMs: 200,
  orbHoverReleaseMs: 800,
} as const;
