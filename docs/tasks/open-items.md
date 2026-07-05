# v1.0.1 — 開発環境とステータスバー

**v1.0.0**（呼吸 MOD・journal 確定）のパッチ版。**探求の Layer 0 は維持**しつつ、実機開発を楽にする。

参照: [journal/v1.0.0.md](../journal/v1.0.0.md) · [overlay/mods/breath/](../../overlay/mods/breath/)

---

## この版の骨核

| 項目 | v1.0.1 でやること |
|---|---|
| **探求** | v1.0.0 と同じ（顔のみ呼吸。サーボ停止） |
| **UI** | 画面上端から下スワイプで **ステータスバー**（時刻・バッテリー）。通常時は非表示 |
| **開発** | **可能なら** Mac と USB なしで MOD 更新（同一 Wi‑Fi） |

Layer 0 の同席観察（v1.1.0）はこの版の外。

---

## 1. ステータスバー（スワイプ表示）

### 要件

- **操作**: 画面上部（タッチ y ≦ 80px）から **下方向スワイプ** → バー表示
- **表示**: 時刻（`HH:MM`）、バッテリー残量（`NN%`、充電中は `⚡` 等）
- **非表示**: 上スワイプ、または数秒で自動的に隠す
- **トーン**: **白背景・黒文字**（黒背景・白前景の顔と区別するため、あえて反転）。呼吸中は常時出さない

### 技術メモ

| 要素 | API / 実装 |
|---|---|
| タッチ | `robot.touch`（CoreS3 LCD、`M5StackCoreS3Touch`。y ≥ 200 は仮想 A/B/C ボタン） |
| 時刻 | `globalEnv.device.RTC`（BM8563、`platforms/m5stackchan_cores3/host/provider.js`） |
| バッテリー | ホスト `m5stackchan/battery` 経由（provider の `BreathSMBus` が SDK の AXP2101 I2C ハンドルを捕獲）。MOD から直接 SMBus を開くと duplicate address |
| 描画 | PIU `Container` / `Label` を `robot.renderer.addDecorator`（`piu/MC` はホスト提供） |

### タスク

- [x] `overlay/mods/breath/` に `status-bar.js`（スワイプ検知 + 描画）
- [x] manifest は `manifest_mod.json` のみ（PIU / SMBus はホスト側モジュールを参照）
- [x] 実機: スワイプ → 表示 → 自動非表示
- [x] 呼吸ループと干渉しないこと（タッチ処理はバー用のみ）

### 実装メモ（2026-07-05 解決）

バッテリー `--%` 問題の根本原因は 2 つ: (1) カスタム platform の `setup-target.js` が `"setup/target"` として登録されても SDK 側定義に makefile 上負けてビルドに入らず、電源レール patch もバッテリー登録も実行されていなかった、(2) SDK の setup-target が AXP2101（I2C 0x34）を `globalThis.power` で占有しており、別途開くと `RangeError: duplicate address`。`host/provider.js` の `BreathSMBus` が SDK と同一の I2C ハンドルを捕獲し、`m5stackchan/battery`（`readBatterySample()`）経由で読む方式で解決。詳細は `overlay/docs/my-cores3/01-environment-and-build.md` 参照。

---

## 2. USB なし Wi‑Fi 開発環境（デプロイ + ログ）

2026-07-05 の SDK 実地調査に基づき再設計。**旧案（mcrun ベースの mod Wi‑Fi 更新 / xsbug over Wi‑Fi）は棄却**。

### 調査で確定した前提

| 事実 | 帰結 |
|---|---|
| `mcrun` の mod 転送は xsbug プロトコル依存。ESP32 の xsbug は **UART/USB のみ**（TCP 実装はデッドコード、`debugger_uart*.c` 系のみ実在） | 旧 2a（mcrun mod Wi‑Fi 更新）・旧 2b（xsbug over Wi‑Fi）は**不成立** |
| breath のコードは PIU / battery 込みで**ホストファームに焼き込む**構成 | mod パーティション更新（256KB 制約）では肝心の反復をカバーできない |
| Moddable は OTA を公式サポート: defines `"ota": {"autosplit": 1}` だけで factory を ota_0/ota_1/otadata に自動分割。`examples/io/listener/httpserverota` が `PUT /ota` の雛形 | **フルホスト OTA が本命**。16MB flash で各スロット ~7.75MiB、アプリ実測 3.73MiB、mod/storage 維持で収まる（試算済み） |
| `globalThis.trace` は実行時差し替え可（SDK 公式前例: `examples/js/repl`）。release ビルドでも機能 | **UDP ログミラー**が唯一かつ十分な Wi‑Fi ログ手段 |
| stack-chan に `HttpServerService`（Hono 風ルータ、`services/http-server/`）実装済み。mDNS モジュールあり。Wi‑Fi 資格情報は NVS 設定済み（offset 固定なのでパーティション再構成でも残る） | デバイス側の土台は流用のみ |
| mcconfig は任意の `key=value` を `mc/config` に注入可 | **ビルド ID を焼き込み `GET /status` で照合** → 「deploy が反映されたか」問題の恒久解 |

### アーキテクチャ

```
[Mac]                                        [StackChan (CoreS3)]
overlay/scripts/ota-deploy.sh --PUT /ota-->  dev サーバ（HttpServerService 流用）
  build（buildId 注入）→ curl                  ├ OTA 書込（embedded:update）→ 再起動
  → GET /status で buildId 照合                ├ GET /status {buildId, ip, battery, uptime}
overlay/scripts/logs.sh       <--UDP------   trace ミラー（globalThis.trace ラップ）
  （nc -ukl 8686 相当）                        mDNS: stackchan.local
```

