"use client";

import { useCallback, useRef, useState } from "react";
import { EventDebugPanel } from "@/components/events/EventDebugPanel";
import { EventLayer } from "@/components/events/EventLayer";
import { BreathForm } from "@/components/BreathForm";
import { HelpOverlay } from "@/components/HelpOverlay";
import { FloatingLeaves } from "@/components/FloatingLeaves";
import { Orbs } from "@/components/Orbs";
import { StarField } from "@/components/StarField";
import { RippleField } from "@/components/RippleField";
import { SiteChrome } from "@/components/SiteChrome";
import { TimeSeekBar } from "@/components/TimeSeekBar";
import { useBreathEngine } from "@/hooks/useBreathEngine";
import { useDayCycle } from "@/hooks/useDayCycle";
import { useDebugMode } from "@/hooks/useDebugMode";
import { useInteractionState } from "@/hooks/useInteractionState";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useRandomEvents } from "@/hooks/useRandomEvents";
import { CONFIG } from "@/lib/constants";
import { phaseOffsetFromTarget } from "@/lib/dayCycle";

const INTERACTIVE_SELECTOR =
  ".help-toggle, .help-overlay, .event-debug, .time-seek-bar, .orb";

/** 「深呼吸している場所」のメイン画面 */
export function Space() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [phaseOffset, setPhaseOffset] = useState<number | null>(null);
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

  const {
    syncPhase,
    effectivePhase,
    serviceTimeLabel,
    phaseLabel,
    isManual,
    orbNightAmbience,
    starNightAmbience,
    leafAmbience,
  } = useDayCycle({ debug, phaseOffset });

  const { activeEvent, completeEvent, nextFireAt } = useRandomEvents({
    enabled: !helpOpen,
    debug,
    phase: effectivePhase,
  });

  const {
    sessionSeed,
    touchBoost,
    ripples,
    triggerRipple,
    triggerBreathClick,
  } = useInteractionState();

  useBreathEngine({
    cycleSeconds: CONFIG.breathCycleSeconds,
    inhaleRatio: CONFIG.breathInhaleRatio,
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
    },
  });

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
      <SiteChrome />
      <StarField sessionSeed={sessionSeed} ambience={starNightAmbience} />
      <FloatingLeaves sessionSeed={sessionSeed} ambience={leafAmbience} />
      <Orbs
        count={CONFIG.orbCount}
        sessionSeed={sessionSeed}
        ambience={orbNightAmbience}
      />
      <RippleField ripples={ripples} pointer={pointer} />
      <EventLayer activeEvent={activeEvent} onComplete={completeEvent} />

      <main className="stage">
        <BreathForm
          ref={breathRef}
          touchBoost={touchBoost}
          onBreathClick={triggerBreathClick}
        />
      </main>

      <button
        type="button"
        className="help-toggle"
        aria-label={helpOpen ? "説明を閉じる" : "説明を表示"}
        onClick={() => setHelpOpen((open) => !open)}
      >
        {helpOpen ? "×" : "?"}
      </button>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <TimeSeekBar
        phase={effectivePhase}
        onPhaseChange={(phase) =>
          setPhaseOffset(phaseOffsetFromTarget(syncPhase, phase))
        }
      />

      {debug && (
        <EventDebugPanel
          activeEvent={activeEvent}
          nextFireAt={nextFireAt}
          paused={helpOpen}
          syncPhase={syncPhase}
          effectivePhase={effectivePhase}
          serviceTimeLabel={serviceTimeLabel}
          phaseLabel={phaseLabel}
          isManual={isManual}
        />
      )}
    </div>
  );
}
