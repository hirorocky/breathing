import Time from 'time'
import Timer from 'timer'
import { deepClone, mergeValidated, loadParams, persistParams } from 'breath/param-store'
import { onMicEvent } from 'breath/mic'
import { getEmotion, onEmotionEvent } from 'breath/emotion'

/**
 * v1.2.0 (E2) — ヘッド LED(12 連 PY32)を感情の環境光にする。
 *
 * `robot.led.head`(`PY32Led`、RGB。breath ファームで既に生成済み — ゲート・パッチ
 * 不要)を 4Hz(250ms)のループで更新する。I2C は 100kHz・全 12 個更新で 13
 * トランザクションかかるため、色が前回と同じなら書かない(dirty-check)。
 *
 * 色相は emotion.js の v(valence)で決める: v>0 は暖色(淡い白 → 琥珀 → 桜色)、
 * v<0 は寒色(淡い白 → 青 → 藍)。v=0 は両ブランチが同じ WHITE アンカーへ収束する
 * ため特別分岐は不要(連続関数)。明るさは a(arousal)で決める: 4〜maxBright(既定
 * 18/255)— 環境光は主張しない範囲に抑える。mod.js が呼吸サイクルごとに書く
 * `globalThis.breathPulse`(0..1、口の開き具合を正規化した値)で ±30% のゆらぎを
 * 掛ける。sleepy(emotion.js の判定)では既定で消灯、`sleepGlow` パラメータ有効時は
 * 1/255 の 8 秒周期のかすかな明滅にする。
 *
 * イベント演出: `onMicEvent`(mic.js)の loud/clap で 300ms だけ明るさ 2 倍・白寄り
 * (startle の可視化)。touch は `emotion.js` に最小追加した `onEmotionEvent(cb)`
 * 購読ポイント経由(pushTouch() が 'touch' イベントを発火する)で 600ms の暖色パルス。
 *
 * dev-server 向けに `GET /led`(現在色・params)・`PUT /led/params`(部分更新)・
 * `POST /led/test`(直接点灯テスト、`PY32Led.on()` の duration 引数で自動消灯)を
 * 公開する(実際のルーティングは dev-server.js 側)。
 *
 * 例外は全て握って trace のみ(再スローしない)。Promise は使わない(cry.js /
 * liveliness.js / mic.js と同じ方針)。LED の I2C 失敗はループを止めず次回リトライ
 * する(dirty-check のキャッシュを更新しないことで自然に次回書き込みを再試行する)。
 */

const PREF_KEY = 'led'
const TICK_MS = 250 // 4Hz。I2C 100kHz・12 個更新で 13 トランザクションかかるため上限
const MIN_BRIGHT = 4 // maxBright 既定 18 のときの下限(base = 4 + max(0,a)*14 と等価)
const BREATH_FLUTTER_AMOUNT = 0.3 // 呼吸連動の ±30% ゆらぎ
const STARTLE_MS = 300
const STARTLE_BRIGHT_MULTIPLIER = 2
const TOUCH_PULSE_MS = 600
const SLEEP_GLOW_PERIOD_MS = 8000
const SLEEP_GLOW_VALUE = 1 // 1/255 のかすかな明滅
const TEST_MAX_MS = 10000 // POST /led/test の安全上限

// 色アンカー(0..255、彩度最大の基準色。実際の明るさは scaleColor() で brightness/255 倍する)。
const WHITE = { r: 255, g: 255, b: 255 } // v=0(淡い白)
const AMBER = { r: 255, g: 170, b: 60 } // v>0 の低め(琥珀)
const SAKURA = { r: 255, g: 140, b: 170 } // v>0 の高め(桜色)
const BLUE = { r: 70, g: 130, b: 255 } // v<0 の低め
const INDIGO = { r: 90, g: 60, b: 200 } // v<0 の高め(藍)
const TOUCH_HUE = lerpColorAnchor(AMBER, SAKURA, 0.3) // touch パルスは固定の暖色

const defaults = {
  enabled: true,
  maxBright: 18,
  sleepGlow: false,
}

let params = deepClone(defaults)
let started = false
let ledRef = null
let tickTimerId = null

