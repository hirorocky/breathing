export const APP_TITLE = "深呼吸している場所";

/** 空間の基本設定 */
export const CONFIG = {
  /** 呼吸 1 サイクルの秒数 */
  breathCycleSeconds: 8,
  /** 呼吸の揺らぎ（0 = 規則的、1 以上 = より生っぽい） */
  breathInstability: 0.6,
  /** 画面周辺に漂う気配の点の数 */
  orbCount: 5,
} as const;

/** 訪問記録の保持期間（年）。worker SESSION_VISITS_RETENTION_SEC と一致 */
export const SERVER_SESSION_VISITS_RETENTION_YEARS = 1;

/** `/privacy` お問い合わせ（未設定時はプレースホルダ表示） */
export const PRIVACY_CONTACT =
  process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim() || "";

