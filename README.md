# 深呼吸している場所

存在負荷が高い私たちが、同じ部屋で演じなくていい時間を試す探求プロジェクト。媒体は [StackChan](https://docs.m5stack.com/ja/StackChan)（M5Stack デスクトップロボット）。

Web 版（v0.1.0 / v0.2.0）の実装は git 履歴に残している。**v1.0.0 以降**は StackChan ファームウェアと同席観察を回す。

## ドキュメント

| パス | 内容 |
|---|---|
| [docs/concept-v1/](docs/concept-v1/) | 現在の探求指針（v1.0.0 以降・StackChan） |
| [docs/journal/](docs/journal/) | 版ごとの観察と気づき |
| [docs/concept/](docs/concept/) | Web 探求期の指針（参照用） |
| [overlay/docs/my-cores3/](overlay/docs/my-cores3/) | CoreS3 / K151-R 向け開発ガイド |

## StackChan 開発環境

`stack-chan/` サブモジュールは **fork [hirorocky/stack-chan](https://github.com/hirorocky/stack-chan) の `breath` ブランチ**を指す。ファームウェア変更は submodule 内で直接編集・コミットする。MOD・スクリプト・ドキュメントは **`overlay/`** に置く。

### 初回

```bash
git submodule update --init --recursive
./scripts/stack-chan-setup.sh
cd stack-chan/firmware
npm install
npm run setup -- --device=esp32
```

### ビルド・MOD 書き込み（K151-R / m5stackchan_cores3）

`stack-chan/firmware/` で:

```bash
npm run build:m5stackchan-cores3
npm run deploy:m5stackchan-cores3
npm run mod:m5stackchan-cores3 -- ./mods/<mod>/manifest.json
```

詳細: [overlay/README.md](overlay/README.md) · エージェント向け: [CLAUDE.md](CLAUDE.md)

### upstream 更新後

```bash
git -C stack-chan fetch upstream
git -C stack-chan merge upstream/develop   # breath ブランチ上で
# ビルド確認（stack-chan/firmware で npm run build:breath:m5stackchan-cores3）
git -C stack-chan push origin breath
```

`stack-chan/` は fork の `breath` ブランチ。ファーム変更は submodule 内で直接コミットし `origin breath`（fork、ssh push）へ push する。upstream（本家）へは push しない。push 後は breathing 側で `stack-chan` の gitlink 更新をコミットする（2 段コミット）。

## エージェント（Claude / Codex）

ルートの [CLAUDE.md](CLAUDE.md) と [AGENTS.md](AGENTS.md)（→ `CLAUDE.md`）に、リポジトリ構成・ハードウェア・ビルド手順・エージェント向けルールをまとめている。

## ライセンス

Copyright 2026 hirorocky

このリポジトリのリソースは [Apache License 2.0](LICENSE) で配布する（upstream の [stack-chan](https://github.com/stack-chan/stack-chan) と同一ライセンス。`stack-chan/` サブモジュールおよびその改変は upstream のライセンス・著作権表示に従う）。
