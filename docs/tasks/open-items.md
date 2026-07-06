# v1.1.0 — 生き物の気配（鳴き声・微挙動・微反応）

**v1.0.2**（設定バー、tag `v1.0.2`）の次。StackChan を「生き物っぽく」する — ただしペットのような能動的な芝居ではなく、**そこに生きている気配**として。最終的に同室 2〜10 人の同席観察（`docs/concept-v1/01-purpose.md` の本題）で確かめる。

参照: [concept-v1/03-interactions.md](../concept-v1/03-interactions.md)（Layer 設計・原則） · [journal/v1.0.0.md](../journal/v1.0.0.md)

---

## 設計ガードレール（concept-v1 から）

| 原則 | この版での意味 |
|---|---|
| 稀で・弱く | 鳴き声・ランダム挙動は「沈黙が正しい」を既定に。頻度と強さは FB ループの主チューニング軸 |
| 非指示・第三焦点 | 音や動きで「こっちを見ろ」と要求しない。返答・会話はしない |
| 間 | 反応には 300ms〜1.5s の余白。即時反応は機械っぽさ・攻撃性になる |
| 非線形 | 挙動の間隔は固定周期にしない（ポアソン的なランダム） |

### concept との緊張点（明示して観察で判定する）

1. **スピーカー**: 現指針は「原則ミュート」。鳴き声は *soft/short/rare* の設計でこれに挑戦する実験。存在負荷が上がるなら音量 0 に戻せる（v1.0.2 の設定バーで即時調整可）
2. **マイク**: 現指針は OFF（AI Agent 文脈）。禁止されているのは音声 Q&A・ウェイクワードであり、「大きな音にびくっとする」受動的な気配は別物として試す
3. **カメラ（目の前のもの検知）**: 指針が明示的に「監視・評価感を避ける」としており、**初期スコープから外す**。「気づいてる感」は音・タッチ・IMU で近似し、カメラはユーザー判断の保留実験とする

---

## フィードバックループの設計（この版の作り方そのもの）

### Loop A — 鳴き声（実機スピーカー上・秒単位で回す）

**方針: 音は静的ファイルではなく「レシピ（パラメータ JSON）」。鳴くたびにデバイス内で合成し、毎回微小なゆらぎを乗せる**（同じ murmur は二度と鳴らない — 非線形原則を音にも適用）。

```
Claude: レシピ JSON を PUT /cry/params で実機へ → POST /cry/<name> で試し鳴き
ユーザー: 実機スピーカーの音をその場で聴いて FB（もっと柔らかく・短く・低く…）
→ 確定レシピ: Preference / manifest 既定値化 → コミット
```

- **デバイス側シンセ**（`overlay/mods/breath/cry.js`）: サイン波 + フィルタ付きノイズ + エンベロープの最小トポロジー。レシピ = 基本周波数・ピッチカーブ・ビブラート・倍音・ノイズ比・エンベロープ・長さ + **ゆらぎ幅**（再生ごとに各パラメータへ乗せるランダム量）
- **再生前バッファ生成**（generate-ahead）: サンプル列は鳴く直前ではなくアイドル時に事前計算してキャッシュし、呼吸アニメーションをブロックしない。鳴いたら次の変奏を裏で生成
- **Mac プロトタイプ**（`overlay/tools/cry/synth.py`、標準ライブラリのみ）は**シンセのトポロジー設計にだけ**使う（アルゴリズム探索は afplay の方が速い）。音作りの本番ループは実機上
- OTA が必要なのはシンセエンジン自体の変更時のみ。レシピ調整は OTA 不要
- 却下した代替: 静的 MAUD リソース（毎回同一で機械的・反復に OTA 必須）、効果音素材、TTS 由来
- **JS 合成の速度リスク**: XS でのサンプル計算コストは Phase 0 で実測。フォールバック階段: 16kHz → 8kHz → AudioOut の Tone コマンド列（ピッチ輪郭のみネイティブ生成）+ 短いノイズバッファ → 最終手段は「事前計算した N 変奏からランダム選択」
- 音のボキャブラリー初期案（少数から始める）:

| 名前 | 場面 | キャラクター |
|---|---|---|
| murmur | アイドル中ごくまれに | 寝息・小さな「くぅ」。気づかない人がいてよい音量 |
| ~~sigh~~ | **不採用**（2026-07-06 Loop B） | 吐息のつもりが**ため息に聞こえ**、場の空気を下げる。深呼吸は無音で確定（`sighProb: 0` 既定化。レシピ自体は cry.js に残置） |
| startle | 大きな音への微反応 | 短い「びくっ」。かわいさより反射（yelp/kyu/double の 3 パターン抽選） |
| touch | 頭頂タッチへの応答 | 一番柔らかい音。返事ではなく気配 |

