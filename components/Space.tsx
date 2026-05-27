"use client";

import { useCallback, useState } from "react";
import { EventDebugPanel } from "@/components/events/EventDebugPanel";
import { EventLayer } from "@/components/events/EventLayer";
import { BreathForm } from "@/components/BreathForm";
import { DriftField } from "@/components/DriftField";
import { HelpOverlay } from "@/components/HelpOverlay";
import { Orbs } from "@/components/Orbs";
import { SiteChrome } from "@/components/SiteChrome";
import { WordBar } from "@/components/WordBar";
import { useBreathEngine } from "@/hooks/useBreathEngine";
import { useDebugMode } from "@/hooks/useDebugMode";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useRandomEvents } from "@/hooks/useRandomEvents";
import { CONFIG, SEED_WORDS } from "@/lib/constants";

function isTypingInInput(): boolean {
  return document.activeElement?.tagName === "INPUT";
}

/** 「深呼吸している場所」のメイン画面 */
export function Space() {
  const [words, setWords] = useState<string[]>([...SEED_WORDS]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wordBarOpen, setWordBarOpen] = useState(false);
  const [wordBarSession, setWordBarSession] = useState(0);
  const [wordBarInitialChar, setWordBarInitialChar] = useState("");

  const { debug, toggleDebug } = useDebugMode();

  const { activeEvent, completeEvent, nextFireAt } = useRandomEvents({
    enabled: !helpOpen,
  });

  useBreathEngine({
    cycleSeconds: CONFIG.breathCycleSeconds,
    instability: CONFIG.breathInstability,
  });

  const closeWordBar = useCallback(() => {
    setWordBarOpen(false);
    setWordBarInitialChar("");
  }, []);

  const openWordBar = useCallback((char: string) => {
    setWordBarInitialChar(char);
    setWordBarSession((session) => session + 1);
    setWordBarOpen(true);
  }, []);

  useKeyboardShortcuts({
    onKeyDown: (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "d"
      ) {
        toggleDebug();
        event.preventDefault();
        return;
      }

      const isHelpShortcut =
        event.key === "?" || (event.shiftKey && event.key === "/");

      if (isHelpShortcut) {
        if (isTypingInInput()) return;
        setHelpOpen((open) => !open);
        event.preventDefault();
        return;
      }

      if (helpOpen) {
        if (event.key === "Escape") {
          setHelpOpen(false);
          event.preventDefault();
        }
        return;
      }

      if (wordBarOpen || isTypingInInput()) return;

      if (event.key === "Escape") {
        closeWordBar();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;

      openWordBar(event.key);
      event.preventDefault();
    },
  });

  const handlePlaceWord = useCallback(
    (word: string) => {
      setWords((current) => [word, ...current].slice(0, CONFIG.maxStoredWords));
    },
    [],
  );

  return (
    <div
      className="space"
      data-verbose={helpOpen || undefined}
      data-debug={debug || undefined}
    >
      <SiteChrome presenceCount={CONFIG.presenceCount} />
      <Orbs count={CONFIG.orbCount} />
      <DriftField words={words} />
      <EventLayer activeEvent={activeEvent} onComplete={completeEvent} />

      <main className="stage">
        <BreathForm />
      </main>

      <WordBar
        open={wordBarOpen}
        sessionKey={wordBarSession}
        initialChar={wordBarInitialChar}
        onClose={closeWordBar}
        onPlace={handlePlaceWord}
      />

      <button
        type="button"
        className="help-toggle"
        aria-label={helpOpen ? "説明を閉じる" : "説明を表示"}
        onClick={() => setHelpOpen((open) => !open)}
      >
        {helpOpen ? "×" : "?"}
      </button>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {debug && (
        <EventDebugPanel
          activeEvent={activeEvent}
          nextFireAt={nextFireAt}
          paused={helpOpen}
        />
      )}
    </div>
  );
}
