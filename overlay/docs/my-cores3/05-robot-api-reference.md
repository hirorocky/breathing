# robot オブジェクト API早見表

このドキュメントは、MODの `onRobotCreated(robot, device)` などから使える `robot`（`firmware/stackchan/robot.ts` の `Robot` クラスのインスタンス）が持つ公開メソッド・プロパティをカテゴリ別の表にまとめたものです。索引は [`./README.md`](./README.md) を参照してください。MODの作り方全般は [`./02-mod-development.md`](./02-mod-development.md)、表情/声/視線の仕組みの詳細は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。

公開 API の正本は `stack-chan/firmware/stackchan/robot.ts` と関連する型定義です。本表と差がある場合はコードを優先してください。

## 1. 発話・音声

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `async say(text: string, volume?: number): Promise<Maybe<string>>` | TTS エンジンで `text` を発話する。完了時に `{ success: true, value: text }`、失敗時に `{ success: false, reason }` を返す。 | breath はこの API を使わず、非言語音を `cry.js` で再生する。`volume` は省略可。 |
| `async record(durationMilliSec?: number): Promise<ArrayBuffer>` | マイクから録音し、WAVフォーマットの `ArrayBuffer` を返す。 | `durationMilliSec` 省略時は内部実装（`Microphone#record`）の既定値（3000ms）。マイクが無い機体では `Error('This device does not support a microphone.')` を投げる。 |
| `async tone(hz: number, duration: number, volume?: number): Promise<void>` | 指定した周波数 `hz` ・時間 `duration`（ミリ秒）でトーン音を再生する。 | `volume` は0〜1。範囲外だと `Error('Volume must be between 0 and 1')` を投げる。再生完了まで待つ。 |
| `async playAudio(buffer: ArrayBuffer): Promise<boolean>` | 音声バッファをそのまま再生する。 | 内部で `tone` オブジェクトの `play()` を呼ぶ。`play` が実装されていない場合は `false` を返す。`record()` で録った音声の再生などに使う。 |

## 2. 表情・見た目

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `setEmotion(emotion: Emotion): void` | ロボットの感情状態を設定する。 | `Emotion` は `NEUTRAL` / `ANGRY` / `SAD` / `HAPPY` / `SLEEPY` / `DOUBTFUL` / `COLD` / `HOT` の8種（`firmware/stackchan/renderers-piu/face-context.ts`）。内部状態を即座に書き換えるだけで、実際の描画反映は約30fpsの `updateFace()` で行われる。 |
| `setMouthOpen(value: number): void` | 口の開き具合を直接指定する。 | `value` は0〜1。範囲外だと `Error('value must be between 0 and 1')` を投げる。`say()` 中は自動リップシンクで上書きされる。 |
| `setColor(key: 'primary' \| 'secondary', r: number, g: number, b: number): void` | 顔のテーマカラーを設定する。 | `r`/`g`/`b` は0〜255。内部で `#rrggbb` 形式のhex文字列に変換される。 |
| `showBalloon(text: string, option?: { left?: number; right?: number; top?: number; bottom?: number; width?: number; height?: number }): void` | 吹き出しを表示する。 | `option` 省略時は既定で `{ right: 20, top: 10, width: 80 }`。既に表示中の吹き出しがあれば先に `hideBalloon()` される。 |
| `hideBalloon(): void` | 吹き出しを非表示にする。 | 表示中でなければ何もしない。 |

