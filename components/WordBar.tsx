"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/lib/constants";

type Props = {
  onPlace: (word: string) => void;
};

/** キーボード入力で短い言葉を置く */
export function WordBar({ onPlace }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setValue("");
        return;
      }

      if (open) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?" || event.key === "/") return;
      if (event.key.length !== 1) return;

      setOpen(true);
      setValue(event.key);
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timerId = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timerId);
  }, [open]);

  function submit() {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= CONFIG.maxWordLength) {
      onPlace(trimmed);
    }
    setValue("");
    setOpen(false);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submit();
      event.preventDefault();
    }
    if (event.key === "Escape") {
      setValue("");
      setOpen(false);
    }
  }

  return (
    <>
      <div className={`word-bar${open ? " open" : ""}`}>
        <input
          ref={inputRef}
          className="word-input"
          type="text"
          maxLength={CONFIG.maxWordLength}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={() => {
            if (!value.trim()) setOpen(false);
          }}
          placeholder="ひとこと、降ろす"
          spellCheck={false}
        />
        <div className="word-hint">
          enter で置く <span className="esc">· esc で消す</span>
        </div>
      </div>
      <div className="type-hint">— キーボードを叩くと、ひとこと置いていける</div>
    </>
  );
}
