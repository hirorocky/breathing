# MOD開発ガイド

このドキュメントは、stack-chanの「MOD」（ホストファームウェアの上に載せるユーザーアプリ）を自作するための開発ガイドです。索引は [`./README.md`](./README.md) を参照してください。

## 1. MODとは（ホスト/MOD 2層モデル）

stack-chanのファームウェアは2層に分かれています。

- **ホスト**: `firmware/stackchan/` に実装された土台となるファームウェアです。サーボ制御・TTS（音声合成）・顔描画などの基盤機能を提供します。一度書き込めば、基本的にそのまま使い続けられます。
- **MOD**: `firmware/mods/` に置く、ホストの上に載せる差分アプリです。ボタンを押したら喋る、LEDを光らせる、といった「やりたいこと」はMOD側に書きます。

この2層構造の要は、ホストの起動シーケンス（`firmware/stackchan/main.ts`）が、MODが提供する `onLaunch` / `onRobotCreated` という2つのフックを見つけて呼び出す、という仕組みです。`main.ts` は次のように動きます（Wi-Fi接続や設定読み込みなど詳細は省略した概要です）。

```ts
// firmware/stackchan/main.ts（概要）
let { onRobotCreated, onLaunch } = defaultMod
if (Modules.has('mod')) {
  const mod = Modules.importNow('mod') as StackchanMod
  onRobotCreated = mod.onRobotCreated ?? onRobotCreated
  onLaunch = mod.onLaunch ?? onLaunch
}
const shouldRobotCreate = await (onLaunch?.() ?? true)
if (shouldRobotCreate) {
  const robot = createRobot()
  await onRobotCreated?.(robot, globalEnv.device)
}
```

`Modules.has('mod')` がtrueになるのは、書き込んだMODのmanifest.jsonが `modules` に `"*": "./mod"` のようにモジュール名 `mod` を提供しているときです（詳しくは次節）。MODが `onLaunch` や `onRobotCreated` をexportしていれば、ホスト側のデフォルト実装（`firmware/stackchan/default-mods/`）を上書きします。片方だけexportした場合、もう片方はデフォルトのままフォールバックします。

MODを書き込んでも、ホスト本体（サーボドライバ・TTS・顔描画エンジンなど）は変更されず、MOD用に確保された領域だけが更新されます。設定（Wi-Fiパスワードなど）を含めてすべて消したい場合は `npm run erase-flash` を使いますが、これは工場出荷状態に戻す操作であり、通常のMOD開発では不要です。

## 2. MODの最小構成（まずコピー）

MODの実体は `manifest.json` と、そこから読み込まれるJSファイルの組です。既存の `firmware/mods/look_around/manifest.json` が最小構成の実例です。

```json
// firmware/mods/look_around/manifest.json
{
  "include": ["$(MODDABLE)/examples/manifest_mod.json"],
  "modules": {
    "*": "./mod"
  }
}
```

- `include`: MODをビルドするために必要な定義（`manifest_mod.json`）を注入します。これは必須です。
- `modules."*"`: このMODが提供するモジュールです。`"./mod"` は同じディレクトリの `mod.js`（または `mod.ts`）を指し、モジュール名は `mod` になります。ホスト側の `main.ts` はこの `mod` という名前でMODの存在を判定し、`Modules.importNow('mod')` で読み込みます。

MODは基本的に `.js` で書きます（`firmware/mods/` 配下のサンプルはすべて `mod.js`）。TypeScriptで書きたい場合は、`include` に型定義用のmanifestを追加します。`firmware/mods/dynamixel/manifest.json` がその実例です。

```json
// firmware/mods/dynamixel/manifest.json（一部）
{
  "include": [
    "$(MODDABLE)/examples/manifest_mod.json",
    "$(MODDABLE)/examples/manifest_typings.json",
    "../../stackchan/manifest_typings.json"
  ],
  "modules": {
    "*": ["./mod"]
  }
}
```

その他、よく使う項目の実例です。

