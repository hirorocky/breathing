import { seededRandom } from "@/lib/random";

export type PinkNoiseState = {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
};

export function createPinkNoiseState(seed: number): PinkNoiseState {
  return {
    p1: seededRandom(seed + 11) * 2 - 1,
    p2: seededRandom(seed + 29) * 2 - 1,
    p3: seededRandom(seed + 41) * 2 - 1,
    p4: seededRandom(seed + 71) * 2 - 1,
  };
}

/** 1/f 寄りのノイズを 1 ステップ進め、-1..1 付近の値を返す */
export function stepPink(state: PinkNoiseState): number {
  state.p1 += (Math.random() * 2 - 1 - state.p1) * 0.005;
  state.p2 += (Math.random() * 2 - 1 - state.p2) * 0.011;
  state.p3 += (Math.random() * 2 - 1 - state.p3) * 0.024;
  state.p4 += (Math.random() * 2 - 1 - state.p4) * 0.048;
  return (
    0.52 * state.p1 + 0.28 * state.p2 + 0.14 * state.p3 + 0.06 * state.p4
  );
}

/** 少し大げさな 0..1（明度用） */
export function pinkToAlpha01(pink: number, exaggeration = 1): number {
  const drive = pink * (3.4 * exaggeration);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * Math.tanh(drive)));
}
