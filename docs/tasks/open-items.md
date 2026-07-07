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

- [x] **3a マイク観測基盤**: `overlay/mods/breath/mic.js`（`robot.microphone` から連続レベル解析）+ マイクレベルの UDP ストリーム（port 8688、`overlay/scripts/mic-monitor.sh` で受信）+ `GET /mic` / `PUT /mic/params`。**デバイスの振る舞いは変えない**（観測のみ）。2026-07-07 実機開通:
  - `robot.microphone.onReadable` の `this` は素の AudioIn（lip_sync と同型）。レベルはネイティブ `level()`（バッファ全体の平均絶対値。RMS 代替）、ピークは 4 サンプル間引きの JS 走査
  - 静かな部屋の実測: rms 25〜126（典型 50〜80）、peak 80〜530（典型 200〜300）
  - 処理コスト avgProcUs ≈ 5000〜7000µs / 100ms 窓（CPU ~5〜7%）。呼吸・視線・cry への影響なし（4 分観察で abort・再起動なし）
  - **onReadable の到着間隔は 150〜600ms と揺れる**（厳密な 100ms 周期ではない）— 3b の閾値・アタック検出はこの粒度を前提に設計する
  - 汎用化した `overlay/mods/breath/param-store.js`（mergeValidated / clamp / Preference 永続化）を新設。liveliness.js の同パターン移行は別の機会（動作中コードに触らない）
  - **ハード制約バグを発見・修正**（2026-07-07 実機特定）: CoreS3 はスピーカー（AW88298/AudioOut）とマイク（ES7210/AudioIn）が I2S クロックピン（BCK=G34/LR=G33）を共有しており、**AudioOut を open した瞬間からマイク入力が全ゼロになり close 後も自然復旧しない**（capture の stop/start でのみ復活）。対処 2 段構え: (1) cry.js が再生前 `suspendCapture()` → close +500ms 後 `resumeCapture()`（全終了経路で resume 保証 + closeDeadline で異常系も保証。自己音ゲートの土台を兼ねる）、(2) mic.js にゼロ・ストール・ウォッチドッグ（ゼロ窓 15 連続 → capture 再起動、最短 10 秒間隔）。murmur ×2 で復旧を実機検証済み
  - 残課題（3b に同梱）: `settings-bar.js` の音量確認ビープ（`robot.tone`）も同じ問題を起こす（現状はウォッチドッグが数秒で自動復旧させる）。3b デプロイ時に suspend/resume を配線する
- [x] **3b イベント化**（2026-07-07 実機開通）: loud / clap / voice / silence の検出（closeWindow 内 O(1)、`detectEvents`）+ `PUT /mic/params` ライブ調整 + イベントリング（`GET /mic` の `events`/`state`）+ UDP ストリームの `ev` フィールド + `onMicEvent(cb)` 購読 API（3c 用）。settings-bar のビープにも suspend/resume を配線済み
  - 校正セッション（2026-07-07、デバイスから 1〜2m）による閾値既定値: 拍手 = peak 6,100〜20,300・**peak/rms 比 13〜17**、声 = rms 100〜165・比 2〜3.4、静音フロア = rms 中央値 24・最大 99 → `loud.peakMin 3000 / clap.ratioMin 8 / voice.rmsMin 110×3窓 / silence.rmsMax 60×5分`
  - 検証中に実環境音が校正どおり判別された（clap 比 16.2・25.8、voice 比 3.0）。murmur は suspend/resume ハンドシェイクにより自己イベント誤検出ゼロ
