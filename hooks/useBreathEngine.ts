import { useEffect, useRef } from "react";

type BreathOptions = {
  /** 1 サイクルの秒数 */
  cycleSeconds: number;
  /** 吸気が占める割合（0〜1）。残りが呼気 */
  inhaleRatio: number;
  /** 揺らぎの強さ */
  instability: number;
};

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** 0（呼気終わり）〜 1（吸気終わり）。呼気フェーズを長くする */
function breathEnvelope01(
  t: number,
  cycleSeconds: number,
  inhaleRatio: number,
): number {
  const cycle = Math.max(2, cycleSeconds);
  const u = (((t % cycle) + cycle) % cycle) / cycle;
  const inhale = Math.max(0.2, Math.min(0.5, inhaleRatio));

  if (u < inhale) {
    return smoothstep(u / inhale);
  }

  return 1 - smoothstep((u - inhale) / (1 - inhale));
}

/**
 * 呼吸アニメーション。
 * CSS 変数 --bx / --by / --bo を毎フレーム更新し、
 * 中心の形と背景の明るさを同期させる。
 */
export function useBreathEngine({
  cycleSeconds,
  inhaleRatio,
  instability,
}: BreathOptions) {
  const optionsRef = useRef({ cycleSeconds, inhaleRatio, instability });
  optionsRef.current = { cycleSeconds, inhaleRatio, instability };

  useEffect(() => {
    let frameId = 0;
    const startedAt = performance.now();
    let noiseX = 0;
    let noiseY = 0;
    let pink1 = 0;
    let pink2 = 0;
    let pink3 = 0;
    let pink4 = 0;
    const root = document.documentElement;

    const tick = (now: number) => {
      const t = (now - startedAt) / 1000;
      const { cycleSeconds: speed, inhaleRatio: inhale, instability: inst } =
        optionsRef.current;
      const envelope = breathEnvelope01(t, speed, inhale);
      const breath = envelope * 2 - 1;

      // 主収縮は --bo のみ。bx/by は等方でごく小さなゆらぎだけ
      noiseX += (Math.random() * 2 - 1 - noiseX) * 0.03;
      noiseY += (Math.random() * 2 - 1 - noiseY) * 0.03;
      const jitter = ((noiseX + noiseY) * 0.5) * 0.012 * inst;
      const scale = 1 + jitter;

      pink1 += (Math.random() * 2 - 1 - pink1) * 0.005;
      pink2 += (Math.random() * 2 - 1 - pink2) * 0.01;
      pink3 += (Math.random() * 2 - 1 - pink3) * 0.02;
      pink4 += (Math.random() * 2 - 1 - pink4) * 0.038;
      const pink =
        0.52 * pink1 + 0.28 * pink2 + 0.14 * pink3 + 0.06 * pink4;

      const pinkDrive = pink * (1.4 + inst * 0.35);
      const centerFlicker01 = Math.min(
        1,
        Math.max(0, 0.5 + 0.5 * Math.tanh(pinkDrive)),
      );
      const centerFlicker = 0.2 + centerFlicker01 * 2.0;

      const opacity = 0.5 + breath * 0.5;

      root.style.setProperty("--bx", scale.toFixed(4));
      root.style.setProperty("--by", scale.toFixed(4));
      root.style.setProperty("--bo", opacity.toFixed(4));
      root.style.setProperty("--cf", centerFlicker.toFixed(4));
      root.style.setProperty("--cf01", centerFlicker01.toFixed(4));

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);
}
