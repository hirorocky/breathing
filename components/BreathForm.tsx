"use client";

import { forwardRef, type CSSProperties } from "react";

type Props = {
  touchBoost: number;
  onBreathClick: () => void;
};

/** 中心の呼吸する形 — ring / glow / core の 3 層 */
export const BreathForm = forwardRef<HTMLButtonElement, Props>(
  ({ touchBoost, onBreathClick }, ref) => {
  const style = {
    "--touch-boost": touchBoost,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="breath"
      style={style}
      ref={ref}
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
  },
);
BreathForm.displayName = "BreathForm";
