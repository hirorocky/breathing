# v1.1.0 — 生き物の気配（鳴き声・微挙動・微反応）

**v1.0.2**（設定バー、tag `v1.0.2`）の次。StackChan を「生き物っぽく」する — ただしペットのような能動的な芝居ではなく、**そこに生きている気配**として。最終的に同室 2〜10 人の同席観察（`docs/concept-v1/01-purpose.md` の本題）で確かめる。

参照: [concept-v1/03-interactions.md](../concept-v1/03-interactions.md)（Layer 設計・原則） · [elegnt-expression-design.md](elegnt-expression-design.md)（表現の設計台帳） · [emotion-space-scenarios.md](emotion-space-scenarios.md)（感情空間とシナリオ 20 の原本）

---

## 設計ガードレール（concept-v1 から）

| 原則 | この版での意味 |
|---|---|
| 稀で・弱く | 鳴き声・ランダム挙動は「沈黙が正しい」を既定に。頻度と強さは FB ループの主チューニング軸 |
| 非指示・第三焦点 | 音や動きで「こっちを見ろ」と要求しない。返答・会話はしない |
| 間 | 反応には 300ms〜1.5s の余白。即時反応は機械っぽさ・攻撃性になる（反射 startle のみ例外） |
| 非線形 | 挙動の間隔は固定周期にしない（ポアソン的なランダム） |

### concept との緊張点（明示して観察で判定する）

1. **スピーカー**（指針は「原則ミュート」）: *soft/short/rare* の鳴き声で挑戦中。murmur・startle・touch の 3 レシピが稼働、**sigh は不採用**（ため息に聞こえ場の空気を下げる — `sighProb: 0`。深呼吸は無音で確定）。最終判定は Phase 4 の頻度バランス。存在負荷が上がれば設定バーで即音量 0 にできる
2. **マイク**（指針は OFF）: 禁止は音声 Q&A・ウェイクワード。稼働中のマイク基盤は**受動原則を維持** — 音声内容は一切扱わず（録音・認識・送信なし）、扱うのはレベル値と特徴量のみ
3. **カメラ**: 「監視・評価感を避ける」の指針どおり**スコープ外のまま**。「気づいてる感」は音・タッチで近似する

---

## 現在の状態（2026-07-08）

実機 buildId `6fe3dfd-011220`。更新は Wi‑Fi OTA（`overlay/scripts/ota-deploy.sh`、ホスト省略で IP 自動発見）。breathing リポジトリは `2eff98e`、fork（stack-chan/ breath ブランチ）も push 済みで一致。

### チューニングの回し方（全領域共通）

```
Claude: PUT /<領域>/params でライブ変更（デプロイ不要） → ユーザー: 実機を観察して FB
→ 確定値をモジュールの既定値へ焼き込み → コミット
```

音（cry）はレシピ JSON なのでレシピ調整も OTA 不要。OTA が要るのはコード自体の変更時のみ。

### 稼働中のコンポーネント

