# インタラクション設計

[concept.md](./concept.md) に基づく、このアプリのインタラクション正本。

## 原則

| 原則 | ルール |
|---|---|
| 非指示 | 初見で操作を教えない。`?` と debug 以外は発見型 |
| 低攻撃 | 強いフィードバック・即時性・評価 UI を置かない |
| 間 | 反応には 300ms〜1.5s の遅れを入れる |
| 非線形 | 呼吸・イベントは周期固定にしない |
| 存在の重なり | 会話ではなく痕跡と気配。返答・通知・スレッドは作らない |

**禁止:** トースト、バッジ、いいね、チャット、プッシュ通知、「◯分滞在しました」系のフィードバック。

---

## 層構造

### Layer 0 — 呼吸（常時）

- `useBreathEngine` が `--bx` / `--by` / `--bo` を更新
- 対象: 背景 wash、中心の形、chrome の dot
- 周期: 8s 基準 + instability 0.6。ユーザー操作では変えない

### Layer 1 — 受動（気配と痕跡）

| 要素 | 振る舞い |
|---|---|
| 漂う言葉 | 2.4〜6.9s 間隔で浮上→消失 |
| orb | rAF で点滅 |
| 人数 | 演出値（セッション固定） |
| ランダムイベント | 流れ星 / 風 / 波（本番: 45s 初回、以降 90〜300s） |
| 沈黙 | 何も起きなくて正しい |

言葉: 最大 24 文字、返信なし、同一セッションの drift プールに混ざるのみ。

### Layer 2 — 自発

| 操作 | 入力 |
|---|---|
| 言葉を置く | 任意キー → WordBar → Enter |
| 説明 | `?` または左下ボタン（開いている間イベント停止） |
| debug | Cmd+Shift+D |

verbose ヒントは help 開時のみ。

### Layer 3 — 微反応

| 対象 | 入力 | 反応 | 制限 |
|---|---|---|---|
| 中心 | hover (fine) | glow +5% | debounce 2s |
| 中心 | click/tap | 深い一呼吸 (`--touch-boost`) | 600ms 遅延、10s に 1 回 |
| 空白 | click | 極薄 ripple | debounce 2s |
| orb | hover (fine) | opacity +0.15 | 200ms 遅延 |

---

## パラメータ（コード）

| 定数 | 場所 | 値 |
|---|---|---|
| 呼吸周期 | `lib/constants.ts` | 8s |
| イベント（本番） | `lib/events/config.ts` | 45s / 90〜300s |
| イベント（debug） | `lib/events/config.ts` | 1s / 1〜3s |
| 沈殿時間 | `lib/interaction/constants.ts` | 2〜4s |
| ripple debounce | `lib/interaction/constants.ts` | 2s |
| breath click cooldown | `lib/interaction/constants.ts` | 10s |

---

## 状態（ローカルのみ）

`useInteractionState` が管理:

- `touchBoost` — 中心クリック後の一時的な呼吸 boost
- `ripples` — 空白クリックの ripple 一覧
- `sessionSeed` — セッション固定の乱数 seed
- debounce 用タイムスタンプ

`sessionStorage` は使わない（リロードで痕跡は消える）。

---

## 実装ファイル

| 役割 | パス |
|---|---|
| 定数 | `lib/interaction/constants.ts` |
| 状態 | `hooks/useInteractionState.ts` |
| オーケストレーション | `components/Space.tsx` |
| 中心 | `components/BreathForm.tsx` |
| ripple | `components/RippleField.tsx` |
| 沈殿 | `components/SedimentField.tsx` |
| 漂流 | `components/DriftField.tsx` |
| orb | `components/Orbs.tsx` |
