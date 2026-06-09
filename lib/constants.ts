export const APP_TITLE = "深呼吸している場所";

/** 最初から漂っている言葉。ユーザーが置いた言葉もここに追加される */
export const SEED_WORDS = [
  "また、来た。",
  "夜のほうが正直になれる",
  "おかえり",
  "ことばを降ろす",
  "今日は読むだけ",
  "ぼんやりしていてもいい",
  "夜更けに、輪郭がやわらかい",
  "ここは、何もしない練習",
  "息を吐く",
  "誰もいない、わけではない",
];

/** 空間の基本設定 */
export const CONFIG = {
  /** 呼吸 1 サイクルの秒数 */
  breathCycleSeconds: 8,
  /** 呼吸の揺らぎ（0 = 規則的、1 以上 = より生っぽい） */
  breathInstability: 0.6,
  /** 右上に表示する「居合わせている人」の数 */
  presenceCount: 4,
  /** 画面周辺に漂う気配の点の数 */
  orbCount: 5,
  /** ユーザーが置ける言葉の最大文字数 */
  maxWordLength: 24,
  /** 漂う言葉を保持する上限 */
  maxStoredWords: 40,
} as const;

/** サーバー側 D1 に保持する言葉の期間（年）。worker WORDS_RETENTION_SEC と一致 */
export const SERVER_WORDS_RETENTION_YEARS = 1;

/** 訪問記録の保持期間（年）。worker SESSION_VISITS_RETENTION_SEC と一致 */
export const SERVER_SESSION_VISITS_RETENTION_YEARS = 1;

/** 失敗した言葉 POST の再送キュー上限 */
export const PENDING_WORDS_MAX = 8;

/** `/privacy` お問い合わせ（未設定時はプレースホルダ表示） */
export const PRIVACY_CONTACT =
  process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim() || "";

const DEFAULT_API_BASE =
  process.env.NODE_ENV === "development" ? "http://localhost:8787" : "";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.trim() || DEFAULT_API_BASE;

/** オンライン API（NEXT_PUBLIC_ONLINE=1 のときのみ有効） */
export const ONLINE = {
  enabled: process.env.NEXT_PUBLIC_ONLINE === "1",
  /** orb を presence に連動（0 で固定数） */
  orbLinkEnabled:
    process.env.NEXT_PUBLIC_ONLINE === "1" &&
    process.env.NEXT_PUBLIC_ORB_LINK !== "0",
  /** 本番同一オリジンでは空。dev は Worker dev origin を既定にする */
  apiBase: API_BASE,
  /** GET /api/presence の polling 間隔（ms） */
  presencePollMs: Number(process.env.NEXT_PUBLIC_PRESENCE_POLL_MS) || 60_000,
  /** orb 数が 1 ステップ変わるまでの ms */
  orbStepMs: Number(process.env.NEXT_PUBLIC_ORB_STEP_MS) || 1_200,
} as const;

export type ApiMode = "online" | "static_only" | "offline";

export type PresenceResponse = {
  online: boolean;
  mode: ApiMode;
  count?: number;
  reason?: string;
};
