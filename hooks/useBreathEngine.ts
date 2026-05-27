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

      const scaleX = 1 + wobbleX * 0.18 + noiseX * 0.06 * inst;
      const scaleY = 1 + wobbleY * 0.18 + noiseY * 0.06 * inst;
      const opacity = 0.5 + breath * 0.5;

      root.style.setProperty("--bx", scaleX.toFixed(4));
      root.style.setProperty("--by", scaleY.toFixed(4));
      root.style.setProperty("--bo", opacity.toFixed(4));

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);
}