## 3. 視線・姿勢

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `lookAt(position: Vector3): void` | 注視点を設定する。`Vector3` は `[x, y, z]`（メートル単位）。 | 同期的に完了し、この関数自体は動きの開始/終了を知らない。実際の目・首の動きは内部の周期処理（`updateFace()` / `updatePose()`）が担う。breath での接続は [`03-face-voice-behavior.md`](./03-face-voice-behavior.md) の「視線と姿勢」を参照する。 |
| `lookAway(): void` | 注視点を解除する。 | 以降、目・首は注視点方向を追わなくなる。 |
| `async setPose(pose: Pose, time?: number): Promise<void>` | ポーズ（`Rotation`）を直接設定する。**`@experimental`**（仕様変更の可能性あり）。 | 内部で `driver.applyRotation(pose.rotation, time)` を呼ぶだけの薄いラッパー。`Pose` は `{ position: {x,y,z}, rotation: {r,p,y} }`（`firmware/stackchan/utilities/stackchan-util.ts`）。 |
| `async setTorque(torque: boolean): Promise<void>` | サーボのトルクON/OFFを設定する。 | 内部で `driver.setTorque(torque)` を呼ぶ。 |
| `get pose` | 現在のポーズ（body/eyes）を返す。 | 型は `{ body: Pose; eyes: { left: Pose; right: Pose } }`。読み取り専用として使うこと（直接書き換えても反映される保証はrobot.tsのコードからは確認できない）。 |
| `get driver: Driver` | 低レベルのdriverインスタンスを返す。 | `Driver` 型は `applyRotation(ori, time?)` / `getRotation()` / `setTorque(torque)` / `onAttached?` / `onDetached?` を持つ。`setPose`/`setTorque` より細かい制御が必要な場合に直接呼ぶ（例: `firmware/stackchan/default-mods/on-robot-created.ts` のサーボテスト実装）。 |

## 4. ボタン・センサー

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `get button` | ボタン一覧（`{ a, b, c, power }`、それぞれ `Button` 型）を返す。 | `Button` は `{ onChanged: (this: Digital) => void }`。機体によって存在しないボタンもあるため、使う前に `robot.button.a != null` 等の存在チェックが必要。 |
| `get touch` | タッチ（単純なXY座標のタッチパネル、`Touch` クラス）インスタンスを返す。 | `onTouchBegan(x, y, ticks)` / `onTouchMoved(x, y, ticks)` / `onTouchEnded(x, y, ticks)` のコールバックを持つ（`firmware/stackchan/touch.ts`）。 |
| `get touchPanel: TouchPanel \| undefined` | ジェスチャー認識付きのタッチパネル（例: Si12T）インスタンスを返す。存在しない機体では `undefined`。 | `onGesture: (gesture: TouchPanelGesture) => void` を持つ。`TouchPanelGesture = { type, sample, ticks }`、`type` は `'press' \| 'release' \| 'forwardSwipe' \| 'backwardSwipe'`（`firmware/stackchan/touch-panel-gesture.ts`）。 |
| `get imu: IMU \| undefined` | IMU（慣性センサー）インスタンスを返す。存在しない機体では `undefined`。 | `start()` を呼ぶまで動作しない。`onMotionDetect: (type: MotionType) => void` を持つ。`MotionType` は `'shake' \| 'fallenForward' \| 'fallenBackward' \| 'fallenLeft' \| 'fallenRight' \| 'upsideDown'`（`firmware/stackchan/imu-motion.ts`）。 |
| `get microphone` | マイクインスタンスを返す。 | `record(durationMilliSec?)` のほか `start()`/`stop()`/`onReadable` を持つ（`firmware/stackchan/microphone.ts`）。基本は `robot.record()` 経由で使えば十分。 |
| `get camera` | カメラインスタンス（`RobotCamera`）を返す。 | `start(options?)` / `stop()` / `capture(options?)` を持つ。`options` は `{ width?, height?, imageType?: 'rgb565le'\|'yuv422'\|'jpeg', useBrowserCamera? }`。カメラを持たない機体でも常に `NULL_CAMERA`（何もしないダミー実装）が入っており、`undefined` にはならない。使用例は `firmware/stackchan/default-mods/on-robot-created.ts` の `runCameraPreview`。 |