- **画像などのアセットを取り込む（`resources`）**: `firmware/mods/monologue/manifest.json` では、`assets/` 配下のファイルをリソースとして取り込み、モジュールとして `mod` と `speeches_monologue` の2つを提供しています。

  ```json
  // firmware/mods/monologue/manifest.json
  {
    "include": ["$(MODDABLE)/examples/manifest_mod.json"],
    "resources": {
      "*": "./assets/*"
    },
    "modules": {
      "*": ["./mod", "./speeches_monologue"]
    }
  }
  ```

- **起動時に即時実行させる（`preload`）**: `firmware/mods/config_wifi/manifest.json` では `preload` に `mod` を指定しています。

  ```json
  // firmware/mods/config_wifi/manifest.json
  {
    "include": ["$(MODDABLE)/examples/manifest_mod.json"],
    "modules": {
      "*": ["./mod"]
    },
    "preload": ["mod"]
  }
  ```

- **Moddable標準モジュールを使う（追加の`include`）**: テキストデコードなど標準モジュールを使う場合は、対応する `manifest.json` を追加で `include` します。`firmware/mods/face_tracker/manifest.json` の例です。

  ```json
  // firmware/mods/face_tracker/manifest.json（一部）
  {
    "include": [
      "$(MODDABLE)/examples/manifest_mod.json",
      "$(MODULES)/data/text/decoder/manifest.json"
    ],
    "modules": {
      "*": "./mod"
    }
  }
  ```

新しいMODを作るときは、まずやりたいことに近い既存のMODをコピーして、`mod.js` の中身だけを書き換えるのが手っ取り早い方法です。

## 3. 2つのフック

MODが上書きできるフックの型定義は `firmware/stackchan/default-mods/mod.ts` にあります。

```ts
// firmware/stackchan/default-mods/mod.ts
export interface StackchanMod {
  onLaunch?: () => Promise<boolean> | boolean
  onRobotCreated?: (robot: Robot, option?: unknown) => Promise<void> | void
}
```

### `onLaunch()`

Robotインスタンスが生成される**前**に呼ばれます。戻り値が `false`（または `false` に解決されるPromise）の場合、`createRobot()` と、それに続く `onRobotCreated` の呼び出しがスキップされます。省略した場合はデフォルトで `true` として扱われます。

主な用途は、Wi-Fi設定やサーボのキャリブレーションのように、ロボット本体（サーボ・TTS・顔描画）を起動する前に完了させたい処理です。実際、`firmware/mods/config_wifi/` はこの用途のMODです。

### `onRobotCreated(robot, option)`

Robotインスタンスが生成された**後**に、一度だけ呼ばれます。第1引数の `robot` が、発話・表情・サーボ制御などを行うためのAPIをまとめたオブジェクトです（詳細は7節）。第2引数はデバイス依存の情報（`globalEnv.device`）で、通常のMOD開発では使わないことが多いです。

ボタンの `onChanged` ハンドラの登録やタイマーの設定など、MODの実質的な処理はほぼすべてここに書きます。

### 使い分けの判断基準

- ロボット（顔・サーボ・TTS）を使ってやりたいことをするだけなら、`onRobotCreated` だけをexportすれば十分です。`onLaunch` は省略してかまいません。
- ロボット生成前に何かを済ませたい（Wi-Fi設定モードに入る、キャリブレーションするなど）場合だけ、`onLaunch` も実装します。

exportの形式は、名前付きexportでもデフォルトexportのオブジェクトでもどちらでも構いません。`firmware/mods/light/mod.js` は名前付きexport、`firmware/mods/monologue/mod.js` はデフォルトexportの例です。片方だけをexportした場合、もう片方はホストのデフォルト実装にフォールバックします。

## 4. 最小の実例（light）

`firmware/mods/light/mod.js` は、ボタンA/B/CでLEDをON/OFF/レインボー表示に切り替えるだけの、短くて分かりやすいMODです。