### Loop B — 微挙動（実機・リアルタイムで回す）

```
Claude: dev サーバの PUT /params で頻度・振幅・間隔をライブ変更（デプロイ不要）
ユーザー: 実機を眺めて FB（多すぎる・気づかない・機械っぽい…）
→ 確定値: Preference / manifest 既定値化 → コミット
```

- **生存感エンジン**（idle scheduler）: ポアソン的間隔で微挙動を発火。候補:
  - **まばたき**（renderer 標準の自動まばたきの有無を Phase 0 で確認。あれば揺らぎだけ足す）
  - **視線の微小な揺らぎ**（サッカード。X 首振りは指示になるため目だけ）
  - **深呼吸**（たまに 1 回だけ深い周期。~~+ sigh~~ → 無音で確定・2026-07-06）
  - **姿勢の微動**（サーボ復活の実験 — SCS0009 の駆動音が気配を壊すかが論点。v1.1.0 の宿題「サーボ・LED の取捨」をここで判定）
  - **LED の微弱な明滅**（12 連 LED。呼吸連動の弱い明度変化）
- パラメータ API: dev サーバに `GET/PUT /params`（JSON、Preference 永続化）。**これが Loop B の心臓部**

### 顔の再設計 — B 案(Cozmo 理念)で確定(2026-07-07、Loop B から派生)

