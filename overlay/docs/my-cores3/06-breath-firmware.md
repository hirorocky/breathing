# breath ファームウェア開発・実機運用ガイド

breathing 固有機能は `overlay/mods/breath/` に実装し、`stack-chan/firmware/stackchan/manifest_breath_deploy.json` からホストファームウェアへ組み込む。MOD パーティション単体の書き込みでは更新しない。

## 通常の更新（Wi-Fi OTA）

リポジトリルートで実行する。

```bash
overlay/scripts/ota-deploy.sh              # UDP ビーコンで IP を自動発見
overlay/scripts/ota-deploy.sh 192.168.1.50 # IP を明示
```

スクリプトは buildId 付きでビルドし、認証付き `PUT /ota` で転送した後、再起動後の `GET /status` で buildId の一致を確認する。IP は DHCP で変わり得るため、通常は引数なしで実行する。

OTA は `manifest_breath_deploy.json` の `defines.ota.autosplit` を前提とする。対象機がこのパーティション構成になっていない場合、または Wi-Fi 経路が使えない場合は USB 復旧を行う。

## USB 復旧

`stack-chan/firmware/` で、必ず build の後に breath 用 deploy を実行する。

```bash
pkill -f serial2xsbug 2>/dev/null || true
npm run build:breath:m5stackchan-cores3
npm run deploy:breath:m5stackchan-cores3
```

- `deploy:m5stackchan-cores3` は通常の StackChan 用であり、breath には使わない。
- `npm run erase-flash` は実行しない。NVS の Wi-Fi 設定と OTA 状態を消去するため、必要に見える場合は作業を止めて原因を確認する。
- `overlay/` の変更を増分ビルドが拾わないことがある。反映されない場合は再度 build し、次のバイナリがソースより新しいことを確認してから deploy する。

```text
~/.local/share/moddable/build/tmp/esp32/m5stackchan_cores3/debug/stackchan/xsProj-esp32s3/build/xs_esp32.bin
```

ビルドディレクトリを消す場合も、削除後に必ず build を行ってから deploy する。

## ホストへの組み込み

- `manifest_breath_deploy.json` は `breathHostMod: true` とし、MOD パーティションによる上書きを無効にする。
- overlay の各モジュールは manifest の `modules` に論理名で登録する。
- `stack-chan/firmware/stackchan/default-mods/mod.ts` は `breath/mod` を import する。
- overlay のファイルパスを TypeScript から直接 import しない。実機でモジュール登録されず起動に失敗する。

MOD パーティションを空にする必要がある場合だけ、`stack-chan/firmware/` で次を実行する。

```bash
npm run mod:m5stackchan-cores3 -- ../../overlay/mods/breath-clear/manifest.json
```

## 開発用ネットワーク機能

`breathDevTools` が有効なファームでは次を利用できる。

```bash
overlay/scripts/logs.sh          # UDP 8686: trace
overlay/scripts/stackchan-ip.sh  # UDP 8687: IP 発見
overlay/scripts/mic-monitor.sh   # UDP 8688: マイクレベル
curl http://$(overlay/scripts/stackchan-ip.sh)/status
```

ビーコンと trace の既定送信先は `255.255.255.255`。サブネットを `/24` と仮定したブロードキャストアドレスを使わない。HTTP サーバは `embedded:network/http/server` のコールバック実装を維持し、数 MB の OTA 本体をメモリへ全量保持しない。

状態取得系は GET、更新・テスト系は manifest の `config.devToken` と一致する `x-dev-token` が必要。利用可能な経路は `overlay/mods/breath/dev/dev-server.js` の `ROUTES` と各プレフィックスを正とする。

## 実装上の制約

- AXP2101（I2C `0x34`）へ MOD から直接 SMBus を開かない。`m5stackchan/battery` の API を使う。
- バッテリー値は `readBatterySample()`、バックライトは `setBacklightVoltage()` / `getBacklightVoltage()` を使う。
- 電源ボタンの長押しは AXP2101 のハードウェア即時断を使わず、長押し IRQ を直接ポーリングする。`breath/power.js` が PY32 の LED RAM を消去し、サーボを停止してからソフトウェア電源OFFする。
- 意図的な電源OFFは Preference に記録する。USB充電開始ではAXP2101の仕様により一度起動するが、VBUS起動を検出すると直ちに再OFFする。次の電源ボタン起動では記録を解除して通常起動する。
- CoreS3 のスピーカー出力とマイク入力は I2S クロックを共有する。音声再生時は `mic.js` の `suspendCapture()` / `resumeCapture()` を介する。
- `manifest_breath_deploy.json` の `defines.audioIn.numChannels: 2` と `sampleRate: 48000` を維持する。
- 全画面の active なタッチオーバーレイを追加しない。タッチ領域は必要最小限にし、一つずつ実機確認する。
- `setTorque(false)` は UART 応答待ちで watchdog 再起動を招く可能性がある。使用する場合はタイムアウトを設け、実機で確認する。

## 実機設定UI

画面下端から上へスワイプすると全画面の設定メニューを開く。1層目で項目を選び、2層目で値を直接変更する。

| 項目 | 設定 |
|---|---|
| `VOLUME` | 0〜8。0はミュート |
| `SCREEN` | 1〜8 |
| `LED` | 0、0.5、1〜8。0は完全消灯。0.5はRGB565の色を保ちながら点灯幅を絞った微光 |
| `EMOTION` | 横軸 valence（−1〜1）、縦軸 arousal（−1〜1）の面をタップまたはドラッグ |

音量と画面輝度は `Preference`、LEDは `led.js` のパラメータストアへ保存する。感情面は動的な現在状態を `setEmotionState()` で移動し、その後は感情エンジンの変化を継続する。

## トラブルシューティング

| 症状 | 確認・対処 |
|---|---|
| breath ではなくドロワー UI が出る | breath 用コマンド、`breathHostMod`、`default-mods/mod.ts` の import を確認する |
| 画面が白い | manifest の `breath/mod` 登録と import を確認する |
| OTA 後の buildId が一致しない | 電源・Wi-Fi・現在の IP を確認し、`logs.sh` と `stackchan-ip.sh` で起動状態を調べる。未対応パーティションなら USB 復旧する |
| `PUT /ota` が 401 | `x-dev-token` と manifest の `config.devToken` を一致させる |
| USB で `No serial data received` | `serial2xsbug` を終了し、必要なら本体を物理リセットする |
| 変更が反映されない | build を再実行し、生成バイナリの時刻を確認してから deploy する |
| AXP2101 で duplicate address | 直接 I2C/SMBus を開かず `m5stackchan/battery` を使う |
| USB接続中の電源OFFでヘッドLEDが残る | AXP2101の長押しIRQ有効化、`breath/power.js`、`stopLed()`、OFFLEVELハードウェア断の無効化を確認する |
| 電源OFF中にUSBを挿すと一瞬起動する | AXP2101のVBUS起動仕様。意図的OFFの記録があれば直ちに再OFFするのが正常。電源ボタンで起動すれば通常稼働する |
| マイク値が 0 のまま | 音声出力後に capture を stop/start する。通常は `mic.js` の復旧処理に任せる |
| 左右マイク値が同一 | build 後の `mc.defines.h` で `MODDEF_AUDIOIN_NUMCHANNELS (2)` を確認する |

環境構築や Moddable SDK 自体の問題は [`01-environment-and-build.md`](./01-environment-and-build.md) を参照する。