```js
// firmware/mods/light/mod.js
export function onRobotCreated(robot) {
  const led = robot.led
  if (!led?.a) {
    throw new Error('This device does not support LED or setup LED named as "a".')
  }

  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]
  robot.button.a.onChanged = function () {
    if (this.read()) {
      const firstColor = colors.shift()
      colors.push(firstColor)
      robot.lightOn('a', firstColor.r, firstColor.g, firstColor.b)
    }
  }

  robot.button.b.onChanged = function () {
    if (this.read()) {
      robot.lightOff('a')
    }
  }

  robot.button.c.onChanged = function () {
    if (this.read()) {
      robot.lightRainbow('a')
    }
  }
}
```

ここから読み取れる、MOD全体で繰り返し出てくるパターンがいくつかあります。

- ボタンのイベントは `robot.button.a.onChanged = function () { if (this.read()) { ... } }` という形で登録します。`this.read()` が真になるタイミング（押した/離した、のどちらか一方）でしか処理を行いたくないため、if文で絞り込みます。
- ハードウェア機能を使う前に、その機能が存在するか（この例では `robot.led.a`）を確認し、なければ `throw` して早期に失敗させています。CoreS3本体単体ではLEDが搭載されていない構成もあるため、こうしたガードは実機によって挙動が変わるMODでは重要です。
- `robot.lightOn(ledName, r, g, b)` / `robot.lightOff(ledName)` / `robot.lightRainbow(ledName)` の第1引数は、LEDの識別名（この例では `'a'`）です。led名は `led` カテゴリの設定（`config.led`）で定義したキー名に対応します。設定の書き方は8節を参照してください。

## 5. 少し実用的な例（monologue）

`firmware/mods/monologue/mod.js` は、ボタンAを押すと独り言集からランダムに1つ選んで発話する、少しだけ実用的なMODです。

```js
// firmware/mods/monologue/mod.js
import config from 'mc/config'
import { speeches } from 'speeches_monologue'
import { randomBetween } from 'stackchan-util'

const keys = Object.keys(speeches)

async function sayMonologue(robot) {
  const idx = Math.floor(randomBetween(0, keys.length))
  const key = keys[idx]
  await robot.say(config.tts.type === 'local' ? key : speeches[key])
}

function onRobotCreated(robot) {
  robot.button.a.onChanged = function () {
    if (this.read()) {
      sayMonologue(robot)
    }
  }
}

export default {
  onRobotCreated,
}
```

ポイントは次の2つです。

- `import config from 'mc/config'` でビルド時の設定を読み、`config.tts.type` によって挙動を分岐しています。TTSエンジンが `'local'`（あらかじめ端末上に用意した音声ファイルを再生する方式）の場合はキー文字列を、それ以外（リモートで音声合成する方式）の場合は実際のテキストを `robot.say()` に渡しています。TTSエンジンの詳細は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。
- `await robot.say(...)` は発話完了まで待つ非同期関数です。ボタンハンドラ自体は同期関数のままで、内部で呼ぶ `sayMonologue` だけを `async` にしています。

## 6. AI連携MODの型

もう少し複雑な例として、AIと連携するMODが2つあります。全文は長いため要点だけ紹介します。詳しくは実ファイルを参照してください。

- **`firmware/mods/chatgpt/mod.js`**: 別のPC上で動く音声認識サーバーとWebSocketで接続し、認識されたテキストを受信して `dialogue-chatgpt` モジュールのChatGPT連携に渡します。返答を句点（`。！？`）で分割し、1文ずつ順番に `robot.say()` していきます。WebSocket通信を使うため、この構成ではWi-Fi接続が前提です。
- **`firmware/mods/ai_stackchan/mod.js`**: 音声認識サーバーを別途立てず、`robot.record()` で録音した音声をWhisperで文字起こしし、ChatGPTに渡して、返答を `robot.say()` で発話するところまでを1つのMOD内で完結させています。ChatGPTのTool呼び出し機能を使って `robot.setEmotion()` を呼ばせ、応答の内容に応じて表情を変えている点も特徴です。録音中・思考中はそれぞれ専用のデコレータ（ハート/汗マーク）を顔に重ねて表示し、状態を視覚的に示しています。

両方のMODに共通するのが、APIキーの読み込み方法です。

```js
import loadPreferences from 'loadPreference'

const aiPrefs = loadPreferences('ai')
// aiPrefs.token を ChatGPT などのAPIキーとして使う
```