視線チューニング中に「瞳可動域 ±8px」の構造限界に到達 → 瞳モデル自体を捨て、**目全体が動き・変形する Cozmo 型**へ移行することを決定。ブラウザモックアップ([Breath Face Lab](https://claude.ai/code/artifact/7bd5e9c2-b053-4803-9434-8b55f2cfa6d1)、実機同解像度 320×240)の FB ループで確定した仕様:

- **B 案 = 口なし・目 2 つのみ**。呼吸は**目の脈動**で表現(`setMouthOpen` の値を新レンダラーが脈動強度として解釈 — 呼吸ループ・深呼吸は無変更)
- **白・やや四角め**。確定レシピ: eyeW 57 / eyeH 68 / radius 7 / spacing 122 / centerY 118 / breathDepth 0.14 / microDrift 3.8 / saccadeAmp 26px / saccadeMean 5s / blink 0.9〜5.2s
- **既定表情は「平常」**(2026-07-07 ユーザー確定)。眠気・うたた寝・喜び・興味・驚き・疑いは変形パラメータ(topLid/topAngle/botArc/scale/asym)のプリセットとして保持
- 表情は変形のみ(記号・涙・Z 等は使わない — Cozmo 文法)
- 視線は liveliness の lookAt → gazeX/gazeY を**目全体の移動**にマップ(瞳オフセットの `firmware-eye-breath-gaze-scale.patch` は新レンダラー稼働後に不要化見込み)

#### v1.1.0 実装(2026-07-07、Wi-Fi OTA で配備)

- [x] `overlay/mods/breath/face/eye-cozmo.js`: 角丸矩形 1 目の Shape パーツ(脈動・まばたき・視線・微小な漂いを 1 パーツで合成。Outline 再構築はサイズ変化時のみの dirty-check)
- [x] `overlay/mods/breath/face/breath-face.js`: `behaviors/face.ts` の FaceBase 上に目 2 つ(口なし)。motions は `createBlinkMotion` のみ(`createBreathMotion` は入れない — 呼吸は目の脈動で表現するため)
- [x] `overlay/mods/breath/face/renderer-breath.js`: `renderer-simple.ts` と同型の Renderer(`createAppControllerApplication` + `RendererCompat`)
- [x] `overlay/patches/firmware-main-breath-renderer.patch`(新規): main.ts に `renderer-breath` を登録し、`breathHostMod` 時の既定レンダラーを `breath` にする。既存 `firmware-main-breath-host-mod.patch` と同一ファイルを触るが別 hunk のため非衝突(`git apply --check --reverse` の全パッチ検証 + 新規 worktree での forward apply 一致を確認済み)
- [x] `manifest_breath_deploy.json` に `renderer-breath`/`breath-face`/`eye-cozmo` の 3 モジュールを登録(overlay ↔ submodule 同期)
- [x] ビルド → Wi-Fi OTA デプロイ(`overlay/scripts/ota-deploy.sh`、USB 不使用)→ buildId 一致・uptime 継続(~86s 増加、途中リブートなし)・`logs.sh` で例外/abort/再起動ループなし・`[live] gaze` 継続を確認
- [x] `POST /live/deep-breath` → 14 秒後に `[live] deep-breath (requested) scale=1.5 mouthScale=1.3` trace を確認(目の脈動が深くなる想定 — 目視は未実施)
- [x] ユーザー目視: 黒背景に白い角丸の目 2 つ(口なし)。呼吸で目が脈動する・まばたきで縦に潰れる・視線で目が動く(2026-07-07 OK)
- [x] **upstream バグ発見・修正**(2026-07-07 FB「目が右下に寄っています」): `robot.ts` の `eye.gazeX = Math.cos(yaw)` は偶関数で方向の符号が消え、中央で ≈1(右下バイアス)になる → `Math.sin` に修正(`overlay/patches/firmware-robot-breath-gaze.patch`。正面 = 0・符号 = 方向。upstream 報告候補 3 件目)。同時に `lookAway()` が視線値を凍結するだけで中央に戻さない問題 → liveliness の center 処理を `lookAt([0.7, 0, 0])` に変更。修正後「中央に戻りました」確認済み
- [x] Loop B チューニング確定値を liveliness.js 既定値へ焼き込み: gaze{meanIntervalMs 9000, minIntervalMs 2500, amplitude 1, pixelScale 40, centerBias 0.25}, face{pulseDepth 0.24, microDriftPx 0}(サッカードは「大きく・速く・まれに」、漂いは無効)
- [ ] 表情変形(topLid/topAngle/botArc/scale/asym によるプリセット: 眠気・うたた寝・喜び・興味・驚き・疑い)は次イテレーション。今回は既定表情(平常)のみ

### Loop C — 微反応（センサー・閾値をライブ調整）

```
デバイス: センサー値を UDP ログへストリーム（logs.sh で Claude が観測）
ユーザー: 手を叩く・触るなどの刺激役
Claude: 閾値・反応強度を PUT /params でライブ調整
```

- **音（マイク）**: レベル検知 → startle（まばたき + 呼吸一拍止め + 小さな声）。反応は稀・弱・debounce 長め
- **頭頂タッチ**: Layer 3 既定義の微反応（表情のわずかな変化 or 深呼吸 1 回）
- **IMU（持ち上げ・揺れ）**: 指針は「反応オフ既定候補」。弱い反応を試すかは FB で決める
- ~~カメラ~~（保留 — 上記緊張点 3）

#### マイク基盤の設計（2026-07-07 確定方針: 「顔・音・サーボを組み合わせた総合的な動き」の基盤技術として先行実装）

検出したい 3 事象（ユーザー指定）: **大きな音** / **拍手と声の判別** / **しばらく無音**。

- **受動原則の維持**: 音声の内容は一切扱わない（録音・認識・送信なし）。デバイス外に出るのは**レベル値と特徴量のみ**（監視・評価感の回避。concept の「稀・弱・受動」）
- 入力は Phase 0 調査済みの `robot.microphone`（AudioIn 16kHz、既に生成済み。スピーカー TX と RX は同時使用可）
- **特徴量**（ブロックごと、XS の CPU 予算内に収めるため間引き計算）: RMS レベル・ピーク・立ち上がり速度（アタック）・ゼロ交差率（ZCR）
- **イベント分類**:
  - `loud` = レベル閾値超え（debounce / 不応期つき）
  - `clap` vs `voice` = 立ち上がりが鋭く短い（<200ms 目安）+ 高 ZCR（広帯域）なら拍手、持続的（>300ms）+ 低め ZCR なら声
  - `silence` = 移動平均が閾値以下のまま N 分継続（状態イベント）
- **自己音ゲート**: cry 再生中 + 直後 ~500ms はイベント抑制（自分の murmur に自分で驚くフィードバックを構造的に防ぐ）。将来サーボ ON 時は駆動中も同様
- 閾値・判定パラメータはすべて `GET/PUT /mic/params`（liveliness と同じ Preference 永続化 + ライブ調整）
- 実装は**純コールバック**（Promise 不使用 — dev-server/cry と同じ XS abort 回避方針）

---

## Phase 計画

### Phase 0 — 技術調査（Sonnet に委譲）

- [x] **JS サンプル合成の実測**: XS 上で 8k/16kHz のサイン + ノイズ + エンベロープを何 ms で何サンプル生成できるか（フォールバック階段のどこに立てるかの判定材料）
- [x] **AudioOut への生バッファ供給経路**: mod から ArrayBuffer（RawSamples 相当）を enqueue する API、`AudioOut.Tone`/`Volume` コマンド列の仕様、robot.tone の音声基盤（AudioOut インスタンス）を再利用できるか（起動音の AudioOut と二重にならないか）
- [x] マイク入力: Moddable での CoreS3 マイク（ES7210）サンプリング API とレベル検知の実現性
- [x] renderer: まばたき・視線（目の位置）の操作 API の有無（simple-face の自動まばたき仕様含む）
- [x] サーボ: 呼吸連動の最小駆動と騒音の実態（`setTorque` WDT 問題の再確認含む）
- [x] IMU・LED の API 確認

#### 調査結果（2026-07-06）

- **ベンチ実測**: `Math.sin` 直呼び 812ms/4096 サンプル（198µs/サンプル、リアルタイムの約 1.6 倍遅）。**サインテーブルは XS では逆に 28% 遅い**（直呼び採用）。分割 generate-ahead（64 サンプル≈13ms/チャンク）で呼吸を止めずに生成可能。反応系は「常時 1 変奏キャッシュ」で即時再生
- **AudioOut**: `robot.tone` は呼び出しごとに AudioOut を生成/クローズし再利用不可。I2S1 TX は 1 チャネルのみ → cry.js が自前 AudioOut を持ち、robot.tone と排他。`embedded:io/audio/out` 経路はアンプのサンプルレート同期を正しく行う（旧 pins/audioout はバイパスするので注意）
- **マイク**: `robot.microphone`（AudioIn 16kHz）が既に生成済み。スピーカー TX と RX は同時使用可
- **表情**: 自動まばたきは**既に動作中**。サッカードは実装済み・コメントアウト（`face.ts:57`）— 有効化はオーバーレイパッチのみ。lookAt/lookAway はサーボ不要。renderer 内部に独自の 6 秒周期ボブ（breath フィールド）があり mod の 10 秒呼吸と非同期な点は深呼吸設計時に要整合
- **サーボ**: `main.ts` の `breathHostMod ? 'none'` ハードゲートのためパッチ必須。setTorque WDT は静的に再現せず実機再検証が必要
- **IMU・LED**: `robot.imu` 生成済み、'shake' 等の動き分類 API が既製。LED は PY32 実ドライバあり、`robot.led.head` 生成済みのはず

### Phase 1 — 鳴き声パイプライン（Loop A 開通）

- [ ] `overlay/tools/cry/synth.py` でシンセトポロジーを確定（Mac 上で私が afplay 試聴しながらアルゴリズム探索 → ユーザーと方向性だけ合意）
- [ ] デバイス側シンセ `overlay/mods/breath/cry.js`（レシピ実行 + ゆらぎ + generate-ahead キャッシュ）
- [ ] dev サーバに `PUT /cry/params`・`POST /cry/<name>`（試し鳴き）を追加
- [ ] murmur と sigh の 2 レシピを **実機上の Loop A** で作り込む（毎回のゆらぎ幅も含めて）

### Phase 2 — 生存感エンジン（Loop B 開通）

- [x] idle scheduler 実装（視線の微揺らぎ・深呼吸・まれな murmur。`overlay/mods/breath/liveliness.js`。まばたき揺らぎは Phase 0 調査で自動まばたきが既に動作中と判明したため本 Phase 2a のスコープ外）
- [x] dev サーバ `GET/PUT /params`（JSON・Preference 永続化。`overlay/mods/breath/dev/dev-server.js`）
- [ ] ユーザーと Loop B を回してパラメータ確定 → 既定値化
- [ ] サーボ・LED の ON 実験（駆動音・光の主張が気配を壊さないか）

### Phase 3 — 微反応（Loop C 開通）

- [ ] **3a マイク観測基盤**: `overlay/mods/breath/mic.js`（`robot.microphone` から連続レベル解析）+ マイクレベルの UDP ストリーム + `GET /mic`（現在レベル・状態・直近イベント）。**デバイスの振る舞いは変えない**（観測のみ、部屋の実レベルで閾値を校正する）
- [ ] **3b イベント化**: loud / clap / voice / silence の検出 + 自己音ゲート + `PUT /mic/params` ライブ調整。イベントは trace のみ（拍手・発話・無音をユーザーが演じ、UDP ログで判別精度を確認する Loop C）
- [ ] **3c 総合的な動きの作り込み**: 顔・音・サーボを組み合わせた反応を**一つずつ**（例: 大きな音 → startle 鳴き + まばたき + 呼吸一拍止め。「間」の原則 = 反応まで 300ms〜1.5s の余白）
- [ ] 頭頂タッチの微反応
- [ ] IMU 反応の試行（オフ既定）

### Phase 4 — 統合と同席観察

- [ ] 全要素の頻度バランス最終調整（「沈黙が正しい」に照らす）
- [ ] 同室 2〜10 人での同席観察
- [ ] journal（`/write-journal`、ユーザー口述）
- [ ] tag `v1.1.0`

---

## 積み残し（v1.0.x から）

- [ ] v1.0.2: 再起動後の明るさ・音量保持の受動確認（次回電源断時に設定バーを見るだけ）
- [ ] 開発環境 Phase 3（任意）: OTA ロールバック / trace リングバッファ + `GET /logs` / OTA 中の呼吸停止
