import { nowMs } from "@/lib/time";

export const DAY_CYCLE_SECONDS = 360;
export const DAY_CYCLE_DEBUG_SECONDS = 30;
export const SERVICE_MINUTES_PER_DAY = 24 * 60;

type Oklch = { l: number; c: number; h: number };

export type DayPalette = {
  bgDeep: string;
  bgMid: string;
  bgSoft: string;
  ink: string;
  inkMute: string;
  inkFaint: string;
  ember: string;
  emberSoft: string;
};

type PaletteStop = {
  phase: number;
  bgDeep: Oklch;
  bgMid: Oklch;
  bgSoft: Oklch;
  ink: Oklch;
  inkMute: Oklch;
  inkFaint: Oklch;
  ember: Oklch;
  emberSoft: Oklch;
};

/** 森の池の水面 — 夜は星空、朝は青空、夕方はオレンジの反射 */
const STOPS: PaletteStop[] = [
  {
    phase: 0,
    bgDeep: { l: 0.11, c: 0.04, h: 268 },
    bgMid: { l: 0.15, c: 0.045, h: 272 },
    bgSoft: { l: 0.19, c: 0.038, h: 278 },
    ink: { l: 0.84, c: 0.025, h: 250 },
    inkMute: { l: 0.72, c: 0.032, h: 265 },
    inkFaint: { l: 0.58, c: 0.028, h: 270 },
    ember: { l: 0.82, c: 0.07, h: 95 },
    emberSoft: { l: 0.62, c: 0.048, h: 268 },
  },
  {
    phase: 0.12,
    bgDeep: { l: 0.1, c: 0.042, h: 265 },
    bgMid: { l: 0.13, c: 0.048, h: 270 },
    bgSoft: { l: 0.17, c: 0.04, h: 275 },
    ink: { l: 0.86, c: 0.03, h: 248 },
    inkMute: { l: 0.74, c: 0.036, h: 262 },
    inkFaint: { l: 0.6, c: 0.03, h: 268 },
    ember: { l: 0.85, c: 0.08, h: 100 },
    emberSoft: { l: 0.64, c: 0.05, h: 265 },
  },
  {
    phase: 0.22,
    bgDeep: { l: 0.16, c: 0.048, h: 252 },
    bgMid: { l: 0.22, c: 0.058, h: 246 },
    bgSoft: { l: 0.28, c: 0.062, h: 242 },
    ink: { l: 0.82, c: 0.03, h: 245 },
    inkMute: { l: 0.7, c: 0.038, h: 248 },
    inkFaint: { l: 0.56, c: 0.034, h: 252 },
    ember: { l: 0.78, c: 0.06, h: 82 },
    emberSoft: { l: 0.58, c: 0.044, h: 238 },
  },
  {
    phase: 0.32,
    bgDeep: { l: 0.28, c: 0.07, h: 215 },
    bgMid: { l: 0.38, c: 0.1, h: 232 },
    bgSoft: { l: 0.5, c: 0.125, h: 230 },
    ink: { l: 0.28, c: 0.065, h: 252 },
    inkMute: { l: 0.38, c: 0.055, h: 246 },
    inkFaint: { l: 0.48, c: 0.048, h: 240 },
    ember: { l: 0.55, c: 0.1, h: 228 },
    emberSoft: { l: 0.44, c: 0.08, h: 234 },
  },
  {
    phase: 0.45,
    bgDeep: { l: 0.32, c: 0.075, h: 212 },
    bgMid: { l: 0.44, c: 0.11, h: 228 },
    bgSoft: { l: 0.56, c: 0.135, h: 226 },
    ink: { l: 0.22, c: 0.075, h: 255 },
    inkMute: { l: 0.32, c: 0.065, h: 248 },
    inkFaint: { l: 0.42, c: 0.055, h: 242 },
    ember: { l: 0.48, c: 0.105, h: 224 },
    emberSoft: { l: 0.4, c: 0.085, h: 230 },
  },
  {
    phase: 0.58,
    bgDeep: { l: 0.3, c: 0.07, h: 214 },
    bgMid: { l: 0.4, c: 0.095, h: 232 },
    bgSoft: { l: 0.5, c: 0.11, h: 236 },
    ink: { l: 0.26, c: 0.068, h: 252 },
    inkMute: { l: 0.36, c: 0.058, h: 246 },
    inkFaint: { l: 0.46, c: 0.05, h: 240 },
    ember: { l: 0.52, c: 0.098, h: 226 },
    emberSoft: { l: 0.42, c: 0.078, h: 232 },
  },
  {
    phase: 0.68,
    bgDeep: { l: 0.22, c: 0.055, h: 185 },
    bgMid: { l: 0.32, c: 0.1, h: 48 },
    bgSoft: { l: 0.42, c: 0.135, h: 44 },
    ink: { l: 0.8, c: 0.04, h: 65 },
    inkMute: { l: 0.68, c: 0.058, h: 55 },
    inkFaint: { l: 0.54, c: 0.052, h: 50 },
    ember: { l: 0.72, c: 0.16, h: 46 },
    emberSoft: { l: 0.58, c: 0.12, h: 50 },
  },
  {
    phase: 0.76,
    bgDeep: { l: 0.18, c: 0.06, h: 175 },
    bgMid: { l: 0.28, c: 0.125, h: 40 },
    bgSoft: { l: 0.38, c: 0.155, h: 38 },
    ink: { l: 0.86, c: 0.048, h: 68 },
    inkMute: { l: 0.74, c: 0.068, h: 56 },
    inkFaint: { l: 0.6, c: 0.058, h: 52 },
    ember: { l: 0.68, c: 0.18, h: 42 },
    emberSoft: { l: 0.54, c: 0.14, h: 44 },
  },
  {
    phase: 0.86,
    bgDeep: { l: 0.13, c: 0.048, h: 278 },
    bgMid: { l: 0.17, c: 0.052, h: 272 },
    bgSoft: { l: 0.21, c: 0.045, h: 268 },
    ink: { l: 0.84, c: 0.028, h: 255 },
    inkMute: { l: 0.72, c: 0.034, h: 265 },
    inkFaint: { l: 0.58, c: 0.03, h: 268 },
    ember: { l: 0.8, c: 0.072, h: 88 },
    emberSoft: { l: 0.6, c: 0.046, h: 266 },
  },
  {
    phase: 1,
    bgDeep: { l: 0.11, c: 0.04, h: 268 },
    bgMid: { l: 0.15, c: 0.045, h: 272 },
    bgSoft: { l: 0.19, c: 0.038, h: 278 },
    ink: { l: 0.84, c: 0.025, h: 250 },
    inkMute: { l: 0.72, c: 0.032, h: 265 },
    inkFaint: { l: 0.58, c: 0.028, h: 270 },
    ember: { l: 0.82, c: 0.07, h: 95 },
    emberSoft: { l: 0.62, c: 0.048, h: 268 },
  },
];

