"use client";

import { useCallback, useRef, useState } from "react";
import { EventDebugPanel } from "@/components/events/EventDebugPanel";
import { EventLayer } from "@/components/events/EventLayer";
import { BreathForm } from "@/components/BreathForm";
import { DriftField } from "@/components/DriftField";
import { HelpOverlay } from "@/components/HelpOverlay";
import { Orbs } from "@/components/Orbs";
import { RippleField } from "@/components/RippleField";
import { SiteChrome } from "@/components/SiteChrome";
import { WordBar, type WordBarHandle } from "@/components/WordBar";
import { useBreathEngine } from "@/hooks/useBreathEngine";
import { useDebugMode } from "@/hooks/useDebugMode";
import { useInteractionState } from "@/hooks/useInteractionState";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useOnlineSpace } from "@/hooks/useOnlineSpace";
import { useRandomEvents } from "@/hooks/useRandomEvents";
import { CONFIG } from "@/lib/constants";

function isTypingInInput(): boolean {
  return document.activeElement?.tagName === "INPUT";
}

const INTERACTIVE_SELECTOR =
  ".help-toggle, .help-overlay, .word-bar, .word-input, .word-submit, input, .event-debug, .orb";

/** 「深呼吸している場所」のメイン画面 */
export function Space() {
  const [words, setWords] = useState<Array<{ id: string; text: string }>>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const wordBarRef = useRef<WordBarHandle>(null);
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
  const pointerTargetRef = useRef({
    x: 0,
    y: 0,
    active: false,
    pressed: false,
  });
  const pointerSmoothRef = useRef({
    x: 0,
    y: 0,
    active: false,
    pressed: false,
    amount: 0,
  });
  const breathRef = useRef<HTMLButtonElement | null>(null);
  const warpGradRef = useRef<SVGRadialGradientElement | null>(null);
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
    triggerRipple,
    triggerBreathClick,
  } = useInteractionState();

  const { presenceCount, orbCount, sendWord } = useOnlineSpace({
    sessionSeed,
    enabled: !helpOpen,
  });

  useBreathEngine({
    cycleSeconds: CONFIG.breathCycleSeconds,
    instability: CONFIG.breathInstability,
  });

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

      if (isTypingInInput()) return;

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;

      wordBarRef.current?.appendChar(event.key);
      event.preventDefault();
    },
  });

  const handlePlaceWord = useCallback(
    (word: string) => {
      const item = { id: crypto.randomUUID(), text: word };
      setWords((current) => [item, ...current].slice(0, CONFIG.maxStoredWords));
      void sendWord(word);
    },
    [sendWord],
  );

  const handleSpacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      triggerRipple(event.clientX, event.clientY);
      pointerTargetRef.current = {
        ...pointerTargetRef.current,
        x: event.clientX,
        y: event.clientY,
        active: true,
        pressed: true,
      };
    },
    [triggerRipple],
  );

  useAnimationFrame(() => {
    const el = breathRef.current;
    const grad = warpGradRef.current;
    const disp = warpDispRef.current;
    if (!el || !grad || !disp) return;

    const target = pointerTargetRef.current;
    const smooth = pointerSmoothRef.current;

    // 位置はゆっくり追従（指/マウスの“押し”感）
    const posLerp = 0.12;
    smooth.x += (target.x - smooth.x) * posLerp;
    smooth.y += (target.y - smooth.y) * posLerp;
    smooth.active = target.active;
    smooth.pressed = target.pressed;

    // 強度はさらにゆっくり追従
    const desiredAmount = !smooth.active
      ? 0
      : smooth.pressed
        ? 2.2
        : 0.55;
    const amtLerp = 0.07;
    smooth.amount += (desiredAmount - smooth.amount) * amtLerp;

    setPointer({
      x: smooth.x,
      y: smooth.y,
      active: smooth.active,
      pressed: smooth.pressed,
    });

    if (smooth.amount < 0.02) {
      disp.setAttribute("scale", "0");
      return;
    }

    const rect = el.getBoundingClientRect();
    const ux = Math.min(1, Math.max(0, (smooth.x - rect.left) / rect.width));
    const uy = Math.min(1, Math.max(0, (smooth.y - rect.top) / rect.height));

    const scale = smooth.amount * 70;
    disp.setAttribute("scale", scale.toFixed(2));
    grad.setAttribute("cx", ux.toFixed(4));
    grad.setAttribute("cy", uy.toFixed(4));
  }, true);

  return (
    <div
      className="space"
      data-verbose={helpOpen || undefined}
      data-debug={debug || undefined}
      onPointerDown={handleSpacePointerDown}
      onPointerMove={(event) => {
        // pointerglow 表示は rAF 側で滑らかに更新する
        pointerTargetRef.current = {
          ...pointerTargetRef.current,
          x: event.clientX,
          y: event.clientY,
          active: true,
        };
      }}
      onPointerUp={() => {
        pointerTargetRef.current = {
          ...pointerTargetRef.current,
          active: false,
          pressed: false,
        };
        setPointer((p) => ({ ...p, active: false, pressed: false }));
      }}
      onPointerCancel={() =>
        (() => {
          pointerTargetRef.current = {
            ...pointerTargetRef.current,
            active: false,
            pressed: false,
          };
          setPointer((p) => ({ ...p, active: false, pressed: false }));
        })()
      }
      onPointerLeave={() =>
        (() => {
          pointerTargetRef.current = {
            ...pointerTargetRef.current,
            active: false,
            pressed: false,
          };
          setPointer((p) => ({ ...p, active: false, pressed: false }));
        })()
      }
    >
      <svg
        className="breath-warp-defs"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient
            id="warpMaskGrad"
            gradientUnits="objectBoundingBox"
            cx="0.5"
            cy="0.5"
            r="0.52"
            ref={warpGradRef}
          >
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.65" />
            <stop offset="1" stopColor="black" stopOpacity="0" />
          </radialGradient>
          <svg
            id="warpMaskImage"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            width="1"
            height="1"
          >
            <rect width="1" height="1" fill="url(#warpMaskGrad)" />
          </svg>
        </defs>
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
          <feImage href="#warpMaskImage" result="mask" preserveAspectRatio="none" />
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
      <Orbs count={orbCount} sessionSeed={sessionSeed} />
      <RippleField ripples={ripples} pointer={pointer} />
      <DriftField words={words} />
      <EventLayer activeEvent={activeEvent} onComplete={completeEvent} />

      <main className="stage">
        <BreathForm
          ref={breathRef}
          touchBoost={touchBoost}
          onBreathClick={triggerBreathClick}
        />
      </main>

      <WordBar ref={wordBarRef} onPlace={handlePlaceWord} />

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
