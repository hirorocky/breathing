import { useEffect, useRef } from "react";

/** requestAnimationFrame を React のライフサイクルに合わせて回す */
export function useAnimationFrame(
  callback: (time: number) => void,
  active = true,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;

    let frameId = 0;
    const loop = (time: number) => {
      callbackRef.current(time);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [active]);
}
