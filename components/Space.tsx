"use client";

import { useCallback, useEffect, useState } from "react";
import { BreathForm } from "@/components/BreathForm";
import { DriftField } from "@/components/DriftField";
import { HelpOverlay } from "@/components/HelpOverlay";
import { Orbs } from "@/components/Orbs";
import { SiteChrome } from "@/components/SiteChrome";
import { WordBar } from "@/components/WordBar";
import { useBreathEngine } from "@/hooks/useBreathEngine";
import { CONFIG, SEED_WORDS } from "@/lib/constants";

/** 「深呼吸している場所」のメイン画面 */
export function Space() {
  const [words, setWords] = useState<string[]>([...SEED_WORDS]);
  const [helpOpen, setHelpOpen] = useState(false);

  useBreathEngine({
    cycleSeconds: CONFIG.breathCycleSeconds,
    instability: CONFIG.breathInstability,
  });

  // 説明を開いている間だけ、控えめなヒント類を表示する
  useEffect(() => {
    document.body.classList.toggle("verbose", helpOpen);
    return () => document.body.classList.remove("verbose");
  }, [helpOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" && !(event.shiftKey && event.key === "/")) return;
      if (document.activeElement?.tagName === "INPUT") return;

      setHelpOpen((open) => !open);
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handlePlaceWord = useCallback((word: string) => {
    setWords((current) => [word, ...current].slice(0, CONFIG.maxStoredWords));
  }, []);

  return (
    <>
      <SiteChrome presenceCount={CONFIG.presenceCount} />
      <Orbs count={CONFIG.orbCount} />
      <DriftField words={words} />

      <main className="stage">
        <BreathForm />
      </main>

      <WordBar onPlace={handlePlaceWord} />

      <button
        type="button"
        className="help-toggle"
        aria-label={helpOpen ? "説明を閉じる" : "説明を表示"}
        onClick={() => setHelpOpen((open) => !open)}
      >
        {helpOpen ? "×" : "?"}
      </button>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
