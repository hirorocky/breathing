"use client";

import { useMemo, type CSSProperties } from "react";
import { seededRandom } from "@/lib/random";

const LEAF_COUNT = 11;

type LeafLayout = {
  x: number;
  y: number;
  scale: number;
  spin: number;
  driftDuration: number;
  bobDuration: number;
  delay: number;
  opacity: number;
};

type Props = {
  sessionSeed: number;
  /** 0〜1。昼ほど葉が濃く見える */
  ambience: number;
};

function seededFromSession(sessionSeed: number, index: number): number {
  return seededRandom(sessionSeed * 3000 + index);
}

/** 昼の水面に静かに浮かぶ葉 */
export function FloatingLeaves({ sessionSeed, ambience }: Props) {
  const leaves = useMemo((): LeafLayout[] => {
    return Array.from({ length: LEAF_COUNT }, (_, i) => {
      const r0 = seededFromSession(sessionSeed, i);
      const r1 = seededFromSession(sessionSeed, i + 30);
      const r2 = seededFromSession(sessionSeed, i + 60);
      const r3 = seededFromSession(sessionSeed, i + 90);
      const r4 = seededFromSession(sessionSeed, i + 120);
      return {
        x: 3 + r0 * 94,
        y: 54 + r1 * 32,
        scale: 0.55 + r2 * 0.75,
        spin: -35 + r3 * 70,
        driftDuration: 48 + r4 * 36,
        bobDuration: 7 + r2 * 6,
        delay: r3 * 12,
        opacity: 0.45 + r1 * 0.4,
      };
    });
  }, [sessionSeed]);

  if (ambience <= 0.01) return null;

  return (
    <div
      className="floating-leaves"
      style={{ opacity: Number(ambience.toFixed(4)) }}
      aria-hidden="true"
    >
      {leaves.map((leaf, i) => (
        <div
          key={i}
          className="floating-leaf"
          style={
            {
              left: `${leaf.x.toFixed(4)}%`,
              top: `${leaf.y.toFixed(4)}%`,
              "--leaf-scale": leaf.scale.toFixed(4),
              "--leaf-spin": `${leaf.spin.toFixed(2)}deg`,
              "--leaf-drift-duration": `${leaf.driftDuration.toFixed(2)}s`,
              "--leaf-bob-duration": `${leaf.bobDuration.toFixed(2)}s`,
              "--leaf-delay": `${leaf.delay.toFixed(2)}s`,
              "--leaf-opacity": leaf.opacity.toFixed(4),
            } as CSSProperties
          }
        >
          <span className="floating-leaf-bob">
            <span className="floating-leaf-shape" />
          </span>
        </div>
      ))}
    </div>
  );
}
