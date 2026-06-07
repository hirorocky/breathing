import { useEffect, useRef } from "react";

type BreathOptions = {
  /** 1 サイクルの秒数 */
  cycleSeconds: number;
  /** 揺らぎの強さ */
  instability: number;
};

/**
 * 呼吸アニメーション。
 * CSS 変数 --bx / --by / --bo を毎フレーム更新し、
 * 中心の形と背景の明るさを同期させる。
 */
export function useBreathEngine({ cycleSeconds, instability }: BreathOptions) {
  const optionsRef = useRef({ cycleSeconds, instability });
  optionsRef.current = { cycleSeconds, instability };

  useEffect(() => {
    let frameId = 0;
    const startedAt = performance.now();
    let noiseX = 0;
    let noiseY = 0;
    // 1/f (pink-ish) noise: 複数の低周波ランダムを重ねて作る
    let pink1 = 0;
    let pink2 = 0;
    let pink3 = 0;
    let pink4 = 0;
    const root = document.documentElement;

    const tick = (now: number) => {
      const t = (now - startedAt) / 1000;
      const { cycleSeconds: speed, instability: inst } = optionsRef.current;
      const omega = (2 * Math.PI) / Math.max(2, speed);

      // 周期が一致しない sin 波を重ね、完全には繰り返さないリズムにする
      const breath =
        0.62 * Math.sin(t * omega) +
        0.22 * Math.sin(t * omega * 0.7 + 0.4) +
        0.1 * Math.sin(t * omega * 2.3 + 1.1);

      const wobbleX =
        0.6 * Math.sin(t * omega + 0.18) +
        0.22 * Math.sin(t * omega * 0.73 + 0.6);
      const wobbleY =
        0.6 * Math.sin(t * omega - 0.18) +
        0.22 * Math.sin(t * omega * 0.81 + 1.3);

      noiseX += (Math.random() * 2 - 1 - noiseX) * 0.04;
      noiseY += (Math.random() * 2 - 1 - noiseY) * 0.04;

      // 係数が小さいほどゆっくり変化（低周波）
      pink1 += (Math.random() * 2 - 1 - pink1) * 0.006;
      pink2 += (Math.random() * 2 - 1 - pink2) * 0.013;
      pink3 += (Math.random() * 2 - 1 - pink3) * 0.028;
      pink4 += (Math.random() * 2 - 1 - pink4) * 0.055;
      const pink =
        0.52 * pink1 + 0.28 * pink2 + 0.14 * pink3 + 0.06 * pink4;
      // 明るさ倍率（中心の明るい点にだけ効かせる）
      // 少し体感できる振れ幅にする（ただし不快な点滅にはしない）
      // 中心点の 1/f ゆらぎ（「透明度が 0..1 で揺れる」）。
      // 端（0/1）まで行きやすいように tanh への入力を強める。
      const pinkDrive = pink * (3.2 + inst * 0.6);
      const centerFlicker01 = Math.min(
        1,
        Math.max(0, 0.5 + 0.5 * Math.tanh(pinkDrive)),
      );
      // box-shadow 等に使える倍率も残す（0.2..2.2）
      const centerFlicker = 0.2 + centerFlicker01 * 2.0;

      const scaleX = 1 + wobbleX * 0.18 + noiseX * 0.06 * inst;
      const scaleY = 1 + wobbleY * 0.18 + noiseY * 0.06 * inst;
      const opacity = 0.5 + breath * 0.5;

      root.style.setProperty("--bx", scaleX.toFixed(4));
      root.style.setProperty("--by", scaleY.toFixed(4));
      root.style.setProperty("--bo", opacity.toFixed(4));
      root.style.setProperty("--cf", centerFlicker.toFixed(4));
      root.style.setProperty("--cf01", centerFlicker01.toFixed(4));

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);
}
