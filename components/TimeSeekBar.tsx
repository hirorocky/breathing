"use client";

import { useCallback, useEffect, useRef } from "react";
import { phaseToServiceMinutes } from "@/lib/dayCycle";

type Props = {
  phase: number;
  onPhaseChange: (phase: number) => void;
};

function phaseFromClientX(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, ratio));
}

/** サービス内時刻 0:00〜24:00 のシークバー */
export function TimeSeekBar({ phase, onPhaseChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      onPhaseChange(phaseFromClientX(track, clientX));
    },
    [onPhaseChange],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromPointer(event.clientX);
    };

    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [updateFromPointer]);

  const serviceMinutes = phaseToServiceMinutes(phase);
  const indicatorLeft = `${Math.min(100, Math.max(0, phase * 100))}%`;

  return (
    <div className="time-seek-bar">
      <div
        ref={trackRef}
        className="time-seek-track"
        role="slider"
        aria-label="サービス内時刻"
        aria-valuemin={0}
        aria-valuemax={24 * 60}
        aria-valuenow={serviceMinutes}
        tabIndex={0}
        onPointerDown={(event) => {
          draggingRef.current = true;
          trackRef.current?.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.05 : 0.01;
          if (event.key === "ArrowRight") {
            onPhaseChange(Math.min(1, phase + step));
            event.preventDefault();
          }
          if (event.key === "ArrowLeft") {
            onPhaseChange(Math.max(0, phase - step));
            event.preventDefault();
          }
        }}
      >
        <div className="time-seek-rail" />
        <div className="time-seek-indicator" style={{ left: indicatorLeft }} />
      </div>
    </div>
  );
}
