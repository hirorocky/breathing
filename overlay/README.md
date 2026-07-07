# overlay — breathing 固有の StackChan カスタマイズ

`stack-chan/` サブモジュールは **fork [hirorocky/stack-chan](https://github.com/hirorocky/stack-chan) の `breath` ブランチ**を指す。ファームウェア本体の変更は submodule 内で直接編集・コミットする。本ディレクトリ **`overlay/`** には、MOD・スクリプト・ドキュメントを置く（submodule 本体とは別）。

## 構成

| パス | 内容 |
|---|---|
| `../stack-chan/` | fork（submodule、`breath` ブランチ） |
| `firmware/manifest_smoke_test.json` | スモークテスト用マニフェスト（deploy テンプレ） |
| `mods/breath/` | v1.0.0 探求用 MOD（Layer 0 呼吸）+ v1.0.1 ステータスバー（時刻・バッテリー） |
| `docs/my-cores3/` | CoreS3 / K151-R 向けカスタマイズガイド |
| `mods/` | 探求用 MOD（breathing 固有） |

breath 用 deploy マニフェスト（`manifest_breath_deploy.json`）と MOD 書き込みラッパー（`mod-cores3.sh`）の原本は fork 内 `stack-chan/firmware/stackchan/manifest_breath_deploy.json` / `stack-chan/firmware/scripts/mod-cores3.sh`。

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
# 探求用 breath ファーム（白/黒・呼吸・ステータスバー）— 必ずこちらを deploy
npm run deploy:breath:m5stackchan-cores3

# 通常の StackChan ファーム（Face/Emotion/Speech ドロワー付き）
npm run deploy:m5stackchan-cores3

npm run mod:m5stackchan-cores3 -- ../../overlay/mods/<mod>/manifest.json
```

**注意:** `deploy:m5stackchan-cores3` だけでは breath MOD は焼かれません。MOD パーティションに古い mod が残っていると、ドロワー UI が優先されます。breath 用は `deploy:breath:m5stackchan-cores3` を使ってください（`breathHostMod` で mod パーティション上書きを無効化）。

探求用 MOD を `overlay/mods/` に置く場合は、パスを合わせて `--` に渡す。詳細: [docs/my-cores3/README.md](./docs/my-cores3/README.md) · エージェント向け: [CLAUDE.md](../CLAUDE.md)

## upstream 更新後

```bash
git -C stack-chan fetch upstream
git -C stack-chan merge upstream/develop   # breath ブランチ上で
# ビルド確認（stack-chan/firmware で npm run build:breath:m5stackchan-cores3）
git -C stack-chan push origin breath
```

push 後は breathing 側で `stack-chan` の gitlink 更新をコミットする（2 段コミット）。詳細: [CLAUDE.md](../CLAUDE.md) の「fork ブランチ運用」。
