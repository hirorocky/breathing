"use client";

import { useCallback, useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";

type Props = {
  count: number;
};

function PresenceDots({ count }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);

  const animate = useCallback(
    (time: number) => {
      const t = time / 1000;
      const dots = containerRef.current?.querySelectorAll<HTMLElement>(".pd");
      if (!dots) return;

      dots.forEach((dot, index) => {
        const phase = t * 0.6 + index * 1.7;
        const scale = 0.85 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
        const opacity = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(phase + 0.4));
        dot.style.setProperty("--s", scale.toFixed(3));
        dot.style.setProperty("--o", opacity.toFixed(3));
      });
    },
    [],
  );

  useAnimationFrame(animate);

  return (
    <span ref={containerRef} className="presence-dots">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`pd${index === count - 1 ? " you" : ""}`}
        />
      ))}
    </span>
  );
}

type SiteChromeProps = {
  presenceCount: number;
};

/** 画面四隅の控えめなラベル */
export function SiteChrome({ presenceCount }: SiteChromeProps) {
  return (
    <>
      <div className="chrome">
        <span className="dot" />
        <span className="title">深呼吸している場所</span>
      </div>
      <div className="chrome-right">
        <PresenceDots count={presenceCount} />
        <span className="label">いま、{presenceCount}人が居合わせている</span>
      </div>
    </>
  );
}
