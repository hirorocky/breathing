"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { EventComponentProps } from "@/lib/events/types";
import { seededRandom } from "@/lib/random";
import {
  WATER_EVENT_DURATION_MS,
  createWaterSurfaceParams,
  drawWaterSurface,
} from "@/lib/waterSurface";

/** 画面全体を水面として、波紋と光の反射で揺らす */
export function BreathWaveEvent({ seed, onComplete }: EventComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const params = useMemo(() => createWaterSurfaceParams(seed), [seed]);

  const style = useMemo(() => {
    const r1 = seededRandom(seed * 307);
    return {
      "--wave-drift": seed < 0.5 ? -1 : 1,
      "--wave-sway": 0.82 + r1 * 0.45,
    } as CSSProperties;
  }, [seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frameId = 0;
    let completed = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const elapsedSec = elapsed / 1000;

      drawWaterSurface(
        ctx,
        window.innerWidth,
        window.innerHeight,
        elapsedSec,
        params,
      );

      if (elapsed >= WATER_EVENT_DURATION_MS) {
        if (!completed) {
          completed = true;
          onCompleteRef.current();
        }
        return;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frameId);
    };
  }, [params]);

  return (
    <div className="event breath-wave-event" style={style} aria-hidden="true">
      <div className="breath-wave-viewport">
        <canvas ref={canvasRef} className="breath-wave-canvas" />
      </div>
    </div>
  );
}
