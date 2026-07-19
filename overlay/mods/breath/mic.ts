import type { ClampRanges } from 'breath/param-store'
import { deepClone, loadParams, mergeValidated, persistParams, sanitizeParams } from 'breath/param-store'
import { Socket } from 'socket'
import Time from 'time'
import Timer from 'timer'

interface AudioInLike {
  readonly channels?: number
  readonly sampleRate?: number
  level?(buffer: ArrayBuffer): number
  read(byteLength: number): ArrayBuffer | undefined
}

interface MicrophoneLike {
  onReadable?: (this: AudioInLike, byteLength: number) => void
  start(): void
  stop(): void
}

interface RobotWithMicrophone {
  microphone?: MicrophoneLike
}

interface UdpSocket {
  write(host: string, port: number, data: ArrayBuffer): void
}

type UdpSocketConstructor = new (options: { kind: 'UDP' }) => UdpSocket
type MicEventType = 'loud' | 'clap' | 'voice' | 'silence'

interface MicWindow {
  t: number
  rms: number
  peak: number
}

interface DirectionEstimate {
  t: number
  lag: number
  lagX100: number
  corrPeakRatio: number
  l0: number
  l1: number
}

interface MicEvent extends MicWindow {
  type: MicEventType
  lag?: number
  lagX100?: number
  l0?: number
  l1?: number
}

type MicEventListener = (event: MicEvent) => void

/**
 * v1.1.0 Phase 3a — マイク観測基盤(レベルのみ)。
 *
 * デバイスの見た目・振る舞いは一切変えない(イベント検出・反応は次フェーズ 3b)。
 * 音声の内容(波形の録音・保存・認識)は絶対に扱わない — レベル値と特徴量のみ
 * (プロジェクトの受動原則)。
 *
 * `robot.microphone` は `stackchan/microphone.ts` の `Microphone` ラッパー
 * (内部で単一の `embedded:io/audio/in` を保持)。`onReadable` はラッパー越しに
 * 素の `AudioIn` を `this` で渡してくる(`mods/lip_sync/mod.js` と同じ形)ため、
 * `this.read(...)` / `this.level(...)` がそのまま使える。CoreS3 は
 * 16kHz/16bit/2ch(I2S port1)— `level()` は素のネイティブ実装で
 * 「バッファ全体を int16 とみなした平均絶対値」を返す(RMS ではないが同じ用途の
 * 軽量な代替。実測でネイティブに存在することを確認済み)。ピークはネイティブに
 * 相当がないため、間引いた(4 サンプルに 1 個)JS ループで求める。
 *
 * onReadable ごとの粒度は生っぽい(ring バッファの都合に合わないので)、
 * 約 100ms 窓に集約してからリングバッファ・ストリームへ反映する。
 *
 * 自己計測: `Time.ticks` は ms 精度(ESP32 の `modMilliseconds()` そのまま。
 * `Time.microseconds` は未実装)。1 チャンクの JS 処理は sub-ms なため単発の
 * delta は 0 か 1 になりがちだが、窓ごとに合計 ms / チャンク数 を取って
 * 1000 倍(µs 換算)し、それを窓間で指数移動平均する — 量子化ノイズはあるが
 * 統計的に CPU 予算の目安になる(GET /mic の avgProcUs)。
 *
 * 全コールバックで例外を握って trace のみ(再スローしない)。Promise は一切
 * 使わない(unhandled rejection → XS abort → 再起動の実績があるため。
 * cry.js / dev-server.js と同じ方針)。
 *
 * v1.1.0 Phase 3b — 上記の窓(rms/peak)の上にイベント検出(loud/clap/voice/
 * silence)を追加した。closeWindow から呼ぶ O(1) の分岐・算術のみで、反応
 * (顔・音)は一切つながない — trace・イベントリング・UDP ストリーム(ev
 * フィールド)・onMicEvent 購読(3c 用)で観測できるだけ。
 *
 * v1.1.0 Phase 3b+ — 方向推定(観測のみ、反応は一切つながない)。CoreS3 は
 * ES7210 デュアルマイク(間隔 ~4cm)で、AudioIn を 2ch(`defines.audioIn.
 * numChannels: 2`。実測で確認 — device target 側は既に 2 を宣言していたが
 * 実際の合成結果は 1 に落ちていたため `overlay/firmware/manifest_breath_
 * deploy.json` に明示的な `defines.audioIn.numChannels: 2` を追加して修正
 * した)で受けているため、`this.read(...)` が返す ArrayBuffer は L/R
 * インターリーブの Int16(サンプル n の ch0 = samples[2n]、ch1 =
 * samples[2n+1])。どちらが物理的に左/右かは未確定なため、`lag`(ch1 が
 * ch0 に対して何サンプル遅れているか。正負の意味付けは実地検証で確定する)
 * ・`l0`/`l1`(チャンネル別レベル)という中立な名前で報告する。
 *
 * チャンクの peak が `params.loud.peakMin` 以上・かつ直前の推定から
 * `params.loud.refractoryMs` 以上経過したときだけ相互相関(ラグ ±maxLag)
 * を計算する(通常時の追加 CPU はゼロ)。ループ内アロケーションなし・
 * 例外は握って trace のみ(失敗しても loud/clap イベント自体は通常どおり
 * 発火する)。
 *
 * v1.2.0 — サンプルレート非依存化(48kHz 実験)。右マイク(ch1)の音響結合が
 * 弱く TDOA のラグが量子化の床(16kHz で最大 ±1.7 サンプル)に沈む問題への
 * 対策として、実行時サンプルレートを 16kHz 前提から解放した。`ensureRateFactor`
 * が最初のチャンクで `AudioIn.sampleRate`(無ければ 16000 にフォールバック)から
 * `rateFactor = sampleRate/16000` を求め、オンセット窓(`dirOnsetBefore`/
 * `dirOnsetAfter`)とピーク走査ストライド(`peakStride`/`peakChannelStride`)を
 * 「時間一定」になるよう再スケールする。**報告する `lag`/`lagX100` は常に
 * 16kHz 換算**(既存のライブ調整値・校正記録・trace の読み方を不変に保つ)。
 * 高レートでの計算量爆発(窓・ラグとも rateFactor 倍 → 総当たりは rateFactor^2 倍)
 * を避けるため、相互相関は粗密 2 段探索にしている(`computeDirectionEstimate`
 * 内: 粗 = stride 間引きで従来と同計算量、密 = 粗のベストラグ ±stride のみ
 * 全解像度)。`rateFactor === 1`(16kHz)のときは実質従来の単段探索と同じ。
 */

