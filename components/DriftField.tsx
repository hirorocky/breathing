"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
} from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import {
  createPinkNoiseState,
  pinkToAlpha01,
  stepPink,
} from "@/lib/pinkNoise";
import { seededRandom } from "@/lib/random";

type Drift = {
  id: string;
  text: string;
  x: number;
  y: number;
  fallTarget: number;
  leaving: boolean;
};

type DriftRuntime = {
  noise: ReturnType<typeof createPinkNoiseState>;
  noiseX: ReturnType<typeof createPinkNoiseState>;
  noiseY: ReturnType<typeof createPinkNoiseState>;
  lissajousPhase: number;
  wanderX: number;
  wanderY: number;
  driftStartedAt: number | null;
};

type Props = {
  words: ReadonlyArray<{ id: string; text: string }>;
};

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1_000_000);
}

function createDrift(id: string, text: string): Drift {
  const seed = hashSeed(id);
  const r1 = seededRandom(seed + 17);

  return {
    id,
    text,
    x: 6 + Math.random() * 88,
    y: 12 + Math.random() * 72,
    fallTarget: 16 + r1 * 22,
    leaving: false,
  };
}

function createRuntime(id: string): DriftRuntime {
  const seed = hashSeed(id);
  const r2 = seededRandom(seed + 41);

  return {
    noise: createPinkNoiseState(seed),
    noiseX: createPinkNoiseState(seed + 101),
    noiseY: createPinkNoiseState(seed + 203),
    lissajousPhase: r2 * Math.PI * 2,
    wanderX: 0,
    wanderY: 0,
    driftStartedAt: null,
  };
}

const WANDER_MAX = 72;
const WANDER_SPEED = 14;
const DRIFT_BLEND_SEC = 2;
const ENTER_END_OPACITY = 0.78;
const ALPHA_EXAGGERATION = 1.15;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** ユーザーが置いた言葉だけが、静かに漂い続ける */
export function DriftField({ words }: Props) {
  const [drifts, setDrifts] = useState<Drift[]>([]);
  const [driftingIds, setDriftingIds] = useState<Set<string>>(() => new Set());
  const liveIds = useMemo(() => new Set(words.map((w) => w.id)), [words]);
  const leaveTimers = useRef(new Map<string, number>());
  const motionRefs = useRef(new Map<string, HTMLDivElement>());
  const runtimeRef = useRef(new Map<string, DriftRuntime>());
  const driftsRef = useRef(drifts);
  const driftingIdsRef = useRef(driftingIds);
  const lastFrameRef = useRef<number | null>(null);
  driftsRef.current = drifts;
  driftingIdsRef.current = driftingIds;

  useEffect(() => {
    setDrifts((current) => {
      const currentById = new Map(current.map((d) => [d.id, d]));
      const next: Drift[] = [];

      for (const w of words) {
        const existing = currentById.get(w.id);
        if (existing) {
          next.push({ ...existing, text: w.text, leaving: false });
        } else {
          runtimeRef.current.set(w.id, createRuntime(w.id));
          next.push(createDrift(w.id, w.text));
        }
      }

      for (const d of current) {
        if (!liveIds.has(d.id) && !d.leaving) {
          next.push({ ...d, leaving: true });

          const el = motionRefs.current.get(d.id);
          if (el) {
            el.style.opacity = "";
            el.style.transform = "";
          }

          const existingTimer = leaveTimers.current.get(d.id);
          if (existingTimer) window.clearTimeout(existingTimer);
          const timer = window.setTimeout(() => {
            setDrifts((items) => items.filter((item) => item.id !== d.id));
            leaveTimers.current.delete(d.id);
            runtimeRef.current.delete(d.id);
            motionRefs.current.delete(d.id);
            setDriftingIds((ids) => {
              const nextIds = new Set(ids);
              nextIds.delete(d.id);
              return nextIds;
            });
          }, 1100);
          leaveTimers.current.set(d.id, timer);
        }
      }

      return next;
    });
  }, [words, liveIds]);

  useEffect(() => {
    const timers = leaveTimers.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleEnterEnd = useCallback((id: string, event: AnimationEvent) => {
    if (event.animationName !== "driftEnter") return;

    const el = motionRefs.current.get(id);
    const drift = driftsRef.current.find((d) => d.id === id);
    const rt = runtimeRef.current.get(id);
    if (el && drift && rt) {
      rt.driftStartedAt = performance.now();
      // CSS アニメ解除後も落下終点に留める（瞬間移動防止）
      el.style.transform = `translate3d(0px, ${drift.fallTarget}px, 0)`;
      el.style.opacity = String(ENTER_END_OPACITY);
    }

    setDriftingIds((ids) => {
      if (ids.has(id)) return ids;
      const next = new Set(ids);
      next.add(id);
      return next;
    });
  }, []);

  useAnimationFrame((now) => {
    const last = lastFrameRef.current;
    lastFrameRef.current = now;
    if (last === null) return;

    const dt = Math.min(0.05, (now - last) / 1000);
    if (dt <= 0) return;

    for (const drift of driftsRef.current) {
      if (drift.leaving || !driftingIdsRef.current.has(drift.id)) continue;

      const el = motionRefs.current.get(drift.id);
      const rt = runtimeRef.current.get(drift.id);
      if (!el || !rt) continue;

      if (rt.driftStartedAt === null) continue;

      const pink = stepPink(rt.noise);
      const alpha01 = pinkToAlpha01(pink, ALPHA_EXAGGERATION);
      const flickerOpacity = 0.1 + alpha01 * 0.9;

      const vx = stepPink(rt.noiseX) * WANDER_SPEED;
      const vy = stepPink(rt.noiseY) * WANDER_SPEED;
      rt.wanderX += vx * dt;
      rt.wanderY += vy * dt;

      const dist = Math.hypot(rt.wanderX, rt.wanderY);
      if (dist > WANDER_MAX) {
        const s = WANDER_MAX / dist;
        rt.wanderX *= s;
        rt.wanderY *= s;
      }

      const driftSec = (now - rt.driftStartedAt) / 1000;
      const blend = easeOutCubic(Math.min(1, driftSec / DRIFT_BLEND_SEC));
      const opacity =
        ENTER_END_OPACITY + (flickerOpacity - ENTER_END_OPACITY) * blend;

      const lissX =
        Math.sin(driftSec * 0.16 + rt.lissajousPhase) * 9 * blend;
      const lissY =
        Math.cos(driftSec * 0.13 + rt.lissajousPhase * 1.15) * 7 * blend;

      const tx = rt.wanderX * blend + lissX;
      const ty = drift.fallTarget + rt.wanderY * blend + lissY;

      el.style.opacity = opacity.toFixed(3);
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
    }
  });

  return (
    <div className="driftfield" aria-hidden="true">
      {drifts.map((drift) => {
        const isDrifting = driftingIds.has(drift.id);

        return (
          <div
            key={drift.id}
            className={`drift-anchor${drift.leaving ? " leaving" : ""}`}
            style={
              {
                left: `${drift.x}%`,
                top: `${drift.y}%`,
              } as CSSProperties
            }
          >
            <div
              ref={(node) => {
                if (node) motionRefs.current.set(drift.id, node);
                else motionRefs.current.delete(drift.id);
              }}
              className={`drift-motion${isDrifting ? " drifting" : " entering"}${
                drift.leaving ? " leaving" : ""
              }`}
              style={
                {
                  "--fall-y": `${drift.fallTarget}px`,
                } as CSSProperties
              }
              onAnimationEnd={(event) => handleEnterEnd(drift.id, event)}
            >
              <span className="driftword">{drift.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
