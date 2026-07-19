# breathing — エージェント向けガイド

存在負荷が高い私たちが、同じ部屋で演じなくていい時間を試す探求プロジェクト。媒体は [StackChan](https://docs.m5stack.com/ja/StackChan)（M5Stack デスクトップロボット）。

`stack-chan/CLAUDE.md` もファームウェア作業時に参照する。

探求用 breath MOD は **ホストへのフル deploy** で焼く。MOD パーティション単体書き込みだけでは不十分なことが多い。

---

## リポジトリ構成

| パス | 内容 |
|---|---|
| `docs/concept/` | **探求指針**（StackChan 向け） |
| `docs/journal/` | 観察と気づき（ユーザー対話ベースで書く） |
| `docs/tasks/` | 現在の実装状況・表現設計・残タスク |
| `stack-chan/` | fork サブモジュール（[hirorocky/stack-chan](https://github.com/hirorocky/stack-chan)、`breath` ブランチ。origin = fork、upstream = 本家 [stack-chan/stack-chan](https://github.com/stack-chan/stack-chan)、push disabled） |
| [`overlay/`](overlay/README.md) | breathing 固有の MOD・スクリプト・ツール・開発ドキュメント |
| `scripts/` | リポジトリのセットアップ用スクリプト |
| `.cursor/skills/` | journal・CoreS3 作業用のエージェントスキル |

`overlay/` 配下の詳しい構成は [`overlay/README.md`](overlay/README.md) を参照する。

### fork ブランチ運用（stack-chan submodule）

`stack-chan/` は **fork [hirorocky/stack-chan](https://github.com/hirorocky/stack-chan) の `breath` ブランチ**を指す（`.gitmodules` で固定）。ファームウェア変更は submodule 内で直接編集・コミットする。

| 項目 | 内容 |
|---|---|
| origin | fork（`hirorocky/stack-chan`）。push は ssh 可 |
| upstream | 本家 `stack-chan/stack-chan`。**push disabled**（fetch のみ） |
| 変更履歴 | fork 直下 `BREATH-CHANGES.md`（Apache-2.0 §4(b) の改変ファイル一覧） |

**ファーム変更のワークフロー**（ユーザー明示時のみ実行。ルール 2 参照）:

1. `stack-chan/` 内でソースを直接編集する
2. `stack-chan/` 内でコミット（upstream の lefthook が pre-commit で Biome を走らせる。import 並び順等の指摘は `cd stack-chan/firmware && npx biome check --write <files>` で直してから再コミット）
3. `git -C stack-chan push origin breath`
4. breathing リポジトリ側で `stack-chan` の gitlink 更新をコミット（2 段コミットの後半）
5. **upstream ファイルを新たに改変したら `stack-chan/BREATH-CHANGES.md` の改変ファイル一覧を更新する**（ルール）

**upstream 取り込み手順**（breath ブランチ上で）:

```bash
git -C stack-chan fetch upstream
git -C stack-chan merge upstream/develop
# ビルド確認（stack-chan/firmware で npm run build:breath:m5stackchan-cores3）
git -C stack-chan push origin breath
# breathing 側で gitlink 更新をコミット
```

deploy マニフェストは `stack-chan/firmware/stackchan/manifest_breath_deploy.json`、MOD 書き込みラッパーは `stack-chan/firmware/scripts/mod-cores3.sh` に置く。

---

## エージェント向けルール

1. **設計や振る舞いを判断するときは、最初に `docs/concept/` を読む。** このプロジェクトの目的や判断基準はここにある。`docs/journal/` はユーザーが話した観察と、ユーザーと合意した内容だけを書く。journal を編集するときは `/write-journal` スキルを使う。
2. **ファームウェア本体は `stack-chan/` 内で編集する。** `stack-chan/` は fork `hirorocky/stack-chan` の `breath` ブランチを指す submodule である。本家を指す `upstream` には push しない。
3. **通常の StackChan が備える AI Agent 機能は、このプロジェクトでは使用しない。** breathing 固有の静かな振る舞いは `overlay/mods/breath/` に実装する。
4. **ファームウェアの npm コマンドは `stack-chan/firmware/` で実行する。** breathing リポジトリのルートでは実行しない。
5. **ユーザーから明示的に依頼されない限り、commit と push は行わない。** ファームウェア変更を commit・push するときは、先に `stack-chan/`、次にこの breathing リポジトリの順で処理する。手順は「fork ブランチ運用」を参照する。
6. **実機への通常の書き込みには `overlay/scripts/ota-deploy.sh` を使う。** OTA を利用できない初回セットアップや復旧時だけ、USB の `deploy:breath:m5stackchan-cores3` を使う。breathing 固有機能を含まない `deploy:m5stackchan-cores3` は使わない。
7. **`docs/journal/` 以外の文書には、現在有効な情報だけを書く。** 古い説明、完了した移行の経緯、廃止した手順は削除する。過去の変更を調べる必要がある場合は Git 履歴を参照する。
8. **主担当エージェントは設計・判断・作業の分解・成果のレビューと統合を担当する。** 範囲が明確で独立して進められる実装・調査・テストは、利用可能なサブエージェントへ委譲する。サブエージェントの成果は主担当が確認し、プロジェクト全体との整合性と最終結果に責任を持つ。
9. **`overlay/mods/` は strict TypeScript で実装し、lint と format にはルートの `biome.json` を使う。** `stack-chan/firmware/` で `npm run check:breath` を実行し、型エラー・lint warning・format 差分を残さない。
10. **静的チェックはコミットの有無にかかわらず積極的に実行する。** 変更後や区切りのよい作業ごとに `npm --prefix stack-chan/firmware run check:breath` と `git diff --check` を実行する。`scripts/stack-chan-setup.sh` は `.githooks/pre-commit` を有効化し、コミット時にも同じチェックを自動実行する。
11. **デプロイ前に生成物を確認する。** overlayやforkのsetup-targetを変更した場合、増分ビルドを信用してdeployだけを繰り返さない。必要なら対象のModdable生成ディレクトリを削除してbuildし、`manifest_flat.json`・生成JS/XSB・startupSound設定が変更内容を含むことを確認してからdeployする。反映確認は実機の画面だけで判断せず、`/status`の`boot.deployNotice`や`bootError`も読む。
12. **native変更のUSB書き込みは `overlay/scripts/native-deploy.sh` に集約する。** vendor版Moddable SDKを使い、check→キャッシュ削除→build→生成物検証→deployを行う。通常更新はWi-Fi OTAとし、同じdeployを根拠なく繰り返さない。
13. **プロジェクトの型チェックはTypeScript 7.0.2を使う。** `@typescript/native` が `.bin/tsc` をTS7へ固定する。`@typescript/typescript6` はTypeDocとZedのvtslsが必要とする互換API専用であり、通常の `tsc` や実機ビルドの型検査をTS6へ戻さない。

---

## 初回セットアップ

前提として、Xcode Command Line Tools、Homebrew、Node.js 22（`stack-chan/firmware/.nvmrc`）、`xz`（`brew install xz`）を用意する。

```bash
git submodule update --init --recursive
cd stack-chan/firmware
npm install
npm run setup
npm run setup -- --device=esp32
npm run doctor
```

---

## 所有ハードウェア

**M5Stack StackChan Remote Controller Kit (SKU: K151-R)**

- 本体: M5Stack **CoreS3**（Moddable サブプラットフォーム `m5stackchan_cores3`）
- サーボ: **SCS0009 ×2**（UART1、TX GPIO6 / RX GPIO7、1 Mbps）
- リモコン: K151-R 付属 ESP-NOW リモコン
- ヘッド LED: 12個（PY32 I/Oエキスパンダ、I2C `0x6F` 経由）
- 電源管理 IC: **AXP2101**（I2C `0x34`）

---

## 実機開発時に読む文書

| 作業 | 参照先 |
|---|---|
| breath のビルド、OTA、USB 復旧、ログ確認、トラブル対応 | [`overlay/docs/my-cores3/06-breath-firmware.md`](overlay/docs/my-cores3/06-breath-firmware.md) |
| CoreS3 の環境構築、MOD 開発、API、物理構成 | [`overlay/docs/my-cores3/README.md`](overlay/docs/my-cores3/README.md) |
| breath MOD のファイル構成 | [`overlay/README.md`](overlay/README.md) |