const PREF_KEY = 'mic'

const WINDOW_MS = 100 // 窓の長さ(固定。tunable パラメータではない)
const RING_CAPACITY = 60 // ~6 秒分(既定 100ms 窓 × 60)
const EVENT_RING_CAPACITY = 10 // 直近のイベント(loud/clap/voice/silence)を保持する件数
const PEAK_STRIDE = 4 // ピーク走査の間引き(16kHz 基準。合計比較数の目安 N/PEAK_STRIDE。実行時は rateFactor でスケールした peakStride を使う)
const PEAK_CHANNEL_STRIDE = PEAK_STRIDE * 2 // 開始 index 0・1 の 2 本をこの stride で走査(合計比較数を PEAK_STRIDE 単一走査と同じに保つ。16kHz 基準値)
const LEVEL_FALLBACK_STRIDE = 4 // ネイティブ level() が無い場合の JS 平均絶対値も同様に間引く(レート非依存 — フォールバック経路のみ)
const PROC_US_EMA_ALPHA = 0.2 // avgProcUs の指数移動平均の重み

const NOMINAL_SAMPLE_RATE = 16000 // 全ての報告値・調整値の正規化基準(v1.2.0)。実行時レートが何であれこれに揃える。

// v1.1.0 Phase 3b+ — 方向推定(TDOA + ILD)のウィンドウ。**オンセット(立ち上がり)
// 基準**で直接音の周辺だけを取る(16kHz で前 16・後 48 の計 64 ペア = 4ms)。拍手の
// 直接音は最初の 1〜2ms のみで、ピーク基準の広い窓(旧 256 ペア = 16ms)は部屋の
// 反射音が支配して相関ピークが方向と無関係にずれる(2026-07-07 左右拍手セッションで
// 左右が分離しなかった実測を受けた改良)。この 2 値は 16kHz 基準の「時間一定」値
// (v1.2.0)— 実行時は `ensureRateFactor` が `dirOnsetBefore`/`dirOnsetAfter` へ
// rateFactor 倍してキャッシュする。
const DIR_ONSET_BEFORE = 16
const DIR_ONSET_AFTER = 48
const DIR_ESTIMATE_MAX_AGE_MS = 1000 // イベントに添付してよい推定の鮮度(この窓を超えたら添付しない)

const STREAM_HOST = '255.255.255.255' // グローバルブロードキャスト固定(サブネット仮定は禁止 — ERR_MEM 再起動ループの実績)
const STREAM_PORT = 8688

// v1.1.0 Phase 3a 追記 — cry ↔ mic ハンドシェイク + ゼロ・ストール・ウォッチドッグ。
// CoreS3 はスピーカー(AW88298/AudioOut)とマイク(ES7210/AudioIn)が I2S クロック
// ピン(BCK/LR)を共有しており、AudioOut を open している間 AudioIn の入力が
// 全ゼロになり、close しても自然復旧しない(capture の stop/start でのみ復活する)。
// cry.js は再生の前後で suspendCapture()/resumeCapture() を呼んでこれを避ける。
// このウォッチドッグは cry.js が想定していない未知の TX 利用者(将来の機能)への
// 保険 — running 中に rms/peak が 0 の窓が連続したら capture を再起動する。
const ZERO_STREAK_THRESHOLD = 15 // 連続ゼロ窓(100ms 窓 x 15 ≈ 1.5秒)で再起動を試みる
const ZERO_RESTART_MIN_INTERVAL_MS = 10000 // 再起動の最短間隔(マイク物理故障時の無限リスタート防止)

const defaults = {
  enabled: true,
  stream: {
    enabled: false,
    intervalMs: 100,
  },
  // v1.1.0 Phase 3b — イベント検出パラメータ(実測済みの指紋を既定値の根拠にする。
  // 2026-07-07 校正: 静音フロア rms 中央値 24・最大 99、拍手 peak 6,100〜20,300 /
  // peak/rms 比 13〜17、声 rms 100〜165 / peak/rms 比 2〜3.4)。
  loud: { peakMin: 1500, refractoryMs: 1500 }, // peakMin は 2026-07-07 実測で 3000 → 1500(1m の普通の拍手は 1200〜6500。声・フロアの peak は ~550 以下で余裕あり)
  clap: { ratioMin: 8 },
  voice: { rmsMin: 110, minWindows: 3, gapWindows: 1, hangoverMs: 30000 },
  silence: { rmsMax: 60, minutes: 5 },
  // v1.1.0 Phase 3b+ — 方向推定(TDOA + ILD)。maxLag はマイク間隔 ~4cm →
  // 到達時間差最大 ±117µs ≈ 16kHz で ±2 サンプル弱に余裕を持たせた値。
  // v1.2.0 で maxLag の単位を「16kHz 換算サンプル」に再定義(実行時レートが
  // 何であれ既定 4 のまま使える)。実際の探索は effectiveMaxLag =
  // round(maxLag * rateFactor) にスケールする(48kHz では ±12)。
  direction: { enabled: true, maxLag: 4 },
}

