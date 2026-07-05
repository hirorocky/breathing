# 物理カスタマイズ（ケース・サーボ・配線・安全）

このドキュメントは、stack-chanの「ケース」「サーボ」「配線」「電源」など物理的な構成要素と、それらの対応関係・安全上の注意をまとめたものです。索引は [`./README.md`](./README.md) を参照してください。ビルドのターゲット系統（標準CoreS3 / Stack-chan専用ボード構成）については [`./01-environment-and-build.md`](./01-environment-and-build.md) を、`driver.type: "none"` の場合の振る舞いについては [`./03-face-voice-behavior.md`](./03-face-voice-behavior.md) を参照してください。

## 0. 電子工作初心者へ（最初に）

stack-chanの物理カスタマイズは、はんだ付けや回路設計をほぼ必要としません。基本的には、3Dプリントされたケースにサーボモータを組み込み、コネクタ付きのケーブルで既製の基板（Stack-chan board）に接続するだけです。`schematics/`ディレクトリにある基板の設計データを自分で編集したり、基板そのものを自作する必要は通常ありません（詳細は9章）。

ただし、サーボモータや電源（バッテリー）を扱うため、ソフトウェアだけのカスタマイズとは異なる安全上の注意があります。これは9章「安全上の注意」に独立してまとめているので、作業前に必ず目を通してください。

## 1. ケース（筐体）

`case/`ディレクトリには、世代の異なる2系統のケースが存在します。

- `case/case_SG90/`, `case/case_RS30X/`, `case/case_SCS0009/`: 各サーボ専用の3Dプリントパーツ。**旧世代（v0）のケースで、M5Stack Core Basic/Gray/Go/Fire向け**です（対応基板は`v0.2.1`）。CoreS3との組み合わせについては明記されておらず、電気的に流用できる場合もありますが要検証です。
- `case/v1/`: 新世代（v1.0）のケース。組み立てガイドは `case/v1/dynamixel.md`（英語）/ `case/v1/dynamixel_ja.md`（日本語）です。**CoreS3を前提とした唯一の公式最新ケースですが、対応サーボはDYNAMIXEL XL330のみ**です。
- `case/backpack/`: バッテリーパック用のパーツ（v0系）。
- `case/contributed/`: コミュニティ提供の非公式ケース。

参考: `case/README.md` / `case/README_ja.md`。

**CoreS3ユーザーへの結論**: CoreS3向けにケースを新規に組むなら `case/v1/`（XL330前提）を使うのが最も確実です。手持ちの旧世代サーボ用ケース（SG-90/RS30X/SCS0009向け）を流用する場合は、寸法やStack-chan基板とのコネクタ互換性を自分で確認してください。

## 2. サーボの種類とドライバ

ファームウェアの `firmware/stackchan/drivers/` には、サーボの種類ごとに異なるドライバが実装されています。どのドライバを使うかは preferences の `driver.type` で切り替えます（切り替えの仕組みは `firmware/stackchan/main.ts` の `drivers` Mapが `driver.type` の文字列とドライバクラスを対応付けています）。

| `driver.type` | ドライバファイル | 対応サーボの例 | 通信方式 | 備考 |
| --- | --- | --- | --- | --- |
| `pwm` | `sg90-driver.ts` | SG-90 | PWM | 安価（~500円）。滑らかな角度制御が苦手で、突入電流でM5Stackが再起動することがある。トルクON/OFFを制御できない |
| `rs30x` | `rs30x-driver.ts` | RS304MD等（Futaba系） | シリアル（TTL） | 高機能・高価（~3,000円）。現在角度を読み取れる |
| `scservo` | `scservo-driver.ts` | SCS0009（Feetech系） | シリアル（TTL） | 工場出荷時のデフォルト設定を前提にした実装 |
| `dynamixel` | `dynamixel-driver.ts` | XL330（ROBOTIS） | 半二重シリアル | `case/v1/`ケースで推奨されているサーボ |
| `m5stackchan` | `m5stackchan-servo-driver.ts` | （SCServo系プロトコルのサーボ） | シリアル | **CoreS3専用ボード構成（`manifest_m5stackchan_cores3.json`）の既定**。PY32のI/Oエキスパンダ経由でサーボ電源をON/OFFする機能を内蔵している |
| `none` | `none-driver.ts` | サーボなし | - | `applyRotation()`が何もせず、`getRotation()`は常に回転0を返す。首は物理的に動かず、視線（目の動き）だけで注視点に追従する |

## 3. CoreS3のサーボ設定（実物の設定値）

Stack-chan専用ボード構成（`firmware/platforms/m5stackchan_cores3/`）向けのマニフェスト `firmware/stackchan/manifest_m5stackchan_cores3.json` には、次の`driver`設定が入っています。

```json
// firmware/stackchan/manifest_m5stackchan_cores3.json
"driver": {
  "type": "m5stackchan",
  "panId": 1,
  "tiltId": 2,
  "yawZeroPosition": 460,
  "pitchZeroPosition": 620,
  "serial": {
    "transmit": 6,
    "receive": 7,
    "port": 1,
    "baud": 1000000
  }
}
```

