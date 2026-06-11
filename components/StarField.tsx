"use client";

import { useCallback, useMemo, useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { seededRandom } from "@/lib/random";

const STAR_COUNT = 52;

type StarLayout = {
  x: number;
  y: number;
  phase: number;
  rate: number;
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
      return {
        x: 4 + r0 * 92,
        y: 6 + r1 * 68,
        phase: r2 * Math.PI * 2,
        rate: 0.55 + r3 * 0.9,
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
        const phase = t * 0.42 * star.rate + star.phase;
        const twinkle = 0.5 + 0.5 * Math.sin(phase);
        const scale = 0.65 + 0.55 * twinkle;
        const baseOpacity = 0.22 + 0.62 * twinkle;
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
      style={{ opacity: ambience }}
      aria-hidden="true"
    >
      {stars.map((star, i) => (
        <div
          key={i}
          className={`star${star.isYou ? " you" : ""}`}
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
          }}
        />
      ))}
    </div>
  );
}