| モジュール | 役割・確定済みの既定値 | API |
|---|---|---|
| `mod.js` | 呼吸ループ（吸 4s/吐 6s + jitter、emotion の breathFactor で伸縮）。段階起動 +2s bars → +3s dev → +4s cry → +5s liveliness → +6s mic → +7s reactions → +8s emotion → +9s led → +10s posture | — |
| `face/`（B 案 Cozmo） | 白い角丸の目 2 つ・口なし。呼吸 = 脈動（pulseDepth 0.24）+ **上下ボブ 75px**（吸うと浮く）。表情は occluder 変形のみ: topLid（眠気）・topAngle（険しさ）・scale/lift（覚醒）。**botArc（笑い目）は廃止 — 喜びは LED・声色担当** | 計器: `GET /status` の `dbgGaze`、`GET /emotion` の `dbgEye`/`dbgPulse` |
| `liveliness.js` | ポアソン的サッカード・深呼吸・まれな murmur。gaze{meanInterval 9s, amplitude **0.8**（サーボ騒音対策の暫定 — E3.1 後に 1.0 へ）, pixelScale 40} | `GET/PUT /params`、`POST /live/gaze` `/live/deep-breath` |
| `cry.js` | デバイス内シンセ（レシピ + 再生ごとのゆらぎ + generate-ahead）。レシピ: murmur（寝息）・startle（yelp/kyu/double 抽選）・touch（最も柔らかい） | `PUT /cry/params`、`POST /cry/<name>` |
| `mic.js` | 48kHz/2ch。100ms 窓の rms/peak → loud/clap/voice/silence 検出 + TDOA 方向推定。既定値: loud.peakMin 1500 / clap.ratioMin 8 / voice.rmsMin 110×3 窓 / silence.rmsMax 60×5 分 / lagSideMin 25。**lag は 16kHz 換算・負 = ユーザー視点で左・正 = 右**（E2E 目視確認済み） | `GET /mic`、`PUT /mic/params`、UDP 8688（`mic-monitor.sh`） |
| `reactions.js` | clap/loud → 不応期 8s → 間 200〜600ms → 音のした側へ一瞥（首は lookAt 自動追従）→ 1〜2.5s 保持 → 中央。15% で startle 鳴き + のけぞりリコイル | `GET/PUT /react(/params)`、`POST /react/startle`（dir 指定可） |
| `emotion.js` | Russell 円環 (v,a)。指数回帰（τ≈180s、ベースラインやや快 +0.2）+ 微ノイズ + 時刻変調 + マイク/タッチ入力。派生モディファイア（speed/gain/breath/recovery/sleepy）が呼吸・サッカード・murmur・startle・表情・LED・姿勢を連続変調 | `GET /emotion`、`PUT /emotion/state` `/emotion/params`、`POST /emotion/scenario {id:1..20}` `/emotion/touch` |
| `led.js` | 12 連を個別制御。色相 = v（白⇄琥珀⇄桜/青⇄藍）、暗さは**点灯数**（空間エンベロープ、呼吸で伸縮）。γ2.2 LUT。startle 白波・touch 暖色波 | `GET/PUT /led(/params)`、`POST /led/test` `/led/set` `/led/sweep` |
| `posture.js` | 感情 → 見上げ角 = clamp(10 + v·6 + a·8, 0, 24)°、sleepy=0。レート制限 45s/4°。startle リコイル 3°/0.5s/1.8s | `GET/PUT /posture(/params)`、`POST /posture/test` |
| `status-bar.js` / `settings-bar.js` | 上端から下スワイプ = 時刻・バッテリー / 下端から上スワイプ = 明るさ・音量 | — |
| `dev/` | UDP trace（8686）・IP ビーコン（8687）・`GET /status`・`PUT /ota` | `overlay/scripts/{logs,stackchan-ip,ota-deploy}.sh` |

### 制約・教訓（今後の作業で守ること）

書き込み経路・I2S ピン共有・manifest の defines 罠などの環境系は `CLAUDE.md` が正。ここには挙動設計に効くものだけ残す。

- **overlay モジュールに Promise/async を書かない**（unhandled rejection → XS abort → 再起動）。robot の async API は `.then(undefined, e => trace(...))` で受け、例外は握って trace のみ
- **tilt は「見上げ角」のみ**（ドライバが −p を 0〜90° にクランプ）。うつむきは水平（0°）で近似するしかない
- **サーボ READ は全タイムアウト**（WRITE は正常 — 書き込み専用バス疑い）。姿勢フィードバック無し前提で設計する。毎秒の `timeout.` trace スパムは E3.1 で抑止予定
- **LED は点灯色値 ≥48 を死守**（RGB565 量子化で低輝度は色相が壊れる）。暗さは点灯数で作る
- **方向推定は破裂音のみ**（連続音は反響で不可）。至近の爆音は ADC クリップでラグの大きさが潰れる — 符号は信じる・大きさは参考
- 定常 CPU: mic 処理 ~9〜12k µs/100ms 窓。呼吸のカクつきが見えたら peak 走査の間引き強化で下げる
- **エージェント作業中に他者（親セッション含む）がデプロイしない**（中間状態を焼くフランケンビルド → 描画凍結の実績）
- E2 期に一度だけ OTA 後に Wi‑Fi setup モードへ入った（単発）。再発したら記録する

