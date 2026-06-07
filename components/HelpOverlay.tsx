"use client";

import Link from "next/link";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** ? ボタンで開く説明。Esc は Space 側のキーボード処理で閉じる */
export function HelpOverlay({ open, onClose }: Props) {
  return (
    <div
      className={`help-overlay${open ? " open" : ""}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
    >
      <div className="help-card" onClick={(event) => event.stopPropagation()}>
        <div className="help-eyebrow">about</div>
        <div className="help-title">
          ここでは、何もしなくていい。
          <br />
          ただ、息が戻るまで、居ていい。
        </div>
        <div className="help-body">
          <p className="lead">
            中心の形は、呼吸している。
            <br />
            あなたに何かを促すためではなく、ただ、息をしている。
          </p>
          <ul>
            <li>急かされない</li>
            <li>評価されない</li>
            <li>何者かにならなくていい</li>
            <li>沈黙が許される</li>
          </ul>
          <p>
            置いた言葉は、あなたの画面にだけ見える。
            <br />
            画面の隅の小さな点は、いま居合わせている誰かの気配。
            <br />
            互いの言葉は、見合わない。
          </p>
          <p className="help-disclosure">
            この場は、存在の負荷を少し下げられるかを試す小さな試みです。
            置いた言葉は他の利用者には見えません。場をつくっている人が、あとから読むことがあります。
            名前やプロフィールはありません。利用のおおよその様子だけを、個人を特定しない形で見ています。
            {" "}
            <Link href="/privacy" className="help-disclosure-link">
              くわしく
            </Link>
          </p>
          <p className="help-foot">
            正しくまとめなくていい。
            <br />
            区切りがついたら、キーボードを叩いてひとこと置いていってもいい。
            <br />
            esc または ? で閉じる。
          </p>
        </div>
      </div>
    </div>
  );
}
