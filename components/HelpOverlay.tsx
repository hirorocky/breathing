"use client";

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
            時おり、ほかの人の置いていった短い言葉が、滲んでは消える。
            <br />
            画面の隅にある小さな点は、いま居合わせている誰か。
            <br />
            互いに、見ない。
          </p>
          <p className="help-foot">
            キーボードを叩くと、ひとこと置いていける。
            <br />
            esc または ? で閉じる。
          </p>
        </div>
      </div>
    </div>
  );
}
