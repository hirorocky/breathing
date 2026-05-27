"use client";

import { useCallback, useMemo, useState } from "react";
import { EventDebugPanel } from "@/components/events/EventDebugPanel";
import { EventLayer } from "@/components/events/EventLayer";
import { BreathForm } from "@/components/BreathForm";
import { DriftField } from "@/components/DriftField";
import { HelpOverlay } from "@/components/HelpOverlay";
import { Orbs } from "@/components/Orbs";
import { RippleField } from "@/components/RippleField";
import { SedimentField } from "@/components/SedimentField";
import { SiteChrome } from "@/components/SiteChrome";
import { WordBar } from "@/components/WordBar";
import { useBreathEngine } from "@/hooks/useBreathEngine";
import { useDebugMode } from "@/hooks/useDebugMode";
import { useInteractionState } from "@/hooks/useInteractionState";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useRandomEvents } from "@/hooks/useRandomEvents";
import { CONFIG, SEED_WORDS } from "@/lib/constants";
import { seededRandom } from "@/lib/random";

function isTypingInInput(): boolean {
  return document.activeElement?.tagName === "INPUT";
}

const INTERACTIVE_SELECTOR =
  ".help-toggle, .help-overlay, .word-bar, .word-input, input, .event-debug, .orb, .companion-breath-event";

/** 「深呼吸している場所」のメイン画面 */
export function Space() {
  const [words, setWords] = useState<string[]>([...SEED_WORDS]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wordBarOpen, setWordBarOpen] = useState(false);
  const [wordBarSession, setWordBarSession] = useState(0);
  const [wordBarInitialChar, setWordBarInitialChar] = useState("");
  const [incomingWord, setIncomingWord] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const { debug, toggleDebug } = useDebugMode();

  const { activeEvent, completeEvent, nextFireAt } = useRandomEvents({
    enabled: !helpOpen,
    debug,
  });

  const {
    sessionSeed,
    touchBoost,
    ripples,
    companionNear,
    triggerRipple,
    triggerBreathClick,
  } = useInteractionState();

  const presenceCount = useMemo(
    () => 3 + Math.floor(seededRandom(sessionSeed) * 3),
    [sessionSeed],
  );

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

  const handlePlaceWord = useCallback((word: string) => {
    setIncomingWord(word);
  }, []);

  const handleSedimentSettled = useCallback((word: string) => {
    setWords((current) => [word, ...current].slice(0, CONFIG.maxStoredWords));
  }, []);

  const handleIncomingHandled = useCallback(() => {
    setIncomingWord(null);
  }, []);

  const handleSpacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      triggerRipple(event.clientX, event.clientY);
    },
    [triggerRipple],
  );

  return (
    <div
      className="space"
      data-verbose={helpOpen || undefined}
      data-debug={debug || undefined}
      data-companion-near={
        companionNear && activeEvent?.type === "companion-breath"
          ? true
          : undefined
      }
      onPointerDown={handleSpacePointerDown}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        setPointer({ x: event.clientX, y: event.clientY, active: true });
      }}
      onPointerLeave={() => setPointer((p) => ({ ...p, active: false }))}
    >
      <SiteChrome presenceCount={presenceCount} />
      <Orbs count={CONFIG.orbCount} sessionSeed={sessionSeed} />
      <RippleField ripples={ripples} pointer={pointer} />
      <SedimentField
        incoming={incomingWord}
        onSettled={handleSedimentSettled}
        onIncomingHandled={handleIncomingHandled}
      />
      <DriftField words={words} />
      <EventLayer activeEvent={activeEvent} onComplete={completeEvent} />

      <main className="stage">
        <BreathForm touchBoost={touchBoost} onBreathClick={triggerBreathClick} />
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
