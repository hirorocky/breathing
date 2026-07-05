# CoreS3向け環境構築・ビルド・書き込み

このドキュメントは、M5Stack CoreS3でstack-chanを動かすために必要な開発環境のセットアップ方法と、ビルド・書き込みの具体的な手順をまとめたものです。索引は [`./README.md`](./README.md) を参照してください。

以降のコマンドは、特に断りがない限り `firmware/` ディレクトリで実行することを前提としています。

## 1. 開発環境セットアップ（macOS）

### 各ツールの役割

組み込み開発が初めての場合、まず出てくるツール名が何をするものか分かりにくいので整理します。

| ツール | 役割 |
| --- | --- |
| **Moddable SDK** | JavaScriptでファームウェアを書くためのSDK本体。ビルド/書き込みを行う `mcconfig`、書き込み済みホストにMODだけを書き込む `mcrun`、配布用バンドルを作る `mcbundle`、デバッガの `xsbug` などのコマンドを提供します。 |
| **ESP-IDF** | Espressif社が提供するESP32向けのC言語SDK。ESP32向けビルドの土台になっており、書き込みツールの `esptool` などもこれに含まれます。 |
| **xs-dev** | Moddable SDKとESP-IDFのセットアップ・更新・接続デバイスの検出などを自動化するCLIツール。stack-chanのnpmスクリプトは内部でこれを呼び出しています。 |

つまり、実際にJSでコードを書いてビルドするのはModdable SDKの役目で、ESP-IDFはその裏でESP32向けのビルドを支える基盤、xs-devはその2つの導入を楽にするための補助ツールという関係です。

### 前提条件

- Homebrew
- `brew install xz`
- Xcode Command Line Tools
- Node.js（`firmware/.nvmrc` にバージョンが指定されています。本家の getting-started は Node v22 でテストされています）

### 手順

```sh
cd firmware
npm install
npm run setup
npm run setup -- --device=esp32
npm run doctor
```

- `npm run setup`: 内部で `xs-dev setup` を実行し、Moddable SDKを取得します。
- `npm run setup -- --device=esp32`: ESP-IDFを導入します。
- `npm run doctor`: 現在のgitのHEADを表示したうえで `xs-dev doctor` を実行し、Moddable SDKのバージョン、対応ターゲットデバイス、ESP-IDFのパスなどを表示して環境を確認します。

### macOSでのDockerについて