各項目の意味は次の通りです。

- `panId: 1` / `tiltId: 2`: サーボのID割り当てです。`panId`（左右回転、足側の軸）がID1、`tiltId`（上下回転、顔側の軸）がID2に対応します。この規約はケース側の規約（ID1=足、ID2=顔）と一致しています。
- `yawZeroPosition: 460` / `pitchZeroPosition: 620`: サーボが正面（中央）を向いた状態に対応する、サーボ側の生の位置値（raw position）の基準値です。サーボの取り付け角度に応じてこの値を調整することで、ソフトウェア側で正面判定を補正できます（4章参照）。
- `serial`: サーボとの通信設定です。UART1（`port: 1`）を使い、送信（`transmit`）がGPIO6、受信（`receive`）がGPIO7、通信速度（`baud`）は1Mbpsです。

**注意**: この`serial`設定は、CoreS3本体標準のGrove I2Cポート（PORT.A）とは別物です。専用のStack-chan拡張基板（`schematics/m5-pantilt/`）を介した配線に対応するピン設定です（5章参照）。

## 4. サーボID設定・キャリブレーション

2つのサーボは信号線を共有するため、事前にID割り当てが必須です（足側=ID1/pan、顔側=ID2/tilt）。設定方法はサーボの種類によって異なります。

### DYNAMIXEL XL330（`case/v1/`推奨構成）

PC側の**ROBOTIS Dynamixel Wizard2 + U2D2**（別売のUSB-シリアル変換アダプタ）を使ってID・ボーレートを設定します。工場出荷時はID=1、57600bpsなので、これをID1/ID2、1Mbpsに変更します。正式な手順は `case/v1/dynamixel.md`（英語）/ `case/v1/dynamixel_ja.md`（日本語）にまとまっているので、そちらに従ってください。

なお、ファームウェア側にも実験的なMOD `firmware/mods/dynamixel/mod.js` の `changeBaudrate()` 関数でボーレートを変更する手段がありますが、こちらは実験的な位置づけであり、公式の手順はPC側のDynamixel Wizard2を使う方法です。

### SCS0009 / SCServo系

Feetech公式のGUIツール「`FD.exe`」と、URT1というシリアル変換器を使い、`Goal`の値を511に設定して基準角度に合わせ、必要であればID（`Programming`タブ）を書き換えます。手順は `case/README.md`（英語）/ `case/README_ja.md`（日本語）の該当節を参照してください。

### ソフトウェア側での微調整

サーボの取り付け位置がわずかにズレて正面を向いていない場合、`firmware/stackchan/manifest_m5stackchan_cores3.json` の `yawZeroPosition` / `pitchZeroPosition` を書き換えることで、ソフトウェア側で正面判定を補正できます。

### キャリブレーション系MODについて（実験的機能）

- `firmware/mods/calibration/mod.js`: SCServo用のオフセット角度キャリブレーションMODです。ファイル冒頭のコメントに「This mod is under construction. setting pan/tilt offset does not work properly.（このMODは開発中で、pan/tiltオフセットの設定が正しく動作しない）」と明記されています。**未完成の実験的機能として扱ってください。**
- `firmware/mods/setup_rs30x/mod.js`: RS30X用のセットアップMODです。実装を確認すると、`robot.button.a.onChanged` に2つの関数を代入しているため、後から代入した2つ目（±10度の往復動作）だけが有効になり、1つ目で意図されていた `flashId(0x02)`（ID書き換え）を呼ぶコードパスは実質呼ばれません。**動作は実質「10度往復させるだけ」で、ID書き換え機能としては使えない状態です。**

## 5. 配線・ピン（初心者向け）

- **サーボ**: 専用のStack-chan拡張基板（`schematics/m5-pantilt/`）を介してUARTで接続します（3章の`serial`設定: TX=GPIO6, RX=GPIO7, 1Mbps）。CoreS3本体単体のGroveポートに直接挿すものではありません。
- **サーボ電源のON/OFF**: 物理的なスイッチや配線ではなく、ソフトウェア制御です。`firmware/stackchan/drivers/m5stackchan-servo-driver.ts` の `PY32ServoPower` クラスが、PY32というI/Oエキスパンダ（I2Cアドレス`0x6F`＝10進数で111）のピン0を介してサーボ電源をON/OFFします。Robotが接続・切断されるタイミング（`onAttached`/`onDetached`）で自動的に切り替わります。
- **M5Unit拡張（温湿度センサ等）**: **PORT.AのGroveポート（I2C）**に接続します（`firmware/mods/unit_temperature/README_ja.md`参照）。これはCoreS3本体標準のI2Cポートで、サーボ用のシリアル通信ポートとは別物です。

## 6. 電源（AXP2101、なぜ設定が必要か）

CoreS3には「AXP2101」というPMIC（電源管理IC、I2Cアドレス`0x34`）が搭載されています。素の状態のCoreS3では、Stack-chan拡張基板（サーボ・ヘッドLED）が必要とする電源レール（電圧の出力経路）や電流設定が有効になっていません。

