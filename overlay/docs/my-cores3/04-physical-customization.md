# K151-R の物理構成と安全

所有機は M5Stack StackChan Remote Controller Kit（K151-R）。CoreS3、SCS0009 サーボ 2 台、StackChan 拡張基板、12 個のヘッド LED、ESP-NOW リモコンで構成する。

## サーボと配線

breath manifest の設定は次のとおり。

| 項目 | 値 |
|---|---|
| driver | `m5stackchan` |
| pan（足側） | ID 1 |
| tilt（顔側） | ID 2 |
| UART | port 1、TX GPIO6、RX GPIO7、1 Mbps |
| 正面補正 | yaw raw 460、pitch raw 620 |

2 台は信号線を共有するため、サーボ ID を重複させない。正面のずれは `stack-chan/firmware/stackchan/manifest_breath_deploy.json` の `yawZeroPosition` / `pitchZeroPosition` で補正する。

サーボは StackChan 拡張基板を介して接続する。CoreS3 の Grove PORT.A は I2C 拡張用であり、サーボ UART の接続先ではない。

## 電源と LED

- AXP2101（I2C `0x34`）は CoreS3 の電源管理 IC。
- PY32（I2C `0x6F`）はサーボ電源と 12 個のヘッド LED を制御する。
- 専用サブプラットフォーム `m5stackchan_cores3` を使う。汎用 CoreS3 ターゲットでは拡張基板の電源と LED の設定が含まれない。
- AXP2101 へ追加で直接 I2C/SMBus を開かない。breath からのバッテリー取得とバックライト制御は `m5stackchan/battery` を使う。

配線確認には `stack-chan/firmware/mods/m5stackchan_smoke/` と [`m5stackchan-cores3-smoke.md`](../../../stack-chan/firmware/docs/m5stackchan-cores3-smoke.md) を使う。サーボを動かす前に、可動範囲から手や物を離す。

## 安全

- 通電・トルク有効時に首を手で無理に動かさない。
- ケースとケーブルに干渉しない範囲で動かす。取り付けや補正値の変更後は、小さい角度から確認する。
- 配線を変更するときは電源を切る。コネクタの向き、サーボ ID、電源系統を確認してから通電する。
- 膨張、変形、発熱したバッテリーは使用しない。短絡や過放電を避ける。
- スモークテストをケース外で行う場合は、サーボを固定して予期しない回転に備える。

基板設計は [`stack-chan/schematics/`](../../../stack-chan/schematics/)、ケース資料は [`stack-chan/case/`](../../../stack-chan/case/) を参照する。