`loadPreferences('ai')` は `ai` カテゴリの設定を読み込み、その中の `token` フィールドをAPIキーとして使います。設定方法（Web Preference UIから設定する方法と、`manifest_local.json` の `config.ai.token` に直接書く方法）は8節で説明します。

## 7. robot APIの主なもの

`onRobotCreated(robot)` の `robot` は `firmware/stackchan/robot.ts` で定義された `Robot` クラスのインスタンスです。MOD開発で使う頻度が高いものを挙げます（署名は実装に基づく要約です。詳細と全メソッドは [`./05-robot-api-reference.md`](./05-robot-api-reference.md) を参照してください）。

- **発話**: `robot.say(text, volume?)` — 非同期。TTSが `local` の場合の `text` の扱いは10節の注意を参照してください。
- **録音**: `robot.record(durationMilliSec?)` — マイク未搭載機ではエラーになります。
- **音を鳴らす**: `robot.tone(hz, duration, volume?)`
- **表情**: `robot.setEmotion('HAPPY')` — `NEUTRAL` / `ANGRY` / `SAD` / `HAPPY` / `SLEEPY` / `DOUBTFUL` / `COLD` / `HOT` など。
- **口の開き**: `robot.setMouthOpen(value)` — `0`〜`1`。
- **色**: `robot.setColor('primary', r, g, b)` — `key` は `'primary'` または `'secondary'`。
- **吹き出し**: `robot.showBalloon(text, option?)` / `robot.hideBalloon()`
- **視線・姿勢**: `robot.lookAt([x, y, z])` / `robot.lookAway()`。姿勢制御の `robot.setPose(pose, time?)` は実装コメント上も `@experimental` と明記されています。
- **サーボのトルク**: `robot.setTorque(bool)`
- **ボタン**: `robot.button.a` / `.b` / `.c` / `.power`（それぞれ `.onChanged` と `.read()`）
- **センサー**: `robot.touch`、`robot.imu`（IMUが搭載されていれば `onMotionDetect` などのハンドラを持ちます）、`robot.microphone`、`robot.camera`
- **LED**: `robot.lightOn(ledName, r, g, b, ...)` / `robot.lightOff(ledName, ...)` / `robot.lightBlink(ledName, r, g, b, duration, ...)` / `robot.lightRainbow(ledName, ...)`
- **一時停止/再開**: `robot.pause()` / `robot.resume()` — 顔・姿勢の更新ループを止める/戻す

視線や動きに関するより詳しい挙動は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) も参照してください。

### バッテリー残量（`m5stackchan_cores3` 限定、robot API ではない）

Stack-chan専用ボード構成（`platforms/m5stackchan_cores3/`）では、`robot` のAPIではなく、ホストが提供する専用モジュール `m5stackchan/battery` からバッテリー残量を読みます（breathing overlay の `overlay/patches/firmware-platform-breath-battery.patch` で追加）。

```js
import { readBatterySample } from 'm5stackchan/battery'

const sample = readBatterySample()
// sample: { pct: number, mv: number, charging: boolean } | null（未取得/読み取り失敗時は null）
```

AXP2101（I2C 0x34）は SDKの `setup-target.js` が起動時に占有するため、MODや別モジュールから直接 `new SMBus({ address: 0x34, ... })` を開くと `RangeError: duplicate address` になります。バッテリーを読みたい場合は必ず `readBatterySample()` を使ってください（実装例: `overlay/mods/breath/status-bar.js`。詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) のトラブルシューティングを参照）。

## 8. 設定をMODから読む

MODから設定値を読む方法は2種類あります。

### 推奨: `loadPreference`

```js
import loadPreferences from 'loadPreference'

const aiPrefs = loadPreferences('ai')
```

カテゴリ名（`wifi` / `driver` / `renderer` / `tts` / `ai` / `led` など）を渡すと、そのカテゴリの設定オブジェクトが返ります。実例は6節で紹介した `chatgpt`・`ai_stackchan` の各MODを参照してください。

### 低レベル: `mc/config`

```js
import config from 'mc/config'

config.tts.type
```

