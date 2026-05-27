"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "breathing:debug";

function readDebugFlag(): boolean {
  if (typeof window === "undefined") return false;

  if (new URLSearchParams(window.location.search).get("debug") === "1") {
    return true;
  }

  return localStorage.getItem(STORAGE_KEY) === "1";
}

/** デバッグモード。`?debug=1` または Ctrl/Cmd+Shift+D で切り替え */
export function useDebugMode() {
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    setDebug(readDebugFlag());
  }, []);

  const toggleDebug = useCallback(() => {
    setDebug((current) => {
      const next = !current;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return { debug, toggleDebug };
}