- [x] **3b+ 方向推定・実装**（2026-07-07 配備済み。ユーザー要望「大きな音が鳴った方を向く」）: loud チャンク内で TDOA（ch0×ch1 相互相関、ラグ ±4 @16kHz）+ チャンネル別レベル（l0/l1）。loud/clap イベントに `lag`/`l0`/`l1` が付く。`params.direction {enabled, maxLag}`。対象は破裂音のみ（連続音は反響で不可）。これが入ると ELEGNT 台帳の「方向つき一瞥」が解禁（能力の正直さ充足）
  - **重大発見**: デバイス定義は `numChannels: 2` を宣言していたのにビルド解決は **1（モノラル）**に落ちており、片チャンネルを黙って捨てていた → `manifest_breath_deploy.json` に `defines.audioIn.numChannels: 2` を明示して真のステレオ化（`mc.defines.h` で NUMCHANNELS(2) を確認済み）
  - コスト実測: 方向推定は 41〜93ms/回（loud 時のみ・refractory ゲート付き。3c では startle の呼吸停止と同じ瞬間なので実害薄）。定常 avgProcUs はステレオ化で ~15,000〜24,000µs（CPU 15〜24%）に増加 — **要観察項目**（呼吸のカクつきが見えたら peak 走査の間引き強化で下げられる）
  - afplay 実験: ch0 が一貫して大きい・lag は位置固定で安定。ただし Mac スピーカーの位置が未統制のため意味付けは保留
- [x] **3b+ L/R 実地確定**（2026-07-07 検証セッション ×2）: 初回（ピーク基準 256 ペア窓 = 16ms）は左右が分離せず → **オンセット基準の短窓（前 16・後 48 = 4ms）+ 相関ピークの放物線補間（サブサンプル、`lagX100`）**に改良して分離達成
  - 確定した対応: **lag 正 = ユーザー視点で左 / 負 = 右**（ch0 = 左マイク。マイクはカメラの左右、間隔 ~3.6cm — 至近テストの最大ラグ 1.7 サンプル ≈ 経路差 36mm と一致）
  - 方向バケット案: `|lagX100| >= 60` で左右、それ未満は中央（3c でライブ調整）
  - 既知の限界: 至近の爆音は ADC クリップ（peak 32768）でラグの大きさが 0 寄りに潰れる（符号は保たれる）→ 3c は「符号は信じる・大きさは参考」で設計。連続音（声）の方向推定は対象外のまま
  - 教訓: 拍手の方向情報は直接音の最初の 1〜2ms にしかない。ピーク基準の広い窓は部屋の反射音が支配して方向と無関係のラグを出す
- [x] **3b+ 48kHz 化で L/R 分離を完成**（2026-07-07。上の項の符号マッピング・±60 バケットは本項で更新）: 右マイク（MIC2）の音響結合が弱く、間隔 3cm の物理限界 Δt_max = 87.5µs は **16kHz でわずか ±1.4 サンプル**（正面付近で 1 サンプル ≈ 40°）— 右側の小さなラグが量子化に沈んでいた → manifest `defines.audioIn.sampleRate: 48000`（fork コミット `0e713ba2`）で分解能 3 倍（1 サンプル ≈ 14°）。mic.js はレート非依存化（`rateFactor` キャッシュ、**lag は常に 16kHz 換算で正規化** — 閾値・過去記録の意味を保存。方向推定は粗密 2 段探索で 63〜170ms、定常 avgProcUs ~9〜12k µs）
  - ラベル付き判定（「左やった/右やった」のメッセージ区切り方式）: **左 = −1.25 / 右 = +1.38**。理論最大 1.4 にほぼ張り付き = ほぼ真横の拍手として物理と完全整合。**確定: 負 = ユーザー視点で左 / 正 = 右**
  - **エンドツーエンド目視確認**: dir=+1 一瞥 → 実測 +26.5px → ユーザー「右に動きました」✓。右拍手 → 正ラグ → 右向き一瞥のチェーン完成。`invert` は false のままで正しい
  - 途中の「全て左を向く」報告は**バグではなかった**: ランダムな間・保持での観察タイミングずれ + 環境音反応（dir=0/−1）の混入 + 左右の座標系の行き違い。調査用に `GET /status` へ `dbgGaze`（eye-cozmo の実描画オフセット px）を常設 — 以後の視線検証は画面を見ずにできる
  - 確定既定値: `loud.peakMin 1500`（1m の普通の拍手 1200〜6500 を確実に拾う。声・フロアは ~550 以下）・`lagSideMin 25`（左右 ±125↑ と正面 ±20 の間に十分な余白）
