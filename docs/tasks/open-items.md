# v1.0.2 — 設定バー（明るさ・音量）

**v1.0.1**（開発環境・ステータスバー・Wi‑Fi OTA、tag `v1.0.1`）の続き。**探求の Layer 0 は維持**しつつ、UI に明るさ・音量の設定バーを追加する。

参照: [journal/v1.0.0.md](../journal/v1.0.0.md) · [overlay/mods/breath/](../../overlay/mods/breath/)。Wi‑Fi OTA の詳細は `CLAUDE.md` の「Wi‑Fi OTA デプロイ（Phase 2）」節を参照（v1.0.1 で完了・変更なし）。

---

## この版の骨核

| 項目 | v1.0.2 でやること |
|---|---|
| **探求** | v1.0.1 と同じ（顔のみ呼吸。サーボ停止） |
| **UI** | 画面下端から上スワイプで **設定バー**（明るさ・音量、+/− ボタン）。通常時は非表示 |
| **開発** | Wi‑Fi OTA（`overlay/scripts/ota-deploy.sh`）で反復開発。USB は未使用（v1.0.1 Phase 2 で完了済み） |

Layer 0 の同席観察（v1.1.0）はこの版の外。

---

## 1. 設定バー（明るさ・音量）

### 要件

- **操作**: 画面下端（y ≧ 160、height 80 の透明ゾーン）から **上方向スワイプ ≥40px** → バー表示。表示中に **下スワイプ** または **8 秒操作なし** で自動非表示（ボタン操作でタイマーリセット）
- **対称性**: 既存 status-bar（画面上端 0〜80px・下スワイプで表示）と操作方向・ゾーンとも対称。上端/下端で y 範囲が重ならないため競合しない。下スワイプゾーン（透明、height 80）と可視バー（height 72）は兄弟として分離し、可視バー自体には `backgroundTouch` を付けず、個々のボタンだけ `active: true` にする
- **トーン**: **白背景・黒文字**（黒背景・白前景の顔と区別するため、あえて反転。status-bar と同じ意図）。上辺 1px ボーダー（`#cccccc`）
- **表示（2 行）**:
  - 明るさ行: ラベル + `[-]` + レベル表示 `n/8` + `[+]`（**1〜8 の 8 段階**）
  - 音量行: ラベル + `[-]` + レベル表示 `n/8` + `[+]`（**0〜8 の 9 段階**）
- **永続化**: `Preference`（domain `breath`、key `backlightMv` / `ampVolume`）。起動時（`applySavedSettings()`）に保存値を再適用
- **既知の制約**: 音量変更は**起動音そのものには当日反映されない**（起動音は setup フェーズで再生済みのため、次回起動時から反映）
- **フォント**: status-bar と同じ `20px Open Sans`。ビットマップフォント資産（`OpenSans-Regular-20`）は ASCII (0x20–0x7e) のみを内包しており日本語グリフが無いため、「明るさ」「音量」ラベルは表示できない → **`BRT` / `VOL` にフォールバック**（ビルド前に `.fnt` を調査して確定。実装済み）

### 技術メモ

| 要素 | API / 実装 |
|---|---|
| 明るさ制御 | AXP2101 DLDO1 電圧レジスタ **0x99**（値 = (mV−500)/100、5bit 0〜30）。`m5stackchan/battery` の `setBacklightVoltage(mv)` / `getBacklightVoltage()`（`battery-registry.js` に追加、`firmware-platform-breath-battery.patch` へ反映済み） |
| 死んでいる API（使用禁止） | SDK の `power.brightness` / `Host.Backlight` は Power クラスに setter が無く**何もしない**。Moddable AXP2101 ドライバの `LDO.voltage` セッターは引数順バグで常に最小値を書くため使用禁止 |
| 音量制御 | `globalThis.amp.volume = 0..256`（SDK AW88298 セッター、バグなし・即時反映・I2C 0x36 で衝突なし）。getter もある |
| 聴覚フィードバック | 音量変更時に `robot.tone(880, 80, 0.5)` を発火（try/catch + Promise 拒否も個別に捕獲。失敗しても値の変更自体は継続） |
| 永続化 | `import Preference from 'preference'` を overlay 側（`settings-bar.js`）から直接使用。`preference` モジュールは `utilities/manifest_utility.json` 経由で既にホストビルドに含まれている（追加の manifest 変更は不要と確認済み） |

### タスク

- [x] `battery-registry.js` に `setBacklightVoltage` / `getBacklightVoltage` を追加
- [x] `overlay/patches/firmware-platform-breath-battery.patch` を再生成し、全パッチの forward apply（クリーンな submodule チェックアウト）・reverse-apply-check を確認
- [x] `overlay/mods/breath/settings-bar.js` 実装（下スワイプ検知・2 行 UI・Preference 永続化・ビープ・`attachSettingsBar` / `applySavedSettings` を export）
- [x] `overlay/mods/breath/mod.js` に `applySavedSettings()` → `attachSettingsBar(robot)` を（`attachStatusBar` と同じ 2s Timer 内で）接続
- [x] `manifest_breath_deploy.json` に `settings-bar` を登録し、submodule 側コピーへ同期
- [x] ビルド成功（`build:breath:m5stackchan-cores3`）・Wi‑Fi OTA デプロイ成功（`ota-deploy.sh`、buildId 一致・`/status` 生存確認）
- [x] 実機: 下端スワイプで設定バーが表示/非表示・自動非表示（2026-07-06 ユーザー確認 + UDP トレースで裏取り）
- [x] 実機: 明るさ `[-]`/`[+]` で画面の明るさが変化（2026-07-06 ユーザー確認）
- [x] 実機: 音量 `[-]`/`[+]` で音量とビープ音が変化（2026-07-06 ユーザー確認）
- [ ] 実機: 再起動後も明るさ・音量の設定が保持されること（次回の電源断/OTA の際に設定バーの値を見れば受動的に確認できる）

### 運用メモ（2026-07-06）

- **デバイスの IP は DHCP で変わる**（実績: 電源入れ直しで .76 → .66）。`overlay/scripts/stackchan-ip.sh` が `overlay/mods/breath/dev/beacon.js`（UDP ブロードキャスト、port 8687、10 秒周期）を受信して自動発見するため、**DHCP 予約は不要**。`overlay/scripts/ota-deploy.sh` もホスト省略時はこれで自動発見する。ビーコンが届かない場合のみ `logs.sh` を起動して電源投入し、UDP ブートトレースの送信元 IP で特定する
- 「デバイスに繋がらない」= クラッシュとは限らない。**まず電源と IP を疑う**（今回の実例: 電源オフ + IP 変更を abort と誤認しかけた）

---

## Phase 3 — 堅牢化（任意）

- [ ] ESP-IDF ロールバック: sdkconfig `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` + 起動確認後の mark-valid（SDK に既製実装なし、FFI で自作）
- [ ] trace リングバッファ + `GET /logs`（UDP 取りこぼし時の追い読み）
- [ ] OTA 書込中は呼吸アニメーションを一時停止（フラッシュ書込と描画の負荷分離）

---

## v1.1.0 以降（探求・変更なし）

- [ ] 同室 2〜10 人で同席観察
- [ ] **人間でも Web でもないロボット** としての第三焦点
- [ ] サーボ・LED の取捨（同室観察後）

---

## journal

- [ ] journal は **開発効率の観察** があれば `/write-journal`（探求の Layer 0 観察は v1.1.0）
