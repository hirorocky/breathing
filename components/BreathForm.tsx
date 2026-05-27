"use client";

import type { CSSProperties } from "react";

type Props = {
  touchBoost: number;
  onBreathClick: () => void;
};

/** 中心の呼吸する形 — ring / glow / core の 3 層 */
export function BreathForm({ touchBoost, onBreathClick }: Props) {
  const style = {
    "--touch-boost": touchBoost,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="breath"
      style={style}
      aria-label="呼吸している形"
      onClick={(event) => {
        event.stopPropagation();
        onBreathClick();
      }}
    >
      <div className="ring" aria-hidden="true" />
      <div className="glow" aria-hidden="true" />
      <div className="core" aria-hidden="true" />
    </button>
  );
}