- [ ] **3c 総合的な動きの作り込み**: 顔・音・サーボを組み合わせた反応を**一つずつ**。**設計台帳: `docs/tasks/elegnt-expression-design.md`**（ELEGNT の 4 語彙 intention/attention/attitude/emotion × StackChan アセットのマップ、実装順、ガードレール）
  - [x] **ステップ 1「startle + 方向つき一瞥」実装・配備**（2026-07-07、`overlay/mods/breath/reactions.js`）: clap/loud → 不応期 8s → 間 200〜600ms → 音のした側へ `lookAt`（lagX100 の符号、`|lag|<60` は正面、`invert` フラグあり）→ 1〜2.5s 保持 → 中央へ。15% で startle 鳴き。一瞥中は liveliness の `deferGaze(ms)` で idle 視線を抑制。`GET/PUT /react(/params)` + `POST /react/startle`（手動発火、dir 指定可）。実機で実際の拍手 → 自動発火まで確認済み
  - [x] 検証中に発見・修正: **capture 再開直後 ~300ms の ADC 過渡ポップ**（peak 20480・片チャンネルのみ）が偽 clap になる → mic.js に再開後 400ms のイベントミュート（`armPostRestartMute`。rms/peak の観測は止めない）。修正後 murmur×3 + startle 鳴きで自己トリガゼロ
  - [ ] ユーザー目視: 一瞥の方向が音源と一致するか（**invert 未検証** — 逆なら `PUT /react/params {"glance":{"invert":true}}`）、間・保持・戻りの質感、cry 頻度 15% の体感
  - [ ] 次ステップ候補（台帳順）: 一瞥（voice 立ち上がり）→ γ(場) 勾配（silence/voiceActive で liveliness パラメータ切替）→ 深呼吸の予備動作
- [ ] 頭頂タッチの微反応
- [ ] IMU 反応の試行（オフ既定）

### E フェーズ — 感情 2 次元エンジンと全アクチュエータ統合（2026-07-07〜08、ユーザー指示「一旦全てを実装」）

台帳: `docs/tasks/emotion-space-scenarios.md`（空間定義・力学・シナリオ 20）。