let lastAppliedColor = null // { r, g, b }(dirty-check 用。null はまだ一度も書いていない)
let startleUntilTicks = -Infinity
let touchStartTicks = -Infinity
let touchUntilTicks = -Infinity
let testUntilTicks = -Infinity
let testColor = null // { r, g, b }(GET /led がテスト中に報告する実際の点灯色)

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x
}

function clampByte(x) {
  const n = Math.round(x)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

function clampLedParams(target) {
  if (typeof target.maxBright === 'number') target.maxBright = clamp(target.maxBright, 0, 80)
  return target
}

function lerpColorAnchor(from, to, t) {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  }
}

function scaleColor(color, brightness) {
  const scale = brightness / 255
  return { r: color.r * scale, g: color.g * scale, b: color.b * scale }
}

/** v(-1..1) から色相を決める。v=0 はどちらの枝でも WHITE アンカーへ収束する(連続)。 */
function computeHueColor(v) {
  if (v > 0) {
    const t = clamp(v, 0, 1)
    return t <= 0.5 ? lerpColorAnchor(WHITE, AMBER, t * 2) : lerpColorAnchor(AMBER, SAKURA, (t - 0.5) * 2)
  }
  const t = clamp(-v, 0, 1)
  return t <= 0.5 ? lerpColorAnchor(WHITE, BLUE, t * 2) : lerpColorAnchor(BLUE, INDIGO, (t - 0.5) * 2)
}

// ---------------------------------------------------------------------------
// 色の合成(通常時 / sleepy / startle / touch)
// ---------------------------------------------------------------------------

function computeSleepyColor(now) {
  if (!params.sleepGlow) return { r: 0, g: 0, b: 0 }
  const phase = (now % SLEEP_GLOW_PERIOD_MS) / SLEEP_GLOW_PERIOD_MS
  const level = Math.sin(2 * Math.PI * phase) * 0.5 + 0.5
  const value = level > 0.5 ? SLEEP_GLOW_VALUE : 0
  return { r: value, g: value, b: value }
}

/** 通常時の環境光。emotion.js 失敗時は消灯にフォールバックする。 */
function computeAmbientColor(now) {
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
    return { r: 0, g: 0, b: 0 }
  }

  if (sleepy) return computeSleepyColor(now)

  const hue = computeHueColor(v)
  const pulse = typeof globalThis.breathPulse === 'number' ? clamp(globalThis.breathPulse, 0, 1) : 0.5
  const breathMul = 1 + BREATH_FLUTTER_AMOUNT * (2 * pulse - 1) // 0.7..1.3
  const minBright = Math.min(MIN_BRIGHT, params.maxBright)
  const brightnessBase = minBright + Math.max(0, a) * (params.maxBright - minBright)
  const brightness = Math.max(0, brightnessBase * breathMul)
  return scaleColor(hue, brightness)
}

/** startle 演出: 現在の環境光を白寄りに寄せて 2 倍(300ms)。 */
function computeStartleColor(now) {
  const base = computeAmbientColor(now)
  const boosted = lerpColorAnchor(base, WHITE, 0.5)
  return {
    r: Math.min(255, boosted.r * STARTLE_BRIGHT_MULTIPLIER),
    g: Math.min(255, boosted.g * STARTLE_BRIGHT_MULTIPLIER),
    b: Math.min(255, boosted.b * STARTLE_BRIGHT_MULTIPLIER),
  }
}

/** touch 演出: 固定の暖色パルス(600ms、sin 包絡線で滑らかに立ち上がり・戻る)。 */
function computeTouchPulseColor(now) {
  const progress = clamp((now - touchStartTicks) / TOUCH_PULSE_MS, 0, 1)
  const envelope = Math.sin(Math.PI * progress) // 0 -> 1 -> 0
  const minBright = Math.min(MIN_BRIGHT, params.maxBright)
  const peakBright = Math.max(minBright, params.maxBright)
  const brightness = minBright + envelope * (peakBright - minBright)
  return scaleColor(TOUCH_HUE, brightness)
}

// ---------------------------------------------------------------------------
// I2C 書き込み(dirty-check)
// ---------------------------------------------------------------------------

