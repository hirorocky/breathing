"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTERACTION } from "@/lib/interaction/constants";

export type Ripple = {
  id: number;
  x: number;
  y: number;
};

type Options = {
  onBreathTouched?: () => void;
};

export function useInteractionState(options: Options = {}) {
  const { onBreathTouched } = options;
  const onBreathTouchedRef = useRef(onBreathTouched);
  onBreathTouchedRef.current = onBreathTouched;

  // SSR と CSR の初期レンダーが一致するよう、seed は mount 後にのみ確定する
  const [sessionSeed, setSessionSeed] = useState(0);
  useEffect(() => {
    setSessionSeed(Math.random());
  }, []);

  const [touchBoost, setTouchBoost] = useState(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const lastRippleAt = useRef(0);
  const lastBreathClickAt = useRef(0);
  const rippleId = useRef(0);
  const boostTimerRef = useRef<number | null>(null);

  const clearBoostTimer = useCallback(() => {
    if (boostTimerRef.current !== null) {
      window.clearTimeout(boostTimerRef.current);
      boostTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearBoostTimer, [clearBoostTimer]);

  const triggerRipple = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastRippleAt.current < INTERACTION.rippleDebounceMs) return false;

    lastRippleAt.current = now;
    const id = ++rippleId.current;
    setRipples((current) => [...current, { id, x, y }]);

    window.setTimeout(() => {
      setRipples((current) => current.filter((r) => r.id !== id));
    }, 1200);

    return true;
  }, []);

  const triggerBreathClick = useCallback(() => {
    const now = Date.now();
    if (now - lastBreathClickAt.current < INTERACTION.breathClickCooldownMs) {
      return false;
    }

    lastBreathClickAt.current = now;
    onBreathTouchedRef.current?.();

    window.setTimeout(() => {
      clearBoostTimer();
      setTouchBoost(INTERACTION.touchBoostAmount);

      boostTimerRef.current = window.setTimeout(() => {
        setTouchBoost(0);
        boostTimerRef.current = null;
      }, INTERACTION.touchBoostDurationMs);
    }, INTERACTION.breathClickDelayMs);

    return true;
  }, [clearBoostTimer]);

  return {
    sessionSeed,
    touchBoost,
    ripples,
    triggerRipple,
    triggerBreathClick,
  };
}
