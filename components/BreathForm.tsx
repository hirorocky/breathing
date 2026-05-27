"use client";

/** 中心の呼吸する形 — ring / glow / core の 3 層 */
export function BreathForm() {
  return (
    <div className="breath" aria-hidden="true">
      <div className="ring" />
      <div className="glow" />
      <div className="core" />
    </div>
  );
}