function cycleSeconds(debug: boolean): number {
  return debug ? DAY_CYCLE_DEBUG_SECONDS : DAY_CYCLE_SECONDS;
}

export function getSyncPhase(atMs: number = nowMs(), debug = false): number {
  const sec = Math.floor(atMs / 1000);
  const period = cycleSeconds(debug);
  return (sec % period) / period;
}

export function normalizePhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

/** ドラッグ先の phase と、その時点の sync からオフセットを求める */
export function phaseOffsetFromTarget(
  syncPhase: number,
  targetPhase: number,
): number {
  return normalizePhase(targetPhase - syncPhase);
}

export function getEffectivePhase(
  syncPhase: number,
  phaseOffset: number | null,
): number {
  if (phaseOffset === null) return syncPhase;
  return normalizePhase(syncPhase + phaseOffset);
}

export function phaseToServiceMinutes(phase: number): number {
  const normalized = ((phase % 1) + 1) % 1;
  return Math.floor(normalized * SERVICE_MINUTES_PER_DAY) % SERVICE_MINUTES_PER_DAY;
}

export function formatServiceTime(phase: number): string {
  const total = phaseToServiceMinutes(phase);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

export function getPhaseLabel(phase: number): string {
  const p = normalizePhase(phase);
  if (p < 0.15 || p >= 0.95) return "dawn";
  if (p < 0.35) return "morning";
  if (p < 0.55) return "day";
  if (p < 0.75) return "dusk";
  return "night";
}

/** 夕暮れ〜夜明け手前（0.75〜0.95）。流れ星は isDeepNightPhase を使う */
export function isNightPhase(phase: number): boolean {
  const p = normalizePhase(phase);
  return p >= 0.75 && p < 0.95;
}

/** 朝〜昼（浮葉の対象） */
export function isMorningDayPhase(phase: number): boolean {
  const p = normalizePhase(phase);
  return p >= 0.15 && p < 0.55;
}

function ramp(value: number, start: number, end: number): number {
  if (value <= start || value >= end) return 0;
  if (value < start + 0.03) return (value - start) / 0.03;
  if (value > end - 0.03) return (end - value) / 0.03;
  return 1;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const TWILIGHT_FADE_MIN = 30;
const NIGHT_START_MIN = 18 * 60;
const DEEP_NIGHT_START_MIN = 21 * 60;
const DEEP_NIGHT_END_MIN = 3 * 60;
const PRE_DAWN_END_MIN = Math.floor(0.15 * SERVICE_MINUTES_PER_DAY);

/** 21:00〜3:00 の深夜帯（星空）— 0〜1 */
function deepNightStarPresence(minutes: number): number {
  if (minutes >= DEEP_NIGHT_START_MIN) {
    return smoothstep(
      DEEP_NIGHT_START_MIN,
      DEEP_NIGHT_START_MIN + TWILIGHT_FADE_MIN,
      minutes,
    );
  }
  if (minutes < DEEP_NIGHT_END_MIN) {
    return 1 - smoothstep(
      DEEP_NIGHT_END_MIN - TWILIGHT_FADE_MIN,
      DEEP_NIGHT_END_MIN,
      minutes,
    );
  }
  return 0;
}

/** 18:00〜3:00 と夜明け手前の orb — 深夜帯も継続（星空と重なる）— 0〜1 */
function twilightOrbPresence(minutes: number): number {
  if (minutes >= NIGHT_START_MIN) {
    if (minutes < NIGHT_START_MIN + TWILIGHT_FADE_MIN) {
      return smoothstep(
        NIGHT_START_MIN,
        NIGHT_START_MIN + TWILIGHT_FADE_MIN,
        minutes,
      );
    }
    return 1;
  }

  if (minutes < DEEP_NIGHT_END_MIN) {
    return 1;
  }

  if (minutes >= DEEP_NIGHT_END_MIN && minutes < PRE_DAWN_END_MIN) {
    if (minutes >= PRE_DAWN_END_MIN - TWILIGHT_FADE_MIN) {
      return 1 - smoothstep(
        PRE_DAWN_END_MIN - TWILIGHT_FADE_MIN,
        PRE_DAWN_END_MIN,
        minutes,
      );
    }
    return 1;
  }

  return 0;
}

/** 夜の orb — 18:00〜3:00 は常に。21:00〜3:00 は星空と重なる */
export function orbNightAmbience(phase: number): number {
  const p = normalizePhase(phase);
  const duskIn = ramp(p, 0.72, 0.75);
  const twilight = twilightOrbPresence(phaseToServiceMinutes(p));
  return Math.max(duskIn, twilight);
}

/** 深夜の星空 — 21:00〜3:00 */
export function starNightAmbience(phase: number): number {
  const p = normalizePhase(phase);
  return deepNightStarPresence(phaseToServiceMinutes(p));
}

/** 21:00〜3:00（星空・流れ星の対象） */
export function isDeepNightPhase(phase: number): boolean {
  return deepNightStarPresence(phaseToServiceMinutes(normalizePhase(phase))) > 0;
}

/** 水面の浮葉レイヤーの不透明度（0〜1） */
export function leafAmbience(phase: number): number {
  const p = normalizePhase(phase);
  return ramp(p, 0.18, 0.58);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

function lerpOklch(a: Oklch, b: Oklch, t: number): Oklch {
  return {
    l: lerp(a.l, b.l, t),
    c: lerp(a.c, b.c, t),
    h: lerpHue(a.h, b.h, t),
  };
}

function fmt(color: Oklch): string {
  return `oklch(${color.l.toFixed(4)} ${color.c.toFixed(4)} ${color.h.toFixed(2)})`;
}

function findStopPair(phase: number): [PaletteStop, PaletteStop, number] {
  const p = ((phase % 1) + 1) % 1;
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (p >= a.phase && p <= b.phase) {
      const span = b.phase - a.phase || 1;
      return [a, b, (p - a.phase) / span];
    }
  }
  return [STOPS[0], STOPS[1], 0];
}

export function sampleDayPalette(phase: number): DayPalette {
  const [a, b, t] = findStopPair(phase);
  return {
    bgDeep: fmt(lerpOklch(a.bgDeep, b.bgDeep, t)),
    bgMid: fmt(lerpOklch(a.bgMid, b.bgMid, t)),
    bgSoft: fmt(lerpOklch(a.bgSoft, b.bgSoft, t)),
    ink: fmt(lerpOklch(a.ink, b.ink, t)),
    inkMute: fmt(lerpOklch(a.inkMute, b.inkMute, t)),
    inkFaint: fmt(lerpOklch(a.inkFaint, b.inkFaint, t)),
    ember: fmt(lerpOklch(a.ember, b.ember, t)),
    emberSoft: fmt(lerpOklch(a.emberSoft, b.emberSoft, t)),
  };
}

export function applyDayPalette(root: HTMLElement, palette: DayPalette): void {
  root.style.setProperty("--bg-deep", palette.bgDeep);
  root.style.setProperty("--bg-mid", palette.bgMid);
  root.style.setProperty("--bg-soft", palette.bgSoft);
  root.style.setProperty("--ink", palette.ink);
  root.style.setProperty("--ink-mute", palette.inkMute);
  root.style.setProperty("--ink-faint", palette.inkFaint);
  root.style.setProperty("--ember", palette.ember);
  root.style.setProperty("--ember-soft", palette.emberSoft);
}
