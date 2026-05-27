"use client";

import type { AnimationEvent, CSSProperties } from "react";
import type { EventComponentProps } from "@/lib/events/types";

/** 控えめな流れ星。画面上部を斜めに一瞬だけ通過する */
export function ShootingStarEvent({ seed, onComplete }: EventComponentProps) {
  const startX = 5 + seed * 50;
  const startY = 8 + ((seed * 0.7) % 1) * 22;
  const angle = -22 - seed * 18;
  const length = 100 + seed * 80;

  const style = {
    left: `${startX}%`,
    top: `${startY}%`,
    "--star-angle": `${angle}deg`,
    "--star-length": `${length}px`,
  } as CSSProperties;

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!event.animationName.includes("shootingStarPass")) return;
    onComplete();
  }

  return (
    <div className="event shooting-star-event" aria-hidden="true">
      <div className="shooting-star" style={style}>
        <div className="shooting-star-track" onAnimationEnd={handleAnimationEnd}>
          <div className="shooting-star-tail" />
          <div className="shooting-star-head" />
        </div>
      </div>
    </div>
  );
}
