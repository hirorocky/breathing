import { useCallback, useEffect, useRef, useState } from "react";
import { EVENT_CONFIG } from "@/lib/events/config";
import { pickRandomEventType } from "@/components/events/registry";
import type { ActiveEvent } from "@/lib/events/types";

function randomIntervalMs(): number {
  const { minIntervalMs, maxIntervalMs } = EVENT_CONFIG;
  return minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs);
}

type Options = {
  /** false の間はスケジュールも表示も止める */
  enabled?: boolean;
};

/**
 * 静かにランダムイベントをスケジュールする。
 * 同時に 1 つだけ。終了後、ランダムな間隔で次を予約する。
 */
export function useRandomEvents({ enabled = true }: Options = {}) {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [nextFireAt, setNextFireAt] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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

      setNextFireAt(Date.now() + delayMs);

      timerRef.current = window.setTimeout(() => {
        if (!enabledRef.current) return;

        setNextFireAt(null);
        setActiveEvent({
          instanceId: crypto.randomUUID(),
          type: pickRandomEventType(),
          seed: Math.random(),
        });
      }, delayMs);
    },
    [clearTimer],
  );

  const completeEvent = useCallback(() => {
    setActiveEvent(null);
    scheduleNext(randomIntervalMs());
  }, [scheduleNext]);

  // 初回スケジュール / enabled 切り替え
  useEffect(() => {
    if (!enabled) {
      clearTimer();
      setActiveEvent(null);
      setNextFireAt(null);
      return;
    }

    if (activeEvent === null && timerRef.current === null) {
      scheduleNext(EVENT_CONFIG.initialDelayMs);
    }

    return clearTimer;
  }, [enabled, activeEvent, scheduleNext, clearTimer]);

  return { activeEvent, completeEvent, nextFireAt };
}
