# breath ファームウェア開発・実機運用ガイド

breathing 固有機能は `overlay/mods/breath/` に実装し、`stack-chan/firmware/stackchan/manifest_breath_deploy.json` からホストファームウェアへ組み込む。MOD パーティション単体の書き込みでは更新しない。

## 通常の更新（Wi-Fi OTA）

リポジトリルートで実行する。

```bash
overlay/scripts/ota-deploy.sh              # UDP ビーコンで IP を自動発見
overlay/scripts/ota-deploy.sh 192.168.1.50 # IP を明示
```

スクリプトは buildId 付きでビルドし、認証付き `PUT /ota` で転送した後、再起動後の `GET /status` で buildId の一致を確認する。IP は DHCP で変わり得るため、通常は引数なしで実行する。

スクリプトはreleaseホストをビルドし、ビルド時間、転送時間・サイズ・速度と、実機が返す受信回数・受信サイズ・Flash書き込み回数・累積書き込み時間を表示する。breath 専用releaseホストは約 2.68 MB。Flash書き込みは約22〜24秒であり、受信チャンクは常駐バッファへまとめず到着単位でFlashへ書き込む。

### デプロイ前の生成物確認（必須）

`mcconfig -t deploy`は増分ビルドの古いXSB／JSを再利用することがある。ソースを変更したのに実機が変わらない場合は、デプロイを繰り返さず、対象ビルドを削除してから必ず build → 生成物確認 → deploy の順にする。

```bash
rm -rf vendor/moddable/build/tmp/esp32/m5stackchan_cores3/release/stackchan
MODDABLE="$PWD/../../vendor/moddable" \
  /Users/hiro/.local/share/moddable/build/bin/mac/release/mcconfig \
  -m -p esp32:./platforms/m5stackchan_cores3 -t build \
  "$PWD/stackchan/manifest_breath_deploy.json"
```

build後に次を確認する。

- `manifest_flat.json`と`mc.xs.c`の`startupSound`が`false`
- `tsc/*/deploy-notice.js`が最新ソースの内容（`font: '20px Open Sans'`、通知遅延、`UPDATED shown`）になっている
- `modules/setup/target.xsb`のタイムスタンプがsetup-target変更後である

この確認を省略してdeployだけを繰り返してはいけない。書き込みログが成功しても、古いバイナリなら実機の表示・音は変わらない。

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

### native変更時の短縮コマンド

Moddable の native 層を変更した場合は、リポジトリルートから次のコマンドを使う。vendor SDK の指定、Biome/TypeScript check、release ビルドキャッシュの削除、生成物検証、USB deploy を一つにまとめているため、長い環境変数付き `mcconfig` を手入力しない。

```bash
overlay/scripts/native-deploy.sh                         # USBポートを自動検出
overlay/scripts/native-deploy.sh --port /dev/cu.usbmodem101
overlay/scripts/native-deploy.sh --build-only            # 書き込み前の生成物確認だけ
```

このスクリプトは `npm run erase-flash` を呼ばず、生成された release ビルドディレクトリだけを削除する。`--build-only` でも `startupSound: false` と `deploy-notice` の生成を検査する。native 変更以外の日常更新は、引き続き Wi-Fi OTA を使う。

## ホストへの組み込み