---

## 残タスク（Phase 4 に入る前に消化する）

### 実装

- [ ] **E3.1 サーボ静音の根本対応**: ①首追従の follow-ratio（首は視線の 5 割だけ・ゆっくり追う。シナリオ #8「目が先・頭が後」の staging と同じ機構）②命令角の自前追跡（READ 不能のため現在角を posture.js が記憶し、recoil・mood shift が yaw を 0 に叩き戻さないようにする）③`getRotation` 毎 100ms の READ タイムアウト trace 抑止。完了後に liveliness の gaze amplitude を 0.8 → 1.0 へ戻す
- [ ] **LED 物理配置の確認と layout 補正**: `POST /led/sweep` で 0 番から順に点灯 → ユーザーが「光る順番・2 本のバーへの割り当て」を目視報告 → `led.js` の layout（並び・分割・向き）を補正。端からの色相遷移・呼吸エンベロープの見た目の評価はこの補正後
- [ ] **3c 残り（ELEGNT 台帳順、詳細は `elegnt-expression-design.md`）**:
  - 一瞥（voice）: voice イベント（rms 110×3 窓）でも一瞥。clap より長い間・短い保持・低確率（声は方向推定不可 → 正面 or 直近の loud 方向）
  - γ(場) 勾配: silence 継続 → liveliness のゲイン全体を下げ、voiceActive → やや上げる。**シナリオ #14/#15 と同体** — シナリオ調整をもって完了とする
  - 深呼吸の予備動作: 深呼吸の直前に小さな沈み（anticipation）を入れる
  - うたた寝: 静けさ + 快が続くと目が閉じ、たまに薄く開く。**シナリオ #3/#4 と同体**
- [ ] **頭頂タッチの物理配線 + 微反応**: 現状 `emotion.pushTouch()` は `POST /emotion/touch`（手動）のみで**物理タッチは未配線**。画面（顔領域）タップ → pushTouch を配線する。制約: 上端・下端のスワイプゾーンと非干渉にする、全画面 `active` オーバーレイは使わない（touch-debug で PIU 不安定化の疑い）。配線後に touch 音・LED 暖色波・v+ の一連を実機評価
- [ ] IMU 反応の試行（`robot.imu` の 'shake' 分類のみ・オフ既定）。優先度低 — **v1.1.0 から落としてよい**

### 評価・判定（ユーザーとの実機セッションが必要）

- [ ] **サーボ駆動音の総合判定**（concept-v1 の宿題「サーボの取捨」の最終回答）: 緩和後の駆動音が気配を壊すか。壊すなら姿勢系を既定オフに落とす
- [ ] **一瞥の質感評価**: 間（200〜600ms）・保持（1〜2.5s）・戻りの速さ、startle 鳴き 15% の体感頻度
- [ ] **シナリオ 20 の取捨選択 + 実機調整**（下表。残タスクの本体）
- [ ] v1.0.2 積み残し: 再起動後の明るさ・音量保持の受動確認（次回電源断時に設定バーを見るだけ）

### シナリオ 20 の調整表

手順: `curl -X POST .../emotion/scenario -d '{"id":N}'` で発火 → 同席観察 → `PUT /emotion/params`（必要に応じ `/led/params` `/posture/params` `/params` `/react/params`）でライブ調整 → **採用なら既定値化・不採用なら台帳から削除**。空間定義・力学・各シナリオの原文は `emotion-space-scenarios.md`（Q1 = 快×覚醒 … Q4 = 快×沈静）。