こちらはビルド時に確定した設定（`manifest_local.json` の `config` セクション）に直接アクセスするもので、実行中の変更（後述のBLE経由の設定）を反映しません。5節の `monologue` MODで使われています。

### 設定の優先順位

`loadPreference`（実装: `firmware/stackchan/utilities/loadPreference.ts`）は、次の優先順位で値を決定します（後ろに書いたものほど優先度が高い）。

1. `manifest_local.json` の `config` セクションに書いた値（`mc/config` 経由）
2. MOD自身が提供する `mod/config` モジュールの値（存在する場合）
3. BLE経由でWeb Preference UIなどから書き込まれ、端末に保存された値（`Preference.get`）

つまり、実機上でWeb Preference UIから設定した値が最終的に優先されます。ビルド前に決めておきたい既定値は `manifest_local.json` の `config` に書き、APIキーのように実機ごとに変わる値はWeb Preference UIから設定するのが基本的な使い分けです。

## 9. ビルドと反復（CoreS3）

以下は、ホストファームウェアがすでにCoreS3に書き込まれていることを前提とした、MOD開発時の反復手順です。ホストの書き込み自体（`npm run deploy` など）や、ターゲット指定の詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) を参照してください。

MODだけを高速に書き込む場合は `npm run mod` を使います（`firmware/` ディレクトリで実行）。

```sh
npm run mod --target=esp32/m5stack_cores3 ./mods/xxx/manifest.json
```

サーボ電源(PY32)や専用LEDを持つStack-chan専用ボード構成を使っている場合は、専用の `mod:m5stackchan-cores3` スクリプトを使うのが推奨コマンドです。

```sh
npm run mod:m5stackchan-cores3 -- ./mods/xxx/manifest.json
```

内部では`mcrun`実行直前にesptool経由でデバイスをハードリセットしてから書き込みを試み、失敗した場合は最大3回まで自動リトライします（`firmware/scripts/mod-cores3.sh`）。これは、以前`mcrun`のxsbugデバッグプロトコル接続が不安定で間欠的にハングする問題を解決したもので、`deploy`より速く、信頼できるMOD反復開発の標準手段になっています。

`npm run mod` / `npm run mod:m5stackchan-cores3` はホスト全体を再書き込みするより速いため、MODのコードを直しては書き込んで動作確認する、というループを短く回せます。

## 10. ハンズオン（コピペで動く最小MOD）

実際に手を動かして、ボタンAを押すと表情が変わって「こんにちは！」と喋る、最小のMODを作ってみます。

`firmware/mods/hello/manifest.json` を作成します。

```json
// firmware/mods/hello/manifest.json
{
  "include": ["$(MODDABLE)/examples/manifest_mod.json"],
  "modules": {
    "*": "./mod"
  }
}
```

`firmware/mods/hello/mod.js` を作成します。

```js
// firmware/mods/hello/mod.js
export function onRobotCreated(robot) {
  robot.button.a.onChanged = async function () {
    if (this.read()) {
      robot.setEmotion('HAPPY')
      await robot.say('こんにちは！')
      robot.setEmotion('NEUTRAL')
    }
  }
}
```

`firmware/` ディレクトリで書き込みます。

```sh
npm run mod:m5stackchan-cores3 -- ./mods/hello/manifest.json
```

書き込みが終わったらボタンAを押してみてください。表情が `HAPPY` に変わり、「こんにちは！」と発話し、発話が終わると表情が `NEUTRAL` に戻ります。

一点注意があります。`robot.say()` の第1引数の扱いはTTSエンジンによって変わります。TTSが `local`（端末上に事前生成した音声ファイルを再生する方式）の場合、この引数は実際に読み上げるテキストではなく、事前生成時に使ったキー文字列である必要があります（5節の `monologue` MODで見たとおりです）。リモートTTS（`remote` / `voicevox` など）の場合は、任意のテキストをそのまま渡せます。`local` のTTSの詳しい挙動は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。

ここまでできれば、あとは `robot.button.b` / `robot.button.c` に別の処理を割り当てたり、7節のAPI一覧を見ながら好きな挙動を追加したりして、自分のMODに発展させていけます。
