# 表情（顔）・声（TTS）・振る舞い（視線/動き）のカスタマイズ

このドキュメントは、stack-chanの「顔」「声」「動き」をカスタマイズするための実装箇所と仕組みをまとめたものです。索引は [`./README.md`](./README.md) を参照してください。MODの作り方全般は [`./02-mod-development.md`](./02-mod-development.md)、`robot` のAPI一覧は [`./05-robot-api-reference.md`](./05-robot-api-reference.md)、サーボやケースなど物理構成は [`./04-physical-customization.md`](./04-physical-customization.md) を参照してください。

## 最初に知っておくべき注意（顔の描画システムは2系統ある）

リポジトリには顔の描画実装が2つ存在します。

- `firmware/stackchan/renderers-piu/` — Piu（Moddable SDKの宣言的UIフレームワーク）ベースの実装。**これが現行で実際に動く実装**です。`firmware/stackchan/main.ts` がimportしているのはこちらです。カスタマイズはこのディレクトリを触ってください。
- `firmware/stackchan/renderers/` — Canvas（Poco）に直接描画する古い実装です。`main.ts` はこれをimportしておらず、現行ビルドでは使われません。

この違いは実務上重要です。`firmware/mods/face`（`import { Renderer } from 'simple-face'` で古い `renderers/simple-face.ts` を使う）や `firmware/mods/ai_stackchan`（`import { createHeartDecorator, createSweatDecorator } from 'decorator'` で古い `renderers/decorator.ts` の関数型デコレータを使い、`robot.renderer.addDecorator()` に渡す）は、古いAPI前提のコードです。現行の `renderer.addDecorator()`（`firmware/stackchan/robot.ts`）はPiuの表示オブジェクト（`PiuContent`）を期待しますが、`renderers/decorator.ts` が返すのは `(tick, poco, faceContext, end) => {...}` という「Pocoに直接描画する関数」です。型が異なるため、これらのMODは現行ビルドでは動かない、または移植が必要な可能性があります。新しくカスタマイズを書く場合は、必ず `renderers-piu/` 側の仕組み（`renderer.addDecorator` には `renderers-piu/effects/*.ts` のようなPiuコンテンツを渡す）に合わせてください。

## A. 表情（顔）

### 1. FaceContext ― 表情を表す「状態オブジェクト」

`firmware/stackchan/renderers-piu/face-context.ts` に、表情を表す状態オブジェクト `FaceContext` の型が定義されています。Webエンジニア向けに言うと、Reactのstateのように「毎フレーム、この値を見て各パーツが自分の見た目を更新する」ための入力データです。

```ts
// firmware/stackchan/renderers-piu/face-context.ts
export const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
})

export type FaceContext = {
  mouth: { open: number }
  eyes: {
    left: { open: number; gazeX: number; gazeY: number }
    right: { open: number; gazeX: number; gazeY: number }
  }
  breath: number
  emotion: Emotion
  theme: { primary: Color; secondary: Color } // '#rrggbb' 形式の文字列
}
```

各パーツ（目・口など）はこの `FaceContext` を毎フレーム受け取る `onFaceContext(shape, face)` というコールバックを持ち、その中で自分の描画を更新します。値を直接変更したい場合はこのオブジェクトの構造を理解しておく必要があります。

### 2. パーツ実装 ― どこを触れば見た目が変わるか

| パーツ | ファイル | 概要 |
| --- | --- | --- |
| 目 | `firmware/stackchan/renderers-piu/parts/eye.ts` | `Eye` は黒目（`Iris`）とまぶた（`Eyelid`）で構成されるコンテナ。`gazeX`/`gazeY` で黒目の位置を移動させます。`Eyelid` は `open` と `emotion` の組み合わせから毎回パス（アウトライン）を再構築しており、`ANGRY`/`SAD`/`SLEEPY`/`HAPPY` でまぶたの形が変わります。**表情の見た目を変えたいとき、最も触ることになるのはここです。** |
| 口 | `firmware/stackchan/renderers-piu/parts/mouth.ts` | `Mouth` は `mouth.open` の値から幅・高さを `minWidth/maxWidth`・`minHeight/maxHeight` の間で線形補間します（口が開くほど高さは大きく、幅は狭くなる作り）。 |
| 犬顔用パーツ | `firmware/stackchan/renderers-piu/parts/dog/{eyebrow,mouth,nose}.ts` | `DogFace` 用の眉・口・鼻。 |

