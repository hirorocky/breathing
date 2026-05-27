"use client";

import type { AnimationEvent, CSSProperties } from "react";
import type { EventComponentProps } from "@/lib/events/types";

/** 呼吸の輪郭のそばに現れ、同じリズムで息をする気配 */
export function CompanionBreathEvent({ seed, onComplete }: EventComponentProps) {
  const side = seed < 0.5 ? "left" : "right";
  const offsetY = -6 + ((seed * 0.9) % 1) * 12;

  const style = {
    "--companion-y": `${offsetY}%`,
  } as CSSProperties;

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!event.animationName.includes("companionFade")) return;
    onComplete();
  }

  return (
    <div
      className={`companion-breath-event companion-breath-event--${side}`}
      style={style}
      aria-hidden="true"
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="companion-figure">
        <div className="companion-halo" />
        <div className="companion-body">
          <div className="companion-head" />
          <div className="companion-torso" />
        </div>
      </div>
    </div>
  );
}
