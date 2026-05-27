import { useEffect, useRef } from "react";

type Options = {
  enabled?: boolean;
  onKeyDown: (event: KeyboardEvent) => void;
};

/** window の keydown を 1 箇所で購読する */
export function useKeyboardShortcuts({ enabled = true, onKeyDown }: Options) {
  const handlerRef = useRef(onKeyDown);
  handlerRef.current = onKeyDown;

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: KeyboardEvent) => {
      handlerRef.current(event);
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
