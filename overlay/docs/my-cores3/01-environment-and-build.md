# CoreS3 向け環境構築・ビルド

breathing の開発対象は K151-R / CoreS3 のサブプラットフォーム `m5stackchan_cores3` です。日常の実機書き込みとトラブル対応は [`06-breath-firmware.md`](./06-breath-firmware.md) を参照してください。

コマンドは、特記がない限りリポジトリルートではなく `stack-chan/firmware/` で実行します。

## 開発環境

macOS では次を用意します。

- Xcode Command Line Tools
- Homebrew
- Node.js 22（`stack-chan/firmware/.nvmrc`）
- `xz`（`brew install xz`）

初回だけ、リポジトリルートから次を実行します。

```bash
git submodule update --init --recursive
cd stack-chan/firmware
npm install
npm run setup
npm run setup -- --device=esp32
npm run doctor
```

`npm run setup` は Moddable SDK、`npm run setup -- --device=esp32` は ESP32 用環境を準備します。環境確認には `npm run doctor`、USB デバイスの確認には `npm run scan` を使います。

Moddable のコマンドが見つからない場合は、現在のシェルで次を読み込みます。

```bash
source ~/.local/share/xs-dev-export.sh
```

## breath 用コマンド

`stack-chan/firmware/package.json` に次の専用スクリプトがあります。

| コマンド | 用途 |
|---|---|
| `npm run build:breath:m5stackchan-cores3` | breath ホストファームのビルド |
| `npm run deploy:breath:m5stackchan-cores3` | breath ホストファームの USB 書き込み |
| `npm run mod:m5stackchan-cores3 -- <manifest>` | 補助 MOD のパーティション書き込み |

breath の manifest は `stack-chan/firmware/stackchan/manifest_breath_deploy.json` です。breathing のモジュールをホストへ組み込み、`m5stackchan_cores3` ドライバ、OTA、ステレオマイク、開発ツールを有効にします。

日常の反復では、ビルドから反映確認まで行う次の OTA スクリプトをリポジトリルートで実行します。

```bash
overlay/scripts/ota-deploy.sh
```

USB の `deploy:breath:m5stackchan-cores3` は初回書き込みまたは OTA が利用できない復旧時だけ使います。標準 StackChan 用の `deploy:m5stackchan-cores3` は breath の機能を含まないため使いません。

`npm run erase-flash` は Wi-Fi 設定と OTA 状態も消すため実行しません。消去が必要に見える場合は作業を止め、[`06-breath-firmware.md`](./06-breath-firmware.md) の復旧手順を確認します。

## ログと反映確認

通常は Wi-Fi 開発ツールを使います。

```bash
overlay/scripts/logs.sh
overlay/scripts/stackchan-ip.sh
curl http://$(overlay/scripts/stackchan-ip.sh)/status
```

ブート直後など Wi-Fi 開発ツール開始前のログが必要な場合は USB シリアルで採取します。`xsbug` や `serial2xsbug` が USB ポートを占有している場合があるため、書き込み前にプロセスと接続状態を確認してください。

## 関連資料

- breath の書き込み、OTA、復旧、既知の制約: [`06-breath-firmware.md`](./06-breath-firmware.md)
- breath MOD の構成: [`../../README.md`](../../README.md)
- ハードウェア構成: [`04-physical-customization.md`](./04-physical-customization.md)
