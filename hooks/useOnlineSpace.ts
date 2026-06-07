"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPresence, submitWord } from "@/lib/api";
import {
  ONLINE,
  PENDING_WORDS_MAX,
  type ApiMode,
} from "@/lib/constants";
import { useOrbCount } from "@/hooks/useOrbCount";
import { resolveOrbTarget } from "@/lib/orbPresence";
import { seededRandom } from "@/lib/random";

type Options = {
  sessionSeed: number;
  enabled?: boolean;
};

/**
 * オンライン API が使える間だけ presence 実数・言葉の裏送信を行う。
 * presence は GET /api/presence の polling のみ。
 */
export function useOnlineSpace({ sessionSeed, enabled = true }: Options) {
  const [apiMode, setApiMode] = useState<ApiMode>("offline");
  const [presenceCount, setPresenceCount] = useState<number | null>(null);

  const staticOnlyRef = useRef(false);
  const pendingWordsRef = useRef<string[]>([]);

  const fallbackPresence = useMemo(
    () => 3 + Math.floor(seededRandom(sessionSeed) * 3),
    [sessionSeed],
  );

  const applyPresence = useCallback((count: number) => {
    setPresenceCount(Math.max(0, count));
  }, []);

  const markOnline = useCallback(() => {
    staticOnlyRef.current = false;
    setApiMode("online");
  }, []);

  const markStaticOnly = useCallback(() => {
    staticOnlyRef.current = true;
    setApiMode("static_only");
    setPresenceCount(null);
    pendingWordsRef.current = [];
  }, []);

  const flushPendingWords = useCallback(async () => {
    if (pendingWordsRef.current.length === 0) return;

    const queue = [...pendingWordsRef.current];
    pendingWordsRef.current = [];

    for (let i = 0; i < queue.length; i++) {
      const text = queue[i]!;

      const result = await submitWord(ONLINE.apiBase, text);
      if (result.mode === "static_only") {
        markStaticOnly();
        return;
      }
      if (!result.ok) {
        pendingWordsRef.current = queue.slice(i).slice(-PENDING_WORDS_MAX);
        return;
      }
      markOnline();
    }
  }, [markOnline, markStaticOnly]);

  const poll = useCallback(async () => {
    if (!ONLINE.enabled || !enabled || staticOnlyRef.current) return;

    const result = await fetchPresence(ONLINE.apiBase);

    if (result.mode === "static_only") {
      markStaticOnly();
      return;
    }

    if (result.mode === "online" && result.online) {
      markOnline();
      if (typeof result.count === "number") {
        applyPresence(result.count);
      }
      await flushPendingWords();
      return;
    }

    setApiMode("offline");
    setPresenceCount(null);
  }, [
    applyPresence,
    enabled,
    flushPendingWords,
    markOnline,
    markStaticOnly,
  ]);

  useEffect(() => {
    if (!ONLINE.enabled || !enabled) {
      staticOnlyRef.current = false;
      pendingWordsRef.current = [];
      setApiMode("offline");
      setPresenceCount(null);
      return;
    }

    staticOnlyRef.current = false;
    void poll();
    const id = window.setInterval(() => void poll(), ONLINE.presencePollMs);
    return () => window.clearInterval(id);
  }, [enabled, poll]);

  const sendWord = useCallback(
    async (text: string): Promise<void> => {
      if (!ONLINE.enabled || !enabled || staticOnlyRef.current) return;

      const result = await submitWord(ONLINE.apiBase, text);
      if (result.mode === "static_only") {
        markStaticOnly();
        return;
      }
      if (result.ok) {
        markOnline();
        return;
      }

      pendingWordsRef.current.push(text);
      if (pendingWordsRef.current.length > PENDING_WORDS_MAX) {
        pendingWordsRef.current = pendingWordsRef.current.slice(
          -PENDING_WORDS_MAX,
        );
      }
    },
    [enabled, markOnline, markStaticOnly],
  );

  const displayPresence =
    apiMode === "online" && presenceCount !== null
      ? presenceCount
      : fallbackPresence;

  const orbTarget = useMemo(
    () => resolveOrbTarget(apiMode, presenceCount, sessionSeed),
    [apiMode, presenceCount, sessionSeed],
  );

  const orbCount = useOrbCount(orbTarget, ONLINE.orbStepMs);

  return {
    apiMode,
    presenceCount: displayPresence,
    orbCount,
    sendWord,
    isApiActive: apiMode === "online",
  };
};