// path (e.g. 'stream.intervalMs') -> [min, max]。setMicParams / 復元時の安全クランプ。
const CLAMP_RANGES: ClampRanges = {
  'stream.intervalMs': [20, 5000],
  'loud.peakMin': [200, 32767],
  'loud.refractoryMs': [100, 10000],
  'clap.ratioMin': [2, 50],
  'voice.rmsMin': [10, 5000],
  'voice.minWindows': [1, 20],
  'voice.gapWindows': [0, 10],
  'voice.hangoverMs': [1000, 300000],
  'silence.rmsMax': [0, 5000],
  'silence.minutes': [1, 180],
  'direction.maxLag': [1, 8],
}

let params = deepClone(defaults)
let started = false
let running = false
let suspended = false // cry.js の再生中は true(suspendCapture〜resumeCapture の間)
let micRef: MicrophoneLike | null = null
let socket: UdpSocket | null = null
let streamTimerId: ReturnType<typeof Timer.repeat> | null = null

let zeroStreak = 0
let lastZeroRestartTicks = -Infinity

// v1.1.0 Phase 3c 追記 — capture 再開直後のミュート窓。cry.js の suspendCapture/
// resumeCapture ハンドシェイク越しに breath/reactions の 'clap' 反応を実機検証した際、
// resumeCapture() の ~300ms 後に peak=20480・l0=484 対 l1=40(片チャンネルのみ)という
// 極端な peak/rms 比のイベントが observed(2026-07-07)。両チャンネル非対称・純粋な
// インパルス的特徴は、室内の残響ではなく AudioIn 再起動直後の ADC/コーデック側の
// 過渡応答(ポップ)である可能性が高い。capture を再起動する経路(resumeCapture /
// ゼロ・ストール復旧)の直後は一時的にイベント検出だけを止める(rms/peak の記録・
// リング・ストリームは通常どおり続ける — 観測を止めない)。
const POST_RESTART_MUTE_MS = 400
let muteEventsUntilTicks = -Infinity

function armPostRestartMute(now: number): void {
  muteEventsUntilTicks = now + POST_RESTART_MUTE_MS
}

let lastWindow: MicWindow = { t: 0, rms: 0, peak: 0 }
const ring: MicWindow[] = []

let windowStartTicks = 0
let windowLevelWeightedSum = 0
let windowSampleCount = 0
let windowPeak = 0
let windowProcMsSum = 0
let windowProcCount = 0

let avgProcUsEma: number | null = null

// v1.1.0 Phase 3b — イベント検出(loud/clap/voice/silence)の状態。反応(顔・音)は
// 一切つながない — trace・リングバッファ・UDP ストリームで観測できるだけ。
let lastLoudEventTicks = -Infinity
let voiceActive = false
let voiceStreak = 0
let voiceGapStreak = 0
let lastVoiceTicks = -Infinity
let silentState = false
let lastNonQuietTicks = 0
let pendingStreamEvent: MicEventType | null = null // 次の UDP ストリームパケットに一度だけ乗せる ev フィールド
let pendingStreamEventLag: number | null = null // 同上。lagX100(サブサンプル補間ラグ × 100。推定があった場合のみ)
const eventRing: MicEvent[] = []
const micEventListeners: MicEventListener[] = []

// v1.1.0 Phase 3b+ — 方向推定(TDOA + ILD)の状態。反応は一切つながない。
let micChannels: number | null = null // AudioIn.channels をキャッシュ(2 でなければ推定を実行しない)
let lastDirEstimate: DirectionEstimate | null = null
let lastDirEstimateTicks = -Infinity
let lastDirComputeTicks = -Infinity // loud.refractoryMs と同様のゲート(毎チャンク計算しない)

// v1.2.0 — サンプルレート非依存化の状態。最初のチャンクで一度だけ確定する
// (以後 no-op)。rateFactor===1(16kHz)の間は全て 16kHz 基準の既定値のまま
// なので、48kHz を試さない機体・パーティションでは挙動が一切変わらない。
let rateFactor = 1 // sampleRate / NOMINAL_SAMPLE_RATE。startMic 直後は 16kHz 前提の 1。
let rateFactorReady = false
let dirOnsetBefore = DIR_ONSET_BEFORE // 実レート換算(時間一定)。ensureRateFactor で更新。
let dirOnsetAfter = DIR_ONSET_AFTER
let peakStride = PEAK_STRIDE // 実レート換算(走査点数一定)。ensureRateFactor で更新。
let peakChannelStride = PEAK_CHANNEL_STRIDE

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function resetWindowAccumulators(now: number): void {
  windowStartTicks = now
  windowLevelWeightedSum = 0
  windowSampleCount = 0
  windowPeak = 0
  windowProcMsSum = 0
  windowProcCount = 0
}

function pushRing(entry: MicWindow): void {
  ring.push(entry)
  if (ring.length > RING_CAPACITY) ring.shift()
}

/**
 * 実行時の `AudioIn.sampleRate` を読んで rateFactor(= sampleRate/16000)を
 * キャッシュし、時間基準のオンセット窓(dirOnsetBefore/After)と CPU 対策の
 * ピーク走査ストライド(peakStride/peakChannelStride)を再スケールする。
 * accumulateChunk の先頭から呼ぶ(最初のチャンクで一度だけ実行、以後は
 * no-op)。`sampleRate` プロパティが無い実装では 16000 とみなし
 * rateFactor=1 にフォールバックする(trace で警告)。
 */
function ensureRateFactor(audioIn: AudioInLike): void {
  if (rateFactorReady) return
  rateFactorReady = true

  const hasSampleRate = typeof audioIn.sampleRate === 'number' && audioIn.sampleRate > 0
  const sampleRate = hasSampleRate ? audioIn.sampleRate : NOMINAL_SAMPLE_RATE
  rateFactor = sampleRate / NOMINAL_SAMPLE_RATE
  if (!hasSampleRate) {
    trace(`[mic] AudioIn.sampleRate unavailable; assuming ${NOMINAL_SAMPLE_RATE}Hz (rateFactor=1)\n`)
  }

  dirOnsetBefore = Math.max(1, Math.round(DIR_ONSET_BEFORE * rateFactor))
  dirOnsetAfter = Math.max(1, Math.round(DIR_ONSET_AFTER * rateFactor))
  peakStride = Math.max(1, Math.round(PEAK_STRIDE * rateFactor))
  peakChannelStride = peakStride * 2

  const channels = typeof audioIn.channels === 'number' ? audioIn.channels : 1
  trace(`[mic] capture started (${sampleRate}Hz x ${channels}ch)\n`)
}