- [x] **E1 感情エンジン + 表情変形**: `emotion.js`（(v,a) 指数回帰 + 微ノイズ + 時刻変調 + マイク/タッチ入力 + 派生モディファイア）。eye-cozmo に occluder 方式の表情変形（topLid/topAngle/botArc/scale/lift）。呼吸・サッカード・murmur・startle を連続変調。`POST /emotion/scenario {id:1..20}`・`PUT /emotion/state`・`POST /emotion/touch`・`GET /emotion`。全 20 シナリオ 200 応答・再起動ゼロ
- [x] **E2 LED 環境光**: `led.js`（4Hz dirty-check。色相 = 快、明るさ = 覚醒 × 呼吸ゆらぎ、最大 18/255。sleepy 消灯、loud/clap で白ブースト、touch で暖色パルス）。`GET/PUT /led(/params)`・`POST /led/test`
- [x] **E3 サーボ解禁 + 感情姿勢**: fork でゲート解除（`driverKey` は明示 config 優先）+ **NoneDriver ブートフォールバック** + 首追従閾値を config 化（breath は 45°）。`posture.js`（感情 → 見上げ角、45s+/4°+ のレート制限、startle のけぞりリコイル、`POST /posture/test`）。一瞥の首追従は lookAt 自動連動
- [x] **tilt の符号と可動域を実機特定**: ドライバは `-rotation.p` を 0〜90° にクランプ = **機構は水平〜見上げしか動けない**。正の pitch を送ると全て 0 にクランプされ不動（初回テストで yaw だけ動いた原因）。posture.js は「見上げ角」セマンティクス（0 = 水平が最下）に統一し、うつむきは水平で近似
- 既知の未解決: サーボ **READ が全タイムアウト**（WRITE は正常 — 書き込み専用バスの可能性。`rotationDeg` は常に 0,0。実害は姿勢フィードバック無しのみ）。E2 の 2 回目 OTA 後に一度だけ Wi-Fi setup モードに入り物理リセットが必要だった（単発・要観察）
- 未検証（ユーザー評価待ち）: サーボ駆動音の印象（concept-v1 の宿題）、表情変形・LED の見た目の質、シナリオごとのチューニング
- [x] **E2.1 LED 個別制御化**（2026-07-08 FB「白が明るすぎ・5 色に離散化・呼吸が見えない・個別制御を」）: 全 LED を暗くする方式は RGB565 量子化で色相が破壊されると特定 → **点灯 LED は色値フロア（≥48）死守・暗さは点灯数（空間エンベロープ）で作る**方式へ全面改修。γ2.2 LUT・端からの色相遷移・呼吸でエンベロープが伸縮・startle 白波（輝度は旧比大幅減）・touch 暖色波・`POST /led/sweep`/`/led/set`（配置調査用）。5 段階 v 色チェックで全色相異を実測
- [x] **笑いの下弧（botArc）廃止**（2026-07-08 FB「笑ったときの目に違和感」）: 喜びは LED・声色へ一本化。目の変形は topLid（眠気）・topAngle（険しさ）・scale/lift（覚醒）に純化
- [x] **呼吸ボブ追加**（2026-07-08 FB「サイズが変わりつつ上下もする」）: 吸うと目が浮き吐くと沈む。`face.breathBobPx`、**ユーザー確定 75px**（吸気ピークで画面上端すれすれ — 大きな浮き沈み）
- [x] **サーボ騒音の緩和値を既定化**（2026-07-08 FB「移動量が大きい・速いとうるさい」）: recoil 0.5s/1.8s/3°・mood shift 1.8〜2.6s・gaze amplitude 0.8（idle で首追従が発動しない）。フランケンビルド事故（エージェント作業中の並行デプロイで描画凍結）は再デプロイで解消 — **教訓: エージェント実行中は他者がデプロイしない**
- [ ] **E3.1 サーボ静音の根本対応**（積み残し）: 首追従の follow-ratio（首は視線の 5 割だけゆっくり追う）+ 命令角の自前追跡で recoil/mood shift が yaw を 0 に叩かないように + `getRotation` 毎 100ms READ タイムアウト（毎秒 `timeout.` trace スパム）の抑止。導入後 gaze amplitude 1.0 へ戻す

### Phase 4 — 統合と同席観察

- [ ] 全要素の頻度バランス最終調整（「沈黙が正しい」に照らす）
- [ ] 同室 2〜10 人での同席観察
- [ ] journal（`/write-journal`、ユーザー口述）
- [ ] tag `v1.1.0`

---

## 積み残し（v1.0.x から）

- [ ] v1.0.2: 再起動後の明るさ・音量保持の受動確認（次回電源断時に設定バーを見るだけ）
- [ ] 開発環境 Phase 3（任意）: OTA ロールバック / trace リングバッファ + `GET /logs` / OTA 中の呼吸停止

## 完了記録

- [x] **2026-07-07 stack-chan を fork の breath ブランチへ移行（パッチ方式廃止）**: `.gitmodules` を fork [hirorocky/stack-chan](https://github.com/hirorocky/stack-chan) の `breath` ブランチへ切替（origin = fork・ssh push、upstream = 本家・push disabled）。`overlay/patches/` による `git apply` + dirty submodule 方式を廃止し、ファーム変更は submodule 内で直接編集・コミット → `push origin breath` → breathing 側で gitlink 更新をコミットする 2 段運用に統一。deploy マニフェスト（`manifest_breath_deploy.json`）・`mod-cores3.sh` の原本も fork 内へ移動。改変ファイル一覧は fork 直下 `BREATH-CHANGES.md`（Apache-2.0 §4(b)）で管理
