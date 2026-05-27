"use client";

import { useCallback, useMemo, useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { seededRandom } from "@/lib/random";

type OrbLayout = {
  x: number;
  y: number;
  phase: number;
  rate: number;
  isYou: boolean;
};

type Props = {
  count: number;
};

/** 画面周辺に漂う「他者の気配」を表す点 */
export function Orbs({ count }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const orbs = useMemo((): OrbLayout[] => {
    return Array.from({ length: count }, (_, i) => {
      const angle = seededRandom(i) * Math.PI * 2;
      const distance = 36 + seededRandom(i + 50) * 14;
      return {
        x: 50 + Math.cos(angle) * distance,
        y: 50 + Math.sin(angle) * distance * 0.78,
        phase: seededRandom(i + 100) * 6,
        rate: 0.7 + seededRandom(i + 150) * 0.6,
        isYou: i === count - 1,
      };
    });
  }, [count]);

  const animate = useCallback(
    (time: number) => {
      const t = time / 1000;
      const elements = containerRef.current?.querySelectorAll<HTMLElement>(".orb");
      if (!elements) return;

      elements.forEach((el, i) => {
        const orb = orbs[i];
        const phase = t * 0.5 * orb.rate + orb.phase;
        const scale = 0.7 + 0.7 * (0.5 + 0.5 * Math.sin(phase));
        const opacity = 0.18 + 0.45 * (0.5 + 0.5 * Math.sin(phase + 0.3));
        el.style.setProperty("--s", scale.toFixed(3));
        el.style.setProperty("--o", opacity.toFixed(3));
      });
    },
    [orbs],
  );

  useAnimationFrame(animate);

  return (
    <div className="orbs" ref={containerRef} aria-hidden="true">
      {orbs.map((orb, i) => (
        <div
          key={i}
          className={`orb${orb.isYou ? " you" : ""}`}
          style={{ left: `${orb.x}%`, top: `${orb.y}%` }}
        />
      ))}
    </div>
  );
}
