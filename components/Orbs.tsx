"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { INTERACTION } from "@/lib/interaction/constants";
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
  sessionSeed: number;
};

function seededFromSession(sessionSeed: number, index: number): number {
  return seededRandom(sessionSeed * 1000 + index);
}

/** 画面周辺に漂う「他者の気配」を表す点 */
export function Orbs({ count, sessionSeed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const orbs = useMemo((): OrbLayout[] => {
    return Array.from({ length: count }, (_, i) => {
      const angle = seededFromSession(sessionSeed, i) * Math.PI * 2;
      const distance = 36 + seededFromSession(sessionSeed, i + 50) * 14;
      return {
        x: 50 + Math.cos(angle) * distance,
        y: 50 + Math.sin(angle) * distance * 0.78,
        phase: seededFromSession(sessionSeed, i + 100) * 6,
        rate: 0.7 + seededFromSession(sessionSeed, i + 150) * 0.6,
        isYou: i === count - 1,
      };
    });
  }, [count, sessionSeed]);

  const handleOrbEnter = useCallback((index: number) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredIndex(index);
      hoverTimerRef.current = null;
    }, INTERACTION.orbHoverDelayMs);
  }, []);

  const handleOrbLeave = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    window.setTimeout(() => {
      setHoveredIndex(null);
    }, INTERACTION.orbHoverReleaseMs);
  }, []);

  const animate = useCallback(
    (time: number) => {
      const t = time / 1000;
      const elements = containerRef.current?.querySelectorAll<HTMLElement>(".orb");
      if (!elements) return;

      elements.forEach((el, i) => {
        const orb = orbs[i];
        const phase = t * 0.5 * orb.rate + orb.phase;
        const scale = 0.7 + 0.7 * (0.5 + 0.5 * Math.sin(phase));
        const baseOpacity = 0.18 + 0.45 * (0.5 + 0.5 * Math.sin(phase + 0.3));
        const hoverBoost = hoveredIndex === i ? INTERACTION.orbHoverBoost : 0;
        el.style.setProperty("--s", scale.toFixed(3));
        el.style.setProperty("--o", Math.min(1, baseOpacity + hoverBoost).toFixed(3));
      });
    },
    [orbs, hoveredIndex],
  );

  useAnimationFrame(animate);

  return (
    <div className="orbs" ref={containerRef} aria-hidden="true">
      {orbs.map((orb, i) => (
        <div
          key={i}
          className={`orb${orb.isYou ? " you" : ""}`}
          style={{ left: `${orb.x}%`, top: `${orb.y}%` }}
          onMouseEnter={() => handleOrbEnter(i)}
          onMouseLeave={handleOrbLeave}
        />
      ))}
    </div>
  );
}