目の大きさ・座標や口のサイズは、パーツ自体ではなく呼び出し側の `firmware/stackchan/renderers-piu/behaviors/face.ts` で決まります。

```ts
// firmware/stackchan/renderers-piu/behaviors/face.ts (SimpleFaceの例)
contents: [
  new Eye({ cx: 30, cy: 33, radius: 8, side: 'left' }),
  new Eye({ cx: 170, cy: 36, radius: 8, side: 'right' }),
  new Mouth({ cx: 100, cy: 88 }),
]
```

色（テーマ）は `firmware/stackchan/renderers-piu/face-skin.ts` の `createFaceSkinPalette(primary, secondary)` がPiuの `Skin` オブジェクトを作り、`FaceContext.theme.primary/secondary` の変化を検知して自動的に再生成します。

### 3. まばたき・呼吸・視線ゆらぎ（Motion）

「時間経過で `FaceContext` を書き換える関数」は `firmware/stackchan/renderers-piu/motions/{blink,breath,saccade}.ts` に分かれています。`firmware/stackchan/renderers-piu/behaviors/face.ts` の `FaceBehavior` がデフォルトで使うのは次の2つです（`saccade` はコメントアウトされていて既定では無効です）。

```ts
// firmware/stackchan/renderers-piu/behaviors/face.ts
this.#motions = motions ?? [
  createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  createBreathMotion({ duration: 6000 }),
  // createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
]
```

- `blink.ts`: タイマー駆動で目を開閉させ、`face.eyes.left/right.open` に係数（0.2〜1.0）を掛けます。開いている時間（`openMin`〜`openMax`ミリ秒）と閉じている時間（`closeMin`〜`closeMax`ミリ秒）をランダムに決めます。
- `breath.ts`: `sin` 波で `face.breath` を更新します（-1〜1、`quantize` で8段階に離散化）。この値は顔全体のY座標オフセットとして使われ（`FaceBehavior.onTimeChanged` 内）、顔が周期的に上下に揺れて見えます。
- `saccade.ts`: 目の微小なランダム移動（サッケード）。デフォルトでは無効化されています。有効化したい場合は `behaviors/face.ts` のコメントを外してimportし、`gain` などのパラメータを調整してください。

これらのMotion関数の切り替え間隔やゲインを変える、あるいは自作のMotion関数を追加するのがまばたき・呼吸・視線ゆらぎのカスタマイズ方法です。更新頻度は `FaceBehavior` の `intervalMs`（既定33ms、約30fps）で決まります。

### 4. 顔テンプレートの種類と切り替え

`firmware/stackchan/renderers-piu/behaviors/face.ts` には `SimpleFace` / `SmallFace` / `DogFace` / `ImageFace`（PNGスプライトによる顔、後述）の4種類のテンプレートがあります。それぞれ対応する `firmware/stackchan/renderers-piu/renderer-{simple,small,dog,image}.ts` が `Renderer` クラスをexportし、`firmware/stackchan/main.ts` の次のMapで文字列キーと結び付けられています。

```ts
// firmware/stackchan/main.ts
const renderers = new Map<string, (param: unknown) => Renderer>([
  ['dog', (param) => new DogFaceRenderer(param)],
  ['simple', (param) => new SimpleRenderer(param)],
  ['image', (param) => new ImageFaceRenderer(param)],
  ['small-face', (param) => new SmallFaceRenderer(param)],
])
// ...
const rendererKey = rendererPrefs.type ?? 'simple'
```

renderer選択は preferences の `renderer.type` で行います。ただしWeb Preference UI（`web/preference/index.html`）の選択肢は `simple` と `dog` のみで、`image` と `small-face` はUIから選べません。これらを使う場合は `firmware/stackchan/manifest_local.json` の `config.renderer.type` に直接書いてください。

