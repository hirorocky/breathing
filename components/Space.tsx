"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    active: boolean;
    pressed: boolean;
  }>({
    x: 0,
    y: 0,
    active: false,
    pressed: false,
  });
  const breathRef = useRef<HTMLButtonElement | null>(null);
  const warpImageRef = useRef<SVGFEImageElement | null>(null);
  const warpDispRef = useRef<SVGFEDisplacementMapElement | null>(null);

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
      setPointer((p) => ({
        ...p,
        x: event.clientX,
        y: event.clientY,
        active: true,
        pressed: true,
      }));
    },
    [triggerRipple],
  );

  useEffect(() => {
    const el = breathRef.current;
    const img = warpImageRef.current;
    const disp = warpDispRef.current;
    if (!el || !img || !disp) return;

    if (!pointer.active) {
      disp.setAttribute("scale", "0");
      return;
    }

    const rect = el.getBoundingClientRect();
    const ux = Math.min(1, Math.max(0, (pointer.x - rect.left) / rect.width));
    const uy = Math.min(1, Math.max(0, (pointer.y - rect.top) / rect.height));

    // マウス: 置くだけでも歪む / タッチ: 押している間だけ歪む（指を置く=press扱い）
    const amount = pointer.pressed ? 2.2 : 0.55;
    const scale = amount * 70;
    disp.setAttribute("scale", scale.toFixed(2));

    // マスク半径も少し広げて「押された範囲」を大きくする
    const maskSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><defs><radialGradient id='g' cx='${ux}' cy='${uy}' r='0.52'><stop offset='0' stop-color='white' stop-opacity='1'/><stop offset='0.55' stop-color='white' stop-opacity='0.65'/><stop offset='1' stop-color='black' stop-opacity='0'/></radialGradient></defs><rect width='1' height='1' fill='url(#g)'/></svg>`;
    img.setAttribute(
      "href",
      `data:image/svg+xml;utf8,${encodeURIComponent(maskSvg)}`,
    );
  }, [pointer]);

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
        setPointer((p) => ({
          ...p,
          x: event.clientX,
          y: event.clientY,
          active: true,
        }));
      }}
      onPointerUp={() => setPointer((p) => ({ ...p, active: false, pressed: false }))}
      onPointerCancel={() =>
        setPointer((p) => ({ ...p, active: false, pressed: false }))
      }
      onPointerLeave={() =>
        setPointer((p) => ({ ...p, active: false, pressed: false }))
      }
    >
      <svg
        className="breath-warp-defs"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <filter
          id="breathWarp"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018"
            numOctaves="2"
            seed="2"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="0"
            xChannelSelector="R"
            yChannelSelector="G"
            result="warped"
            ref={(node) => {
              warpDispRef.current = node;
            }}
          />
          <feImage
            href="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%201%201%27%20preserveAspectRatio%3D%27none%27%3E%3Crect%20width%3D%271%27%20height%3D%271%27%20fill%3D%27black%27%2F%3E%3C%2Fsvg%3E"
            result="mask"
            ref={(node) => {
              warpImageRef.current = node;
            }}
          />
          <feComposite in="warped" in2="mask" operator="in" result="warpMasked" />
          <feComposite
            in="SourceGraphic"
            in2="mask"
            operator="out"
            result="sourceOutside"
          />
          <feMerge>
            <feMergeNode in="sourceOutside" />
            <feMergeNode in="warpMasked" />
          </feMerge>
        </filter>
      </svg>
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
        <BreathForm
          ref={breathRef}
          touchBoost={touchBoost}
          onBreathClick={triggerBreathClick}
        />
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