| # | 名前 | 主な調整ノブ | 採否・concept 照合の観点 |
|---|---|---|---|
| 1 | ごきげん | LED 色相（白⇄琥珀）の見え方、speedFactor/gainFactor 上限、murmur 音色の明るさ | 「反応が速く大きい」が主張になりすぎないか（低攻撃） |
| 2 | はしゃぎ疲れ | 高覚醒→滑落の時定数（何分で減衰開始か）、減衰の知覚可能性 | 減衰が「故障」に見えないか |
| 3 | まどろみ | topLid 下がり量、まばたき伸長、呼吸周期の伸び、寝入りまでの静けさ時間、薄目の頻度 | 3c「うたた寝」と同体。寝顔が「電源切れ」に見えないか |
| 4 | 寝起きの微覚醒 | 睡眠中の startle 抑制閾値（反射殺し）、薄目見回しの速度 | 「驚かない安心感」が成立するか |
| 5 | 不機嫌 | topAngle の険しさ上限、視線外しの頻度、低い音の頻度 | **要照合**: 怒り顔が人への評価的フィードバックに見えないか |
| 6 | 疑心暗鬼 | 一瞥速度、細目凝視の持続、視線を外すまでの間 | **要照合**: 凝視が「監視感」にならないか |
| 7 | 驚きの色分け | recoveryFactor の快/不快差、不快側の固まり時間 | 同一反射・異なる余韻が観察者に伝わるか |
| 8 | 好奇心 | 目が先・頭が後の staging 遅延（E3.1 の follow-ratio と同じ機構）、注視時間、v+ 報酬量 | 注視が「こっちを見ろ」（指示）にならないか |
| 9 | 退屈 | Q3 への漂流時定数、サッカード減の量、目の下向き量 | 沈み方が自然か（無変化検出は silence イベント由来） |
| 10 | 退屈の自己刺激 | バースト頻度の上限（誘いにならない線）、murmur 音量 | **要照合**: 頻度を誤ると「誘い」= 非指示違反 |
| 11 | かまってもらえた | touch 音の柔らかさ、LED 暖色パルスの強さ、連続タッチでの Q1 到達カーブ | 喜び表現は LED・声色のみ（botArc 廃止済み）で足りているか。頭頂タッチの物理配線が前提 |
| 12 | 触られすぎ | 反転閾値（既定: 60 秒内 4 回以上）、視線外しの質感、回復時間 | **要照合**: 「もういい」が人への拒絶評価に見えないか |
| 13 | 萎縮 | 反応縮小の勾配、回復に要する静けさ時間 | 萎縮と慣れの区別が伝わるか。実演には startle 連発が必要（負荷注意） |
| 14 | にぎやかな部屋 | voiceActive 判定の安定性、表現ゲインの上げ幅 | γ(場) 勾配の実装と同体。第三焦点の心地よさになっているか |
| 15 | 静かな作業部屋 | silence 判定（rmsMax 60×5 分）の妥当性、γ≈0 時に残す最小表現 | 表現ゼロが「死んでいる」に見えないか — 「沈黙が正しい」の本丸 |
| 16 | 朝の立ち上がり | 起動直後の初期 (v,a)、時間帯判定、半開きの見た目、覚醒までの時間 | 朝の実時間でしか検証できない（セッション計画に注意） |
| 17 | 夜更け | arousal 上限の低下量、startle 縮小率・回復遅延 | 深夜の実時間でしか検証できない。時刻変調の器の形が妥当か |
| 18 | 機嫌の回復儀式 | 様子見一瞥のタイミング、LED 暖色一瞬の長さ | **要照合**: 儀式が「演技」（芝居がかり）にならないか |
| 19 | いじけ | 薄目応答までの一拍の長さ、回復勾配 | **要照合**: 受け入れ保留が人への罰に見えないか |
| 20 | 場の共鳴 | —（声の質統計が未実装。レベル変動の統計のみ使う設計） | **v1.1.0 スコープ外の候補**。実装するなら受動原則の再確認必須 |

