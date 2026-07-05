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

upstream は **`stack-chan/` サブモジュール**（[stack-chan/stack-chan](https://github.com/stack-chan/stack-chan)）。パッチ・MOD・ドキュメントは **`overlay/`** に置く。

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

詳細: [overlay/README.md](overlay/README.md) · エージェント向け: [CLAUDE.md](CLAUDE.md)（`overlay/CLAUDE.local.md` へのリンク）

### upstream 更新後

```bash
git submodule update --remote stack-chan
./scripts/stack-chan-setup.sh
```

`stack-chan/` 内にパッチ適用後の差分が出るのは正常。**サブモジュール側ではコミットしない。**

## エージェント（Claude / Codex）

ルートの [CLAUDE.md](CLAUDE.md)（→ `overlay/CLAUDE.local.md`）と [AGENTS.md](AGENTS.md)（→ `CLAUDE.md`）に、リポジトリ構成・ハードウェア・ビルド手順・エージェント向けルールをまとめている。実体は `overlay/CLAUDE.local.md` 一箇所。
