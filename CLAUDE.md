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
| `mods/breath/touch-debug.js` | タッチデバッグ（**mod.js から未接続** — 全画面オーバーレイで不安定化し得る） |

### overlay/patches/ 一覧（setup で stack-chan に適用）

| パッチ | 目的 |
|---|---|
| `firmware-package-json.patch` | `deploy:breath:m5stackchan-cores3` 等の npm scripts |
| `firmware-manifest-json.patch` | TypeScript `Disposable` lib 追加 |
| `firmware-main-breath-host-mod.patch` | `breathHostMod` 時は MOD パーティション上書きをスキップ |
| `firmware-default-mods-mod-breath.patch` | `default-mods/mod.ts` が `breath/mod` を import |
| `firmware-app-controller-breath.patch` | 顔タップでドロワーを開かない（`breathHostMod` 時） |
| `firmware-platform-breath-battery.patch` | AXP2101 バッテリー読み取り（SMBus 捕獲 + `m5stackchan/battery` registry） |

---

## エージェント向けルール

1. **探求の判断**は `docs/concept-v1/` を起点にする。journal はユーザー口述・合意のみ（`/write-journal` スキル参照）。
2. **`stack-chan/` サブモジュール内ではコミットしない。** パッチ適用後の dirty 状態は正常。変更は `overlay/patches/` で管理。
3. **出荷時 AI Agent モードは使わない。** 静かな呼吸 MOD を書く。
4. ファームウェア作業は **`stack-chan/firmware/`** で npm コマンドを実行（リポジトリルートではない）。
5. ユーザーが明示しない限り **git commit / push しない。**
6. **breath 探求の書き込みは `deploy:breath:m5stackchan-cores3` を使う。** `deploy:m5stackchan-cores3` は通常 StackChan（ドロワー UI 付き）であり breath ではない。

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
- 電源 IC: **AXP2101**（I2C 0x34）— SDK の setup-target（`globalThis.power`）が占有。読み取りは `m5stackchan/battery`（`host/provider.js` の `BreathSMBus` 捕獲）経由。**MOD から直接 SMBus を開かない**

---

## breath ファーム書き込み（必読）

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

### 推奨 deploy 手順

`overlay/` 配下（`mods/breath/*.js` 等）を編集した場合は **deploy の前に build を必ず実行**する。`deploy` 単体だと増分ビルドが古いバイナリを再利用し、書き込み成功でも実機が変わらないことがある（下記「ビルドキャッシュ」参照）。

```bash
./scripts/stack-chan-setup.sh
cd stack-chan/firmware
pkill -f serial2xsbug 2>/dev/null || true   # xsbug がポート占有している場合
npm run build:breath:m5stackchan-cores3
npm run deploy:breath:m5stackchan-cores3
```

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

- 黒背景・白い顔、口が **吸 4s / 吐 6s**（起動 ~0.5s 後）
- タップしても **ドロワー（Face/Emotion/Speech）は出ない** — 意図どおり
- 画面上端（y ≦ 80px）から下スワイプ → 白背景・黒文字のステータスバー（時刻 `HH:MM` ・バッテリー `NN%`）が表示、上スワイプまたは 5 秒で自動非表示
- `mod.js` は呼吸ループ + ステータスバー（起動 ~2s 後に接続）。touch-debug は未接続
- `setTorque(false)` は未使用（UART 応答待ちで WDT 再起動し得るため）

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

### ビルド環境

| 症状 | 対処 |
|---|---|
| `mcrun: command not found` | `~/.local/share/xs-dev-export.sh` を shell に読み込む |
| `Cannot find name 'Disposable'` | `./scripts/stack-chan-setup.sh`（manifest パッチ） |
| `fontbm` / libfreetype | `brew install freetype` |
| パッチが当たらない | upstream 更新後、`overlay/patches/` を手当て |

---

## overlay/mods/breath 編集時の注意

- **変更後は `build:breath:m5stackchan-cores3` → `deploy:breath:m5stackchan-cores3`**（MOD 単体 install だけでは不十分）
- deploy だけ実行しない。書き込み成功でも **古いバイナリ**の可能性がある（§「overlay 変更後のビルドキャッシュ」）
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
