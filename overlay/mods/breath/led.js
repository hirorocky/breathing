import Time from 'time'
import Timer from 'timer'
import { deepClone, mergeValidated, loadParams, persistParams } from 'breath/param-store'
import { onMicEvent } from 'breath/mic'
import { getEmotion, onEmotionEvent } from 'breath/emotion'
import { getSharedPY32IOExpander } from 'py32-io-expander'

/**
 * v1.2.1 (E2.1) — ヘッド LED 環境光を個別制御(setLedColor × 12)ベースに全面改修。
 *
 * E2(全 LED 同色を 4〜18/255 に減光)の実機 FB:
 *   1. 白が明るすぎる(startle の白 = 全灯 2 倍)
 *   2. 色が 5 パターンくらいに離散化しグラデーションに見えない
 *   3. 呼吸のゆらぎが全く見えない
 * 診断: PY32 の LED RAM は RGB565(R5/G6/B5)。全 LED を 4〜18/255 へ暗くすると
 * 量子化で色相が破壊される(例: 琥珀 255,170,60 を輝度 12 に落とすと (12,8,3) →
 * 5/6/5bit で (1,2,0) = 緑化)。
 *
 * 発想の転換: **点灯している LED の色値は量子化に負けない下限(主要チャンネル
 * ≥ 48)を保ち、「暗さ」は点灯 LED 数と空間エンベロープで作る。**
 *
 * - 描画基盤: `getSharedPY32IOExpander()`(robot.led.head 生成時に初期化済みの共有
 *   インスタンス)の `setLedColor(i,r,g,b)` + `refreshLeds()`。12 要素のフレーム
 *   バッファ(frame)と実機ミラー(applied)を持ち、**変化した index だけ**書く
 *   dirty-check。更新レートは通常 4Hz、演出(色相遷移・startle/touch 波・sweep・
 *   manual)中のみ 10Hz(I2C 100kHz・13 トランザクション ≈ 数 ms なので余裕)。
 * - ガンマ: γ=2.2 の 256 要素 LUT をモジュールロード時に 1 回だけ生成。**最終
 *   チャンネル値ではなくエンベロープ強度(e)に通す** — 最終値に掛けると量子化
 *   フロア(48)を割って色相破壊が再発するため。フェードの知覚なめらかさだけを
 *   ガンマで作り、色値レンジは 48..coreBright に閉じる。
 * - 環境光: 色相は v マップ(WHITE⇄AMBER⇄SAKURA / BLUE⇄INDIGO)を維持。
 *   明るさ(覚醒 a)= エンベロープの広さ(envelopeMin..envelopeMax 個 + ceil を
 *   ±25% 変調)。呼吸 = `globalThis.breathPulse` で幅が ±breathSwing/2 伸縮し、
 *   端の LED は e の連続変化でフェードイン/アウトする。sleepy は消灯(既定)。
 * - 色相遷移: v が閾値(0.12)を超えて動いたら、バーの端(論理 0 側)から新しい
 *   色が 1.2 秒かけて流れてくる(境界 LED は補間色)。閾値未満の変化はゆっくり
 *   ドリフト。遷移中に次の要求が来たら to を from に引き継いで即再スタート。
 * - startle(loud/clap): 両端→中央の白っぽい波 300ms(明るさは coreBright 比で
 *   控えめ — E2 の「全灯 2 倍白」の半分以下の光量)。touch: 中央→外の暖色波
 *   600ms。演出は Timer を持たず状態 + tick 合成なので、次の要求が来たら状態の
 *   上書きだけで即引き継がれる。
 * - 物理配置調査: `POST /led/sweep`(index 0→11 を順に単灯)と `POST /led/set`
 *   (単一 LED 直接点灯)。どちらも **生の物理 index**(layout 補正なし)を使う。
 *   並び補正は params.layout {reverse, split}(split は回転オフセット。初期値は
 *   素直に 0..11 連続)。
 *
 * 例外は全て握って trace のみ(再スローしない)。Promise は使わない。I2C 失敗は
 * applied を更新しないことで次 tick に自然リトライ。ループ内アロケーションは
 * スクラッチオブジェクトの使い回しで最小化。
 */