## 5. LED

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number): void` | 指定したLEDを指定色で点灯する。 | `r`/`g`/`b` は0〜255。`duration`（ミリ秒）・`index`（開始位置）・`count`（対象数）は省略可。存在しない `ledName` を指定した場合は何もしない。 |
| `lightOff(ledName: string, index?: number, count?: number): void` | 指定したLEDを消灯する。 | `index`/`count` を省略すると全LEDが対象。 |
| `lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number): void` | 指定した色・間隔でLEDを点滅させる。 | `duration` は点滅間隔（ミリ秒）で省略不可。 |
| `lightRainbow(ledName: string, index?: number, count?: number): void` | 指定したLEDにレインボー効果を表示する。 | 色指定はなし（内部でレインボーパターンを生成）。 |
| `get led` | 利用可能なLEDの `Record<string, Led>` を返す。 | `Object.keys(robot.led)` でLED名の一覧を取得できる（`firmware/stackchan/default-mods/on-robot-created.ts` のLEDテスト参照）。LEDが無い機体では空オブジェクト。 |

## 6. ライフサイクル・差し替え

| API（シグネチャ） | 説明 | 補足/例 |
| --- | --- | --- |
| `pause(): void` | ロボットの更新処理（`updateFace()`/`updatePose()`）を一時停止する。 | 停止中は表情・姿勢が更新されなくなる。 |
| `resume(): void` | `pause()` を解除する。 | |
| `useTTS(tts: TTS): void` | TTSエンジンを差し替える。 | `TTS` は `{ stream(text, volume?): Promise<void>; onPlayed?; onDone? }`。差し替え時、既存TTSの `onDone`/`onPlayed` コールバックは無効化され、新TTSにリップシンク用のコールバックが再設定される。 |
| `useDriver(driver: Driver): void` | サーボドライバを差し替える。 | 差し替え前のdriverの `onDetached?()` を呼び、新driverの `onAttached?()` を呼ぶ。 |
| `useRenderer(renderer: Renderer): void` | 表示レンダラーを差し替える。 | `Renderer` は `{ update(interval, faceContext); addDecorator(decorator); removeDecorator(decorator); application?; setFace?(face) }`。 |
| `get renderer: Renderer` | 現在のレンダラーインスタンスを返す。 | `addDecorator(decorator)`/`removeDecorator(decorator)` で吹き出しや絵文字エフェクトなどのPiuコンテンツを重ね合わせられる。`setFace?(face)` で顔テンプレート全体を差し替えられる（`firmware/stackchan/default-mods/on-robot-created.ts` のカメラプレビュー切り替え等で使用）。詳細は [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) 参照。 |
| `get application: DrawerButtonRegistry` | 画面のドロワー（設定引き出し）にボタンを追加/削除するためのレジストリを返す。 | `addDrawerButton({ key, label, callback, kind?, initialState? })` / `removeDrawerButton(key)` / `clearDrawerButtons()` / `setDrawerButtonState(key, active)`。`kind` は `'action' \| 'toggle'`（省略時は `'action'` 相当の扱い）。`callback` には `robot` 自身が渡される。使用例多数（`firmware/stackchan/default-mods/on-robot-created.ts`）。 |

## ボタンハンドラの共通パターン

`Button#onChanged` は `this`（`Digital` インスタンス）にバインドされたコールバックで、`this.read()` で現在の状態（押されているかどうか）を読む必要があります。

```ts
// firmware/stackchan/default-mods/on-robot-created.ts の実例に基づく
if (robot.button.a != null) {
  robot.button.a.onChanged = function () {
    if (!this.read()) {
      return
    }
    // ボタンAが押された時の処理
  }
}
```

存在しないボタンにアクセスするとエラーになりうるため、必ず `robot.button.x != null` で存在確認してから登録します。

## IMUモーション検知の例

```ts
// firmware/stackchan/default-mods/on-robot-created.ts の実例に基づく
if (robot.imu != null) {
  robot.imu.start() // start()を呼ぶまで検知は動かない
  robot.imu.onMotionDetect = (type) => {
    // type: 'shake' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'
    if (type === 'shake') {
      robot.setEmotion('HOT')
    }
  }
}
```

## 関連ドキュメント

- breath での顔、非言語音、視線、姿勢の接続は [`03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照する。
- breath MOD の構成と実装原則は [`02-mod-development.md`](./02-mod-development.md) を参照する。

## API ドキュメントの生成

`stack-chan/firmware/` で `npm run generate-apidoc` を実行すると、TSDoc から `firmware/docs/api/` を生成できます。