そのため、Stack-chan専用ボード構成でファームウェアを起動すると、`firmware/platforms/m5stackchan_cores3/setup-target.js` がAXP2101のレジスタを書き換えて、必要な電源（LDO/DCDCの有効化、充電電流の設定など）を有効化します。この処理はビルド・書き込みのターゲットに専用サブプラットフォーム（`-p esp32:./platforms/m5stackchan_cores3`）を指定したときだけ適用されます。

- **ユーザーが手で設定を弄る必要はありません。** レジスタの書き換えは起動時に自動で行われます。
- ただし、標準のCoreS3向けターゲット（`--target=esp32/m5stack_cores3`）でビルド・書き込みすると、この電源パッチが当たりません。その結果「サーボが動かない」「ヘッドLEDが点かない」といった症状になります。この場合の対処は [`./01-environment-and-build.md`](./01-environment-and-build.md) の「トラブルシューティング」章を参照してください。
- 電源パッチの適用処理は`try`/`catch`で囲まれており、失敗してもファームウェアの起動自体は継続します（黒い画面のまま固まる、といった事態にはなりません）。

## 7. ヘッドLED・拡張ユニット

### ヘッドLED

CoreS3専用ボード構成には、12連のヘッドLEDが搭載されています。設定は `firmware/platforms/m5stackchan_cores3/manifest.json` の `led.head`（`type: "py32"`, `length: 12`, `ledPin: 13`, `address: 111`）で定義され、実装は `firmware/stackchan/led/py32-led.ts` です。サーボ電源と同じPY32のI/Oエキスパンダ（I2Cアドレス`0x6F`＝111）経由で制御します。

操作用のAPIは `robot.lightOn` / `robot.lightOff` / `robot.lightBlink` / `robot.lightRainbow` で、デモMODは `firmware/mods/light/mod.js` にあります。

### 環境センサ等のM5Unit拡張

`firmware/mods/unit_temperature/` は、SHT30を搭載した環境センサーユニットをPORT.A（Grove/I2C）に接続し、温湿度を吹き出し（バルーン）表示するデモです。使用するセンサーのドライバーはMODの`manifest.json`で指定されており、これを変更すれば他のセンサーユニットも使えます。

ただし1点制約があります。MODの実装はネイティブ（C言語）コードを含められないため、`### mod cannot contain native code`というビルドエラーが出た場合は、ドライバー（またはそれが依存するモジュール）をホスト側（ファームウェア本体）で事前に読み込んでおく必要があります。

### 動作確認（スモークテスト）

`firmware/mods/m5stackchan_smoke/` は、サーボ電源とヘッドLEDを自動でひと通り動かす確認用MODです。ケースを組み立てた後、配線やIDの設定に問題がないかを確認するのに適しています。手順は [`./01-environment-and-build.md`](./01-environment-and-build.md) の「CoreS3スモークテスト」章を参照してください。

## 8. schematics/（触るべきか）

`schematics/m5-pantilt/`には、サーボ駆動・電源拡張基板（Stack-chan board）のKiCad設計データが入っています。これは「ケースの中に入っている変換基板の設計図」であり、初心者が触る必要は通常ありません。既製の基板をそのまま使うのが基本です。

自分でサーボの種類を選ぶ際の比較情報は `schematics/README.md`（PWM/シリアルサーボそれぞれの価格・機能・注意点）にまとまっているので、そちらは一読の価値があります。

## 9. 安全上の注意

サーボやバッテリーを扱う作業には、ソフトウェアだけのカスタマイズとは異なるリスクがあります。作業前に必ず確認してください。

- **PWMサーボ（SG-90）の過熱・発煙のおそれ**: 可動範囲の物理的な限界を超えるような角度を指示すると、過負荷になり発熱・発煙するおそれがあります。また、突入電流が大きく、M5Stackが再起動する場合があります（`schematics/README.md`にも同様の記載があります）。
- **トルクがかかった状態でサーボを手で動かさない**: PWMサーボはソフトウェアからトルクのON/OFFを制御できません。通電中（トルクがかかった状態）に無理に首を手で捻ると、内部のギアが破損するおそれがあります。
- **サーボの取り付け向きに注意**: 取り付け向きを間違えると、ケースと干渉して正しく動作しません。ケースに固定する前に、一度ファームウェアを書き込んで動作確認することを推奨します（2章の可動範囲・基準角度の表も参照）。
- **サーボを動かす前は周囲を確認**: サーボを動かすMOD（スモークテスト含む）を実行する前に、周囲に指や障害物がないか確認してください。
- **キャリブレーション系MODは実験的**: `firmware/mods/calibration/mod.js` はオフセット設定が正しく動作しないことが明記されています。正しく動くことを前提にせず、まず動作を確認しながら使ってください（4章参照）。
- **バッテリー（リポ/リチウムポリマー）の取り扱い**: 膨張・変形・発熱している電池は使用しないでください。純正品または推奨されている容量・仕様の電池（`case/README.md`に記載の400mAh/640mAh品など）を使い、短絡（プラス・マイナスの接触）や過放電を避けてください。