```json
// firmware/stackchan/manifest_local.json の例
{
  "config": {
    "renderer": {
      "type": "image"
    }
  }
}
```

### 5. カスタム表情の作り方（段階的に）

1. **既存パーツの見た目だけ変えたい**: `parts/eye.ts` の `Eyelid.updatePath()`（`switch (emotion)` で分岐している部分）や `parts/mouth.ts` の `updateFromOpen()` を編集します。最も手軽な方法です。
2. **新しい顔セットを作りたい**: `behaviors/face.ts` の `SimpleFace`/`DogFace` を参考に、`FaceBase.template(...)` で独自の `contents`（パーツの配置）を組みます。
3. **画像スプライトに差し替えたい**: `ImageFace` 方式を使います。実装は `firmware/stackchan/renderers-piu/parts/image/*` とPNGスプライトシートです。設計の背景は `firmware/docs/0002-image-face.md`（RFC文書）にまとまっています。このドキュメントによると `EyelidSprite`/`MouthSprite` は `open` の値を6段階のフレーム番号に量子化して表示コマを切り替える方式で、初期版では `emotion` による見た目変化はサポートされていません（Unresolved questionsに記載あり）。**実験的な位置づけの実装として扱ってください。**
4. **新しいRendererタイプを登録したい**: `firmware/stackchan/main.ts` の `renderers` Mapにキーとファクトリ関数を追加し、`firmware/stackchan/renderers-piu/manifest_renderer_piu.json` の `modules` と `preload` に新しいrendererモジュールを追加します（既存の `renderer-simple`/`renderer-dog`/`renderer-image`/`renderer-small` の登録例を参照）。

### 6. 表情の切り替えAPI（MODから）

```ts
// firmware/stackchan/robot.ts
robot.setEmotion('HAPPY')      // 次フレーム(約30fps更新)で反映
robot.setMouthOpen(0.5)        // 0..1の範囲。範囲外だと例外
robot.setColor('primary', r, g, b)   // key: 'primary' | 'secondary'
robot.showBalloon('こんにちは')      // 吹き出し表示
robot.hideBalloon()
```

`setEmotion()`/`setMouthOpen()` は即座に内部状態を書き換えるだけで、実際の描画反映は `Robot#updateFace()`（約30fps、`INTERVAL_FACE = 1000 / 30`）で行われます。

絵文字エフェクト（ハート・怒りマーク・汗・涙・眠気の泡）は `firmware/stackchan/renderers-piu/effects/emoticon.ts` の `Emoticon` テンプレート（`EmoticonKey = 'heart' | 'angry' | 'sweat' | 'tear' | 'sleepy'`）で、`renderer.addDecorator(new Emoticon({ key: 'heart' }))` のように重ねて表示できます。

LLM（ChatGPT）と連携して表情を制御する実例は `firmware/mods/ai_stackchan/mod.js` にあります。LLMにfunction callingで `set_emotion` ツールを与え、`robot.setEmotion(emotion)` を呼び出す構成です。ただしこのMODは前述のとおり吹き出し/デコレータ部分で古いAPI（`decorator.ts`）を使っているため、`robot.setEmotion()` の呼び出し自体は現行ビルドでも動きますが、デコレータ表示部分は要確認・要移植です。

## B. 声（TTS）

### 7. TTSエンジン一覧と設定

`firmware/stackchan/speeches/` に各エンジンの実装があり、`firmware/stackchan/main.ts` の `ttsEngines` Mapで `tts.type` の値と結び付けられています。`tts.type` を指定しない場合は `local` が使われます。

