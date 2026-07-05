# breathing — エージェント向けガイド

存在負荷が高い私たちが、同じ部屋で演じなくていい時間を試す探求プロジェクト。媒体は [StackChan](https://docs.m5stack.com/ja/StackChan)（M5Stack デスクトップロボット）。

Web 版（v0.1.0 / v0.2.0）の実装は git 履歴に残す。**v1.0.0 以降の主経路**は StackChan ファームウェアと同席観察。upstream の `stack-chan/CLAUDE.md` もファームウェア作業時に参照する。

---

## リポジトリ構成

| パス | 内容 |
|---|---|
| `docs/concept-v1/` | **現在の探求指針**（v1.0.0 以降） |
| `docs/journal/` | 版ごとの観察と気づき（ユーザー対話ベースで書く） |
| `docs/concept/` | Web 探求期の指針（参照用） |
| `stack-chan/` | upstream サブモジュール（[stack-chan/stack-chan](https://github.com/stack-chan/stack-chan)、`develop`） |
| `overlay/` | breathing 固有のパッチ・MOD・ドキュメント（**サブモジュールにコミットしない**） |
| `overlay/docs/my-cores3/` | CoreS3 / K151-R 向け開発ガイド |
| `overlay/mods/` | 探求用 MOD（breathing 固有） |
| `.cursor/skills/stackchan-cores3/` | StackChan カスタマイズ用スキル |
| `.cursor/skills/write-journal/` | journal 執筆用スキル |

### overlay/ の中身

- `patches/` — upstream へ `git apply`（`scripts/stack-chan-setup.sh` で適用）
- `firmware/scripts/mod-cores3.sh` — MOD 書き込みラッパー（setup 時に submodule へコピー）
- `firmware/manifest_smoke_test.json` — deploy テンプレ

---

## エージェント向けルール

1. **探求の判断**は `docs/concept-v1/` を起点にする。journal の観察・気づきはユーザー口述・合意のみ（`/write-journal` スキル参照）。
2. **`stack-chan/` サブモジュール内ではコミットしない。** パッチ適用後の dirty 状態は正常。変更は `overlay/patches/` で管理。
3. **出荷時 AI Agent モードは使わない。** 会話・Q&A は存在負荷を上げる。静かな呼吸 MOD を書く。
4. ファームウェア作業は **`stack-chan/firmware/`** で npm コマンドを実行（リポジトリルートではない）。
5. ユーザーが明示しない限り **git commit / push しない。**

---

## 初回セットアップ

```bash
git submodule update --init --recursive
./scripts/stack-chan-setup.sh
cd stack-chan/firmware
npm install
npm run setup -- --device=esp32
```

upstream 更新後:

```bash
git submodule update --remote stack-chan
./scripts/stack-chan-setup.sh
```

---

## 所有ハードウェア

**M5Stack StackChan Remote Controller Kit (SKU: K151-R)**。Moddable/JS ファームウェア書き込み済み（工場出荷ファームは M5Burner で復元可。ダウンロードモードは RST 3 秒長押しでインジケーター緑）。

- 本体: M5Stack **CoreS3**
- サーボ: **SCS0009 ×2**（水平 360° / 垂直 90°）。UART **G6/G7, port 1, baud 1000000**（`stack-chan/firmware/stackchan/manifest_m5stackchan_cores3.json` と一致確認済み）
- 付属リモコン（ESP-NOW）は **このファームでは非対応**（工場出荷専用）
- ヘッド LED: 12 連（PY32、I2C 0x6F）
- 実機確認済み: 顔 / サーボ / ヘッド LED（スモークテスト）

---

## ビルド・MOD 書き込み

**サーボ・ヘッド LED を使うときは専用ボード構成のみ。** `stack-chan/firmware/` で:

```bash
npm run build:m5stackchan-cores3
npm run deploy:m5stackchan-cores3
npm run mod:m5stackchan-cores3 -- ./mods/<mod>/manifest.json
```

探求用 MOD を `overlay/mods/` に置く場合は、manifest パスを `--` に渡す。

標準 `--target=esp32/m5stack_cores3` は顔だけの確認用。AXP2101 パッチが当たらずサーボ/LED が動かない。

### MOD 書き込み（`mod:m5stackchan-cores3`）

`mcrun -d` が `Installing mod..` でハングする問題あり。**`overlay/firmware/scripts/mod-cores3.sh`** が esptool リセット + 最大 3 回リトライ。これが標準ループ。

**最終手段**: `overlay/firmware/manifest_smoke_test.json` をテンプレに `-t deploy`:

```json
{
  "include": ["./manifest_m5stackchan_cores3.json"],
  "modules": { "mod": "../mods/m5stackchan_smoke/mod" }
}
```

（`include` のパスは `stack-chan/firmware/stackchan/` 基準。MOD パスは用途に合わせて差し替え）

---

## トラブルシューティング（要約）

詳細: `overlay/docs/my-cores3/01-environment-and-build.md` §7

| 症状 | 対処 |
|---|---|
| `mcrun: command not found` | `~/.local/share/xs-dev-export.sh` を shell に読み込む |
| `Cannot find name 'Disposable'` | `overlay/patches/firmware-manifest-json.patch` を適用（setup スクリプト） |
| `fontbm` / libfreetype | `brew install freetype` |
| `Please build before deploy` | ビルド成果物 `xs_esp32.bin` の有無を確認 |
| MOD 転送ハング | `mod:m5stackchan-cores3` を使う（mod-cores3.sh） |

---

## 参照ドキュメント

| やりたいこと | 読むファイル |
|---|---|
| 探求の目的・勾配 | `docs/concept-v1/01-purpose.md` |
| 同室・StackChan の役割 | `docs/concept-v1/02-vision.md` |
| 振る舞い・Layer 設計 | `docs/concept-v1/03-interactions.md` |
| 環境構築・書き込み | `overlay/docs/my-cores3/01-environment-and-build.md` |
| MOD 開発 | `overlay/docs/my-cores3/02-mod-development.md` |
| 顔・声・振る舞い | `overlay/docs/my-cores3/03-face-voice-behavior.md` |
| robot API | `overlay/docs/my-cores3/05-robot-api-reference.md` |
| StackChan 作業全般 | `.cursor/skills/stackchan-cores3/SKILL.md` |
| journal 執筆 | `.cursor/skills/write-journal/SKILL.md` |

---

## 現在の実機状態（メモ）

`overlay/mods/breath`（v1.0.0 Layer 0）を MOD 書き込み済み（2026-07-05）。起動後 ~0.5s で自動呼吸（吸 4s / 吐 6s）。観察前に電源投入で動作確認すること。