- dev 専用モジュールは `overlay/mods/breath/dev/`（`dev-server.js` / `trace-udp.js`）に置き、manifest の config フラグで有効化（探求の Layer 0 コードと分離）
- 認証は静的トークン（`mc/config`）+ 同一 LAN のみ。探求用 dev 版として割り切り、文書化する

### Phase 1 — Wi‑Fi ログ + status（USB で焼く最後のファーム）

- [x] `trace-udp.js`: `globalThis.trace` をラップし UDP ブロードキャスト（port 8686）へミラー（元 trace も維持）
- [x] `dev-server.js`: `GET /status`（buildId・IP・バッテリー・uptime）— **`HttpServerService` は不使用**（下記実装メモ）
- [x] mDNS で `stackchan.local` を名乗る（デバイス側は動作確認済み。ただし自宅 Deco IoT SSID がクライアント間 multicast を遮断するため Mac から名前解決不可 → IP 直打ちで代用）
- [x] buildId 注入経路の確認（`npm run build:breath:... -- buildId=<id>` がそのまま mcconfig に届き `mc/config` に入ることを実機で確認。ラッパー不要。**deploy にも同じ buildId を渡す**こと）
- [x] `overlay/scripts/logs.sh`（UDP listen、python3 実装）
- [x] USB で deploy → Mac にログが届く・`/status` が返る・buildId 一致・バッテリー実値を確認（2026-07-05）

#### 実装メモ（2026-07-05 実機デバッグで判明）

- **サブネットブロードキャスト（/24 仮定の x.y.z.255）は禁止**: 自宅 Deco は /22 のため通常ホスト宛になり、ARP 未解決 pbuf が滞留 → `UDP send error -1 (ERR_MEM)` → 数十秒周期の再起動ループ。グローバルブロードキャスト 255.255.255.255 は lwIP でそのまま送出でき、Mac にも届く（採用）。ユニキャストは `mc/config` の `devLogHost` で指定可。
- **stack-chan の `HttpServerService` は現行 SDK で全リクエスト死**: upstream の `http-server-service.js` が `headers.set('content-length', body.byteLength)` で変換前の文字列 `body` を参照（undefined）。現行 SDK の `Headers.set` は `value.toString()` を呼ぶため throw → 404/500 フォールバックも同経路で throw → `respondWith(undefined)` の unhandled rejection で **XS abort → 約 40 秒後に WDT 再起動**。upstream へ報告する価値のあるバグ。
- **SDK の `listen` モジュールも素のままでは危険**: 不正 HTTP（ポートスキャン・telnet 打鍵・ルーターの死活プローブ等）でパースが失敗すると、onRequest 前に reject される内部 Promise（requestPromise / responsePromise）にハンドラが無く、unhandled rejection → XS abort → 再起動（実機で再現）。dev-server は rejection ハンドラを事前接続した overlay コピー **`breath/dev/http-listen`** を使う（`Response` の content-length 実装はこちらが正しい）。
- **unhandled rejection は XS abort（再起動）**: 非同期サーバループでは `promise.then(undefined, ...)` で必ず握りつぶすこと。実測では abort から約 40 秒後に WDT 再起動し、その間ポートは connection refused になる。
- 起動 +3 秒より前の trace（`[breath] loop running` 等）は UDP には乗らない（ミラー開始前）。ブート直下のログはシリアル採取（環境ガイド §8）で見る。

### Phase 2 — OTA デプロイ（以後 USB 不要）

- [ ] `manifest_breath_deploy.json` に `"defines": {"ota": {"autosplit": 1}}` → パーティション再構成（**初回のみ USB フル書き込み必須**。NVS の Wi‑Fi 設定は残る）
- [ ] dev サーバに `PUT /ota`（token 必須）: `embedded:update` で受信ストリーム書込 → complete → esp_restart（FFI）
- [ ] `overlay/scripts/ota-deploy.sh`: build → curl → 再起動待ち → `GET /status` の buildId 照合まで自動化
- [ ] 異常系の確認（転送中断・不正バイナリ・OTA 中の再スワイプ）と USB リカバリ手順の文書化

### Phase 3 — 堅牢化（任意）

- [ ] ESP-IDF ロールバック: sdkconfig `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` + 起動確認後の mark-valid（SDK に既製実装なし、FFI で自作）
- [ ] trace リングバッファ + `GET /logs`（UDP 取りこぼし時の追い読み）
- [ ] OTA 書込中は呼吸アニメーションを一時停止（フラッシュ書込と描画の負荷分離）

---

## 3. 観測版の切り方

- [ ] セクション 1（完了）+ セクション 2 の Phase 2 が実機で通った時点で tag `v1.0.1`
- [ ] journal は **開発効率の観察** があれば `/write-journal`（探求の Layer 0 観察は v1.1.0）

---

## v1.1.0 以降（探求・変更なし）

- [ ] 同室 2〜10 人で同席観察
- [ ] **人間でも Web でもないロボット** としての第三焦点
- [ ] サーボ・LED の取捨（同室観察後）

---

## 実装順（提案）

1. ~~**ステータスバー**~~ — 完了（2026-07-05）
2. **Phase 1: Wi‑Fi ログ + status** — UDP trace ミラーが先。以後の OTA 開発自体が楽になる
3. **Phase 2: OTA デプロイ** — パーティション再構成（初回 USB）→ `PUT /ota` → `ota-deploy.sh`
4. tag `v1.0.1`（Phase 3 の堅牢化はタグ後でも可）
