"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CONFIG } from "@/lib/constants";

export type WordBarHandle = {
  appendChar: (char: string) => void;
};

type Props = {
  onPlace: (word: string) => void;
};

/** 画面下部に常時表示される言葉入力 */
export const WordBar = forwardRef<WordBarHandle, Props>(function WordBar(
  { onPlace },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useImperativeHandle(ref, () => ({
    appendChar(char: string) {
      setValue((current) => (current + char).slice(0, CONFIG.maxWordLength));
      inputRef.current?.focus();
    },
  }));

  function submit() {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= CONFIG.maxWordLength) {
      onPlace(trimmed);
    }
    setValue("");
    inputRef.current?.focus();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submit();
      event.preventDefault();
    }
    if (event.key === "Escape") {
      setValue("");
      inputRef.current?.blur();
      event.preventDefault();
    }
  }

  const hasText = value.trim().length > 0;

  return (
    <div className="word-bar">
      <div className="word-bar-row">
        <input
          ref={inputRef}
          className="word-input"
          type="text"
          maxLength={CONFIG.maxWordLength}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="ことばにする"
          spellCheck={false}
          aria-label="ことばを入力"
        />
        {hasText && (
          <button
            type="button"
            className="word-submit"
            onClick={submit}
            aria-label="ことばを置く"
          >
            <svg
              className="word-submit-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M12 19V7M12 7l-4.5 4.5M12 7l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
