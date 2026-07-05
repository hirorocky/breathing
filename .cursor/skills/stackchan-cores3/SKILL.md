---
name: stackchan-cores3
description: M5Stack CoreS3版stack-chanのカスタマイズ支援。MOD(アプリ)開発、表情・声・振る舞いの変更、CoreS3向けビルド/書き込み、ケース/サーボ等の物理カスタマイズを行うとき、または firmware/ のファームウェアコードを触るときに使う。
---

このスキルは breathing リポジトリ内の M5Stack CoreS3 版 StackChan（K151-R）カスタマイズを支援する。upstream は `stack-chan/` サブモジュール。ガイドは [`overlay/docs/my-cores3/`](../../overlay/docs/my-cores3/) にある。作業の際はまず該当ガイドを参照すること。ファームウェアコマンドは `stack-chan/firmware/` で実行する。

## stack-chanの基本構造

- Moddable SDK(XS engine)上でJS/TSで動くESP32ロボット。
- 2層構造: **ホスト**(`firmware/stackchan/`)=土台ファームウェア（サーボ/TTS/顔描画）。一度書き込めばよい。**MOD**(`firmware/mods/`)=上に載せるユーザーアプリで、`onLaunch`/`onRobotCreated`フックを上書きする。
- 通常の開発は `npm run mod` でMODだけを高速に書き換えるループ。ホスト設定を変えたら `npm run deploy`。

## 重要な前提・地雷（最優先で意識する）

- **ビルドターゲットが2系統**: 標準M5Stack CoreS3は `--target=esp32/m5stack_cores3`。サーボ電源(PY32)/12連ヘッドLEDを持つStack-chan専用ボード構成は `-p esp32:./platforms/m5stackchan_cores3` ＋専用マニフェスト `firmware/stackchan/manifest_m5stackchan_cores3.json` を使う。「サーボやLEDが動かない」場合、標準ターゲットでビルドしていてAXP2101電源パッチ(`firmware/platforms/m5stackchan_cores3/setup-target.js`)が当たっていない可能性を最初に疑う。
- **顔レンダラーは2系統**: 現行で実際に動くのは `firmware/stackchan/renderers-piu/`。`firmware/stackchan/renderers/` はレガシー/テスト用で現行ビルド非使用。表情カスタマイズは renderers-piu を触る。古いMOD(`firmware/mods/face`, `ai_stackchan`のdecorator呼び出し)はレガシーAPI前提で現行では動かない/要移植の可能性。
- **CoreS3単体はサーボ無し**: サーボ未接続なら `driver.type: "none"`。この場合「振る舞い」は目線(視線)のみで首は物理的に動かない。
- **MODは基本 .js**（サンプルは全てmod.js）。TSにするならmanifestのincludeに`manifest_typings.json`を足す。
- **設定の優先順位**: デバイス保存値(BLE Preference) > MODのconfig > `firmware/stackchan/manifest_local.json`のconfig。実装は `firmware/stackchan/utilities/loadPreference.ts`。
- **Web Preference UIの落とし穴**: tts.typeの「google-tts」はファーム側に無くGoogle Cloud TTSは実際は`type: remote`。`image`/`small-face`レンダラーはUIに無くmanifest直接編集。`tts.voice`はBLE永続化されない場合あり。
- `npm run erase-flash`はフラッシュ全消去でPreferences設定も消える。実行後はホスト再書き込み＆再設定が必要。
- **（解決済み）専用ボード構成でのMOD書き込みが間欠的にハングする問題**: 以前は`mcrun -d`がxsbugのデバッグプロトコル経由でMODを転送する際、約25〜75%の確率で`Installing mod..`のまま止まることがあった。`mcrun`実行直前にesptool経由でデバイスをハードリセットすることで解決し、`npm run mod:m5stackchan-cores3 -- <manifest>`（`firmware/scripts/mod-cores3.sh`）に組み込み済み。現在はこれが標準の開発ループ。
- 実験的で正しく動かないMOD: `firmware/mods/calibration`（オフセット設定が正常動作しない旨のコメントあり）、`firmware/mods/setup_rs30x`（flashIdが実行されないコードパス）。安易に「使える」と案内しない。

## よく使うコマンド（`stack-chan/firmware/` で実行）

環境:
```
npm install
npm run setup
npm run setup -- --device=esp32
npm run doctor
npm run scan
```

ビルド/書き込み(標準CoreS3):
```
npm run deploy --target=esp32/m5stack_cores3
npm run debug --target=esp32/m5stack_cores3
```

MOD書き込み:
```
npm run mod --target=esp32/m5stack_cores3 ./mods/<name>/manifest.json
```

専用ボード構成:
```
mcconfig -d -m -p esp32:./platforms/m5stackchan_cores3 -t deploy "$PWD/stackchan/manifest_m5stackchan_cores3.json"
npm run mod:m5stackchan-cores3 -- ./mods/<name>/manifest.json
```

（`mod:m5stackchan-cores3` は内部でesptool経由の自動リセットと最大3回のリトライを組み込んだラッパースクリプト`firmware/scripts/mod-cores3.sh`を実行する。`deploy`より速く、信頼できるMOD反復開発の標準手段）

シミュレータ:
```
npm run build:wasm
```
（その後 web/ で `npm run dev`）

品質(Biome):
```
npm run lint
npm run lint:fix
npm run format
npm run format:fix
npm run test:unit
```

## タスク別ガイド（やりたいこと → 参照するドキュメントとキーファイル）

- MOD開発・AI連携・喋る内容変更 → `overlay/docs/my-cores3/02-mod-development.md`。キー: `stack-chan/firmware/mods/*`, `stack-chan/firmware/stackchan/main.ts`
- 顔の見た目/表情 → `overlay/docs/my-cores3/03-face-voice-behavior.md`。キー: `stack-chan/firmware/stackchan/renderers-piu/`
- 声(TTS) → `overlay/docs/my-cores3/03-face-voice-behavior.md`。キー: `stack-chan/firmware/stackchan/speeches/`
- 視線/首振り → `overlay/docs/my-cores3/03-face-voice-behavior.md` と `05-robot-api-reference.md`
- ビルド/書き込み/環境/トラブル → `overlay/docs/my-cores3/01-environment-and-build.md`
- ケース/サーボ/配線/電源/安全 → `overlay/docs/my-cores3/04-physical-customization.md`。キー: `stack-chan/case/`, `stack-chan/schematics/`
- robotの使えるAPI → `overlay/docs/my-cores3/05-robot-api-reference.md`。キー: `stack-chan/firmware/stackchan/robot.ts`

## 作業時の原則

- コードを変更したら `npm run lint`/`format` を通す（このリポジトリはBiome＋lefthookのpre-commit）。
- 変更の検証は実機かWASMシミュレータで。実機のハード確認は `firmware/mods/m5stackchan_smoke/` のスモークテストが便利。
- 断定できない挙動は実ファイル(`firmware/stackchan/robot.ts`等)を読んで確認する。推測で「動く」と言わない。
- 安全: サーボを動かす前は周囲の障害物を確認。PWM(SG90)はトルクON中に首を手で捻るとギア破損、過負荷で発熱の恐れ。
- 本家は `stack-chan/` サブモジュール。upstream への変更は PR 前に `./scripts/stack-chan-setup.sh` でパッチ衝突を確認。breathing 固有の変更は `overlay/` に留める。
