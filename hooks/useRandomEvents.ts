import { useCallback, useEffect, useRef, useState } from "react";
import { getEventConfig, type EventTimingConfig } from "@/lib/events/config";
import { pickRandomEventType } from "@/components/events/registry";
import type { ActiveEvent } from "@/lib/events/types";
import { nowMs } from "@/lib/time";

function randomIntervalMs(config: EventTimingConfig): number {
  return (
    config.minIntervalMs +
    Math.random() * (config.maxIntervalMs - config.minIntervalMs)
  );
}

type Options = {
  /** false の間はスケジュールも表示も止める */
  enabled?: boolean;
  /** true のとき短いイベント間隔を使う */
  debug?: boolean;
  /** サービス内時刻の phase（0〜1）。イベント種別の絞り込みに使う */
  phase?: number;
};

/**
 * 静かにランダムイベントをスケジュールする。
 * 同時に 1 つだけ。終了後、ランダムな間隔で次を予約する。
 */
export function useRandomEvents({
  enabled = true,
  debug = false,
  phase = 0,
}: Options = {}) {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [nextFireAt, setNextFireAt] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  const debugRef = useRef(debug);
  const phaseRef = useRef(phase);
  enabledRef.current = enabled;
  debugRef.current = debug;
  phaseRef.current = phase;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number) => {
      clearTimer();
      if (!enabledRef.current) {
        setNextFireAt(null);
        return;
      }

      setNextFireAt(nowMs() + delayMs);

      timerRef.current = window.setTimeout(() => {
        if (!enabledRef.current) return;

        setNextFireAt(null);
        setActiveEvent({
          instanceId: crypto.randomUUID(),
          type: pickRandomEventType(phaseRef.current),
          seed: Math.random(),
        });
      }, delayMs);
    },
    [clearTimer],
  );

  const completeEvent = useCallback(() => {
    setActiveEvent(null);
    const config = getEventConfig(debugRef.current);
    scheduleNext(randomIntervalMs(config));
  }, [scheduleNext]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      setActiveEvent(null);
      setNextFireAt(null);
      return;
    }

    if (activeEvent === null && timerRef.current === null) {
      const config = getEventConfig(debug);
      scheduleNext(config.initialDelayMs);
    }

    return clearTimer;
  }, [enabled, debug, activeEvent, scheduleNext, clearTimer]);

  return { activeEvent, completeEvent, nextFireAt };
}
