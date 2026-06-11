"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyDayPalette,
  formatServiceTime,
  getEffectivePhase,
  getPhaseLabel,
  getSyncPhase,
  leafAmbience,
  nightAmbience,
  sampleDayPalette,
} from "@/lib/dayCycle";
import { nowMs } from "@/lib/time";

type Options = {
  debug?: boolean;
  phaseOffset: number | null;
};

/** サービス内時刻に合わせて背景色トークンを更新する */
export function useDayCycle({ debug = false, phaseOffset }: Options) {
  const [syncPhase, setSyncPhase] = useState(0);

  useEffect(() => {
    const tick = () => setSyncPhase(getSyncPhase(nowMs(), debug));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [debug]);

  const effectivePhase = useMemo(
    () => getEffectivePhase(syncPhase, phaseOffset),
    [phaseOffset, syncPhase],
  );

  useEffect(() => {
    applyDayPalette(document.documentElement, sampleDayPalette(effectivePhase));
  }, [effectivePhase]);

  return {
    syncPhase,
    effectivePhase,
    serviceTimeLabel: formatServiceTime(effectivePhase),
    phaseLabel: getPhaseLabel(effectivePhase),
    isManual: phaseOffset !== null,
    nightAmbience: nightAmbience(effectivePhase),
    leafAmbience: leafAmbience(effectivePhase),
  };
}