- `manifest_breath_deploy.json` は `manifest_breath_lean.json` を読み込み、breath に必要なネットワーク、HTTP、Piu、音声、サーボ、LED、開発APIだけをホストへ含める。
- エントリーポイントは `main-breath.ts`。Wi-Fiと開発APIを先に起動してから、breath用のRobotを構築する。初期化失敗は `/status` の `bootError` で確認できる。
- 起動時のdeploy通知は無音で、画面に `UPDATED` を2.5秒表示し、ヘッドLEDを虹色に点灯してから通常表示へ戻す。通知は `deploy-notice.ts` が担当し、音声再生は行わない。
- CoreS3のSDK標準`startupSound`（`bflatmajor.maud`）がリセット直後に鳴るため、breath manifestでは`startupSound: false`にする。`Robot.tone`と`breath/cry.ts`の明示的な再生は通常機能として維持する。
- 通常OTAはreleaseホストを使う。デバッグ用の `build:breath:m5stackchan-cores3` / `deploy:breath:m5stackchan-cores3` はUSBシリアルでXS例外を調べる場合だけ使う。
- `breath-policy-loader.ts` はハードウェア非依存の `breath-policy/*` MODをAPI versionで検証する。不在時は `builtin`、互換時は `active`、検証失敗時は `rejected` として内蔵policyを使う。状態は `/status` の `policy` で確認する。
- `manifest_breath_deploy.json` は `breathHostMod: true` とし、MOD パーティションによる上書きを無効にする。
- overlay の各モジュールは manifest の `modules` に論理名で登録する。
- `stack-chan/firmware/stackchan/default-mods/mod.ts` は `breath/mod` を import する。
- overlay のファイルパスを TypeScript から直接 import しない。実機でモジュール登録されず起動に失敗する。

MOD パーティションのアーカイブはホストのモジュール構成と一致する必要がある。軽量ホストで起動直後に `mod failed` となる場合は通常運用の範囲外なので、全Flash消去は行わず作業を止め、MOD領域だけを確認する。`breath-clear` は通常ホスト用の空MODを書き込む補助手段であり、物理的に空のパーティションを作るものではない。

## policy MOD の更新

ハードウェア非依存の `overlay/mods/breath-policy/` だけを変更した場合は、ホストを更新せずpolicy MODをWi-Fiで更新できる。

```bash
overlay/scripts/policy-deploy.sh --build-only       # release XSAの生成だけ
overlay/scripts/policy-deploy.sh                    # ビーコンでIPを発見して更新
overlay/scripts/policy-deploy.sh 192.168.1.50       # IPを明示して更新
overlay/scripts/policy-deploy.sh --disable          # 外部policyを無効化してbuiltinへ戻す
```

スクリプトは `meta.ts` のAPI version、host API範囲、schema versionを読み、Git短縮hashとビルド時刻から一意なbuildIdを生成して `mod/config` とHTTP headerの両方へ設定する。更新時は実行中のXSAを同じVMから書き換えないよう、最初に認証付き `DELETE /policy` で無効化し、再起動後の `state: "disabled"` を確認してから `PUT /policy` する。PUT後は再び再起動を待ち、`/status.policy` が `state: "active"` かつ同じ `modBuildId` になるまで確認する。`--disable` はXSAを消去せず、disabled確認後に終了する。開発トークンを既定値から変えた場合は `BREATH_DEV_TOKEN` 環境変数へ同じ値を設定する。

policy以外のoverlay、ホストAPI、ドライバー、リソースを変更した場合は `ota-deploy.sh` でホスト全体を更新する。

通常ホストへ戻す必要がある場合だけ、`stack-chan/firmware/` で次を実行する。

```bash
npm run mod:m5stackchan-cores3 -- ../../overlay/mods/breath-clear/manifest.json
```

## 開発用ネットワーク機能

`breathDevTools` が有効なファームでは次を利用できる。

```bash
overlay/scripts/logs.sh                 # UDP 8686: trace（画面表示）
overlay/scripts/logs.sh 8686 logs.jsonl # UDP 8686: trace（保存）
overlay/scripts/stackchan-ip.sh  # UDP 8687: IP 発見
overlay/scripts/mic-monitor.sh   # UDP 8688: マイクレベル
curl http://$(overlay/scripts/stackchan-ip.sh)/status
```

ビーコンと trace の既定送信先は `255.255.255.255`。サブネットを `/24` と仮定したブロードキャストアドレスを使わない。HTTP サーバは `embedded:network/http/server` のコールバック実装を維持し、数 MB の OTA 本体をメモリへ全量保持しない。

### xsbugを使わないリモートデバッグ

通常の開発では xsbug を起動せず、UDP trace と HTTP `/status` を使う。UDP の各行には `seq`、`uptimeMs`、`buildId` が付くため、`logs.jsonl`を保存して再起動前後のログを時系列で追える。UDPは到達保証を持たないので、現在値の確認には必ず `/status`を併用する。

