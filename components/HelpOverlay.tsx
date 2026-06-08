"use client";

import Link from "next/link";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** ? ボタン — 許可の一文だけ。操作説明・開示は置かない */
export function HelpOverlay({ open, onClose }: Props) {
  return (
    <div
      className={`help-overlay${open ? " open" : ""}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-labelledby="help-title"
    >
      <div className="help-card" onClick={(event) => event.stopPropagation()}>
        <p className="help-title" id="help-title">
          <span className="help-title-line">ここでは、何もしなくていい。</span>
          <span className="help-title-line">ただ、息が戻るまで、居ていい。</span>
        </p>
        <p className="help-close">esc または ? で閉じる。</p>
        <p className="help-privacy">
          <Link href="/privacy" className="help-privacy-link">
            データの取扱いについて
          </Link>
        </p>
      </div>
    </div>
  );
}
