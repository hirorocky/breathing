# CoreS3ユーザー向けカスタマイズガイド 索引

M5Stack CoreS3 版 StackChan（K151-R）向けのカスタマイズガイド。upstream は [`stack-chan/` サブモジュール](../../../stack-chan/) で管理し、本ディレクトリ（`overlay/docs/my-cores3/`）は breathing リポジトリで管理する。

## stack-chan の全体像

- stack-chan は M5Stack（ESP32 マイコン）上で JavaScript により動くロボットです。ファームウェアは Moddable SDK（XS engine）を使います。
- 構造は2層に分かれています。
  - **ホスト(host)**: サーボ制御・TTS（音声合成）・顔描画などの土台となる基盤ファームウェア。`firmware/stackchan/` に実装があります。
  - **MOD**: ホストの上に載せるユーザーアプリ。一般的なサンプルは `firmware/mods/` にあります。
- breath は PIU を含む overlay モジュールをホストへ組み込むため、MOD パーティション単体ではなく OTA または USB のフル deploy で更新します。

## 何をしたいか別の早見表

breath ファームのビルド、OTA、USB 復旧、ログ確認、トラブル対応は、最初に [`06-breath-firmware.md`](./06-breath-firmware.md) を参照してください。

| やりたいこと | 読むドキュメント |
| --- | --- |
| breath の構成・書き込み・トラブル対応 | [`./06-breath-firmware.md`](./06-breath-firmware.md) |
| breath MOD の仕組みを知りたい | [`./02-mod-development.md`](./02-mod-development.md) |
| 顔の見た目を変えたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) |
| 声を変えたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) |
| 首を動かしたい/視線追従させたい | [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md), [`./05-robot-api-reference.md`](./05-robot-api-reference.md) |
| ビルドや書き込みで困った | [`./01-environment-and-build.md`](./01-environment-and-build.md) |
| ケースやサーボを組み立てる/選ぶ | [`./04-physical-customization.md`](./04-physical-customization.md) |
| robotの使えるメソッドを知りたい | [`./05-robot-api-reference.md`](./05-robot-api-reference.md) |

## breath 開発の始め方

1. [`AGENTS.md`](../../../AGENTS.md) の初回セットアップを完了します。
2. 通常はリポジトリルートで `overlay/scripts/ota-deploy.sh` を実行します。
3. OTA を利用できない場合だけ USB で breath ファームを build、deploy します。詳細は [`06-breath-firmware.md`](./06-breath-firmware.md) を参照してください。

## CoreS3 の重要な制約

- K151-R では専用サブプラットフォーム `m5stackchan_cores3` と breath 用 manifest を使います。詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) と [`./04-physical-customization.md`](./04-physical-customization.md) を参照してください。
- breath の顔は `overlay/mods/breath/face/` に実装し、manifest からホストへ組み込みます。詳細は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。

## リポジトリ内の関連する既存ドキュメント

- [`../../../stack-chan/firmware/docs/m5stackchan-cores3-smoke.md`](../../../stack-chan/firmware/docs/m5stackchan-cores3-smoke.md) — Stack-chan 専用 CoreS3 ボードの smoke test
- [`../../../stack-chan/case/README.md`](../../../stack-chan/case/README.md) — ケース全般
- [`../../../stack-chan/schematics/README.md`](../../../stack-chan/schematics/README.md) — 制御基板の回路設計
