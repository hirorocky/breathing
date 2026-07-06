# breathing — エージェント向けガイド

存在負荷が高い私たちが、同じ部屋で演じなくていい時間を試す探求プロジェクト。媒体は [StackChan](https://docs.m5stack.com/ja/StackChan)（M5Stack デスクトップロボット）。

Web 版の実装は git 履歴に残す。**主経路**は StackChan ファームウェアと同席観察。upstream の `stack-chan/CLAUDE.md` もファームウェア作業時に参照する。

探求用 breath MOD は **ホストへのフル deploy** で焼く。MOD パーティション単体書き込みだけでは不十分なことが多い。

---

## リポジトリ構成

| パス | 内容 |
|---|---|
| `docs/concept-v1/` | **探求指針**（StackChan 向け） |
| `docs/journal/` | 観察と気づき（ユーザー対話ベースで書く） |
| `docs/concept/` | Web 探求期の指針（参照用） |
| `stack-chan/` | upstream サブモジュール（[stack-chan/stack-chan](https://github.com/stack-chan/stack-chan)、`develop`） |
| `overlay/` | breathing 固有のパッチ・MOD・ドキュメント（**サブモジュールにコミットしない**） |
| `overlay/docs/my-cores3/` | CoreS3 / K151-R 向け開発ガイド |
| `overlay/mods/breath/` | Layer 0 呼吸 MOD（探求の本体） |
| `overlay/mods/breath-clear/` | MOD パーティション空上書き用 |
| `.cursor/skills/write-journal/` | journal 執筆用スキル |

### overlay/ の中身（ファームウェア関連）

| パス | 内容 |
|---|---|
| `patches/` | upstream へ `git apply`（`scripts/stack-chan-setup.sh` で適用） |
| `firmware/manifest_breath_deploy.json` | breath 用 deploy マニフェスト（setup 時に submodule へコピー） |
| `firmware/scripts/mod-cores3.sh` | MOD 書き込みラッパー（リセット + リトライ） |
| `firmware/manifest_smoke_test.json` | スモークテスト用 deploy テンプレ |
| `mods/breath/mod.js` | 呼吸ループ本体（`onRobotCreated`） |
| `mods/breath/status-bar.js` | 時刻・バッテリーバー（mod.js に接続済み。バッテリー読み取りはホスト側 `m5stackchan/battery` 経由） |
| `mods/breath/settings-bar.js` | 明るさ・音量の設定バー（mod.js に接続済み。画面下端から上スワイプで表示。`m5stackchan/battery` の DLDO1 制御 + `preference` で永続化。v1.0.2） |
| `mods/breath/liveliness.js` | 生存感エンジン（視線の微揺らぎ・深呼吸・まれな murmur。ポアソン的スケジューラ。dev サーバ `GET/PUT /params` でライブチューニング + `preference` 永続化。v1.1.0 Phase 2a） |
| `mods/breath/face/` | 顔の再設計 B 案（Cozmo 理念、v1.1.0）。`eye-cozmo.js`（角丸矩形 1 目の PIU Shape パーツ。脈動・まばたき・視線・微小な漂いを合成）・`breath-face.js`（`behaviors/face.ts` の FaceBase 上に目 2 つ、口なし）・`renderer-breath.js`（`renderer-simple.ts` と同型の Renderer） |
| `mods/breath/touch-debug.js` | タッチデバッグ（**mod.js から未接続** — 全画面オーバーレイで不安定化し得る） |
| `mods/breath/dev/` | Wi-Fi 開発ツール（UDP trace ミラー + `GET /status` + `PUT /ota` + mDNS + IP 自動発見ビーコン。§Wi-Fi 開発ツール・§Wi-Fi OTA デプロイ参照） |
| `mods/breath/dev/beacon.js` | デバイス IP 自動発見用 UDP ビーコン（10 秒ごと、port 8687、`{"name":"stackchan","ip":...,"buildId":...}`） |
| `scripts/logs.sh` | Mac 側 UDP ログ受信（port 8686） |
| `scripts/stackchan-ip.sh` | Mac 側でビーコン（port 8687）を待ち受け、デバイス IP を自動発見（stdout に IP のみ出力） |

### overlay/patches/ 一覧（setup で stack-chan に適用）

| パッチ | 目的 |
|---|---|
| `firmware-package-json.patch` | `deploy:breath:m5stackchan-cores3` 等の npm scripts |
| `firmware-manifest-json.patch` | TypeScript `Disposable` lib 追加 |
| `firmware-main-breath-host-mod.patch` | `breathHostMod` 時は MOD パーティション上書きをスキップ |
| `firmware-main-breath-renderer.patch` | main.ts に `renderer-breath` を登録し、`breathHostMod` 時の既定レンダラーを `breath`（B 案・Cozmo 理念）にする（`firmware-main-breath-host-mod.patch` と同一ファイルを触るが別 hunk のため非衝突。辞書順で host-mod → renderer の順に適用され、`apply --check --reverse` で確認済み） |
| `firmware-default-mods-mod-breath.patch` | `default-mods/mod.ts` が `breath/mod` を import |
| `firmware-app-controller-breath.patch` | 顔タップでドロワーを開かない（`breathHostMod` 時） |
| `firmware-platform-breath-battery.patch` | AXP2101 バッテリー読み取り・バックライト制御（SMBus 捕獲 + `m5stackchan/battery` registry。`setBacklightVoltage`/`getBacklightVoltage` は DLDO1 電圧レジスタ 0x99 を直接叩く） |
| `firmware-robot-breath-gaze.patch` | `robot.ts` の `eye.gazeX/gazeY = Math.cos(...)` を `Math.sin(...)` に修正（cos は偶関数で方向の符号が消え、中央で ≈1 の右下バイアスになる upstream バグ。sin なら正面 = 0・符号 = 方向。upstream 報告候補） |

---

## エージェント向けルール

1. **探求の判断**は `docs/concept-v1/` を起点にする。journal はユーザー口述・合意のみ（`/write-journal` スキル参照）。
2. **`stack-chan/` サブモジュール内ではコミットしない。** パッチ適用後の dirty 状態は正常。変更は `overlay/patches/` で管理。
3. **出荷時 AI Agent モードは使わない。** 静かな呼吸 MOD を書く。
4. ファームウェア作業は **`stack-chan/firmware/`** で npm コマンドを実行（リポジトリルートではない）。
5. ユーザーが明示しない限り **git commit / push しない。**
6. **breath 探求の書き込みは breath 用の経路を使う。** 日常は `overlay/scripts/ota-deploy.sh`（Wi‑Fi OTA）。パーティション未移行・OTA が届かない場合のみ USB の `deploy:breath:m5stackchan-cores3`。どちらも `deploy:m5stackchan-cores3`（通常 StackChan、ドロワー UI 付き）は使わない。

---

## 初回セットアップ

```bash
git submodule update --init --recursive
./scripts/stack-chan-setup.sh   # パッチ適用 + manifest コピー（必須）
cd stack-chan/firmware
npm install
npm run setup -- --device=esp32
```

upstream 更新後は `./scripts/stack-chan-setup.sh` を再実行。パッチが当たらなければ `overlay/patches/` を更新する。

---

## 所有ハードウェア

**M5Stack StackChan Remote Controller Kit (SKU: K151-R)**

- 本体: M5Stack **CoreS3**（Moddable サブプラットフォーム `m5stackchan_cores3`）
- サーボ: **SCS0009 ×2**（UART G6/G7, port 1, baud 1000000）
- 付属 ESP-NOW リモコン: 所持している
- ヘッド LED: 12 連（PY32、I2C 0x6F）
- 電源 IC: **AXP2101**（I2C 0x34）— SDK の setup-target（`globalThis.power`）が占有。読み取りは `m5stackchan/battery`（`host/provider.js` の `BreathSMBus` 捕獲）経由。**MOD から直接 SMBus を開かない**。バックライトは SDK の `power.brightness` / `Host.Backlight` に setter が無く死んでいるため、DLDO1 電圧レジスタ **0x99**（値 = (mV−500)/100、5bit 0〜30）を `m5stackchan/battery` の `setBacklightVoltage`/`getBacklightVoltage` 経由で直接制御する（v1.0.2）

---

## breath ファーム書き込み（必読）

**v1.0.1 Phase 2 以降、主経路は Wi‑Fi OTA（`overlay/scripts/ota-deploy.sh`）。USB（`deploy:breath:m5stackchan-cores3`）は初回セットアップ・パーティション未移行時・OTA が届かないほど壊れた場合のリカバリ用**。詳細は `## Wi-Fi OTA デプロイ（Phase 2）` を参照。以下の USB 手順は主にそのリカバリ経路として残す。

### コマンドの違い

`stack-chan/firmware/` で実行:

```bash
# ★ 探求用 breath — 必ずこちら
npm run deploy:breath:m5stackchan-cores3

# 通常 StackChan（Face/Emotion/Speech ドロワー）— breath 探求では使わない
npm run deploy:m5stackchan-cores3

# ビルドのみ
npm run build:breath:m5stackchan-cores3
```

| コマンド | マニフェスト | 結果 |
|---|---|---|
| `deploy:breath:m5stackchan-cores3` | `manifest_breath_deploy.json` | breath MOD がホストに組み込まれる |
| `deploy:m5stackchan-cores3` | `manifest_m5stackchan_cores3.json` | デフォルト StackChan（ドロワー UI） |

### 起動時の MOD 解決（StackChan アーキテクチャ）

```
main.ts
  1. defaultMod = import 'default-mods/mod'   ← パッチで breath/mod を指す
  2. if (breathHostMod) → MOD パーティションは無視
     else if (Modules.has('mod')) → パーティションの mod で上書き  ← 古い mod 残るとドロワー復活
  3. createRobot() → onRobotCreated(robot)
```

breath deploy の構成:

- `manifest_breath_deploy.json` に `"breathHostMod": true`
- `main.ts` パッチで MOD パーティション上書きをスキップ
- `default-mods/mod.ts` パッチで `import breathMod from 'breath/mod'`（makefile 競合回避）

### overlay モジュールの登録（重要）

`overlay/mods/breath/mod.js` を **ファイルパス import してはいけない**（実機でモジュール未登録 → 起動クラッシュ → 画面真っ白）。

正しい方法:

1. `manifest_breath_deploy.json` に `"breath/mod": "../../../overlay/mods/breath/mod"` を登録
2. `default-mods/mod.ts`（パッチ）から `import breathMod from 'breath/mod'`

manifest で `"default-mods/mod": breath` だけ指定しても、makefile 上 **`default-mods/mod.ts` の glob ルールが後から勝つ**ため効かない。`mod.ts` パッチが必須。

### makefile 競合（ハマりポイント）

```
manifest  override → breath/mod.js  から default-mods/mod.xsb を生成（先）
default-mods/* glob → mod.ts          から default-mods/mod.xsb を生成（後・勝ち）
```

後者が勝つと `on-robot-created.ts`（ドロワー UI）が使われる。**パッチで mod.ts から breath/mod を import するのが正解。**

### 推奨 deploy 手順（USB — 初回 / リカバリ用）

**通常の反復開発では使わない。** パーティション未移行の初回セットアップ、または Wi‑Fi OTA が届かないほどファームが壊れた場合のリカバリ手順。日常の更新は `## Wi-Fi OTA デプロイ（Phase 2）` の `ota-deploy.sh` を使う。

`overlay/` 配下（`mods/breath/*.js` 等）を編集した場合は **deploy の前に build を必ず実行**する。`deploy` 単体だと増分ビルドが古いバイナリを再利用し、書き込み成功でも実機が変わらないことがある（下記「ビルドキャッシュ」参照）。

```bash
./scripts/stack-chan-setup.sh
cd stack-chan/firmware
pkill -f serial2xsbug 2>/dev/null || true   # xsbug がポート占有している場合
npm run build:breath:m5stackchan-cores3
npm run deploy:breath:m5stackchan-cores3
```

**`npm run erase-flash`（esptool erase-flash）は絶対に実行しない。** NVS の Wi‑Fi 資格情報と otadata が消え、Wi‑Fi OTA 経路が使えなくなる（再度 Wi‑Fi 設定からやり直しになる）。パーティション変更後の USB deploy が失敗し erase が必要に見える場合は、そこで作業を止めて状況を確認する（実績: `defines.ota.autosplit` 追加後の deploy は erase 不要で成功した）。

### overlay 変更後のビルドキャッシュ（ハマりポイント）

breath 用 JS（`overlay/mods/breath/`）は `manifest_breath_deploy.json` 経由で **ホストファームウェアに焼き込まれる**。`mcconfig` の増分ビルドが `overlay/` の変更を拾わず、**更新前の `xs_esp32.bin` のまま `deploy` が走る**ことがある。

| 確認 | 方法 |
|---|---|
| ビルドが走ったか | `build:breath` のログに TypeScript/リンク処理が出るか。サイズ行 `xs_esp32.bin binary size 0x........` が表示されるか |
| 中身が新しいか | 編集したソースより **新しい**タイムスタンプの `xs_esp32.bin` があるか |
| サイズの変化 | コード変更後も binary size が **前回と完全一致**なら古いビルドを疑う |

バイナリの場所:

```text
~/.local/share/moddable/build/tmp/esp32/m5stackchan_cores3/debug/stackchan/xsProj-esp32s3/build/xs_esp32.bin
```

**対処:** `npm run build:breath:m5stackchan-cores3` を再実行 → 上記を確認 → `deploy:breath`。それでも反映されない場合は build ディレクトリを削除してから **build → deploy**（`rm -rf .../debug/stackchan` の直後に `deploy` だけ実行すると CMake 未生成で失敗するので、必ず `build` を挟む）。

MOD パーティションに古い mod が残っている疑いがある場合（補助）:

```bash
npm run mod:m5stackchan-cores3 -- ../../overlay/mods/breath-clear/manifest.json
```

### 正常な実機挙動

- 黒背景に **白い角丸の目 2 つ（口なし）**。呼吸で目が脈動（吸 4s / 吐 6s）し、まばたきで縦に潰れ、視線・微小な漂いで目がわずかに動く（起動 ~0.5s 後。v1.1.0 顔の再設計 B 案・Cozmo 理念。表情変形は未実装 — 常に平常）
- タップしても **ドロワー（Face/Emotion/Speech）は出ない** — 意図どおり
- 画面上端（y ≦ 80px）から下スワイプ → 白背景・黒文字のステータスバー（時刻 `HH:MM` ・バッテリー `NN%`）が表示、上スワイプまたは 5 秒で自動非表示
- 画面下端（y ≧ 160px、height 80 の透明ゾーン）から上スワイプ → 白背景・黒文字の設定バー（明るさ・音量、`[-]`/`[+]` ボタン、`BRT n/8` / `VOL n/8`）が表示、下スワイプまたは 8 秒で自動非表示（v1.0.2）。ラベルは 20px Open Sans に日本語グリフが無いため ASCII フォールバック
- `mod.js` は呼吸ループ + ステータスバー + 設定バー（起動 ~2s 後、`applySavedSettings()` → `attachSettingsBar()`）+ dev ツール（起動 ~3s 後、`config.breathDevTools` 時）。touch-debug は未接続
- `setTorque(false)` は未使用（UART 応答待ちで WDT 再起動し得るため）

---

## Wi-Fi 開発ツール（Phase 1: UDP ログ + /status）

`overlay/mods/breath/dev/`（trace-udp / dev-server / dev-tools / beacon）。`manifest_breath_deploy.json` の `"breathDevTools": true` で有効。

```bash
# UDP ログミラー受信（port 8686、trace が全てブロードキャストされてくる）
overlay/scripts/logs.sh

# デバイス IP の自動発見（port 8687、10 秒周期のビーコンを最大 15 秒待ち受け）
overlay/scripts/stackchan-ip.sh

# デバイス状態の確認（buildId / ip / battery / uptimeMs の JSON）
curl http://$(overlay/scripts/stackchan-ip.sh)/status
curl http://stackchan.local/status   # mDNS は本 LAN では解決不可（後述）。参考として残す
```

- 生存感エンジン（`liveliness.js`）のライブチューニングは `GET/PUT /params`（Loop B の心臓部。v1.1.0 Phase 2a、要 `x-dev-token`）。詳細は `docs/tasks/open-items.md` の Loop B 参照
- IP は DHCP で変わり得る（実績: `.76` → `.66`）。**固定 IP・DHCP 予約は不要** — `overlay/scripts/stackchan-ip.sh` が毎回ビーコンから現在の IP を発見する
- ビーコンの送信先も trace-udp と同じグローバルブロードキャスト（255.255.255.255）固定。デバイス → Mac の方向のみ実証済み（逆方向の mDNS 相当のクライアント間 multicast はこの LAN で遮断される）
- **buildId は build と deploy の両方に渡す**（deploy も mcconfig を再実行するため、付け忘れると `unknown` で上書きされる）:
  ```bash
  BUILD_ID="$(git rev-parse --short HEAD)-$(date +%H%M%S)"
  npm run build:breath:m5stackchan-cores3 -- buildId=$BUILD_ID
  npm run deploy:breath:m5stackchan-cores3 -- buildId=$BUILD_ID
  # 反映確認: curl .../status の buildId が一致すること（ビルドキャッシュ問題の恒久解）
  ```
- 送信先はグローバルブロードキャスト 255.255.255.255 固定。**サブネット /24 仮定の x.y.z.255 は使わない**（Deco の /22 で ARP 滞留 → ERR_MEM → 再起動ループの実績）。ユニキャストにしたい場合は manifest の config に `devLogHost` を追加
- **stack-chan の `HttpServerService` と SDK の `listen` は使わない**: 前者は任意の 1 リクエスト、後者は不正 HTTP（ポートスキャン等）で unhandled rejection → XS abort → 再起動する（`docs/tasks/open-items.md` Phase 1 実装メモ参照）。dev-server は `embedded:network/http/server` を直接ルーティングする純コールバック実装（Promise 不使用のため構造的に安全）
- 起動 +3s より前の trace（`[breath] loop running` 等）は UDP に乗らない。ブート直下はシリアル採取（環境ガイド §8）
- `stackchan.local` は自宅 Deco IoT SSID ではクライアント間 multicast 遮断のため解決不可（デバイス側 mDNS は正常）。`overlay/scripts/stackchan-ip.sh` の UDP ビーコン発見で代用（IP 直打ちも可）

---

## Wi-Fi OTA デプロイ（Phase 2: 以後 USB 不要）

**日常の breath 反復開発の主経路。** `manifest_breath_deploy.json` の `"defines": {"ota": {"autosplit": 1}}` でパーティションを `ota_0`/`ota_1`/`otadata` + `xs`（mod）/`storage`/`nvs` に再構成済み（実機確認済み・2026-07-06）。パーティション未移行の機体では先に USB フル書き込みが必要（前節）。

```bash
overlay/scripts/ota-deploy.sh                # ホスト省略 → UDP ビーコン（port 8687）で自動発見
overlay/scripts/ota-deploy.sh 192.168.1.50   # ホストを明示（自動発見をスキップ。IP 直打ち。mDNS は本 LAN では不可）
```

やること: （ホスト省略時）`stackchan-ip.sh` で IP 自動発見 → buildId 付き build → `PUT /ota`（`x-dev-token: breath-dev`）→ 再起動待ち → `GET /status` の buildId 照合。USB には触らない。IP は DHCP で変わり得るが、ホストを省略して呼べば毎回追従する（DHCP 予約は不要）。

- 実測所要時間（バイナリ約 3.75MiB、同一 LAN）: 総時間 77〜83 秒（大半はビルド）。アップロード完了 → 再起動 → `/status` 応答までは約 12〜17 秒
- OTA スロットは書込みごとに `ota_0` ⇄ `ota_1` を自動で交互に切替（`embedded:storage/flash` の `"nextota"` パスが `esp_ota_get_next_update_partition` で常に非アクティブ側を指す）。`esp-idf/components/app_update/otatool.py read_otadata` で `ota_seq` を読むと確認できる
- 認証は `mc/config` の `devToken`（既定 `"breath-dev"`）と `x-dev-token` ヘッダの一致のみ。同一 LAN 前提の dev 用途と割り切っている
- **異常系でも abort・再起動しない**（実機確認済み）: トークン不一致は 401（`curl -sf` は exit 22）を返し旧ファームのまま生存。転送中断（`curl --limit-rate` で開始して kill 等）も `OTA.close()`（`complete()` を呼ばない = cancel）だけで旧ファームのまま生存し、直後の正常な OTA も成功する
- 実装は `overlay/mods/breath/dev/dev-server.js`。`PUT /ota` は Phase 1 の `breath/dev/http-listen`（Promise ベース、ボディを丸ごと `concat` してから読む方式）ではなく、SDK の `examples/io/listener/httpserverota` に倣った低レベル `embedded:network/http/server` ルーティングで実装（受信チャンクをその場で `OTA.write()`、Promise を使わないコールバックのみ）。理由: 数 MB のファームを一度にバッファするのは非現実的で、Promise 化すると Phase 1 で踏んだ unhandled rejection → XS abort のリスクも再発するため
- 未検証（範囲外）: 不正な内容のバイナリを流し込んだ場合の内容検証、OTA 書込み中のステータスバー操作との干渉。書込み中の呼吸アニメーションのカクつきは許容事項（Phase 3 対応候補）
- 詳細: `docs/tasks/open-items.md` §2 Phase 2 実装メモ

---

## MOD パーティション書き込み（補助）

```bash
npm run mod:m5stackchan-cores3 -- ../../overlay/mods/<mod>/manifest.json
```

- `mcrun -d` が `Installing mod..` でハングしやすい → `mod-cores3.sh`（esptool リセット + 最大 3 回リトライ）
- **breath 探求の主経路はフル deploy**（`deploy:breath`）。MOD 単体だけではホスト側 breath 組み込み・パッチが効かない
- MOD パーティションの mod は native（PIU 等）不可。PIU UI はホスト manifest に module 登録する

---

## トラブルシューティング

詳細: `overlay/docs/my-cores3/01-environment-and-build.md` §7

### 書き込み

| 症状 | 原因 | 対処 |
|---|---|---|
| 書き込み成功だが breath が動かない / ドロワーが出る | `deploy:m5stackchan-cores3` を使った | `deploy:breath:m5stackchan-cores3` に切替 |
| ドロワーが消えない | MOD パーティションに古い mod | `breath-clear` を書込 + `deploy:breath`（`breathHostMod` 確認） |
| `Installing mod..` でハング | デバッグリスナー不調 | `mod-cores3.sh` / 物理リセットボタン |
| `No serial data received` | xsbug がポート占有 | `pkill -f serial2xsbug` → ダメなら物理リセット |
| 画面真っ白 | `breath/mod` 未登録・import 失敗 | manifest + `mod.ts` パッチを確認、setup 再実行 |
| 顔は出るがすぐ再起動ループ | status-bar の二重 SMBus / touch-debug 全画面 / setTorque | `mod.js` を呼吸ループのみの最小構成に戻す |
| deploy 成功だが overlay の変更が実機に反映されない | 増分ビルドが古い `xs_esp32.bin` を再利用 | `build:breath` を再実行 → バイナリのサイズ・タイムスタンプ確認 → `deploy:breath` |
| カスタム platform の setup-target のコードが実機で走らない（電源レール patch 等が効かない） | `"setup/target"` は manifest で宣言しても **SDK 側定義が makefile 上勝つ** | 別名の setup モジュール（例 `m5stackchan/battery`）+ `host/provider.js` のフックから実装する |
| AXP2101 へ I2C アクセスで `RangeError: duplicate address (in I2C)` | SDK の `globalThis.power`（setup-target 生成）が I2C 0x34 を占有 | `host/provider.js` の `BreathSMBus` 捕獲経由（`m5stackchan/battery`）で読む。直接 `new SMBus({address: 0x34, ...})` しない |
| `ota-deploy.sh` が `/status` の buildId 照合でタイムアウトする | デバイスが再起動中 / Wi‑Fi 未接続 / パーティション未移行 | UDP ログ（`logs.sh`）で再起動シーケンスを確認。パーティション未移行なら先に USB フル書き込みが必要 |
| `PUT /ota` が 401 | `x-dev-token` 不一致 | `overlay/firmware/manifest_breath_deploy.json` の `config.devToken`（既定 `breath-dev`）とヘッダを揃える |
| `/status` も ping も UDP ログも無反応 | **まず電源と IP を疑う**（DHCP で IP は変わる。実績: .76 → .66）。クラッシュとは限らない | 電源を確認 → `overlay/scripts/stackchan-ip.sh` で自動発見（DHCP 予約は不要）。それでも無反応なら `logs.sh` を起動した状態で電源投入し UDP ブートトレースの送信元 IP を確認 |

### ビルド環境

| 症状 | 対処 |
|---|---|
| `mcrun: command not found` | `~/.local/share/xs-dev-export.sh` を shell に読み込む |
| `Cannot find name 'Disposable'` | `./scripts/stack-chan-setup.sh`（manifest パッチ） |
| `fontbm` / libfreetype | `brew install freetype` |
| パッチが当たらない | upstream 更新後、`overlay/patches/` を手当て |

---

## overlay/mods/breath 編集時の注意

- **変更後は build → deploy。** パーティション移行済みの機体なら `overlay/scripts/ota-deploy.sh`（Wi‑Fi、build も内包）で十分。未移行 / リカバリ時のみ USB の `build:breath:m5stackchan-cores3` → `deploy:breath:m5stackchan-cores3`（MOD 単体 install だけでは不十分）
- USB 手順の場合、deploy だけ実行しない。書き込み成功でも **古いバイナリ**の可能性がある（§「overlay 変更後のビルドキャッシュ」）
- status-bar は接続済み（バッテリーはホスト `m5stackchan/battery` 経由）。touch-debug は依然未接続 — 追加で attach する場合は **段階的に**（1 つずつ実機確認）
  - status-bar: バッテリーは **MOD/host から直接 SMBus を開かない**（AXP2101 は SDK の `globalThis.power` が占有しており duplicate address になる）。`m5stackchan/battery` の `readBatterySample()` を使う（内部で `host/provider.js` の `BreathSMBus` が捕獲した io を読む）
  - touch-debug: 全画面 `active` + `backgroundTouch` オーバーレイは PIU 不安定化の疑い。下端バーのみ
- `setTorque(false)`: 非同期 + タイムアウト付きで再導入する場合は実機で再起動しないことを確認する

---

## 参照ドキュメント

| やりたいこと | 読むファイル |
|---|---|
| 探求の目的・勾配 | `docs/concept-v1/01-purpose.md` |
| 振る舞い・Layer 設計 | `docs/concept-v1/03-interactions.md` |
| 環境構築・書き込み | `overlay/docs/my-cores3/01-environment-and-build.md` |
| MOD 開発 | `overlay/docs/my-cores3/02-mod-development.md` |
| robot API | `overlay/docs/my-cores3/05-robot-api-reference.md` |
| journal 執筆 | `.cursor/skills/write-journal/SKILL.md` |
