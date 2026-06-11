"use client";

import { useCallback, useMemo, useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { seededRandom } from "@/lib/random";

const STAR_COUNT = 96;

type StarLayout = {
  x: number;
  y: number;
  phase1: number;
  phase2: number;
  rate1: number;
  rate2: number;
  /** 0〜1。星ごとに瞬きの強さが違う */
  twinkleDepth: number;
  size: number;
  isYou: boolean;
};

type Props = {
  sessionSeed: number;
  /** 0〜1。夜ほど星が濃く見える */
  ambience: number;
};

function seededFromSession(sessionSeed: number, index: number): number {
  return seededRandom(sessionSeed * 2000 + index);
}

/** 夜の水面に映る星空 */
export function StarField({ sessionSeed, ambience }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const stars = useMemo((): StarLayout[] => {
    return Array.from({ length: STAR_COUNT }, (_, i) => {
      const r0 = seededFromSession(sessionSeed, i);
      const r1 = seededFromSession(sessionSeed, i + 40);
      const r2 = seededFromSession(sessionSeed, i + 80);
      const r3 = seededFromSession(sessionSeed, i + 120);
      const r4 = seededFromSession(sessionSeed, i + 160);
      return {
        x: 4 + r0 * 92,
        y: 6 + r1 * 68,
        phase1: r2 * Math.PI * 2,
        phase2: r3 * Math.PI * 2,
        rate1: 0.25 + r0 * 2.8,
        rate2: 0.4 + r1 * 3.6,
        twinkleDepth: 0.12 + r4 * 0.88,
        size: 1.4 + r2 * 1.8,
        isYou: i === STAR_COUNT - 1,
      };
    });
  }, [sessionSeed]);

  const animate = useCallback(
    (time: number) => {
      const t = time / 1000;
      const elements = containerRef.current?.querySelectorAll<HTMLElement>(".star");
      if (!elements) return;

      elements.forEach((el, i) => {
        const star = stars[i];
        const wave1 = Math.sin(t * star.rate1 + star.phase1);
        const wave2 = Math.sin(t * star.rate2 + star.phase2);
        const twinkle = 0.5 + 0.5 * (wave1 * 0.58 + wave2 * 0.42);
        const pulseRaw = 1 - star.twinkleDepth + star.twinkleDepth * twinkle;
        const pulse = 0.42 + 0.58 * pulseRaw;
        const scale = 0.64 + 0.26 * pulse;
        const baseOpacity = 0.36 + 0.22 * pulse;
        el.style.setProperty("--s", scale.toFixed(3));
        el.style.setProperty("--o", baseOpacity.toFixed(3));
      });
    },
    [stars],
  );

  useAnimationFrame(animate);

  if (ambience <= 0.01) return null;

  return (
    <div
      className="starfield"
      ref={containerRef}
      style={{ opacity: Number((ambience * 0.72).toFixed(4)) }}
      aria-hidden="true"
    >
      {stars.map((star, i) => (
        <div
          key={i}
          className={`star${star.isYou ? " you" : ""}`}
          style={{
            left: `${star.x.toFixed(4)}%`,
            top: `${star.y.toFixed(4)}%`,
            width: `${star.size.toFixed(4)}px`,
            height: `${star.size.toFixed(4)}px`,
          }}
        />
      ))}
    </div>
  );
}
