"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { pickRandom } from "@/lib/random";

type Drift = {
  id: number;
  word: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
};

type Props = {
  words: readonly string[];
};

/** 沈殿した言葉が、時折ふわっと浮かび上がって消えていく */
export function DriftField({ words }: Props) {
  const [drifts, setDrifts] = useState<Drift[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (words.length === 0) return;

    let cancelled = false;
    let timerId = 0;

    const surfaceWord = () => {
      if (cancelled) return;

      const word = pickRandom(words);
      const id = ++nextId.current;
      const fromBelow = Math.random() < 0.5;

      const drift: Drift = fromBelow
        ? {
            id,
            word,
            x: 8 + Math.random() * 84,
            y: 60 + Math.random() * 25,
            dx: (Math.random() - 0.5) * 40,
            dy: -120 - Math.random() * 60,
          }
        : {
            id,
            word,
            x: Math.random() < 0.5 ? 4 : 70,
            y: 18 + Math.random() * 50,
            dx: (Math.random() < 0.5 ? 1 : -1) * (60 + Math.random() * 50),
            dy: -30 + Math.random() * 20,
          };

      setDrifts((current) => [...current, drift]);

      window.setTimeout(() => {
        setDrifts((current) => current.filter((item) => item.id !== id));
      }, 6200);

      timerId = window.setTimeout(surfaceWord, 2400 + Math.random() * 4500);
    };

    timerId = window.setTimeout(surfaceWord, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [words]);

  return (
    <div className="driftfield" aria-hidden="true">
      {drifts.map((drift) => (
        <div
          key={drift.id}
          className="driftword"
          style={
            {
              left: `${drift.x}%`,
              top: `${drift.y}%`,
              "--dx": `${drift.dx}px`,
              "--dy": `${drift.dy}px`,
            } as CSSProperties
          }
        >
          {drift.word}
        </div>
      ))}
    </div>
  );
}