| `tts.type` | 実装ファイル | 概要 | 必須設定 |
| --- | --- | --- | --- |
| `local` | `tts-local.ts` | ビルド時に生成済みの音声資産（`.maud`など）をFlashから再生。外部サーバ不要。 | なし。`robot.say('key')` の `key` が資産ファイル名（`speeches.js` などで定義した識別子）に対応 |
| `remote` | `tts-remote.ts` | 任意のHTTP TTSサーバ（Google Cloud TTSやCoqui AI TTSなど）にリクエストしてWAVをストリーミング再生 | `host`, `port` |
| `voicevox` | `tts-voicevox.ts` | 自前でホストしたVOICEVOX ENGINEに接続 | `host`, `port`（`speakerId` は省略可、既定1） |
| `voicevox-web` | `tts-voicevox-web.ts` | クラウド版の `api.tts.quest` を利用 | `token`（`speakerId` は省略可） |
| `elevenlabs` | `tts-elevenlabs.ts` | ElevenLabsのAPI | `token`（`voice`, `model` は省略可） |
| `openai` | `tts-openai.ts` | OpenAIのTTS API | `token`（`model`, `voice`, `speed` は省略可） |

### 8. TTSの設定場所とAPIキー

- **ビルド時に固定する場合**: `firmware/stackchan/manifest_local.json` の `config.tts` に書きます（このファイルは `.gitignore` 対象で自分で作成します。詳細は [`./01-environment-and-build.md`](./01-environment-and-build.md) を参照）。

  ```json
  // firmware/stackchan/manifest_local.json の例（ElevenLabs）
  {
    "config": {
      "tts": {
        "type": "elevenlabs",
        "token": "YOUR_API_KEY"
      }
    }
  }
  ```

- **実機で動的に設定する場合**: Web Preference UI（BLE経由。手順は [`./01-environment-and-build.md`](./01-environment-and-build.md) の「Web設定UI」章を参照）。

> [!NOTE]
> 既知の落とし穴があります。
> - Web UIの `tts.type` 選択肢にある「Google TTS」は、実装側のキー名としては存在しません（`main.ts` の `ttsEngines` が認識するのは `local`/`remote`/`voicevox`/`voicevox-web`/`elevenlabs`/`openai` のみ）。Google Cloud TTSを使う場合は実際には `remote` タイプを使う必要がありますが、`remote` はUIの選択肢にも含まれていないため、`manifest_local.json` に直接書く必要があります。
> - Web UIには `tts.voice` の入力欄がありますが、ファームウェア側でBLE経由の設定を永続化するキー一覧（`firmware/stackchan/utilities/consts.ts` の `PREF_KEYS`）に `tts.voice` は含まれていません。そのため実機に保存されない可能性があります。
> - 端末内でオンデマンド音声合成（AquesTalkなど）は現時点で非対応です。事前生成（`local`）方式か、外部サーバへのリモート問い合わせ（`remote`系）方式のみサポートされています（`firmware/docs/text-to-speech.md`）。

Google Cloud TTS・Coqui AI TTS・VOICEVOXなどを使った事前生成は `firmware/scripts/generate-speech-*` スクリプトで音声ファイルを生成し、`firmware/stackchan/assets/sounds` に配置してビルド・Flashに焼き込みます（詳細は `firmware/docs/text-to-speech.md`）。

### 9. 発話APIとリップシンク

```ts
// firmware/stackchan/robot.ts
await robot.say('こんにちは', 0.8) // text, volume(省略可)
```

`say()` は各TTSエンジンの `tts.stream()` を呼び出します。リップシンク（発話に合わせて口を動かす仕組み）は次のようになっています。

1. 各TTSエンジンは再生中の音声バッファのパワー（音量）を `firmware/stackchan/speeches/calculate-power.ts`（内部でネイティブ関数 `xs_calculatePower` を呼ぶ）で計算します。
2. 計算したパワーを `onPlayed(power)` コールバック経由で `robot.ts` に渡します。
3. `robot.ts` はそのパワーを `mouthOpen`（`Math.min(volume / 2000, 1.0)`）に変換し、`updateFace()` で `FaceContext.mouth.open` に反映します。

つまり「TTSの音声を再生したときの音量に応じて自動で口が開閉する」仕組みで、発話するテキストの内容そのものは見ていません（音素解析ではなく音量ベースの簡易リップシンクです）。

