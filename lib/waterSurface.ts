import { seededRandom } from "@/lib/random";

export const WATER_EVENT_DURATION_MS = 5_500;

export type WaterSource = {
  x: number;
  y: number;
  amplitude: number;
  speed: number;
  phase: number;
  wavelength: number;
};

export type WaveTrain = {
  dir: -1 | 1; // -1: left→right, 1: right→left（位相の向き）
  amplitude: number;
  speed: number;
  frequency: number;
  startSec: number;
  durationSec: number;
  phase: number;
  yBias: number;
};

export type WaterSurfaceParams = {
  impact: WaterSource; // 画面外の落水（衝撃源）
  local: WaterSource[]; // 小さな揺れ（場のノイズ）
  trains: WaveTrain[]; // 左/右から押し寄せる波
};

export function createWaterSurfaceParams(seed: number): WaterSurfaceParams {
  const dir: -1 | 1 = seed < 0.5 ? -1 : 1;
  const r0 = seededRandom(seed * 811);
  const r1 = seededRandom(seed * 307);

  // 画面外の大きな落水：左右どちらかの外に置く
  const impact: WaterSource = {
    x: dir === -1 ? -0.22 : 1.22,
    y: 0.52 + (r1 - 0.5) * 0.16,
    amplitude: 1.35 + r0 * 0.55,
    speed: 3.1 + r1 * 1.2,
    phase: seededRandom(seed * 613) * Math.PI * 2,
    wavelength: 0.034 + r0 * 0.016,
  };

  // 場の微小揺れ（少なめに）
  const local: WaterSource[] = [];
  const localCount = 2 + Math.floor(seededRandom(seed * 997) * 2);
  for (let i = 0; i < localCount; i++) {
    const a = seededRandom(seed * 431 + i * 29);
    const b = seededRandom(seed * 127 + i * 41);
    const c = seededRandom(seed * 503 + i * 37);
    local.push({
      x: 0.18 + a * 0.64,
      y: 0.22 + b * 0.56,
      amplitude: 0.14 + c * 0.18,
      speed: 1.2 + a * 1.1,
      phase: b * Math.PI * 2,
      wavelength: 0.045 + c * 0.02,
    });
  }

  // 左 or 右から何枚か「押し寄せる波」
  const trains: WaveTrain[] = [];
  const trainCount = 3 + Math.floor(seededRandom(seed * 911) * 3); // 3..5
  for (let i = 0; i < trainCount; i++) {
    const a = seededRandom(seed * 719 + i * 23);
    const b = seededRandom(seed * 613 + i * 17);
    const c = seededRandom(seed * 991 + i * 19);
    trains.push({
      dir,
      amplitude: 0.75 + a * 0.55,
      speed: 0.9 + b * 1.2,
      frequency: 0.018 + c * 0.012, // px^-1
      startSec: 0.35 + i * (0.55 + a * 0.22),
      durationSec: 1.6 + b * 0.8,
      phase: c * Math.PI * 2,
      yBias: 0.46 + (b - 0.5) * 0.18,
    });
  }

  return { impact, local, trains };
}

function envelope(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 0;
  if (progress < 0.12) return progress / 0.12;
  if (progress > 0.82) return (1 - progress) / 0.18;
  return 1;
}

function sampleHeight(
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  params: WaterSurfaceParams,
): number {
  let sum = 0;

  // 画面外の落水（衝撃波）
  for (const source of [params.impact, ...params.local]) {
    const sx = source.x * width;
    const sy = source.y * height;
    const dx = x - sx;
    const dy = y - sy;
    const dist = Math.hypot(dx, dy);
    const falloff = Math.exp(-dist * source.wavelength * 0.85);
    sum +=
      Math.sin(dist * source.wavelength - time * source.speed + source.phase) *
      source.amplitude *
      falloff;
  }

  // 左右から押し寄せる波（wave train）
  for (const train of params.trains) {
    const t = time - train.startSec;
    if (t <= 0 || t >= train.durationSec) continue;
    const w = Math.sin((t / train.durationSec) * Math.PI) ** 2; // 立ち上がり/落ち

    const yCenter = train.yBias * height;
    const yFalloff = Math.exp(-Math.abs(y - yCenter) / (height * 0.22));
    const phase =
      (x * train.frequency * train.dir - t * train.speed) + train.phase;
    sum += Math.sin(phase) * train.amplitude * w * yFalloff;
  }

  // 低周波の水面ゆらぎ（控えめ）
  sum += Math.sin(x * 0.007 + time * 0.65) * 0.08;
  sum += Math.cos(y * 0.009 - time * 0.48) * 0.06;
  sum += Math.sin((x + y) * 0.006 + time * 0.32) * 0.045;

  return sum;
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fade: number,
) {
  // ベース色で「青く塗らない」。ごく薄い減光だけで水面の存在を出す。
  ctx.fillStyle = `rgba(0, 0, 0, ${0.03 * fade})`;
  ctx.fillRect(0, 0, width, height);
}

export function drawWaterSurface(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedSec: number,
  params: WaterSurfaceParams,
) {
  const progress = elapsedSec / (WATER_EVENT_DURATION_MS / 1000);
  const fade = envelope(progress);
  const cell = Math.max(4, Math.round(Math.min(width, height) / 180));

  ctx.clearRect(0, 0, width, height);
  drawBase(ctx, width, height, fade);

  if (fade <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const cx = x + cell * 0.5;
      const cy = y + cell * 0.5;
      const h = sampleHeight(cx, cy, width, height, elapsedSec, params);
      const hx =
        sampleHeight(cx + cell, cy, width, height, elapsedSec, params) -
        sampleHeight(cx - cell, cy, width, height, elapsedSec, params);
      const hy =
        sampleHeight(cx, cy + cell, width, height, elapsedSec, params) -
        sampleHeight(cx, cy - cell, width, height, elapsedSec, params);

      const slope = Math.hypot(hx, hy);
      // 波の「面の向き」と稜線を強めて、方向性のあるうねりを見せる
      const highlight = Math.max(0, h * 0.55 + slope * 0.52);

      // 色味を乗せず「反射の明部」だけを描く（screen 合成）。
      // highlight の上限を抑えつつ、低周波のきらめきが見える程度に。
      const hot = Math.min(1.4, highlight);
      const alpha = hot * 0.2 * fade;
      if (alpha < 0.002) continue;

      // ほんの少し暖色寄りの白（画面全体が青く見えるのを避ける）
      ctx.fillStyle = `rgba(240, 242, 238, ${alpha})`;
      ctx.fillRect(x, y, cell + 1, cell + 1);
    }
  }

  ctx.restore();
  drawSpecular(ctx, width, height, elapsedSec, fade);
}

function drawSpecular(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  fade: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let i = 0; i < 3; i++) {
    const px = width * (0.28 + i * 0.22 + Math.sin(time * 0.35 + i) * 0.04);
    const py = height * (0.34 + Math.cos(time * 0.28 + i * 1.7) * 0.08);
    const radius = Math.min(width, height) * (0.18 + i * 0.06);
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
    gradient.addColorStop(0, `rgba(245, 246, 242, ${0.1 * fade})`);
    gradient.addColorStop(0.45, `rgba(245, 246, 242, ${0.035 * fade})`);
    gradient.addColorStop(1, "rgba(245, 246, 242, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  }

  ctx.restore();
}