const PREF_KEY = 'led'
const LED_COUNT = 12
const CENTER = (LED_COUNT - 1) / 2 // 5.5
const TICK_MS = 100 // ベースタイマー 10Hz(演出中のレート)
const SLOW_INTERVAL_MS = 250 // 通常時は 4Hz に間引く
const QUANT_FLOOR = 48 // RGB565 量子化に負けない主要チャンネル下限
const LIT_FLOOR_RATIO = 0.35 // 点灯 LED の下限 = max(QUANT_FLOOR, coreBright*0.35)
const EDGE_FADE_E = 0.35 // e がこれ未満: 0..litFloor へのフェードゾーン(端の出入り)
const HUE_TRANS_THRESHOLD = 0.12 // displayedV との差がこれを超えたら波遷移
const HUE_TRANS_MS = 1200 // 端から新しい色が流れてくる時間
const HUE_DRIFT_RATE = 0.1 // 閾値未満の変化を 1 render ごとに寄せる割合
const STARTLE_MS = 300
const TOUCH_PULSE_MS = 600
const WAVE_SOFT = 1.2 // 波頭のソフト幅(LED 単位)
const SWEEP_DEFAULT_MS = 800
const SWEEP_MIN_MS = 100
const SWEEP_MAX_MS = 3000
const SWEEP_VALUE = 90 // sweep の単灯白(識別用)
const SET_DEFAULT_MS = 2000
const MANUAL_MIN_MS = 100
const MANUAL_MAX_MS = 10000
const SLEEP_GLOW_PERIOD_MS = 8000
const SLEEP_GLOW_VALUE = 20 // 白(r=g=b)なので低値でも量子化で色相破壊しない

// 色アンカー(0..255)。実際の書き込み値は「主要チャンネル = value」になるよう
// max チャンネルで正規化する(setFrameLed 参照)。
const WHITE = { r: 255, g: 255, b: 255 } // v=0
const AMBER = { r: 255, g: 170, b: 60 } // v>0 の低め(琥珀)
const SAKURA = { r: 255, g: 140, b: 170 } // v>0 の高め(桜色)
const BLUE = { r: 70, g: 130, b: 255 } // v<0 の低め
const INDIGO = { r: 90, g: 60, b: 200 } // v<0 の高め(藍)
const TOUCH_HUE = { r: 255, g: 161, b: 93 } // AMBER→SAKURA の 0.3(固定の暖色)

// γ=2.2 の 256 要素 LUT(モジュールロード時に 1 回だけ生成)。
const GAMMA = new Uint8Array(256)
for (let i = 0; i < 256; i++) GAMMA[i] = Math.round(255 * ((i / 255) ** 2.2))

const defaults = {
  enabled: true,
  coreBright: 90, // 点灯 LED の基準色値上限(主要チャンネル)
  envelopeMax: 12, // a=+1 のときの点灯幅(LED 個数)
  envelopeMin: 2, // a=-1 のときの点灯幅
  breathSwing: 3, // 呼吸での伸縮幅(LED 個数、±swing/2)
  sleepGlow: false,
  layout: { reverse: false, split: 0 }, // 並び補正(実測で後から調整。split は回転)
}

let params = deepClone(defaults)
let started = false
let expander = null
let tickTimerId = null

// フレームバッファ(描画目標)と実機ミラー(dirty-check 用)。r,g,b × 12 の 36 バイト。
const frame = new Uint8Array(LED_COUNT * 3)
const applied = new Uint8Array(LED_COUNT * 3)
const layoutMap = new Uint8Array(LED_COUNT) // 論理位置 → 物理 index
let lastRenderTicks = -1e15

// 色相遷移の状態
let displayedV = 0 // バーが現在表示している v
let transActive = false
let transStartTicks = 0
let transBoundary = -1 // 論理位置空間の境界(この render での値)
let transToV = 0
const transFromHue = { r: 255, g: 255, b: 255 }
const transToHue = { r: 255, g: 255, b: 255 }

// 演出(startle/touch)の状態。Timer は持たない(tick 合成) — 新しい要求は上書きで即引き継ぐ。
const EFFECT_NONE = 0
const EFFECT_STARTLE = 1
const EFFECT_TOUCH = 2
let effectType = EFFECT_NONE
let effectStartTicks = 0

// manual(/led/set・/led/test)と sweep(/led/sweep)
const manualFrame = new Uint8Array(LED_COUNT * 3)
let manualUntilTicks = -1e15
let sweepActive = false
let sweepStartTicks = 0
let sweepStepMs = SWEEP_DEFAULT_MS
let sweepLastIndex = -1

