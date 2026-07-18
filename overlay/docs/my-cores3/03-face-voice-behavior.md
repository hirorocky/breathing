# breath の顔・声・振る舞い

この文書は breathing で現在使う表現経路を示します。標準 StackChan の AI Agent、TTS、ドロワー UI は使用しません。探求上の判断は [`../../../docs/concept/`](../../../docs/concept/) を起点にし、実装状況は [`../../../docs/tasks/`](../../../docs/tasks/) を確認してください。

## 顔

breath 専用レンダラーは `overlay/mods/breath/face/` にあります。

| ファイル | 役割 |
|---|---|
| `renderer-breath.js` | `BreathFace` を StackChan の Renderer 契約へ接続 |
| `breath-face.js` | 320 × 240 画面上に左右の目を配置し、まばたきを構成 |
| `eye-cozmo.js` | 角丸矩形の目、呼吸脈動、視線、漂い、表情用まぶたを描画 |

`manifest_breath_deploy.json` がこれらをホストモジュールとして登録し、`main.ts` は `breathHostMod` の既定 renderer に `breath` を選びます。

顔は黒背景、白い目2つ、口なしです。呼吸ループは `robot.setMouthOpen()` を内部信号として使いますが、口を描画するためではなく、目の脈動へ渡すために使います。`FaceBase` からまばたきと視線の状態伝播を利用し、標準顔の独立した breath motion は重ねません。

感情状態は `emotion.js` が管理し、`eye-cozmo.js` の上まぶた表現へ接続します。顔の形や感情表現を変える場合は、標準 renderer ではなくこの3ファイルと `emotion.js` の接続を確認します。

## 声

breathing では文章読み上げや TTS を使わず、`overlay/mods/breath/cry.js` の短い非言語音だけを使います。

- 種類は `murmur`、`sigh`、`startle`、`touch`
- PCM は端末上で生成し、再生後に次の変奏を生成する
- 出力は `embedded:io/audio/out` を使う
- マイク入力と I2S を共有するため、再生前後に `breath/mic` の capture を suspend / resume する
- 音量設定とレシピは Preference および開発 API から調整する

鳴き声のレシピを変更するときは、端末実装 `cry.js` と試作用 `overlay/tools/cry/synth.py` の対応を確認します。文章発話、外部 TTS、リップシンクは breath の実装経路ではありません。

## 呼吸と生存感

`mod.js` の呼吸ループは吸気4秒・呼気6秒を基準に小さく揺らし、目の脈動へ渡します。`liveliness.js` は通常呼吸を置き換えず、視線の微揺らぎ、深呼吸、まれな murmur を重ねます。

`emotion.js` は valence / arousal を保持し、呼吸速度、顔、姿勢、LED の修飾値を提供します。状態変化を追加するときは、一つのイベントから複数表現を直接操作せず、感情状態または各担当モジュールの公開 API を介して接続します。

## 音への反応

`mic.js` はステレオマイクから短い窓のレベルと特徴量を計算し、`loud`、`clap`、`voice`、`silence` などのイベントを通知します。音声内容は扱いません。

`reactions.js` はイベントを購読し、驚き、方向付きの一瞥、反応抑制を担当します。新しい反応は連続発火、マイク再開、鳴き声やサーボとの競合を考慮してここへ追加します。

## 視線と姿勢

- 視線: `liveliness.js` と `reactions.js` が `robot.lookAt()` / `lookAway()` を使う
- 首の視線追従: StackChan 本体の `updatePose()` が `gazeServoFollowDeg` の閾値を超えた注視方向へ追従する
- 感情姿勢: `posture.js` が pitch を低頻度かつゆっくり変更する
- 驚き: `posture.js` の recoil が一時的に頭を動かす

`manifest_breath_deploy.json` は `driver.type: "m5stackchan"` とサーボの UART・ID・ゼロ位置を設定します。サーボ操作は `setTorque()` / `setPose()` の失敗を必ず処理し、多重動作を避けます。姿勢の座標・可動域は [`04-physical-customization.md`](./04-physical-customization.md) も参照してください。

## LED

`led.js` はヘッド LED を感情の環境光として使い、呼吸に合わせて明るさをわずかに変化させます。強い通知や状態表示には使わず、顔・姿勢・音と同様に静かな同席感を優先します。

## 実装を変更するときの参照先

- モジュール構成と追加方法: [`02-mod-development.md`](./02-mod-development.md)
- Robot API: [`05-robot-api-reference.md`](./05-robot-api-reference.md)
- 実機への反映と診断: [`06-breath-firmware.md`](./06-breath-firmware.md)
- 表現設計: [`../../../docs/tasks/elegnt-expression-design.md`](../../../docs/tasks/elegnt-expression-design.md)