`/status`の`boot`は次を示す。

| 項目 | 意味 |
|---|---|
| `id` | 現在の起動識別子 |
| `startedAtMs` | 起動から開発ツール初期化までの経過時間 |
| `healthy` | Robot初期化まで完了したか |
| `lastHeartbeatMs` | 開発ツールが最後に生存を記録した時刻 |
| `previousCompleted` | 直前の起動が正常完了マーカーを残したか。`false`なら前回は起動途中で停止した可能性がある |

起動完了後は5秒ごとにheartbeatを更新し、Robot初期化完了時に正常完了マーカーを保存する。したがって、Wi-Fi接続後に`healthy:false`のまま再起動した場合や、次回起動で`previousCompleted:false`になった場合は、前回起動の途中停止を疑う。native層のpanicやWi-Fi接続前の停止はUDPを送れないため、必要な場合だけUSBシリアルでブートログを採取する。

基本的な確認手順:

```bash
overlay/scripts/logs.sh 8686 logs.jsonl &
DEVICE_IP="$(overlay/scripts/stackchan-ip.sh)"
curl -fsS -H 'x-dev-token: breath-dev' "http://${DEVICE_IP}/status" | jq .
```

ログを止めるときは、受信スクリプトのプロセスだけを終了する。デバイス側のUDP送信失敗は本体のtraceや呼吸ループを停止させない設計になっている。

デプロイ通知の診断は、再起動後に`/status`の`boot.deployNotice`を確認する。

```json
{"scheduled":true,"shown":true,"error":null}
```

`shown:false`の場合は`error`を先に確認する。今回のように`font not found`が出ている場合は、SDKに存在する20px/16pxのOpen Sansだけを使う。`scheduled:false`の場合は、実際に起動しているMODがbreath版でないか、生成物へ通知モジュールが登録されていない。

状態取得系は GET、更新・テスト系は manifest の `config.devToken` と一致する `x-dev-token` が必要。利用可能な経路は `overlay/mods/breath/dev/dev-server.ts` の `ROUTES` と各プレフィックスを正とする。

## 実装上の制約

- AXP2101（I2C `0x34`）へ MOD から直接 SMBus を開かない。`m5stackchan/battery` の API を使う。
- バッテリー値は `readBatterySample()`、バックライトは `setBacklightVoltage()` / `getBacklightVoltage()` を使う。
- 電源ボタンの長押しは AXP2101 のハードウェア即時断を使わず、長押し IRQ を直接ポーリングする。`breath/power.ts` が PY32 の LED RAM を消去し、サーボを停止してからソフトウェア電源OFFする。
- 意図的な電源OFFは Preference に記録する。USB充電開始ではAXP2101の仕様により一度起動するが、VBUS起動を検出すると直ちに再OFFする。次の電源ボタン起動では記録を解除して通常起動する。
- CoreS3 のスピーカー出力とマイク入力は I2S クロックを共有する。音声再生時は `mic.ts` の `suspendCapture()` / `resumeCapture()` を介する。
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

音量と画面輝度は `Preference`、LEDは `led.ts` のパラメータストアへ保存する。感情面は動的な現在状態を `setEmotionState()` で移動し、その後は感情エンジンの変化を継続する。

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
| USB接続中の電源OFFでヘッドLEDが残る | AXP2101の長押しIRQ有効化、`breath/power.ts`、`stopLed()`、OFFLEVELハードウェア断の無効化を確認する |
| 電源OFF中にUSBを挿すと一瞬起動する | AXP2101のVBUS起動仕様。意図的OFFの記録があれば直ちに再OFFするのが正常。電源ボタンで起動すれば通常稼働する |
| マイク値が 0 のまま | 音声出力後に capture を stop/start する。通常は `mic.ts` の復旧処理に任せる |
| 左右マイク値が同一 | build 後の `mc.defines.h` で `MODDEF_AUDIOIN_NUMCHANNELS (2)` を確認する |

環境構築や Moddable SDK 自体の問題は [`01-environment-and-build.md`](./01-environment-and-build.md) を参照する。