- #5/#6/#12/#18/#19 は「評価的フィードバック禁止」との緊張が既知 — 採否判断はこの観点を最優先にする
- #3/#4（うたた寝系）と #14/#15（γ(場)系）は 3c 残りタスクと同体 — シナリオ調整をもって 3c 完了とみなす
- #16/#17 は時刻依存 — 朝・深夜の実時間セッションが必要。他は任意時刻に `POST /emotion/scenario` で再現可能

### 任意（v1.1.0 のスコープ外・やってもよい）

- [ ] 本家 stack-chan への `robot.ts` sin 修正の PR（文面下書きから）
- [ ] サーボ READ 全タイムアウトの根本調査（書き込み専用バス疑いの確定 — E3.1 の trace 抑止で実害は消える）
- [ ] `param-store.js` への liveliness.js 移行（動作中コードのため保留中）
- [ ] 開発環境の拡張: OTA ロールバック / trace リングバッファ + `GET /logs` / OTA 中の呼吸停止

## Phase 4 — 統合と同席観察（v1.1.0 の締め）

- [ ] 全要素の頻度バランス最終調整（「沈黙が正しい」に照らす。スピーカー実験の最終判定もここ）
- [ ] 同室 2〜10 人での同席観察
- [ ] journal（`/write-journal`、ユーザー口述）
- [ ] tag `v1.1.0`

---

## 完了記録（要約。詳細は git log と各モジュールのコメント）

- **2026-07-06 Phase 0 技術調査**: XS 上の JS 合成は generate-ahead で実用（サインテーブルは逆に遅い）、`robot.tone` は AudioOut 再利用不可で cry.js と排他、自動まばたきは既製、サーボは main.ts ゲートで封印されていた — 要点は「制約・教訓」と CLAUDE.md に吸収済み
- **2026-07-06 Phase 1 鳴き声（Loop A）**: `cry.js` + `synth.py`。murmur・startle・touch のレシピ確定、sigh 不採用
- **2026-07-07 Phase 2 生存感（Loop B）**: `liveliness.js` + `GET/PUT /params`。確定値は既定値へ焼き込み済み
- **2026-07-07 顔の再設計 B 案（Cozmo 理念）**: 瞳可動域 ±8px の構造限界 → 目全体が動く方式へ。`face/`（eye-cozmo / breath-face / renderer-breath）。確定レシピ eyeW 57/eyeH 68/spacing 122/centerY 118。upstream の `gazeX = cos(yaw)` バグ（偶関数で方向が消える）を sin に修正（PR 候補）
- **2026-07-07 Phase 3a/3b/3b+ マイク**: 観測 → イベント化 → TDOA 方向推定。I2S ピン共有によるマイク全ゼロ化を suspend/resume + ウォッチドッグで解決。48kHz 化で L/R 分離を完成（3cm 間隔の物理限界 Δt_max 87.5µs に対し 16kHz は分解能不足だった）。校正値・座標系は「稼働中のコンポーネント」の mic.js 行が正
- **2026-07-07 fork 移行**: パッチ + dirty submodule 方式を廃止し、fork hirorocky/stack-chan の breath ブランチへ（運用は CLAUDE.md「fork ブランチ運用」）
- **2026-07-07〜08 E1/E2/E3 感情エンジンと全アクチュエータ統合**: emotion.js（20 シナリオ発火可）・LED 環境光・サーボ解禁 + 感情姿勢。tilt の可動域（見上げのみ）を実機特定
- **2026-07-08 FB 反映**: E2.1 LED 個別制御化（RGB565 量子化対策 = 色値フロア + 空間エンベロープ）、botArc 廃止、呼吸ボブ 75px 確定、サーボ騒音の緩和値既定化（E3.1 の根本対応は残タスク）
