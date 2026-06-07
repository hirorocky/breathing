"use client";

import { useState } from "react";
import { CONFIG } from "@/lib/constants";

type ActiveWordBarProps = {
  initialChar: string;
  onClose: () => void;
  onPlace: (word: string) => void;
};

/** 開いている間だけ描画。親が key を変えて初期文字を渡す */
function ActiveWordBar({ initialChar, onClose, onPlace }: ActiveWordBarProps) {
  const [value, setValue] = useState(initialChar);

  function submit() {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= CONFIG.maxWordLength) {
      onPlace(trimmed);
    }
    onClose();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      submit();
      event.preventDefault();
    }
    if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="word-bar open">
      <input
        className="word-input"
        type="text"
        maxLength={CONFIG.maxWordLength}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleInputKeyDown}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
        placeholder="ことばにする"
        spellCheck={false}
        autoFocus
      />
      <div className="word-hint">
        enter で置く <span className="esc">· esc で消す</span>
      </div>
    </div>
  );
}

type Props = {
  open: boolean;
  sessionKey: number;
  initialChar: string;
  onClose: () => void;
  onPlace: (word: string) => void;
};

/** キーボード入力で短い言葉を置く */
export function WordBar({
  open,
  sessionKey,
  initialChar,
  onClose,
  onPlace,
}: Props) {
  return (
    <>
      {open && (
        <ActiveWordBar
          key={sessionKey}
          initialChar={initialChar}
          onClose={onClose}
          onPlace={onPlace}
        />
      )}
    </>
  );
}