// ループ内アロケーション回避用スクラッチ
const hueScratch = { r: 0, g: 0, b: 0 }
const hueScratch2 = { r: 0, g: 0, b: 0 }
let lastWidth = 0 // GET /led の計器用

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function clampByte(x) {
  const n = Math.round(x)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

/** e(0..1)を γ LUT に通した 0..1 を返す(フェードの知覚をなめらかに)。 */
function gamma01(t) {
  return GAMMA[Math.round(clamp01(t) * 255)] / 255
}

function clampLedParams(target) {
  if (typeof target.coreBright === 'number') target.coreBright = clamp(Math.round(target.coreBright), QUANT_FLOOR, 255)
  if (typeof target.envelopeMax === 'number') target.envelopeMax = clamp(target.envelopeMax, 1, LED_COUNT)
  if (typeof target.envelopeMin === 'number') target.envelopeMin = clamp(target.envelopeMin, 0, LED_COUNT)
  if (typeof target.breathSwing === 'number') target.breathSwing = clamp(target.breathSwing, 0, 6)
  if (target.layout && typeof target.layout.split === 'number')
    target.layout.split = clamp(Math.round(target.layout.split), 0, LED_COUNT - 1)
  return target
}

function rebuildLayoutMap() {
  const reverse = !!params.layout?.reverse
  const split = (params.layout?.split ?? 0) | 0
  for (let p = 0; p < LED_COUNT; p++) {
    let i = reverse ? LED_COUNT - 1 - p : p
    if (split > 0) i = (i + split) % LED_COUNT
    layoutMap[p] = i
  }
}

function lerpColorInto(from, to, t, out) {
  out.r = from.r + (to.r - from.r) * t
  out.g = from.g + (to.g - from.g) * t
  out.b = from.b + (to.b - from.b) * t
}

/** v(-1..1) から色相を out に書く。v=0 は両枝とも WHITE へ収束(連続)。 */
function computeHueColorInto(v, out) {
  if (v > 0) {
    const t = clamp(v, 0, 1)
    if (t <= 0.5) lerpColorInto(WHITE, AMBER, t * 2, out)
    else lerpColorInto(AMBER, SAKURA, (t - 0.5) * 2, out)
    return
  }
  const t = clamp(-v, 0, 1)
  if (t <= 0.5) lerpColorInto(WHITE, BLUE, t * 2, out)
  else lerpColorInto(BLUE, INDIGO, (t - 0.5) * 2, out)
}

/** frame の physIndex に「主要チャンネル = value」となるよう hue を正規化して書く。 */
function setFrameLed(physIndex, hue, value) {
  const m = Math.max(hue.r, hue.g, hue.b)
  if (m <= 0 || value <= 0) return
  const s = value / m
  const o = physIndex * 3
  frame[o] = clampByte(hue.r * s)
  frame[o + 1] = clampByte(hue.g * s)
  frame[o + 2] = clampByte(hue.b * s)
}

/** setFrameLed の per-channel max 合成版(演出オーバーレイ用 — 加算より飽和しにくい)。 */
function maxFrameLed(physIndex, hue, value) {
  const m = Math.max(hue.r, hue.g, hue.b)
  if (m <= 0 || value <= 0) return
  const s = value / m
  const o = physIndex * 3
  const r = clampByte(hue.r * s)
  const g = clampByte(hue.g * s)
  const b = clampByte(hue.b * s)
  if (r > frame[o]) frame[o] = r
  if (g > frame[o + 1]) frame[o + 1] = g
  if (b > frame[o + 2]) frame[o + 2] = b
}

// ---------------------------------------------------------------------------
// 空間エンベロープ(暗さ = 点灯 LED 数、色値は量子化フロア以上に保つ)
// ---------------------------------------------------------------------------

/** a(-1..1) と breathPulse から点灯幅(LED 個数、連続値)を決める。 */
function currentWidth(a) {
  const aNorm = clamp01((a + 1) / 2)
  const envMin = Math.min(params.envelopeMin, params.envelopeMax)
  const base = envMin + (params.envelopeMax - envMin) * aNorm
  const pulse = typeof globalThis.breathPulse === 'number' ? clamp01(globalThis.breathPulse) : 0.5
  return clamp(base + params.breathSwing * (pulse - 0.5), 0.2, LED_COUNT)
}

/**
 * エンベロープ値 e(0..1)→ 主要チャンネル値。
 * - e < EDGE_FADE_E: 0..litFloor の直線フェード(端の出入り。短時間・低輝度なので
 *   量子化の色相ズレは許容し、「いきなり点/消」を避けることを優先)
 * - それ以上: litFloor..ceil を γ LUT で知覚なめらかに(色相は常に判別できる強度)
 */
function litValue(e, ceil, floor) {
  if (e <= 0) return 0
  if (e < EDGE_FADE_E) return floor * (e / EDGE_FADE_E)
  const t = (e - EDGE_FADE_E) / (1 - EDGE_FADE_E)
  return floor + (ceil - floor) * gamma01(t)
}

// ---------------------------------------------------------------------------
// 色相遷移(端から新しい色が流れてくる)
// ---------------------------------------------------------------------------

function updateHueTransition(now, targetV) {
  if (transActive) {
    const tp = (now - transStartTicks) / HUE_TRANS_MS
    if (tp >= 1) {
      transActive = false
      displayedV = transToV
    } else {
      transBoundary = -1 + tp * (LED_COUNT + 2) // -1 → 13(全 LED を確実に通過)
      if (Math.abs(targetV - transToV) > HUE_TRANS_THRESHOLD) {
        // 演出中の次の要求: to を from に引き継いで即再スタート(未到達側の LED は
        // 旧 from 色から一段飛ぶが、完全なピクセル継承より状態の単純さを優先)。
        displayedV = transToV
        transFromHue.r = transToHue.r
        transFromHue.g = transToHue.g
        transFromHue.b = transToHue.b
        computeHueColorInto(targetV, transToHue)
        transToV = targetV
        transStartTicks = now
        transBoundary = -1
        trace(`[led] hue transition retarget -> v=${targetV.toFixed(2)}\n`)
      }
    }
  }
  if (!transActive) {
    if (Math.abs(targetV - displayedV) > HUE_TRANS_THRESHOLD) {
      computeHueColorInto(displayedV, transFromHue)
      computeHueColorInto(targetV, transToHue)
      transToV = targetV
      transActive = true
      transStartTicks = now
      transBoundary = -1
      trace(`[led] hue transition ${displayedV.toFixed(2)} -> ${targetV.toFixed(2)}\n`)
    } else {
      displayedV += (targetV - displayedV) * HUE_DRIFT_RATE
    }
  }
}

/** 論理位置 p の現在色相を out へ(遷移中は境界の両側で from/to、境界 LED は補間)。 */
function hueAt(p, out) {
  if (!transActive) {
    computeHueColorInto(displayedV, out)
    return
  }
  const mix = clamp01(transBoundary - p)
  lerpColorInto(transFromHue, transToHue, mix, out)
}

// ---------------------------------------------------------------------------
// フレーム合成(ambient / sleepy / 演出オーバーレイ / manual / sweep)
// ---------------------------------------------------------------------------

function renderSleepFrame(now) {
  frame.fill(0)
  if (!params.sleepGlow) return
  const phase = (now % SLEEP_GLOW_PERIOD_MS) / SLEEP_GLOW_PERIOD_MS
  if (Math.sin(2 * Math.PI * phase) <= 0) return
  // 中央 2 個だけ、かすかな白(r=g=b なので量子化で色相破壊しない)。
  for (let p = 5; p <= 6; p++) {
    const o = layoutMap[p] * 3
    frame[o] = SLEEP_GLOW_VALUE
    frame[o + 1] = SLEEP_GLOW_VALUE
    frame[o + 2] = SLEEP_GLOW_VALUE
  }
}

/** startle/touch の空間波をフレームへ max 合成する(sleepy 中でも波は見せる)。 */
function overlayEffects(now) {
  if (effectType === EFFECT_NONE) return
  const duration = effectType === EFFECT_STARTLE ? STARTLE_MS : TOUCH_PULSE_MS
  const tp = (now - effectStartTicks) / duration
  if (tp >= 1) {
    effectType = EFFECT_NONE
    return
  }
  if (effectType === EFFECT_STARTLE) {
    // 両端→中央へ白っぽい波(明るさは coreBright 比で控えめ — E2 の全灯 2 倍白の反省)。
    const front = tp * (CENTER + WAVE_SOFT)
    const value = Math.max(QUANT_FLOOR, params.coreBright * 0.7)
    computeHueColorInto(displayedV, hueScratch2)
    lerpColorInto(hueScratch2, WHITE, 0.75, hueScratch)
    for (let p = 0; p < LED_COUNT; p++) {
      const distFromEnd = Math.min(p, LED_COUNT - 1 - p)
      const o = clamp01(WAVE_SOFT - Math.abs(distFromEnd - front))
      if (o > 0) maxFrameLed(layoutMap[p], hueScratch, value * o)
    }
    return
  }
  // touch: 中央→外へ暖色の波(sin 包絡線で立ち上がり・戻る)。
  const front = tp * (CENTER + WAVE_SOFT)
  const value = params.coreBright * Math.sin(Math.PI * tp)
  for (let p = 0; p < LED_COUNT; p++) {
    const d = Math.abs(p - CENTER)
    const o = clamp01(WAVE_SOFT - Math.abs(d - front))
    if (o > 0) maxFrameLed(layoutMap[p], TOUCH_HUE, value * o)
  }
}

function renderAmbientFrame(now) {
  let v = 0
  let a = 0
  let sleepy = false
  try {
    const emo = getEmotion()
    if (emo) {
      v = typeof emo.v === 'number' ? emo.v : 0
      a = typeof emo.a === 'number' ? emo.a : 0
      sleepy = !!emo.sleepy
    }
  } catch (error) {
    trace(`[led] emotion query failed: ${error}\n`)
    frame.fill(0)
    return
  }

  if (sleepy) {
    renderSleepFrame(now)
    overlayEffects(now)
    return
  }

  updateHueTransition(now, v)

  const aNorm = clamp01((a + 1) / 2)
  const w = currentWidth(a)
  lastWidth = w
  const floor = Math.min(Math.max(QUANT_FLOOR, params.coreBright * LIT_FLOOR_RATIO), params.coreBright)
  const ceil = clamp(params.coreBright * (0.75 + 0.25 * aNorm), floor, 255)

  frame.fill(0)
  const halfW = w / 2
  for (let p = 0; p < LED_COUNT; p++) {
    const d = Math.abs(p - CENTER)
    const e = clamp01(halfW + 0.5 - d)
    const value = litValue(e, ceil, floor)
    if (value <= 0) continue
    hueAt(p, hueScratch)
    setFrameLed(layoutMap[p], hueScratch, value)
  }

  overlayEffects(now)
}

function renderSweepFrame(now) {
  const idx = Math.floor((now - sweepStartTicks) / sweepStepMs)
  frame.fill(0)
  const o = idx * 3 // 生の物理 index(layout 補正なし — 物理配置の目視特定用)
  frame[o] = SWEEP_VALUE
  frame[o + 1] = SWEEP_VALUE
  frame[o + 2] = SWEEP_VALUE
  if (idx !== sweepLastIndex) {
    sweepLastIndex = idx
    trace(`[led] sweep index ${idx}\n`)
  }
}

// ---------------------------------------------------------------------------
// I2C 書き込み(index 単位の dirty-check + 一括 refresh)
// ---------------------------------------------------------------------------

function flushFrame() {
  let changed = false
  let failed = false
  for (let i = 0; i < LED_COUNT; i++) {
    const o = i * 3
    const r = frame[o]
    const g = frame[o + 1]
    const b = frame[o + 2]
    if (applied[o] === r && applied[o + 1] === g && applied[o + 2] === b) continue
    try {
      expander.setLedColor(i, r, g, b)
      applied[o] = r
      applied[o + 1] = g
      applied[o + 2] = b
      changed = true
    } catch (_error) {
      failed = true // applied を更新しない → 次 tick で自然リトライ
    }
  }
  if (failed) trace('[led] I2C write failed (will retry)\n')
  if (changed) {
    try {
      expander.refreshLeds()
    } catch (error) {
      trace(`[led] refresh failed: ${error}\n`)
    }
  }
}

// ---------------------------------------------------------------------------
// メインループ(ベース 10Hz、通常時は 4Hz に間引き)
// ---------------------------------------------------------------------------

function performLedTick() {
  try {
    if (!expander) return
    const now = Time.ticks

    if (sweepActive && Math.floor((now - sweepStartTicks) / sweepStepMs) >= LED_COUNT) {
      sweepActive = false
      trace('[led] sweep done\n')
    }
    const manualActive = now < manualUntilTicks

    if (!params.enabled) {
      // 無効時は演出状態も破棄する(enabled 復帰時に古い波が走らないように)。
      effectType = EFFECT_NONE
      transActive = false
      if (!sweepActive && !manualActive) {
        if (now - lastRenderTicks < SLOW_INTERVAL_MS - TICK_MS / 2) return
        lastRenderTicks = now
        frame.fill(0)
        flushFrame()
        return
      }
    }

    const busy = sweepActive || manualActive || effectType !== EFFECT_NONE || transActive
    if (!busy && now - lastRenderTicks < SLOW_INTERVAL_MS - TICK_MS / 2) return
    lastRenderTicks = now

    if (sweepActive) renderSweepFrame(now)
    else if (manualActive) frame.set(manualFrame)
    else renderAmbientFrame(now)

    flushFrame()
  } catch (error) {
    trace(`[led] tick failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// イベント入力(mic の loud/clap、emotion の touch)
// ---------------------------------------------------------------------------

function handleMicEvent(event) {
  try {
    if (!started || !params.enabled) return
    if ('loud' !== event?.type && 'clap' !== event?.type) return
    effectType = EFFECT_STARTLE // 進行中の演出があっても上書きで即引き継ぐ
    effectStartTicks = Time.ticks
  } catch (error) {
    trace(`[led] mic event handling failed: ${error}\n`)
  }
}

function handleEmotionEvent(event) {
  try {
    if (!started || !params.enabled) return
    if ('touch' !== event?.type) return
    effectType = EFFECT_TOUCH
    effectStartTicks = Time.ticks
  } catch (error) {
    trace(`[led] emotion event handling failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** mod.js から起動 +9s で一度だけ呼ぶ。 */
export function startLed(robot) {
  if (started) return
  started = true
  params = clampLedParams(loadParams(PREF_KEY, defaults, {}))
  rebuildLayoutMap()

  let head = null
  try {
    head = robot?.led?.head ?? null
  } catch (error) {
    trace(`[led] robot.led.head access failed: ${error}\n`)
  }
  if (!head) {
    trace('[led] robot.led.head not available; disabled\n')
    return
  }

  try {
    // robot.led.head(PY32Led)生成時に共有インスタンスが初期化済みなので、ここは
    // 取得のみ(新規 I2C オープンや begin リトライの待ちは走らない)。
    expander = getSharedPY32IOExpander()
  } catch (error) {
    trace(`[led] shared expander unavailable: ${error}\n`)
    expander = null
    return
  }

  try {
    head.off() // PY32Led 側の演出タイマーを止めて全消灯 → applied=0 と実機を一致させる
  } catch (error) {
    trace(`[led] initial off failed: ${error}\n`)
  }
  applied.fill(0)

  try {
    onMicEvent(handleMicEvent)
  } catch (error) {
    trace(`[led] onMicEvent subscribe failed: ${error}\n`)
  }
  try {
    onEmotionEvent(handleEmotionEvent)
  } catch (error) {
    trace(`[led] onEmotionEvent subscribe failed: ${error}\n`)
  }

  tickTimerId = Timer.repeat(performLedTick, TICK_MS)
  trace('[led] started (E2.1 per-LED envelope)\n')
}

/** GET /led — フレームバッファ要約(モード・点灯数・代表色 = 最輝 LED)+ params。 */
export function getLedStatus() {
  const now = Time.ticks
  let lit = 0
  let best = -1
  let bi = 0
  const frameOut = []
  for (let i = 0; i < LED_COUNT; i++) {
    const o = i * 3
    const s = frame[o] + frame[o + 1] + frame[o + 2]
    if (s > 0) lit++
    if (s > best) {
      best = s
      bi = o
    }
    frameOut.push([frame[o], frame[o + 1], frame[o + 2]])
  }
  const mode = !params.enabled
    ? 'disabled'
    : sweepActive
      ? 'sweep'
      : now < manualUntilTicks
        ? 'manual'
        : effectType === EFFECT_STARTLE
          ? 'startle'
          : effectType === EFFECT_TOUCH
            ? 'touch'
            : transActive
              ? 'transition'
              : 'ambient'
  return {
    mode,
    lit,
    rep: { r: frame[bi], g: frame[bi + 1], b: frame[bi + 2] },
    displayedV: Math.round(displayedV * 1000) / 1000,
    width: Math.round(lastWidth * 100) / 100,
    frame: frameOut,
    params: getLedParams(),
  }
}

/** 現在有効なパラメータ。 */
export function getLedParams() {
  return deepClone(params)
}

/** 部分更新(PUT /led/params)。deep merge + クランプ + layout 再構築 + Preference 永続化。 */
export function setLedParams(partial) {
  if (!partial || typeof partial !== 'object') return getLedParams()
  params = clampLedParams(mergeValidated(params, partial))
  rebuildLayoutMap()
  persistParams(PREF_KEY, params)
  trace(`[led] params updated ${JSON.stringify(Object.keys(partial))}\n`)
  return getLedParams()
}

/**
 * POST /led/set(要 x-dev-token)。単一 LED を **生の物理 index** で直接点灯
 * (物理配置の目視特定用 — layout 補正は通さない)。ms 経過後は通常描画へ戻る。
 */
export function setLedSingle(index, r, g, b, ms) {
  if (!expander) return false
  try {
    const i = typeof index === 'number' ? Math.round(index) : -1
    if (i < 0 || i >= LED_COUNT) return false
    manualFrame.fill(0)
    const o = i * 3
    manualFrame[o] = clampByte(typeof r === 'number' ? r : 0)
    manualFrame[o + 1] = clampByte(typeof g === 'number' ? g : 0)
    manualFrame[o + 2] = clampByte(typeof b === 'number' ? b : 0)
    const duration = clamp(typeof ms === 'number' && ms > 0 ? ms : SET_DEFAULT_MS, MANUAL_MIN_MS, MANUAL_MAX_MS)
    manualUntilTicks = Time.ticks + duration
    sweepActive = false
    trace(`[led] set index=${i} rgb=(${manualFrame[o]},${manualFrame[o + 1]},${manualFrame[o + 2]}) ms=${duration}\n`)
    return true
  } catch (error) {
    trace(`[led] set failed: ${error}\n`)
    return false
  }
}

/**
 * POST /led/sweep(要 x-dev-token)。index 0→11 を ms ごとに 1 個ずつ白点灯する
 * デモ(ユーザーが物理配置を目視特定するため。生の物理 index・layout 補正なし)。
 * 総所要時間(ms)を返す。0 は失敗。
 */
export function startLedSweep(ms) {
  if (!expander) return 0
  try {
    sweepStepMs = clamp(typeof ms === 'number' && ms > 0 ? ms : SWEEP_DEFAULT_MS, SWEEP_MIN_MS, SWEEP_MAX_MS)
    sweepStartTicks = Time.ticks
    sweepLastIndex = -1
    sweepActive = true
    manualUntilTicks = -1e15
    trace(`[led] sweep start ${sweepStepMs}ms/led\n`)
    return sweepStepMs * LED_COUNT
  } catch (error) {
    trace(`[led] sweep failed: ${error}\n`)
    return 0
  }
}

/**
 * POST /led/test(要 x-dev-token)。全 12 LED を同色で直接点灯(E2 互換のテスト経路。
 * PY32Led.on() ではなく manual フレーム経由になった)。ms 経過後は通常描画へ戻る。
 */
export function testLed(r, g, b, ms) {
  if (!expander) return false
  try {
    const rr = clampByte(typeof r === 'number' ? r : 0)
    const gg = clampByte(typeof g === 'number' ? g : 0)
    const bb = clampByte(typeof b === 'number' ? b : 0)
    for (let i = 0; i < LED_COUNT; i++) {
      const o = i * 3
      manualFrame[o] = rr
      manualFrame[o + 1] = gg
      manualFrame[o + 2] = bb
    }
    const duration = clamp(typeof ms === 'number' && ms > 0 ? ms : 1000, MANUAL_MIN_MS, MANUAL_MAX_MS)
    manualUntilTicks = Time.ticks + duration
    sweepActive = false
    trace(`[led] test r=${rr} g=${gg} b=${bb} ms=${duration}\n`)
    return true
  } catch (error) {
    trace(`[led] test failed: ${error}\n`)
    return false
  }
}
