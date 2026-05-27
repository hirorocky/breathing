"use client";

import type { CSSProperties } from "react";
import type { Ripple } from "@/hooks/useInteractionState";

type Props = {
  ripples: Ripple[];
  pointer: { x: number; y: number; active: boolean };
};

/** 空白を触ったときの極薄 ripple */
export function RippleField({ ripples, pointer }: Props) {
  return (
    <div className="ripplefield" aria-hidden="true">
      {pointer.active && (
        <span
          className="pointerglow"
          style={
            {
              left: pointer.x,
              top: pointer.y,
            } as CSSProperties
          }
        />
      )}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="ripple"
          style={
            {
              left: ripple.x,
              top: ripple.y,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