function computeLevelFallback(samples: Int16Array, sampleCount: number): number {
  let sum = 0
  let counted = 0
  for (let i = 0; i < sampleCount; i += LEVEL_FALLBACK_STRIDE) {
    const v = samples[i] ?? 0
    sum += v < 0 ? -v : v
    counted++
  }
  return counted > 0 ? sum / counted : 0
}

/**
 * ステレオ(L/R インターリーブ)前提の間引き走査。開始 index 0(偶数 = ch0)と
 * 1(奇数 = ch1)の 2 本を peakChannelStride(= peakStride の 2 倍、常に偶数)で
 * 走査する — 合計比較数は単一走査(開始 0・stride peakStride)と同じ
 * (N/peakStride)のまま、両チャンネルを同程度カバーする(以前は開始 0 の
 * みだったため実質 ch0 しか見ていなかった。単純に両方を stride
 * peakStride で回すとコストが 2 倍になるため、真のステレオ化で実データ量
 * 自体が 2 倍になったこととの相乗を避けるためにここは同一コストへ据え置く)。
 * peakStride/peakChannelStride は 16kHz 基準値(PEAK_STRIDE)を rateFactor で
 * スケールしたもの(v1.2.0、`ensureRateFactor` 参照) — 高レートでも走査点数
 * (=CPU コスト)を一定に保つ。
 */
function computePeak(samples: Int16Array, sampleCount: number): number {
  let peak = 0
  for (let i = 0; i < sampleCount; i += peakChannelStride) {
    const v = samples[i] ?? 0
    const abs = v < 0 ? -v : v
    if (abs > peak) peak = abs
  }
  for (let i = 1; i < sampleCount; i += peakChannelStride) {
    const v = samples[i] ?? 0
    const abs = v < 0 ? -v : v
    if (abs > peak) peak = abs
  }
  return peak
}

// ---------------------------------------------------------------------------
// 方向推定(TDOA + ILD)— v1.1.0 Phase 3b+。loud 候補チャンクのときだけ呼ぶ
// (maybeEstimateDirection のゲート経由)。反応は一切つながない(観測のみ)。
// ---------------------------------------------------------------------------

/**
 * チャンク全体でまずピーク絶対値を求め、その半分を初めて超えたフレーム index
 * (= オンセット、直接音の立ち上がり)を返す。拍手の方向情報は最初の直接音に
 * しか無く、ピーク自体は反射音の重なりで数 ms 遅れて立つことがあるため、
 * ピークではなくオンセットに窓を合わせる。
 */
function findOnsetFrameIndex(samples: Int16Array, frameCount: number): number {
  let peak = 0
  for (let n = 0; n < frameCount; n++) {
    const base = n * 2
    let v0 = samples[base] ?? 0
    if (v0 < 0) v0 = -v0
    let v1 = samples[base + 1] ?? 0
    if (v1 < 0) v1 = -v1
    const m = v0 > v1 ? v0 : v1
    if (m > peak) peak = m
  }
  const threshold = Math.floor(peak / 2)
  for (let n = 0; n < frameCount; n++) {
    const base = n * 2
    let v0 = samples[base] ?? 0
    if (v0 < 0) v0 = -v0
    let v1 = samples[base + 1] ?? 0
    if (v1 < 0) v1 = -v1
    if ((v0 > v1 ? v0 : v1) >= threshold) return n
  }
  return 0
}

/**
 * オンセット周辺の短いウィンドウ(前 dirOnsetBefore・後 dirOnsetAfter、
 * チャンク境界でクランプ。実レート換算の「時間一定」値 — ensureRateFactor
 * 参照)で相互相関(ラグ -effectiveMaxLag..+effectiveMaxLag)とチャンネル別
 * レベルを求める。アロケーションなしを保つため、ラグ別 corr は補間に必要な
 * 「best とその両隣」だけをスカラーで保持する(配列を作らない)。
 *
 * v1.2.0 — 粗密 2 段探索。rateFactor(既定 1 = 16kHz)が 1 を超えると窓・ラグ
 * とも rateFactor 倍に膨らみ、素朴な全解像度総当たりは計算量が rateFactor^2
 * 倍になる(48kHz で ~8 倍)。まず stride(= round(rateFactor))間引きの粗探索
 * (サンプル・ラグとも stride 刻み = 16kHz 単段探索と同計算量)でおおよその
 * ラグを求め、その周辺 ±stride だけ全解像度・全サンプルで密探索する
 * (トータルで従来比 2〜3 倍程度)。`rateFactor === 1` のときは stride===1 に
 * なり、密探索の範囲が全域を覆うため実質従来の単段アルゴリズムと同じ
 * (16kHz での出力は変化しない)。
 *
 * 密探索側の相関ピークは放物線補間でサブサンプル化する。**報告する
 * `lag`/`lagX100` は常に 16kHz 換算**(lagInterp を rateFactor で割る)——
 * 既存のライブ調整値(reactions の lagSideMin 等)・校正記録・trace の読み方を
 * 実行時レートに関わらず不変に保つため。診断用に corr の並びを trace する。
 * ウィンドウが小さすぎる(チャンク境界付近)場合は null を返す。
 */
