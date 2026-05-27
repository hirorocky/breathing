import { useEffect } from "react";

/** requestAnimationFrame を React のライフサイクルに合わせて回す */
export function useAnimationFrame(
  callback: (time: number) => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;

    let frameId = 0;
    const loop = (time: number) => {
      callback(time);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [callback, active]);
}
