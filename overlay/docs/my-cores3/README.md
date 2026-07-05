# CoreS3ユーザー向けカスタマイズガイド 索引

M5Stack CoreS3 版 StackChan（K151-R）向けのカスタマイズガイド。upstream は [`stack-chan/` サブモジュール](../../../stack-chan/) で管理し、本ディレクトリ（`overlay/docs/my-cores3/`）は breathing リポジトリで管理する。

## stack-chanの全体像（初心者向け）

- stack-chanはM5Stack（ESP32マイコン）上でJavaScriptで動くロボットです。ファームウェアはModdable SDK（XS engine、JavaScriptランタイム）をベースに動きます。
- 構造は2層に分かれています。
  - **ホスト(host)**: サーボ制御・TTS（音声合成）・顔描画などの土台となる基盤ファームウェア。`firmware/stackchan/` に実装があります。
  - **MOD**: ホストの上に載せるユーザーアプリ。`firmware/mods/` に置きます。
  - ホストは一度書き込めば基本そのままでよく、開発中はMODだけを高速に書き換えて試せます。
- コードはTypeScript/JavaScriptなので、Webエンジニアであれば構文自体は読めるはずです。

## 何をしたいか別の早見表

| やりたいこと | 読むドキュメント |
| --- | --- |
| 喋る内容/AI連携を変えたい | [`./02-mod-development.md`](./02-mod-development.md) |
| 顔の見た目を変えたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) |
| 声を変えたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) |
| 首を動かしたい/視線追従させたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md), [`./05-robot-api-reference.md`](./05-robot-api-reference.md) |
| ビルドや書き込みで困った | [`./01-environment-and-build.md`](./01-environment-and-build.md) |
| ケースやサーボを組み立てる/選ぶ | [`./04-physical-customization.md`](./04-physical-customization.md) |
| robotの使えるメソッドを知りたい | [`./05-robot-api-reference.md`](./05-robot-api-reference.md) |

## 最短の始め方（3ステップ）

1. 環境構築とホストの書き込み。詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) を参照してください。
2. サンプルMODを書き込んで動作確認します。`firmware/` ディレクトリで以下を実行します。

   ```sh
   npm run mod --target=esp32/m5stack_cores3 ./mods/look_around/manifest.json
   ```

3. 自分のMODを作ります。詳細は [`./02-mod-development.md`](./02-mod-development.md) を参照してください。

実機がなくても、`web/simulator/` のWASMシミュレータでロボットのロジックだけを試すこともできます。

## CoreS3特有の重要な注意（最初に知っておくべき地雷）

- ビルドのターゲット指定は2系統あります。
  - 一般的なM5Stack CoreS3本体のみで使う場合: `--target=esp32/m5stack_cores3`
  - サーボ電源(PY32)や12連ヘッドLEDを持つStack-chan専用ボード構成を使う場合: `--target=esp32:./platforms/m5stackchan_cores3` と、専用マニフェスト `firmware/stackchan/manifest_m5stackchan_cores3.json` を使用します。
  - 詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) と [`./04-physical-customization.md`](./04-physical-customization.md) を参照してください。
- CoreS3本体単体（サーボ未接続）で使う場合は、設定で `driver.type: "none"` にします。この場合の「振る舞い」は視線（目の動き）だけになり、首は物理的に動きません。
- 顔の描画システムは2種類存在します。
  - `firmware/stackchan/renderers-piu/` — 現行の実装で、実際のビルドで使われます。カスタマイズはこちらを触ります。
  - `firmware/stackchan/renderers/` — レガシー/テスト用で、現行ビルドでは使用されません。
  - 詳細は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。

## リポジトリ内の関連する既存ドキュメント

- [`../../../stack-chan/firmware/docs/flashing-firmware.md`](../../../stack-chan/firmware/docs/flashing-firmware.md) — 書き込み手順
- [`../../../stack-chan/firmware/docs/text-to-speech.md`](../../../stack-chan/firmware/docs/text-to-speech.md) — TTS設定
- [`../../../stack-chan/firmware/docs/setting-preferences-web.md`](../../../stack-chan/firmware/docs/setting-preferences-web.md) — Web設定画面での preferences 設定
- [`../../../stack-chan/firmware/docs/m5stackchan-cores3-smoke.md`](../../../stack-chan/firmware/docs/m5stackchan-cores3-smoke.md) — Stack-chan 専用 CoreS3 ボードの smoke test
- [`../../../stack-chan/case/v1/dynamixel.md`](../../../stack-chan/case/v1/dynamixel.md) — DYNAMIXELサーボ版ケース
- [`../../../stack-chan/case/README.md`](../../../stack-chan/case/README.md) — ケース全般
- [`../../../stack-chan/schematics/README.md`](../../../stack-chan/schematics/README.md) — 制御基板の回路設計