function computeDirectionEstimate(
  samples: Int16Array,
  frameCount: number,
  onsetFrameIdx: number,
  now: number,
): DirectionEstimate | null {
  const maxLag = params.direction.maxLag // 16kHz 換算(v1.2.0 で再定義)
  const effectiveMaxLag = Math.max(1, Math.round(maxLag * rateFactor)) // 実レート換算の探索範囲

  let winStart = onsetFrameIdx - dirOnsetBefore
  if (winStart < 0) winStart = 0
  let winEnd = onsetFrameIdx + dirOnsetAfter
  if (winEnd > frameCount) winEnd = frameCount
  if (winEnd - winStart <= effectiveMaxLag * 2) return null

  const stride = Math.max(1, Math.round(rateFactor))

  // --- 粗探索(サンプル・ラグとも stride 間引き。16kHz 単段探索と同計算量) ---
  let coarseBestLag = 0
  let coarseBestCorr = -Infinity
  let zeroLagCorr = 0 // 粗探索が lag=0 を通れば暫定値。密探索で通ればより精密な値に上書きする。
  for (let lag = -effectiveMaxLag; lag <= effectiveMaxLag; lag += stride) {
    let corr = 0
    for (let n = winStart; n < winEnd; n += stride) {
      const m = n + lag
      if (m < 0 || m >= frameCount) continue
      corr += (samples[n * 2] ?? 0) * (samples[m * 2 + 1] ?? 0)
    }
    if (0 === lag) zeroLagCorr = corr
    if (corr > coarseBestCorr) {
      coarseBestCorr = corr
      coarseBestLag = lag
    }
  }

  // --- 密探索(粗のベストラグ ±stride だけ全解像度・全サンプル) ---
  let fineLo = coarseBestLag - stride
  if (fineLo < -effectiveMaxLag) fineLo = -effectiveMaxLag
  let fineHi = coarseBestLag + stride
  if (fineHi > effectiveMaxLag) fineHi = effectiveMaxLag

  let bestLag = fineLo
  let bestCorr = -Infinity
  let prevCorr = 0 // 直前ラグの corr(補間用)
  let corrBeforeBest = 0
  let corrAfterBest = 0
  let bestWasPrev = false // 直後のループ回で「best の次の corr」を拾うためのフラグ
  let corrTrace = ''
  for (let lag = fineLo; lag <= fineHi; lag++) {
    let corr = 0
    for (let n = winStart; n < winEnd; n++) {
      const m = n + lag
      if (m < 0 || m >= frameCount) continue
      corr += (samples[n * 2] ?? 0) * (samples[m * 2 + 1] ?? 0)
    }
    if (0 === lag) zeroLagCorr = corr // 密探索の方が精密なので優先して上書き
    if (bestWasPrev) {
      corrAfterBest = corr
      bestWasPrev = false
    }
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
      corrBeforeBest = prevCorr
      corrAfterBest = 0
      bestWasPrev = true
    }
    prevCorr = corr
    corrTrace += `${lag === fineLo ? '' : ','}${Math.round(corr / 1000)}`
  }

  // 放物線補間(best が密探索レンジの端のときは補間しない)。frac は [-0.5, 0.5] にクランプ。
  let lagInterp = bestLag
  if (bestLag > fineLo && bestLag < fineHi) {
    const denom = corrBeforeBest - 2 * bestCorr + corrAfterBest
    if (denom < 0) {
      let frac = (0.5 * (corrBeforeBest - corrAfterBest)) / denom
      if (frac > 0.5) frac = 0.5
      else if (frac < -0.5) frac = -0.5
      lagInterp = bestLag + frac
    }
  }

  // 16kHz 換算に正規化(実行時レートが何であれ既存の調整値・校正記録がそのまま使える)。
  const lag = Math.round(lagInterp / rateFactor)
  const lagX100 = Math.round((lagInterp / rateFactor) * 100)

  let sumAbs0 = 0
  let sumAbs1 = 0
  for (let n = winStart; n < winEnd; n++) {
    let v0 = samples[n * 2] ?? 0
    if (v0 < 0) v0 = -v0
    let v1 = samples[n * 2 + 1] ?? 0
    if (v1 < 0) v1 = -v1
    sumAbs0 += v0
    sumAbs1 += v1
  }
  const windowCount = winEnd - winStart
  const l0 = windowCount > 0 ? Math.round(sumAbs0 / windowCount) : 0
  const l1 = windowCount > 0 ? Math.round(sumAbs1 / windowCount) : 0
  const corrPeakRatio = zeroLagCorr > 0 ? Math.round((bestCorr / zeroLagCorr) * 100) / 100 : 0

  trace(
    `[mic] dir corr(k)=[${corrTrace}] win=${winStart}..${winEnd} fine=${fineLo}..${fineHi} coarseLag=${coarseBestLag} stride=${stride}\n`,
  )
  return { t: now, lag, lagX100, corrPeakRatio, l0, l1 }
}

/**
 * チャンクの peak が `params.loud.peakMin` 以上・かつ直前の推定から
 * `params.loud.refractoryMs` 以上経過したときだけ実行する(通常時の追加
 * CPU ゼロ)。全体を try/catch で包み、失敗しても loud/clap イベント自体は
 * 通常どおり発火する(呼び出し側の accumulateChunk には影響しない)。
 */
function maybeEstimateDirection(
  audioIn: AudioInLike,
  samples: Int16Array,
  sampleCount: number,
  peakValue: number,
): void {
  try {
    if (!params.direction.enabled) return
    if (peakValue < params.loud.peakMin) return

    if (null === micChannels) {
      micChannels = typeof audioIn.channels === 'number' ? audioIn.channels : 1
    }
    if (2 !== micChannels) return

    const now = Time.ticks
    if (now - lastDirComputeTicks < params.loud.refractoryMs) return
    lastDirComputeTicks = now

    const frameCount = Math.floor(sampleCount / 2)
    if (frameCount < 2) return

    const startTicks = Time.ticks
    const onsetFrameIdx = findOnsetFrameIndex(samples, frameCount)
    const estimate = computeDirectionEstimate(samples, frameCount, onsetFrameIdx, now)
    const elapsedMs = Time.ticks - startTicks

    if (estimate) {
      lastDirEstimate = estimate
      lastDirEstimateTicks = now
      trace(
        `[mic] direction estimate lag=${estimate.lag} lagX100=${estimate.lagX100} l0=${estimate.l0} l1=${estimate.l1} ratio=${estimate.corrPeakRatio} tookMs=${elapsedMs}\n`,
      )
    }
  } catch (error) {
    trace(`[mic] direction estimate failed: ${error}\n`)
  }
}

