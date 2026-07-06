import Time from 'time'
import Timer from 'timer'
import { Socket } from 'socket'
import { deepClone, mergeValidated, sanitizeParams, loadParams, persistParams } from 'breath/param-store'

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
 */

const PREF_KEY = 'mic'

const WINDOW_MS = 100 // 窓の長さ(固定。tunable パラメータではない)
const RING_CAPACITY = 60 // ~6 秒分(既定 100ms 窓 × 60)
const PEAK_STRIDE = 4 // ピーク走査の間引き(4 サンプルに 1 個)
const LEVEL_FALLBACK_STRIDE = 4 // ネイティブ level() が無い場合の JS 平均絶対値も同様に間引く
const PROC_US_EMA_ALPHA = 0.2 // avgProcUs の指数移動平均の重み

const STREAM_HOST = '255.255.255.255' // グローバルブロードキャスト固定(サブネット仮定は禁止 — ERR_MEM 再起動ループの実績)
const STREAM_PORT = 8688

const defaults = {
  enabled: true,
  stream: {
    enabled: false,
    intervalMs: 100,
  },
}

// path (e.g. 'stream.intervalMs') -> [min, max]。setMicParams / 復元時の安全クランプ。
const CLAMP_RANGES = {
  'stream.intervalMs': [20, 5000],
}

let params = deepClone(defaults)
let started = false
let running = false
let micRef = null
let socket = null
let streamTimerId = null

let lastWindow = { t: 0, rms: 0, peak: 0 }
const ring = []

let windowStartTicks = 0
let windowLevelWeightedSum = 0
let windowSampleCount = 0
let windowPeak = 0
let windowProcMsSum = 0
let windowProcCount = 0

let avgProcUsEma = null

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function resetWindowAccumulators(now) {
  windowStartTicks = now
  windowLevelWeightedSum = 0
  windowSampleCount = 0
  windowPeak = 0
  windowProcMsSum = 0
  windowProcCount = 0
}

function pushRing(entry) {
  ring.push(entry)
  if (ring.length > RING_CAPACITY) ring.shift()
}

function computeLevelFallback(samples, sampleCount) {
  let sum = 0
  let counted = 0
  for (let i = 0; i < sampleCount; i += LEVEL_FALLBACK_STRIDE) {
    const v = samples[i]
    sum += v < 0 ? -v : v
    counted++
  }
  return counted > 0 ? sum / counted : 0
}

function computePeak(samples, sampleCount) {
  let peak = 0
  for (let i = 0; i < sampleCount; i += PEAK_STRIDE) {
    const v = samples[i]
    const abs = v < 0 ? -v : v
    if (abs > peak) peak = abs
  }
  return peak
}

function accumulateChunk(audioIn, buffer) {
  const sampleCount = buffer.byteLength >> 1
  if (sampleCount <= 0) return

  const samples = new Int16Array(buffer)
  const levelValue = typeof audioIn.level === 'function' ? audioIn.level(buffer) : computeLevelFallback(samples, sampleCount)
  const peakValue = computePeak(samples, sampleCount)

  windowLevelWeightedSum += levelValue * sampleCount
  windowSampleCount += sampleCount
  if (peakValue > windowPeak) windowPeak = peakValue
}

function closeWindow(now) {
  const rms = windowSampleCount > 0 ? Math.round(windowLevelWeightedSum / windowSampleCount) : 0
  const peak = windowPeak
  lastWindow = { t: now, rms, peak }
  pushRing(lastWindow)

  if (windowProcCount > 0) {
    const avgUsThisWindow = (windowProcMsSum / windowProcCount) * 1000
    avgProcUsEma = avgProcUsEma == null ? avgUsThisWindow : avgProcUsEma + PROC_US_EMA_ALPHA * (avgUsThisWindow - avgProcUsEma)
  }

  resetWindowAccumulators(now)
}

function maybeCloseWindow() {
  const now = Time.ticks
  if (now - windowStartTicks >= WINDOW_MS) closeWindow(now)
}

/** `robot.microphone.onReadable` に割り当てるハンドラ。`this` は素の AudioIn。 */
function handleReadable(byteLength) {
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

function ensureSocket() {
  if (!socket) socket = new Socket({ kind: 'UDP' })
  return socket
}

function sendStreamPacket() {
  try {
    const payload = `{"t":${lastWindow.t},"rms":${lastWindow.rms},"peak":${lastWindow.peak}}`
    ensureSocket().write(STREAM_HOST, STREAM_PORT, ArrayBuffer.fromString(payload))
  } catch (error) {
    trace(`[mic] stream send failed: ${error}\n`)
  }
}

function clearStreamTimer() {
  if (streamTimerId != null) {
    Timer.clear(streamTimerId)
    streamTimerId = null
  }
}

function applyStream() {
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

function applyEnabled() {
  if (!micRef) return
  if (params.enabled && !running) {
    try {
      resetWindowAccumulators(Time.ticks)
      micRef.start()
      running = true
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
    trace('[mic] capture stopped\n')
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 起動 ~6s 後に mod.js から一度だけ呼ぶ。 */
export function startMic(robot) {
  if (started) return
  started = true

  params = loadParams(PREF_KEY, defaults, CLAMP_RANGES)

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

/** 現在の状態(GET /mic)。現在レベル・リングバッファ要約・avgProcUs・params。 */
export function getMicStatus() {
  return {
    enabled: params.enabled,
    running,
    t: lastWindow.t,
    rms: lastWindow.rms,
    peak: lastWindow.peak,
    avgProcUs: avgProcUsEma == null ? 0 : Math.round(avgProcUsEma),
    ring: summarizeRing(),
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
export function setMicParams(partial) {
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
