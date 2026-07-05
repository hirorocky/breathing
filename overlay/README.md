# overlay — breathing 固有の StackChan カスタマイズ

upstream の [stack-chan/stack-chan](https://github.com/stack-chan/stack-chan) は **`stack-chan/` サブモジュール** で追跡する。本ディレクトリ **`overlay/`** に、パッチ・スクリプト・MOD・ドキュメントを置く（upstream 本体とは別）。

## 構成

| パス | 内容 |
|---|---|
| `../stack-chan/` | upstream（submodule、`develop`） |
| `patches/` | upstream への git apply 用パッチ |
| `firmware/scripts/mod-cores3.sh` | CoreS3 向け MOD 書き込みラッパー |
| `firmware/manifest_smoke_test.json` | スモークテスト用マニフェスト（deploy テンプレ） |
| `firmware/manifest_breath_deploy.json` | v1.0.0 呼吸 MOD 用 deploy テンプレ |
| `mods/breath/` | v1.0.0 探求用 MOD（Layer 0 呼吸） |
| `docs/my-cores3/` | CoreS3 / K151-R 向けカスタマイズガイド |
| `mods/` | 探求用 MOD（breathing 固有） |
| `CLAUDE.local.md` | エージェント向けガイド（ルート `CLAUDE.md` の実体） |

## 初回セットアップ

```bash
./scripts/stack-chan-setup.sh
cd stack-chan/firmware
npm install
npm run setup -- --device=esp32
```

## 日常の開発（K151-R / m5stackchan_cores3）

`stack-chan/firmware/` で:

```bash
npm run build:m5stackchan-cores3
npm run deploy:m5stackchan-cores3
npm run mod:m5stackchan-cores3 -- ./mods/<mod>/manifest.json
```

探求用 MOD を `overlay/mods/` に置く場合は、パスを合わせて `--` に渡す。詳細: [docs/my-cores3/README.md](./docs/my-cores3/README.md) · エージェント向け: [CLAUDE.md](../CLAUDE.md) · [AGENTS.md](../AGENTS.md)

## upstream 更新後

```bash
git submodule update --remote stack-chan
./scripts/stack-chan-setup.sh
```

パッチが当たらない場合は `overlay/patches/` を upstream の変更に合わせて更新する。