function accumulateChunk(audioIn: AudioInLike, buffer: ArrayBuffer): void {
  ensureRateFactor(audioIn)

  const sampleCount = Math.floor(buffer.byteLength / 2)
  if (sampleCount <= 0) return

  const samples = new Int16Array(buffer)
  const levelValue =
    typeof audioIn.level === 'function' ? audioIn.level(buffer) : computeLevelFallback(samples, sampleCount)
  const peakValue = computePeak(samples, sampleCount)

  windowLevelWeightedSum += levelValue * sampleCount
  windowSampleCount += sampleCount
  if (peakValue > windowPeak) windowPeak = peakValue

  maybeEstimateDirection(audioIn, samples, sampleCount, peakValue)
}

// ---------------------------------------------------------------------------
// イベント検出(loud/clap/voice/silence)— closeWindow から呼ぶ。O(1) の分岐・
// 算術のみ(ループ・アロケーション追加なし)。反応は一切つながない。
// ---------------------------------------------------------------------------

function pushEventRing(event: MicEvent): void {
  eventRing.push(event)
  if (eventRing.length > EVENT_RING_CAPACITY) eventRing.shift()
}

function notifyMicEventListeners(event: MicEvent): void {
  for (const callback of micEventListeners) {
    try {
      callback(event)
    } catch (error) {
      trace(`[mic] event listener failed: ${error}\n`)
    }
  }
}

/**
 * loud/clap の直近の方向推定(`DIR_ESTIMATE_MAX_AGE_MS` 以内)があれば
 * `lag`/`l0`/`l1` をイベントに添付する(v1.1.0 Phase 3b+。voice/silence には
 * 添付しない — 方向推定は loud 候補チャンクでのみ計算されるため)。
 */
function attachDirection(event: MicEvent, now: number): void {
  if ('loud' !== event.type && 'clap' !== event.type) return
  if (!lastDirEstimate) return
  if (now - lastDirEstimateTicks > DIR_ESTIMATE_MAX_AGE_MS) return
  event.lag = lastDirEstimate.lag
  event.lagX100 = lastDirEstimate.lagX100
  event.l0 = lastDirEstimate.l0
  event.l1 = lastDirEstimate.l1
}

function emitMicEvent(now: number, type: MicEventType, rms: number, peak: number): MicEvent {
  const event: MicEvent = { t: now, type, rms, peak }
  attachDirection(event, now)
  pushEventRing(event)
  pendingStreamEvent = type // 次の sendStreamPacket にだけ ev フィールドを乗せる
  pendingStreamEventLag = 'number' === typeof event.lagX100 ? event.lagX100 : null
  const dirPart =
    'number' === typeof event.lag ? ` lag=${event.lag} lagX100=${event.lagX100} l0=${event.l0} l1=${event.l1}` : ''
  trace(`[mic] event ${type} peak=${peak} rms=${rms}${dirPart}\n`)
  notifyMicEventListeners(event)
  return event
}

/**
 * 窓を閉じるたびに評価する。種別は最大1つ(loud/clap と voice/silence は
 * 条件上重ならない — voice は peak < loud.peakMin が前提、silence は
 * 非静音判定が先に走るため同一窓では発火しない)。
 */
function detectEvents(now: number, rms: number, peak: number): MicEventType | null {
  let firedType: MicEventType | null = null

  // --- loud / clap(同じ refractory を共有する「loud 系イベント」)---
  if (peak >= params.loud.peakMin && now - lastLoudEventTicks >= params.loud.refractoryMs) {
    lastLoudEventTicks = now
    const type = rms > 0 && peak / rms >= params.clap.ratioMin ? 'clap' : 'loud'
    emitMicEvent(now, type, rms, peak)
    firedType = type
    lastNonQuietTicks = now
  }

  // --- voice(声窓のヒステリシス。voice.gapWindows まで途切れを許容)---
  const isVoiceWindow = rms >= params.voice.rmsMin && peak < params.loud.peakMin
  if (isVoiceWindow) {
    voiceGapStreak = 0
    if (voiceActive) {
      lastVoiceTicks = now
    } else {
      voiceStreak++
      if (voiceStreak >= params.voice.minWindows) {
        voiceActive = true
        voiceStreak = 0
        lastVoiceTicks = now
        emitMicEvent(now, 'voice', rms, peak)
        firedType = 'voice'
        lastNonQuietTicks = now
      }
    }
  } else if (!voiceActive && voiceStreak > 0) {
    voiceGapStreak++
    if (voiceGapStreak > params.voice.gapWindows) {
      voiceStreak = 0
      voiceGapStreak = 0
    }
  }

  if (voiceActive && now - lastVoiceTicks > params.voice.hangoverMs) {
    voiceActive = false
    voiceStreak = 0
    voiceGapStreak = 0
  }

  // --- silence(無音が silence.minutes 続いた瞬間に 1 回だけ発火)---
  if (rms > params.silence.rmsMax) {
    lastNonQuietTicks = now
    silentState = false
  } else if (firedType) {
    lastNonQuietTicks = now // loud/clap/voice の発火自体も「非静音」として扱う
  }

  if (!silentState && now - lastNonQuietTicks >= params.silence.minutes * 60000) {
    silentState = true
    emitMicEvent(now, 'silence', rms, peak)
    firedType = 'silence'
  }

  return firedType
}