function applyColor(color) {
  const r = clampByte(color.r)
  const g = clampByte(color.g)
  const b = clampByte(color.b)
  if (lastAppliedColor && lastAppliedColor.r === r && lastAppliedColor.g === g && lastAppliedColor.b === b) return
  try {
    ledRef.on(r, g, b)
    lastAppliedColor = { r, g, b }
  } catch (error) {
    trace(`[led] I2C write failed: ${error}\n`)
    // lastAppliedColor を更新しない → 次回 tick で同じ色を再試行する
  }
}

// ---------------------------------------------------------------------------
// メインループ(4Hz)
// ---------------------------------------------------------------------------

function performLedTick() {
  try {
    if (!ledRef) return
    const now = Time.ticks
    if (now < testUntilTicks) return // POST /led/test 実行中は通常ループに触れない(PY32Led.on の duration が自動消灯する)

    if (!params.enabled) {
      applyColor({ r: 0, g: 0, b: 0 })
      return
    }

    let color
    if (now < touchUntilTicks) {
      color = computeTouchPulseColor(now)
    } else if (now < startleUntilTicks) {
      color = computeStartleColor(now)
    } else {
      color = computeAmbientColor(now)
    }
    applyColor(color)
  } catch (error) {
    trace(`[led] tick failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// イベント入力(mic の loud/clap、emotion の touch)
// ---------------------------------------------------------------------------

function handleMicEvent(event) {
  try {
    if (!started) return
    if ('loud' !== event?.type && 'clap' !== event?.type) return
    startleUntilTicks = Time.ticks + STARTLE_MS
  } catch (error) {
    trace(`[led] mic event handling failed: ${error}\n`)
  }
}

function handleEmotionEvent(event) {
  try {
    if (!started) return
    if ('touch' !== event?.type) return
    touchStartTicks = Time.ticks
    touchUntilTicks = touchStartTicks + TOUCH_PULSE_MS
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

  try {
    ledRef = robot?.led?.head ?? null
  } catch (error) {
    trace(`[led] robot.led.head access failed: ${error}\n`)
    ledRef = null
  }
  if (!ledRef) {
    trace('[led] robot.led.head not available; disabled\n')
    return
  }

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
  trace('[led] started\n')
}

/** 現在色・テスト中フラグ・params(GET /led)。テスト中は testColor を報告する。 */
export function getLedStatus() {
  const testing = Time.ticks < testUntilTicks
  return {
    color: testing && testColor ? testColor : lastAppliedColor ?? { r: 0, g: 0, b: 0 },
    testing,
    params: getLedParams(),
  }
}

/** 現在有効なパラメータ。 */
export function getLedParams() {
  return deepClone(params)
}

/** 部分更新(PUT /led/params)。deep merge + クランプ + Preference 永続化。 */
export function setLedParams(partial) {
  if (!partial || typeof partial !== 'object') return getLedParams()
  params = clampLedParams(mergeValidated(params, partial))
  persistParams(PREF_KEY, params)
  trace(`[led] params updated ${JSON.stringify(Object.keys(partial))}\n`)
  return getLedParams()
}

/**
 * POST /led/test(要 x-dev-token)。直接点灯テスト。`PY32Led.on()` の duration 引数で
 * 自動消灯させ、通常ループはテスト期間中スキップする(performLedTick 参照)。
 * テスト終了後は dirty-check キャッシュを無効化してあるため、次の通常 tick で必ず
 * 再適用される。
 */
export function testLed(r, g, b, ms) {
  if (!ledRef) return false
  try {
    const rr = clampByte(typeof r === 'number' ? r : 0)
    const gg = clampByte(typeof g === 'number' ? g : 0)
    const bb = clampByte(typeof b === 'number' ? b : 0)
    const duration = Math.min(TEST_MAX_MS, typeof ms === 'number' && ms > 0 ? ms : 1000)
    testUntilTicks = Time.ticks + duration
    testColor = { r: rr, g: gg, b: bb }
    lastAppliedColor = null
    ledRef.on(rr, gg, bb, duration)
    trace(`[led] test r=${rr} g=${gg} b=${bb} ms=${duration}\n`)
    return true
  } catch (error) {
    trace(`[led] test failed: ${error}\n`)
    return false
  }
}
