# v1.0.1 — 開発環境とステータスバー

**v1.0.0**（呼吸 MOD・journal 確定）のパッチ版。**探求の Layer 0 は維持**しつつ、実機開発を楽にする。

参照: [journal/v1.0.0.md](../journal/v1.0.0.md) · [overlay/mods/breath/](../../overlay/mods/breath/)

---

## この版の骨核

| 項目 | v1.0.1 でやること |
|---|---|
| **探求** | v1.0.0 と同じ（顔のみ呼吸。サーボ停止） |
| **UI** | 画面上端から下スワイプで **ステータスバー**（時刻・バッテリー）。通常時は非表示 |
| **開発** | **可能なら** Mac と USB なしで MOD 更新（同一 Wi‑Fi） |

Layer 0 の同席観察（v1.1.0）はこの版の外。

---

## 1. ステータスバー（スワイプ表示）

### 要件

- **操作**: 画面上部（タッチ y ≦ 80px）から **下方向スワイプ** → バー表示
- **表示**: 時刻（`HH:MM`）、バッテリー残量（`NN%`、充電中は `⚡` 等）
- **非表示**: 上スワイプ、または数秒で自動的に隠す
- **トーン**: **白背景・黒文字**（黒背景・白前景の顔と区別するため、あえて反転）。呼吸中は常時出さない

### 技術メモ

| 要素 | API / 実装 |
|---|---|
| タッチ | `robot.touch`（CoreS3 LCD、`M5StackCoreS3Touch`。y ≥ 200 は仮想 A/B/C ボタン） |
| 時刻 | `globalEnv.device.RTC`（BM8563、`platforms/m5stackchan_cores3/host/provider.js`） |
| バッテリー | ホスト `m5stackchan/battery` 経由（provider の `BreathSMBus` が SDK の AXP2101 I2C ハンドルを捕獲）。MOD から直接 SMBus を開くと duplicate address |
| 描画 | PIU `Container` / `Label` を `robot.renderer.addDecorator`（`piu/MC` はホスト提供） |

### タスク

- [x] `overlay/mods/breath/` に `status-bar.js`（スワイプ検知 + 描画）
- [x] manifest は `manifest_mod.json` のみ（PIU / SMBus はホスト側モジュールを参照）
- [x] 実機: スワイプ → 表示 → 自動非表示
- [x] 呼吸ループと干渉しないこと（タッチ処理はバー用のみ）

### 実装メモ（2026-07-05 解決）

バッテリー `--%` 問題の根本原因は 2 つ: (1) カスタム platform の `setup-target.js` が `"setup/target"` として登録されても SDK 側定義に makefile 上負けてビルドに入らず、電源レール patch もバッテリー登録も実行されていなかった、(2) SDK の setup-target が AXP2101（I2C 0x34）を `globalThis.power` で占有しており、別途開くと `RangeError: duplicate address`。`host/provider.js` の `BreathSMBus` が SDK と同一の I2C ハンドルを捕獲し、`m5stackchan/battery`（`readBatterySample()`）経由で読む方式で解決。詳細は `overlay/docs/my-cores3/01-environment-and-build.md` 参照。

---

## 2. USB なし MOD 更新（Wi‑Fi）

### 背景

- 通常の `mcrun -d` は **xsbug デバッグプロトコル + USB シリアル**（`serial2xsbug`）が前提
- Moddable 公式: **release ビルド** や **HTTP で `.xsa` を mod パーティションへ書き込む** 方式が別途ある（[Discussion #1105](https://github.com/Moddable-OpenSource/moddable/discussions/1105)）

### 方針（2 段階）

#### 2a. Mac 側は USB 不要、同一 Wi‑Fi（推奨・先に試す）

```
Mac: mcrun -t build → breath.xsa
Mac: curl -X POST --data-binary @breath.xsa http://<stackchan-ip>/mod
Device: HTTP 受信 → Flash（mod パーティション）→ 再起動
```

| 項目 | 内容 |
|---|---|
| 初回だけ | Wi‑Fi 設定（既存 Preference / BLE Web UI、または deploy 時に SSID 埋め込み） |
| ホスト/MOD | `HttpServerService` で POST `/mod`（`overlay/mods/breath/` または共通 `dev-server.js`） |
| パーティション | ビルドログの `mod` / `xs` オフセットを `overlay/` に文書化（機種固定後は定数化） |
| Mac 脚本 | `overlay/scripts/mod-upload-wifi.sh` — build + curl |

**制約**: 初回 Wi‑Fi 設定・**フル deploy は依然 USB 可**（ホスト更新時）。MOD 反復だけ Wi‑Fi 化が目標。

#### 2b. xsbug を Wi‑Fi 経由（代替）

- ESP が TCP で Mac 上の xsbug に接続（`mcrun -x host:port`）
- USB ケーブルは不要だが **Mac 側 xsbug 常時起動** は必要
- 優先度低（2a が動けば足りる）

### タスク

- [ ] 実機の mod パーティション offset / size を記録（`01-environment-and-build.md` 追記）
- [ ] MOD 内またはホストパッチで `POST /mod` ハンドラ（`.xsa` 受信・Flash 書き込み・reboot）
- [ ] Wi‑Fi 接続確認用 `GET /status`（時刻・IP・バッテリー）
- [ ] `overlay/scripts/mod-upload-wifi.sh`
- [ ] セキュリティ: 同一 LAN のみ・認証トークン（最低限）— 探求用 dev 版として文書化

---

## 3. 観測版の切り方

- [ ] 上記 1 + 2a が実機で通った時点で tag `v1.0.1`
- [ ] journal は **開発効率の観察** があれば `/write-journal`（探求の Layer 0 観察は v1.1.0）

---

## v1.1.0 以降（探求・変更なし）

- [ ] 同室 2〜10 人で同席観察
- [ ] **人間でも Web でもないロボット** としての第三焦点
- [ ] サーボ・LED の取捨（同室観察後）

---

## 実装順（提案）

1. **ステータスバー** — 単体で価値あり、Wi‑Fi 不要
2. **Wi‑Fi MOD アップロード** — パーティション調査 → HTTP エンドポイント → Mac 脚本
3. tag `v1.0.1`