別方式として、`firmware/mods/lip_sync/mod.js` はマイク入力の音量から `robot.setMouthOpen()` を呼ぶ実装です。人が喋っている音声に合わせて口を動かす（TTSを使わない）用途に使えます。

## C. 振る舞い（視線・動き）

### 10. 首振りとdriverの前提（CoreS3）

M5Stack CoreS3本体には、pan/tilt用のサーボは搭載されていません。サーボを接続していない場合は preferences の `driver.type` を `"none"` にします。`firmware/stackchan/drivers/none-driver.ts` の `NoneDriver` は `applyRotation()` が何もせず、`getRotation()` は常に回転0（`{ y: 0, p: 0, r: 0 }`）を返す実装で、この設定では首は物理的に動きません。

実際にサーボを接続する場合は `scservo`/`dynamixel`/`pwm`/`rs30x`/`m5stackchan` のいずれかを選択します。詳細は [`./04-physical-customization.md`](./04-physical-customization.md) を参照してください。

### 11. lookAt / lookAway の仕組み

```ts
// firmware/stackchan/robot.ts
robot.lookAt([x, y, z]) // メートル単位の注視点。同期的に完了し、実際の移動はここでは起きない
robot.lookAway()        // 注視点を解除
```

`lookAt()`/`lookAway()` は注視点の座標（またはnull）を保存するだけです。実際の動きは、`robot.ts` の2つの周期処理が担っています。

- **顔の更新（約30fps、`INTERVAL_FACE = 1000 / 30`）**: `updateFace()` が注視点から目の `gazeX`/`gazeY` を計算し、目が先に注視点の方向を向きます。
- **姿勢の更新（約10fps、`INTERVAL_POSE = 1000 / 10`）**: `updatePose()` が現在の首の角度と注視点の角度差を計算し、`Math.PI / 6`（=30°）を超えていればdriverの `applyRotation()` を呼んで首を物理的に動かします。角度差が30°以内なら首は動かず、目の動きだけで追従します。

CoreS3本体＋`driver.type: "none"` の構成では、`applyRotation()` が何もしないため首は動かず、「目だけが注視点方向を向く」動きになります。これに加えて、A章のBreath Motionにより顔全体が常時ゆっくり上下に揺れます（この揺れは注視点とは無関係の演出です）。

### 12. 視線の実例

- **ランダム視線**: `firmware/mods/look_around/mod.js`。`Timer.repeat(..., 5000)` で5秒おきにランダムな座標へ `lookAt()` し、ボタンAのトグルでON/OFFできます。動き自体の実装はRobot内部（11章）が担うため、MOD側はランダムな座標を渡すだけの薄いラッパーです。
- **顔追従**: `firmware/mods/face_tracker/mod.js`。M5Stack UnitV2からHTTPで顔座標を受信し、`lookAt()` に変換します。`onRobotCreated(robot, device)` の第2引数 `device` を使ってUnitV2にHTTPリクエストを送る例になっています。
- **感情連動の動き**: `emotion`（`setEmotion()`）は表情描画のみに影響し、pan/tiltサーボを直接駆動する処理はありません。感情に応じて首も動かしたい場合は、MOD側で `setEmotion()` と `lookAt()`、あるいは `robot.driver.applyRotation()` を組み合わせて自分で実装する必要があります。

### 13. ポーズ直接制御

```ts
// firmware/stackchan/robot.ts
await robot.setPose(pose, time) // @experimental。内部でdriver.applyRotation(pose.rotation, time)を呼ぶ
await robot.setTorque(true)     // サーボのトルクON/OFF
robot.driver                    // 低レベルAPI（applyRotation/getRotation/setTorque）に直接アクセス
```

`setPose()` はJSDoc上 `@experimental` と明記されており、仕様が変わる可能性があります。より低レベルにdriverへ直接アクセスする実例は `firmware/mods/dynamixel/mod.js` にあり、`driver.applyRotation(ori)` を直接呼んで首を動かす／Dynamixelサーボ固有の `setOperatingMode`/`setGoalPosition`/`setGoalCurrent` などを使うパターンが確認できます。
