---
name: stackchan-cores3
description: M5Stack CoreS3版StackChanのファームウェア、breath MOD、ビルド・書き込み、実機ハードウェアを扱うときに使う。
---

# StackChan CoreS3 作業

breathing リポジトリの K151-R（CoreS3）向け作業を支援する。作業前にルートの [`AGENTS.md`](../../../AGENTS.md) と、該当するガイドを読む。

## 作業別の参照先

| 作業 | 参照先 |
|---|---|
| breath のビルド、OTA、USB 復旧、ログ、トラブル対応 | [`overlay/docs/my-cores3/06-breath-firmware.md`](../../../overlay/docs/my-cores3/06-breath-firmware.md) |
| CoreS3 の環境構築、MOD 開発、表情・音声、API、物理構成 | [`overlay/docs/my-cores3/README.md`](../../../overlay/docs/my-cores3/README.md) |
| breath 固有モジュールの構成 | [`overlay/README.md`](../../../overlay/README.md) |
| ファームウェア本体の開発規約 | [`stack-chan/CLAUDE.md`](../../../stack-chan/CLAUDE.md) |

## 必須ルール

- npm コマンドは `stack-chan/firmware/` で実行する。
- breathing の通常の実機更新には `overlay/scripts/ota-deploy.sh` を使う。
- OTA を利用できない初回書き込みや復旧時だけ `npm run deploy:breath:m5stackchan-cores3` を使う。
- breathing 固有機能を含まない `npm run deploy:m5stackchan-cores3` は使わない。
- `npm run erase-flash` は実行しない。Wi-Fi 設定と OTA 状態が消えるため、必要に見える場合は作業を止めて確認する。
- ファームウェア本体は `stack-chan/`、breathing 固有機能は `overlay/` で編集する。
- `stack-chan/` の push 先は fork の `origin breath` だけとし、本家の `upstream` へ push しない。
- ユーザーが明示しない限り commit・push しない。
- サーボを動かす前に周囲の障害物を除き、過負荷や発熱がないことを確認する。

## 検証

- コードや設定を推測で案内せず、manifest、`package.json`、実装ファイルを確認する。
- overlay の変更後は OTA スクリプトで build・deploy・buildId 照合まで行う。
- ファームウェア本体を変更した場合は、対象テストと `npm run build:breath:m5stackchan-cores3` を実行する。
- 実機固有機能は、可能な限り実機ログと `/status` で確認する。