function closeWindow(now: number): void {
  const rms = windowSampleCount > 0 ? Math.round(windowLevelWeightedSum / windowSampleCount) : 0
  const peak = windowPeak
  lastWindow = { t: now, rms, peak }
  pushRing(lastWindow)

  if (windowProcCount > 0) {
    const avgUsThisWindow = (windowProcMsSum / windowProcCount) * 1000
    avgProcUsEma =
      avgProcUsEma === null ? avgUsThisWindow : avgProcUsEma + PROC_US_EMA_ALPHA * (avgUsThisWindow - avgProcUsEma)
  }

  if (now >= muteEventsUntilTicks) detectEvents(now, rms, peak)

  checkZeroStall(now)

  resetWindowAccumulators(now)
}

// ---------------------------------------------------------------------------
// ゼロ・ストール・ウォッチドッグ(closeWindow から呼ぶ。running 中のみ到達する
// — handleReadable が !running で早期 return するため、suspended 中は
// closeWindow 自体が呼ばれない。ここでのリセットは保険)
// ---------------------------------------------------------------------------

function resetZeroStallCounter(): void {
  zeroStreak = 0
}

function checkZeroStall(now: number): void {
  if (suspended || !running) {
    zeroStreak = 0
    return
  }
  if (lastWindow.rms === 0 && lastWindow.peak === 0) {
    zeroStreak++
  } else {
    zeroStreak = 0
    return
  }
  if (zeroStreak < ZERO_STREAK_THRESHOLD) return
  zeroStreak = 0
  if (now - lastZeroRestartTicks < ZERO_RESTART_MIN_INTERVAL_MS) return
  lastZeroRestartTicks = now
  restartCaptureForZeroStall(now)
}

function restartCaptureForZeroStall(now: number): void {
  trace('[mic] zero-stall detected, restarting capture\n')
  if (!micRef) return
  try {
    try {
      micRef.stop()
    } catch (error) {
      trace(`[mic] zero-stall stop failed: ${error}\n`)
    }
    running = false
    resetWindowAccumulators(now)
    micRef.start()
    running = true
    armPostRestartMute(now)
  } catch (error) {
    trace(`[mic] zero-stall restart failed: ${error}\n`)
    running = false
  }
}

function maybeCloseWindow(): void {
  const now = Time.ticks
  if (now - windowStartTicks >= WINDOW_MS) closeWindow(now)
}

/** `robot.microphone.onReadable` に割り当てるハンドラ。`this` は素の AudioIn。 */
function handleReadable(this: AudioInLike, byteLength: number): void {
  if (!running) return
  const startTicks = Time.ticks
  try {
    const buffer = this.read(byteLength)
    if (buffer) accumulateChunk(this, buffer)
  } catch (error) {
    trace(`[mic] chunk failed: ${error}\n`)
  }
  windowProcMsSum += Time.ticks - startTicks
  windowProcCount += 1
  maybeCloseWindow()
}

// ---------------------------------------------------------------------------
// UDP ストリーム(trace-udp.js と同じ socket の作法)
// ---------------------------------------------------------------------------

function ensureSocket(): UdpSocket {
  if (!socket) socket = new (Socket as unknown as UdpSocketConstructor)({ kind: 'UDP' })
  return socket
}

function sendStreamPacket(): void {
  try {
    // イベント発火直後の最初のパケットにだけ ev フィールドを乗せる(v1.1.0 Phase 3b)。
    // 方向推定が添付されていれば lag も同じパケットに乗せる(v1.1.0 Phase 3b+)。
    const evPart = pendingStreamEvent ? `,"ev":"${pendingStreamEvent}"` : ''
    const lagPart = null !== pendingStreamEventLag ? `,"lagX100":${pendingStreamEventLag}` : ''
    pendingStreamEvent = null
    pendingStreamEventLag = null
    const payload = `{"t":${lastWindow.t},"rms":${lastWindow.rms},"peak":${lastWindow.peak}${evPart}${lagPart}}`
    ensureSocket().write(STREAM_HOST, STREAM_PORT, ArrayBuffer.fromString(payload))
  } catch (error) {
    trace(`[mic] stream send failed: ${error}\n`)
  }
}

function clearStreamTimer(): void {
  if (streamTimerId !== null) {
    Timer.clear(streamTimerId)
    streamTimerId = null
  }
}

