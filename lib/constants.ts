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
