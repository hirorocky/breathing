"use client";

import { useEffect, useState } from "react";

/** orb 数の変化をゆっくり追従（にぎわりの急変を避ける） */
export function useOrbCount(target: number, stepMs = 1_200): number {
  const [displayed, setDisplayed] = useState(target);

  useEffect(() => {
    if (displayed === target) return;

    const id = window.setTimeout(() => {
      setDisplayed((prev) => {
        if (prev < target) return prev + 1;
        if (prev > target) return prev - 1;
        return prev;
      });
    }, stepMs);

    return () => window.clearTimeout(id);
  }, [displayed, target, stepMs]);

  return displayed;
}
