import type { ComponentType } from "react";

/** 登録可能なイベントの種類 */
export type EventType = "shooting-star" | "wind-drift" | "breath-wave";

/** スケジューラが起動した 1 回分のインスタンス */
export type ActiveEvent = {
  instanceId: string;
  type: EventType;
  /** イベントごとのランダム値（軌道・位置など） */
  seed: number;
};

/** 各イベントコンポーネントが受け取る props */
export type EventComponentProps = {
  seed: number;
  onComplete: () => void;
};

export type EventDefinition = {
  type: EventType;
  /** デバッグ表示用の名前 */
  label: string;
  /** 抽選 weight。大きいほど出やすい */
  weight: number;
  /** 表示時間（ms）。終了後 onComplete を呼ぶ想定 */
  durationMs: number;
  Component: ComponentType<EventComponentProps>;
};
