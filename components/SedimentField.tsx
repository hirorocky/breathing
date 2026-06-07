"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { INTERACTION } from "@/lib/interaction/constants";

type Sediment = {
  id: number;
  word: string;
  settleMs: number;
  x: number;
  y: number;
};

type Props = {
  /** 新しく置かれた言葉。沈殿後 onSettled で drift プールへ */
  incoming: string | null;
  onSettled: (word: string) => void;
  onIncomingHandled: () => void;
};

/** 置いた言葉が、ランダムな位置でしばらく沈んでから漂い始める */
export function SedimentField({
  incoming,
  onSettled,
  onIncomingHandled,
}: Props) {
  const [sediments, setSediments] = useState<Sediment[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!incoming) return;

    const word = incoming;
    onIncomingHandled();

    const settleMs =
      INTERACTION.sedimentMinMs +
      Math.random() * (INTERACTION.sedimentMaxMs - INTERACTION.sedimentMinMs);
    const id = ++nextId.current;
    const x = 6 + Math.random() * 88;
    const y = 12 + Math.random() * 72;

    setSediments((current) => [...current, { id, word, settleMs, x, y }]);

    const timerId = window.setTimeout(() => {
      setSediments((current) => current.filter((s) => s.id !== id));
      onSettled(word);
    }, settleMs);

    return () => window.clearTimeout(timerId);
  }, [incoming, onSettled, onIncomingHandled]);

  return (
    <div className="sedimentfield" aria-hidden="true">
      {sediments.map((sediment) => (
        <div
          key={sediment.id}
          className="sedimentword"
          style={
            {
              left: `${sediment.x}%`,
              top: `${sediment.y}%`,
              "--sediment-ms": `${sediment.settleMs}ms`,
            } as CSSProperties
          }
        >
          {sediment.word}
        </div>
      ))}
    </div>
  );
}