function applyStream(): void {
  clearStreamTimer()
  if (!params.stream.enabled) return
  try {
    streamTimerId = Timer.repeat(sendStreamPacket, params.stream.intervalMs)
    trace(`[mic] stream on udp/${STREAM_PORT} every ${params.stream.intervalMs}ms\n`)
  } catch (error) {
    trace(`[mic] stream start failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// キャプチャの有効/無効(AudioIn の start/stop)
// ---------------------------------------------------------------------------

function applyEnabled(): void {
  if (!micRef) return
  if (params.enabled && !running) {
    try {
      const now = Time.ticks
      resetWindowAccumulators(now)
      resetZeroStallCounter()
      micRef.start()
      running = true
      armPostRestartMute(now)
      trace('[mic] capture started\n')
    } catch (error) {
      trace(`[mic] start failed: ${error}\n`)
      running = false
    }
  } else if (!params.enabled && running) {
    try {
      micRef.stop()
    } catch (error) {
      trace(`[mic] stop failed: ${error}\n`)
    }
    running = false
    resetZeroStallCounter()
    trace('[mic] capture stopped\n')
  }
}

// ---------------------------------------------------------------------------
// cry ↔ mic ハンドシェイク(公開 API の一部だが、applyEnabled と隣接させておく)
//
// suspendCapture(): cry.js が AudioOut を open する直前に呼ぶ。capture 中なら
// stop して suspended フラグを立てる。params.enabled は変更・永続化しない
// (ユーザー設定とは無関係な一時停止)。
//
// resumeCapture(): cry.js が AudioOut を close した後、+500ms 遅らせて呼ぶ。
// suspended かつ params.enabled の場合のみ capture を再開する。mic 自体が
// 未初期化(micRef なし)でも安全な no-op。
// ---------------------------------------------------------------------------

/** cry.js から呼ぶ。再生直前に capture を止める。例外は握って trace のみ。 */
export function suspendCapture(): void {
  try {
    if (suspended) return
    suspended = true
    resetZeroStallCounter()
    if (!micRef || !running) return
    try {
      micRef.stop()
    } catch (error) {
      trace(`[mic] suspend stop failed: ${error}\n`)
    }
    running = false
    trace('[mic] capture suspended\n')
  } catch (error) {
    trace(`[mic] suspendCapture failed: ${error}\n`)
  }
}

/** cry.js から呼ぶ。suspend 前の有効状態に戻す。例外は握って trace のみ。 */
export function resumeCapture(): void {
  try {
    if (!suspended) return
    suspended = false
    if (!micRef || !params.enabled || running) return
    try {
      const now = Time.ticks
      resetWindowAccumulators(now)
      resetZeroStallCounter()
      micRef.start()
      running = true
      armPostRestartMute(now)
      trace('[mic] capture resumed\n')
    } catch (error) {
      trace(`[mic] resume start failed: ${error}\n`)
      running = false
    }
  } catch (error) {
    trace(`[mic] resumeCapture failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 起動 ~6s 後に mod.js から一度だけ呼ぶ。 */
export function startMic(robot: RobotWithMicrophone | null | undefined): void {
  if (started) return
  started = true

  params = loadParams(PREF_KEY, defaults, CLAMP_RANGES)
  lastNonQuietTicks = Time.ticks // silence 検出の基準点(起動直後を「非静音」扱いにする)

  const microphone = robot?.microphone
  if (!microphone) {
    trace('[mic] no microphone on this device; disabled\n')
    return
  }
  micRef = microphone

  try {
    microphone.onReadable = handleReadable
  } catch (error) {
    trace(`[mic] onReadable attach failed: ${error}\n`)
    return
  }

  applyEnabled()
  applyStream()
  trace('[mic] started\n')
}

/**
 * イベント購読(v1.1.0 Phase 3c 用)。callback は `(event) => {}` 形式
 * (`{ t, type, rms, peak }`)。解除 API はない(mod 構成は静的)。登録した
 * callback が例外を投げても他の callback・検出処理には波及しない。
 */
export function onMicEvent(callback: unknown): void {
  if (typeof callback !== 'function') return
  micEventListeners.push(callback as MicEventListener)
}

/** 現在の状態(GET /mic)。現在レベル・リングバッファ要約・avgProcUs・イベント・params。 */
export function getMicStatus() {
  return {
    enabled: params.enabled,
    running,
    suspended,
    t: lastWindow.t,
    rms: lastWindow.rms,
    peak: lastWindow.peak,
    avgProcUs: avgProcUsEma === null ? 0 : Math.round(avgProcUsEma),
    // v1.2.0 — 実行時レート診断(sampleRate 非依存化)。rateFactorReady が false のうちは
    // まだ最初のチャンクを処理していない(16kHz 前提の既定値のまま)。
    rate: {
      rateFactorReady,
      rateFactor,
      sampleRateHz: Math.round(rateFactor * NOMINAL_SAMPLE_RATE),
    },
    ring: summarizeRing(),
    lastDir: lastDirEstimate ? { ...lastDirEstimate } : null,
    events: eventRing.slice(),
    state: {
      voiceActive,
      silent: silentState,
      silentForMs: silentState ? Time.ticks - lastNonQuietTicks : 0,
    },
    params: deepClone(params),
  }
}

function summarizeRing() {
  if (!ring.length) {
    return { count: 0, capacity: RING_CAPACITY, minRms: 0, maxRms: 0, avgRms: 0, minPeak: 0, maxPeak: 0, avgPeak: 0 }
  }
  let minRms = Infinity
  let maxRms = -Infinity
  let sumRms = 0
  let minPeak = Infinity
  let maxPeak = -Infinity
  let sumPeak = 0
  for (const w of ring) {
    if (w.rms < minRms) minRms = w.rms
    if (w.rms > maxRms) maxRms = w.rms
    sumRms += w.rms
    if (w.peak < minPeak) minPeak = w.peak
    if (w.peak > maxPeak) maxPeak = w.peak
    sumPeak += w.peak
  }
  const count = ring.length
  return {
    count,
    capacity: RING_CAPACITY,
    minRms,
    maxRms,
    avgRms: Math.round(sumRms / count),
    minPeak,
    maxPeak,
    avgPeak: Math.round(sumPeak / count),
  }
}

/** 現在有効なパラメータ。 */
export function getMicParams() {
  return deepClone(params)
}

/** 部分更新(PUT /mic/params)。deep merge + 検証 + Preference 永続化 + 即時反映。 */
export function setMicParams(partial: unknown) {
  if (!partial || typeof partial !== 'object') return getMicParams()

  const previousEnabled = params.enabled
  const previousStreamEnabled = params.stream.enabled
  const previousIntervalMs = params.stream.intervalMs

  params = sanitizeParams(mergeValidated(params, partial), CLAMP_RANGES)
  persistParams(PREF_KEY, params)
  trace(`[mic] params updated ${JSON.stringify(Object.keys(partial))}\n`)

  if (started) {
    if (params.enabled !== previousEnabled) {
      try {
        applyEnabled()
      } catch (error) {
        trace(`[mic] applyEnabled failed: ${error}\n`)
      }
    }
    if (params.stream.enabled !== previousStreamEnabled || params.stream.intervalMs !== previousIntervalMs) {
      try {
        applyStream()
      } catch (error) {
        trace(`[mic] applyStream failed: ${error}\n`)
      }
    }
  }

  return getMicParams()
}
