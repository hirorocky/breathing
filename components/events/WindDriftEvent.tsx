"use client";

import { useMemo, type AnimationEvent, type CSSProperties } from "react";
import type { EventComponentProps } from "@/lib/events/types";
import { seededRandom } from "@/lib/random";

type LeafLayout = {
  id: number;
  left: number;
  top: number;
  delay: number;
  duration: number;
  swayDuration: number;
  scale: number;
  spin: number;
  tumbleRate: number;
  flutter: number;
  wobble: number;
  windX: number;
  gravity: number;
  opacity: number;
};

function createLeaves(seed: number): LeafLayout[] {
  const count = 5 + Math.floor(seededRandom(seed * 811) * 5);

  return Array.from({ length: count }, (_, i) => {
    const r1 = seededRandom(seed * 997 + i * 13);
    const r2 = seededRandom(seed * 431 + i * 29);
    const r3 = seededRandom(seed * 127 + i * 41);
    const r4 = seededRandom(seed * 613 + i * 17);
    const r5 = seededRandom(seed * 719 + i * 23);
    const r6 = seededRandom(seed * 503 + i * 37);

    return {
      id: i,
      left: 1 + r1 * 94,
      top: 2 + r2 * 42,
      delay: r3 * 0.65,
      duration: 2.4 + r4 * 1.8,
      swayDuration: 1.05 + r6 * 1.15,
      scale: 0.45 + r1 * 0.6,
      spin: -80 + r2 * 160,
      tumbleRate: 0.55 + r3 * 0.95,
      flutter: 5 + r4 * 16,
      wobble: 3 + r5 * 12,
      windX: 0.5 + r2 * 1.05,
      gravity: 10 + r5 * 22,
      opacity: 0.72 + r6 * 0.28,
    };
  });
}

/** 画面全体がごく弱く横に流れ、小さな葉が舞う — 風の気配 */
export function WindDriftEvent({ seed, onComplete }: EventComponentProps) {
  const direction = seed < 0.5 ? -1 : 1;
  const strength = 0.55 + ((seed * 0.73) % 1) * 0.45;
  const leaves = useMemo(() => createLeaves(seed), [seed]);

  const rootStyle = {
    "--wind-dir": direction,
    "--wind-strength": strength,
  } as CSSProperties;

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!event.animationName.includes("windDrift")) return;
    onComplete();
  }

  return (
    <div className="event wind-drift-event" style={rootStyle} aria-hidden="true">
      <div className="wind-drift-layer" onAnimationEnd={handleAnimationEnd} />
      <div className="wind-leaves" aria-hidden="true">
        {leaves.map((leaf) => (
          <span
            key={leaf.id}
            className="wind-leaf"
            style={
              {
                left: `${leaf.left}%`,
                top: `${leaf.top}%`,
                "--wind-dir": direction,
                "--wind-strength": strength,
                "--leaf-delay": `${leaf.delay}s`,
                "--leaf-duration": `${leaf.duration}s`,
                "--leaf-sway-duration": `${leaf.swayDuration}s`,
                "--leaf-scale": leaf.scale,
                "--leaf-spin": `${leaf.spin}deg`,
                "--leaf-tumble-rate": leaf.tumbleRate,
                "--leaf-flutter": `${leaf.flutter}px`,
                "--leaf-wobble": `${leaf.wobble}px`,
                "--leaf-wind-x": leaf.windX,
                "--leaf-gravity": `${leaf.gravity}vh`,
                "--leaf-opacity": leaf.opacity,
              } as CSSProperties
            }
          >
            <span className="wind-leaf-motion">
              <span className="wind-leaf-fall">
                <span className="wind-leaf-sway">
                  <span className="wind-leaf-shape" />
                </span>
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
