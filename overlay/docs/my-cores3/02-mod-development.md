# breath MOD 開発ガイド

breathing 固有の振る舞いは `overlay/mods/breath/` に実装します。ファイル構成は [`../../README.md`](../../README.md)、実機への反映方法は [`06-breath-firmware.md`](./06-breath-firmware.md) を参照してください。

## 実行経路

breath は MOD パーティション上の独立 MOD ではなく、ホストファームへ組み込まれます。

1. `manifest_breath_deploy.json` が `breath/mod` と依存モジュールを登録する
2. `stack-chan/firmware/stackchan/default-mods/mod.ts` が `breath/mod` を import する
3. `main.ts` は `breathHostMod` が有効なとき MOD パーティションを使用しない
4. Robot 作成後に `overlay/mods/breath/mod.js` の `onRobotCreated(robot)` を呼ぶ

`overlay/mods/breath/*.js` をファイルパスで直接 import せず、manifest の論理モジュール名を使います。新しいファイルを追加するときは `manifest_breath_deploy.json` の `modules` に登録し、たとえば `import ... from 'breath/example'` のように参照します。

## エントリーポイント

`overlay/mods/breath/mod.js` は `onRobotCreated(robot)` を export し、各機能を時間差で起動します。新しい機能は単独モジュールとして実装し、エントリーポイントでは初期化だけを行います。

```js
import { startExample } from 'breath/example'

export function onRobotCreated(robot) {
  try {
    startExample(robot)
  } catch (error) {
    trace(`[example] start failed: ${error}\n`)
  }
}
```

実際には既存機能との起動順や I/O 競合を考慮し、`mod.js` の段階起動へ追加します。長時間処理や待機で `onRobotCreated` を塞がないでください。

## 実装上の原則

- `robot` の公開 API は [`05-robot-api-reference.md`](./05-robot-api-reference.md) と現在の `stack-chan/firmware/stackchan/robot.ts` を確認する。
- CoreS3 固有のバッテリー・バックライト操作は `m5stackchan/battery` 経由にする。AXP2101 に別の SMBus を開かない。
- 音声入力と音声出力は I2S を共有する。再生処理は `breath/mic` の `suspendCapture()` / `resumeCapture()` と協調する。
- 非同期 API の失敗を未処理にしない。fire-and-forget の Promise にも reject ハンドラを付ける。
- PIU を使うモジュールはホスト manifest に登録する。MOD パーティションへ書く補助 MODでは native モジュールを利用できない。
- 設定値は入力を検証・クランプし、共有の `breath/param-store` を使って `Preference` に保存する。
- 音声内容は保存・解釈せず、マイクのレベル値と検出イベントだけを扱う。

## CoreS3 のスワイプ入力

CoreS3 target が既定で選ぶ非同期 FT6x06 ドライバでは、Piu に押下・解放は届いても移動中の座標が届かず、スワイプ変位が常に 0 になる場合があります。breath の `m5stackchan_cores3` platform は、同期 FT6x06 を `m5stackchan/ft6206-polling` という別名で登録し、専用ラッパーから直接参照します。Piu が約 16 ms 間隔で同じタッチインスタンスを読み、スワイプ座標を継続取得するためです。

SDK の `embedded:sensor/Touch/FT6x06` を manifest で同名上書きするだけでは、include の解決順によって target 側の `ft6206_async.js` が勝つことがあります。ドライバを切り替える場合は、ビルドログのモジュール名だけでなく、生成 makefile が参照する実ファイルも確認します。

```bash
rg -n "ft6206(_async)?" ~/.local/share/moddable/build/tmp/esp32/m5stackchan_cores3/debug/stackchan/makefile
```

また、Piu がすでに FT6x06 の I2C アドレスを所有しているため、MOD や `main.ts` から別の Touch インスタンスを開いてはいけません。二重に開くと `RangeError: duplicate address` で起動できません。

## 現在のモジュール境界

| モジュール | 責務 |
|---|---|
| `mod.js` | 段階起動と呼吸ループ |
| `face/` | breath 専用の顔とレンダラー |
| `emotion.js` | valence / arousal 状態と表情修飾 |
| `liveliness.js` | 視線、深呼吸、murmur のスケジュール |
| `mic.js` | マイク特徴量とイベント検出 |
| `reactions.js` | マイクイベントへの反応 |
| `posture.js` | 感情姿勢と startle リコイル |
| `led.js` | 感情と呼吸に連動するヘッド LED |
| `cry.js` | 鳴き声の生成・再生 |
| `status-bar.js` / `settings-bar.js` | 状態表示と端末設定 |
| `dev/` | ログ、状態取得、パラメータ調整、OTA |

既存責務と重なる機能を別モジュールへ追加せず、担当モジュールの公開関数を通して接続します。

## ビルドと実機確認

日常の反映はリポジトリルートで行います。

```bash
overlay/scripts/ota-deploy.sh
```

スクリプトは buildId 付きで breath ホストをビルドし、OTA 転送後に `/status` の buildId を照合します。MOD パーティションだけを書き換えても、ホストに組み込まれた breath の変更は反映されません。

変更後は対象機能だけでなく、呼吸ループ、顔、マイク・音声、サーボ、開発サーバのうち影響する経路を確認します。利用できる単体テストがある場合は `stack-chan/firmware/` で `npm test` も実行します。