本家リポジトリにはDockerによるビルド環境も用意されていますが、**macOSでは推奨されていません**。デバイスへの接続に不具合が報告されているためです（[issue #144](https://github.com/stack-chan/stack-chan/issues/144)）。macOSではxs-dev経由のネイティブ環境を使ってください。

参考: [`../../firmware/docs/getting-started.md`](../../firmware/docs/getting-started.md)

## 2. CoreS3向けビルドと書き込み（最重要）

### npmスクリプトの仕組み

`firmware/package.json` の `build` / `deploy` / `debug` / `mod` は、いずれも次のような形になっています。

```sh
cross-env npm_config_target?=esp32/m5stack cross-env-shell mcconfig -d -m -p \$npm_config_target -t build "$PWD/stackchan/manifest_local.json"
```

`npm_config_target?=esp32/m5stack` はデフォルト値の指定なので、`npm run build --target=X` のように `--target` オプションを渡すと、npmがそれを `npm_config_target=X` という環境変数に変換してデフォルトを上書きします。ビルド対象のマニフェストは `firmware/stackchan/manifest_local.json` です（このファイルは `.gitignore` 対象で、自分で作成する必要があります）。

### 2系統のターゲットを区別する

CoreS3向けのビルドには2つの系統があり、混同しやすいので明確に分けて把握してください。

| 系統 | 対象 | ターゲット指定 |
| --- | --- | --- |
| (A) 標準のM5Stack CoreS3 | CoreS3本体のみ（サーボはpwm/none等任意）。`manifest_local.json` ベース | `--target=esp32/m5stack_cores3` |
| (B) Stack-chan専用ボード構成 | AXP2101電源パッチ＋PY32サーボ電源＋12連ヘッドLEDを持つ専用基板構成 | `-p esp32:./platforms/m5stackchan_cores3` と専用マニフェスト |

**どちらを使うべきか**: サーボやヘッドLEDを搭載したStack-chan専用基板構成であれば(B)、CoreS3本体だけ（首を動かさない、あるいは汎用のPWMサーボを別途つないでいるだけ）であれば(A)を使います。物理構成の詳細は [`./04-physical-customization.md`](./04-physical-customization.md) を参照してください。

#### (A) 標準のM5Stack CoreS3の場合

```sh
# ホストのビルドと書き込み
npm run build --target=esp32/m5stack_cores3
npm run deploy --target=esp32/m5stack_cores3

# デバッガ付きで書き込み
npm run debug --target=esp32/m5stack_cores3

# MODだけを書き込む
npm run mod --target=esp32/m5stack_cores3 ./mods/xxx/manifest.json
```

#### (B) Stack-chan専用ボード構成の場合

専用のサブプラットフォーム `firmware/platforms/m5stackchan_cores3/` と、専用マニフェスト `firmware/stackchan/manifest_m5stackchan_cores3.json` を使います。この構成では、起動時に `firmware/platforms/m5stackchan_cores3/setup-target.js` がAXP2101のレジスタを書き換えて、サーボ電源やヘッドLED用の電源レールを有効化します。

この構成専用のnpmスクリプトが `firmware/package.json` に用意されているので、通常はこちらを使います（内部で `mcconfig -d -m -p esp32:./platforms/m5stackchan_cores3` と専用マニフェストを実行しています）。

```sh
# ホストのビルド
npm run build:m5stackchan-cores3

# ホストのビルドと書き込み
npm run deploy:m5stackchan-cores3

# MODだけを書き込む（-- の後にMODのmanifest.jsonパスを渡す）
npm run mod:m5stackchan-cores3 -- ./mods/m5stackchan_smoke/manifest.json
```

### コマンドの使い分け

| コマンド | 内容 | 使うタイミング |
| --- | --- | --- |
| `npm run deploy` | ホスト全体をビルドして書き込み | 初回セットアップ時、`manifest_local.json` の設定（driverの種類など）を変更したとき。数分かかる |
| `npm run debug` | ビルド＋書き込み＋`xsbug` デバッガの接続 | ログを見たい、ブレークポイントを張って調べたいとき |
| `npm run mod <manifest>` | ホストはそのままMODだけを書き込む | 通常の開発ループ。数秒〜十数秒で完了する高速なサイクル（専用ボード構成では `npm run mod:m5stackchan-cores3 -- <manifest>` を使う。内部で自動リセット＋最大3回リトライが組み込まれており、`deploy`より速く信頼できる標準の反復手段になっている。詳細は7節） |
| `npm run erase-flash` | フラッシュメモリを全消去 | 内部的には `esptool erase-flash` を実行。Preferencesに保存した設定も消えるので、実行後はホストの再書き込みが必要 |

参考: [`../../firmware/docs/flashing-firmware.md`](../../firmware/docs/flashing-firmware.md)

## 3. ブラウザから書き込む方法（Moddable SDK不要）

Moddable SDKなどの開発環境を用意しなくても、Webブラウザから書き込みだけを行う方法があります。`web/flash/` にあるWeb Serial APIを使ったツールです。

### 前提条件

- M5Stackの USBドライバ（CP210x系またはCH9102系）が導入済みであること
- Web Serial APIに対応したブラウザ（Chromeなど）を使うこと

### 手順

1. M5Stackをケーブルで接続する
2. `https://stack-chan.github.io/stack-chan/web/flash/` にアクセスする
3. 機種の選択肢からCoreS3（M5Stack CoreS3）を選ぶ
4. 「Flash Stack-chan firmware」を選ぶ
5. シリアルポートを選択する
6. 「INSTALL STACK-CHAN」→「INSTALL」を選ぶ
7. 2〜3分待つと書き込み完了

工場出荷時のデフォルト設定はSCS0009サーボ向けです。別のサーボや設定を使いたい場合は、後述のWeb設定UIから変更してください。

参考: [`../../firmware/docs/flashing-firmware-web.md`](../../firmware/docs/flashing-firmware-web.md)

## 4. Web設定UI（WiFi・driver・tts・renderer）

`web/preference/` は、BLE（Web Bluetooth）経由でPreferences（WiFi、driver、tts、rendererなどの設定）を書き込むツールです。

### 手順

1. Cボタンを押しながら起動する（CoreS3にはCボタンが無いのでタッチパネルに触れながら起動する）
2. 本体に設定モードの画面が表示される
3. `https://stack-chan.github.io/stack-chan/web/preference/` を開く
4. 「Connect Stack-chan with BLE」を選ぶ
5. デバイス名「STK」を選択する
6. 表示されたフォームに値を入力し、「Submit」を選ぶ

### 設定できる項目

| ドメイン | 項目 |
| --- | --- |
| `wifi` | `ssid`, `password` |
| `renderer` | `type`（`simple` / `dog`） |
| `driver` | `type`（`scservo` / `dynamixel` / `rs30x` / `pwm` / `none`）, `offsetPan`, `offsetTilt` |
| `tts` | `type`（`voicevox` / `elevenlabs` / `google-tts` / `openai` / `local`）, `host`, `port`, `voice`, `token`, `volume` |
| `ai` | `token`, `context` |

### 注意点（実装を確認して分かった落とし穴）

Web UIのフォームと実際にファームウェアが保持する設定項目には、いくつかズレがあります。

- **`tts.type` の `google-tts` は実装に存在しない**: ファームウェア側（`firmware/stackchan/main.ts`）がTTSエンジンとして認識するキーは `local` / `remote` / `voicevox` / `voicevox-web` / `elevenlabs` / `openai` のみで、`google-tts` というキーはありません。Google Cloud TTSを使いたい場合は、実際には `remote` タイプ（`tts-remote` エンジン）を使う必要がありますが、この `remote` はWeb UIの選択肢にも含まれていません。そのため、Google Cloud TTSを使う場合は Web UIではなく `firmware/stackchan/manifest_local.json` の `config.tts.type` に直接 `"remote"` を書く必要があります。
- **`image` / `small-face` レンダラーはUIに無い**: ファームウェア（`firmware/stackchan/main.ts`）には `simple` / `dog` に加えて `image` / `small-face` の2つのレンダラーが実装されていますが、Web UIの選択肢は `simple` と `dog` のみです。これらを使う場合もmanifestを直接編集します。
- **`tts.voice` はUI上にあるが永続化されない**: Web UIのフォームには `tts.voice` の入力欄がありますが、ファームウェア側でBLE経由の設定を永続化するキー一覧（`firmware/stackchan/utilities/consts.ts` の `PREF_KEYS`）には `tts.voice` が含まれていません。そのため、この項目はSubmitしても実機に保存されない可能性があります。

### 設定の優先順位

`firmware/stackchan/utilities/loadPreference.ts` の実装によると、同じ項目が複数箇所で設定されている場合の優先順位は次の通りです（後段が前段を上書きします）。

1. `manifest_local.json` の `config`（ビルド時に固定される設定）
2. MODの `config`
3. デバイスに保存された値（Web設定UIからBLEで書き込んだ値、`Preference` API経由）

つまり、実機で最終的に有効になるのは「BLEで書き込んだ値 > MODのconfig > manifest_local.jsonのconfig」の順です。

参考: [`../../firmware/docs/setting-preferences-web.md`](../../firmware/docs/setting-preferences-web.md)

## 5. CoreS3スモークテスト（実機のハード動作確認）

Stack-chan専用ボード構成（上記2章の(B)）向けに、サーボ電源とヘッドLEDの動作を確認するためのスモークテスト用MODが用意されています。ケースを組み立てた後の動作確認に向いています。

対象: `firmware/docs/m5stackchan-cores3-smoke.md`、`firmware/mods/m5stackchan_smoke/`

### 実行手順

ホストをビルド・書き込み済みであることを前提に、以下を実行します。

```sh
npm run mod:m5stackchan-cores3 -- ./mods/m5stackchan_smoke/manifest.json
```

実行すると、以下の動作が自動的に行われます。

- サーボ: トルクON → 中立姿勢 → 微小なヨー/ピッチの動作確認 → 中立姿勢 → トルクOFF
- ヘッドLED: 赤点灯 → 緑点滅 → レインボー → 消灯

`xsbug` またはシリアルログに `[M5StackChan CoreS3 smoke] ...` というプレフィックスのtraceログが出力されるので、各ステップが実行されたことを確認できます。

> [!NOTE]
> サーボが動くので、実行前に周囲に障害物がないことを確認してください。

参考: [`../../firmware/docs/m5stackchan-cores3-smoke.md`](../../firmware/docs/m5stackchan-cores3-smoke.md)

## 6. 開発サイクルとシミュレータ

### 通常の開発サイクル

- MODのコードだけを変更した場合: `npm run mod` で高速に反映できます（数秒〜十数秒）。
- driverの種類やmanifestの `config` など、ホスト側の設定を変えた場合: `npm run deploy`（または対象がBの場合は `npm run deploy:m5stackchan-cores3`）でホストを再度書き込み直す必要があります。

### WASMシミュレータ（実機不要）

実機が手元になくてもロジックだけを確認したい場合、WASM版のシミュレータを使えます。

```sh
# firmware/ ディレクトリで実行
npm run build:wasm
```

これはwasm版をビルドし、生成された `mc.js` / `mc.wasm` を `web/simulator/` にコピーします。その後、`web/` ディレクトリで以下を実行します。

```sh
npm run dev
```

これは`live-server`を起動するので、ブラウザで `web/simulator/` を開くと、3Dビューと320x240の画面表示でMODの動作を確認できます。ただし、これはCoreS3のハードウェア固有機能（AXP2101電源パッチやヘッドLEDなど）は対象外で、ロボットのロジック（表情や振る舞いなど）の確認用途です。

## 7. トラブルシューティング

- **デバイスが認識しない**: `npm run scan`（内部で `xs-dev scan` を実行）を実行し、`/dev/cu.usbserial-XXXX` のようなポートが見えるか確認してください。M5Stack用のUSBドライバが導入されているかも確認してください。
- **ビルドに失敗する**: `npm run doctor` を実行し、Moddable SDK / ESP-IDFのパスとバージョンが正しく表示されるか確認してください。
- **サーボが動かない/ヘッドLEDが点かない**: まず、2章の(B)の専用ターゲット（`-p esp32:./platforms/m5stackchan_cores3` と `manifest_m5stackchan_cores3.json`）でビルド・書き込みしているか確認してください。標準ターゲット（(A)）ではAXP2101の電源パッチが当たらず、サーボ電源やヘッドLED用の電源レールが有効化されません。電源パッチは `firmware/platforms/m5stackchan_cores3/setup-target.js` が起動時に自動的に適用します。
- **タッチが反応しない/起動直後にクラッシュする**: CoreS3では過去にこの種の不具合が報告されており、修正が入っています。最新の `develop` ブランチに追随しているか確認してください（heap不足に関連する修正が入っている場合があります）。
- **`erase-flash` 実行後に設定が消えた**: `erase-flash` はフラッシュ全体を消去するため、Preferencesに保存していた設定（WiFi・driver・ttsなど）も消えます。ホストを再書き込みし、Web設定UIから設定をやり直してください。
- **`mcrun: command not found`（`npm run mod`/`npm run deploy` 実行時）**: `/bin/sh: mcrun: command not found`（`mcconfig` の場合も同様）というエラーが出る場合があります。同時に表示される `npm warn Unknown cli config "--target"` は無害な非推奨警告であり、原因ではありません。原因は、Moddable SDKのツール（`mcrun`/`mcconfig` 等）にPATHを通す環境変数スクリプト `~/.local/share/xs-dev-export.sh` が、シェル起動時に読み込まれていないことです。SDK自体は `~/.local/share/moddable` にインストール済みでも、この読み込みがないと新しいシェルではコマンドが見つかりません。本来 `npm run setup`（xs-dev）が `~/.zshrc` に読み込み処理を追記するはずですが、追記されないことがあります。
  - 恒久対策: `~/.zshrc` に以下を追記し、新しいターミナルを開くか `source ~/.zshrc` を実行してください。
    ```sh
    # Moddable SDK / xs-dev (stack-chan 開発用)
    [ -f "$HOME/.local/share/xs-dev-export.sh" ] && source "$HOME/.local/share/xs-dev-export.sh"
    ```
  - その場しのぎ: 今のターミナルで `source ~/.local/share/xs-dev-export.sh` を実行してから作業する（ターミナルを閉じると設定は消えます）。
  - 確認方法: `echo $MODDABLE` を実行して `/Users/<you>/.local/share/moddable` のようなパスが表示されれば読み込めています。`which mcrun` でパスが表示されればOKです。
- **デバイス未接続のまま `npm run mod`/`npm run deploy` が進むが書き込まれない**: `npm run mod` はMODを `.xsb`/`.xsa` にコンパイル（`# xsc ...` `# xsl ...` というログが出る）した後、USBシリアル経由で実機にインストールします。本体をUSB接続していない状態で実行すると、`Press <RESET> if necessary.` という表示のまま止まり、実際の書き込みは行われません（PCやフラッシュに影響はありません。固まったように見えたらCtrl+Cで中断してください）。また、`npm run mod`（MODの書き込み）は「ホスト（土台となるファームウェア）が既に書き込み済み」であることを前提としています。ホストを導入していない場合は先に `npm run deploy --target=esp32/m5stack_cores3` などでホストを書き込む必要があります。順序としては「USB接続 → `npm run scan` で認識確認 → `npm run deploy` でホスト書き込み → `npm run mod` でMOD書き込み」となります。
- **`npm run mod`のxsbug接続待ちハング（専用ボード構成、解消済み）**: 専用ボード構成向けにMODを書き込む際、`mcrun -d` がxsbugのデバッグプロトコル経由でMODを転送する過程で、約25〜75%の確率で `Installing mod..` の表示のまま進まなくなる間欠的な不安定さが過去に発生していた（このMac実機で実際に確認、物理リセットでは復帰せずプロセスをkillする必要があった）。実機での切り分けにより、**`mcrun` の実行直前にesptool経由でデバイスをハードリセットする**ことで解決することが判明し、4回連続で1回目の試行だけで成功することを確認済み。この対策を組み込んだラッパースクリプト `firmware/scripts/mod-cores3.sh` を `npm run mod:m5stackchan-cores3` に採用済みで、esptoolによる事前リセット→`timeout 45`での`mcrun`実行→失敗時は`serial2xsbug`プロセスをkillして最大3回リトライ、という仕組みで解消されている。詳細は `firmware/scripts/mod-cores3.sh` を参照。
- **`error TS2304: Cannot find name 'Disposable'`（TypeScriptコンパイル失敗でビルドが止まる）**: `npm run build`/`deploy` 実行時、ドライバ等の `.ts` コンパイルで `error TS2304: Cannot find name 'Disposable'`（`AsyncDisposable` も同様）が Moddable SDK付属の型定義 `~/.local/share/moddable/typings/embedded_io/*.d.ts`（analog/digital/i2c/serial/spi/pwm等）で多数出てビルドが `# typescript compile failure` で止まる場合があります。原因はModdable SDK側のバグで、ビルドツール `~/.local/share/moddable/tools/mcmanifest.js` がTypeScriptビルド用tsconfigを生成する際に `lib: ["es2025"]` をハードコードしており `esnext.disposable` を含めていません。一方 Moddable の型定義(@moddable/typings)は `Disposable` を参照しており、TypeScript 6.x では `Disposable`/`AsyncDisposable` は `esnext.disposable` lib にのみ存在するため型が見つからず失敗します（Moddable自身の `typings/tsconfig.es2025.json` には正しく `["es2025","esnext.disposable"]` と入っているが、ビルド生成側がそれを使っていません）。対処はリポジトリ内で完結し、SDKは触りません。`firmware/stackchan/manifest.json` の `typescript.tsconfig.compilerOptions` に `lib` を追加します。mcmanifest.js は生成tsconfigに対し manifest の `typescript.tsconfig.compilerOptions` を `Object.assign` で上書き適用するため、ここで `lib` を指定すればハードコード値を上書きできます。具体的には:
  ```json
  "typescript": {
    "tsconfig": {
      "compilerOptions": {
        "noImplicitAny": false,
        "lib": ["es2025", "esnext.disposable"]
      }
    }
  }
  ```
  を設定して再ビルドすると解消します（生成される `tsconfig-base.json` の lib に `esnext.disposable` が入ります）。なお `firmware/stackchan/manifest.json` は git 追跡対象ファイルなので、この修正は `git status` に出ます（個人カスタマイズ用ドキュメント群とは別扱い）。将来 Moddable SDK 側で修正されたら不要になる可能性があります。upstream に報告する価値のある不具合です。
- **症状**: `npm run build`/`deploy` 実行時、`npm` 自体は exit 0 に見えるのに実際にはフォント生成でビルドが止まっている。ログに `# fontbm <fontname>` の直後 `dyld[...]: Library not loaded: /opt/homebrew/opt/freetype/lib/libfreetype.6.dylib` と出て `make: *** [....fnt] Abort trap: 6` で失敗する。その結果、最終成果物 `xs_esp32.bin` が生成されず、続く `npm run deploy` が「Please build before deploy」で止まる（deployは既存の `xs_esp32.bin` を書き込むだけのステップのため）。
  - **原因**: Moddableのビットマップフォント生成ツール `fontbm`（`~/.local/share/moddable/build/bin/mac/release/fontbm`）が freetype ライブラリに依存しているが、freetype が未インストール。`npm run setup`(xs-dev) では入らないことがある。
  - **対処**: `brew install freetype` を実行してから再ビルド（`npm run build --target=esp32/m5stack_cores3`）。成功すると `~/.local/share/moddable/build/bin/esp32/m5stack_cores3/debug/stackchan/xs_esp32.bin` が生成され、その後 `npm run deploy --target=esp32/m5stack_cores3` が通る。
  - **切り分けのヒント**: `otool -L ~/.local/share/moddable/build/bin/mac/release/fontbm | grep freetype` で必要なライブラリパスを確認できる。`ls /opt/homebrew/opt/freetype` が無ければ未インストール。ビルドが成功したかは `find ~/.local/share/moddable/build -name xs_esp32.bin` で `xs_esp32.bin` の有無を見るのが確実（`npm` の exit code はあてにならない場合がある）。
- **症状（生の `mcconfig`/`mcrun` を直接使う場合のみ）**: 生の `mcconfig`（または `mcrun`）コマンドを**直接**実行すると `/bin/sh: tsc: command not found` が出て `# typescript compile failure` でビルドが失敗する。一方 `npm run build`/`npm run deploy`、および専用ボード構成向けの `npm run build:m5stackchan-cores3`/`npm run deploy:m5stackchan-cores3` では同じビルドが成功する。
  - **原因**: Moddableのビルドは内部で `tsc`（TypeScriptコンパイラ）をPATHから呼ぶ。`npm run ...` 経由だと npm が自動で `./node_modules/.bin` をPATHに追加するため、プロジェクトの TypeScript(`firmware/node_modules/.bin/tsc`) が見つかる。しかしシェルで `mcconfig` を直接叩くと `node_modules/.bin` がPATHに無いため `tsc` が見つからない。
  - **対処**: 専用npmスクリプト（`build:m5stackchan-cores3`/`deploy:m5stackchan-cores3`/`debug:m5stackchan-cores3`/`mod:m5stackchan-cores3`、2章参照）を追加したことで、通常はこの問題自体を踏まなくなった。それでも何らかの理由で生の `mcconfig`/`mcrun` を直接使いたい場合は、`firmware/` ディレクトリで `node_modules/.bin` をPATHに通す必要がある（例: `PATH="$PWD/node_modules/.bin:$PATH" mcconfig ...`）。

## 8. 補足: StackChan Remote Controller Kit (K151-R) を使う場合

> [!NOTE]
> 以下はこのドキュメントの筆者が実際に所有している製品固有の情報です。この repo のCoreS3対応は特定の基板構成に対してコントリビュートされたものであり、M5Stack公式のK151アダプタ基板と完全に一致するかどうかは実機での検証が必要です。

- ハード構成: 本体はM5Stack CoreS3（組立済み）。サーボは **SCS0009を2基**（水平360°連続回転／垂直90°可動、フィードバック付き）使用しており、専用アダプタ基板経由で **Servo_TX=G6 / Servo_RX=G7**（I2Cも使用）に接続されています。付属のリモコンはJoyCとStickC-Plusを組み合わせたもので、**ESP-NOW無線**でStackChanを操作します。
  - このピン配置（G6/G7）は、本repoの `firmware/stackchan/manifest_m5stackchan_cores3.json` の `serial: {transmit:6, receive:7, port:1, baud:1000000}` と一致しています。ただし、サーボ電源（PY32）や12連ヘッドLEDの構成が公式のK151基板にも存在するかどうかは未確認です。

> [!WARNING]
> K151-Rの工場出荷ファームウェアは、M5Stackの「StackChan World」アプリ（AIエージェントはXiaoZhi提供）であり、**この repo のファームウェア（Moddable SDK / JavaScriptベース）とは別物**です。本ドキュメントの手順（`npm run deploy` 等）でこの repo のファームを書き込むと、工場出荷ファームは上書きされ、出荷時のAI会話機能や付属リモコン（ESP-NOW）での操作は使えなくなります（この repo のファームは、このリモコンには対応していません）。

- **工場出荷状態への戻し方**: 上書きしても復元は可能です。**M5Burner** で最新の工場出荷ファームをダウンロードして書き込んでください。ダウンロードモードへの入り方は、**RSTボタンを約3秒長押し**します（インジケーターが緑色になります）。
- 判断の目安:
  - 「JavaScript（この repo）で自由にカスタマイズしたい」→ この repo のファームに入れ替える（工場出荷時の機能は失われますが、M5Burnerで戻せます）。
  - 「出荷時のAI会話やリモコンをそのまま使いたい」→ 書き込まず、M5Stack公式のStackChan Worldをそのまま使う。
