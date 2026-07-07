import Time from 'time'
import Timer from 'timer'
import { deepClone, mergeValidated, sanitizeParams, loadParams, persistParams } from 'breath/param-store'
import { onMicEvent, getMicStatus } from 'breath/mic'

/**
 * v1.2.0 (E1) — 感情 2 次元エンジン(`docs/tasks/emotion-space-scenarios.md`)。
 *
 * 状態は `{v, a}`(valence/arousal、それぞれ [-1, 1])のみ。1 秒ごとの Timer tick で
 * ベースラインへ指数回帰しつつ、微ノイズで完全静止しない(concept-v1 の非線形原則)。
 * イベント(mic の loud/clap/voice/silence、タッチ)は tick を待たずその場で state に
 * 加算する。時刻(JST、status-bar.js と同じ +9h オフセット手法)で夜間の arousal 上限・
 * 朝のベースラインを変調する。
 *
 * 表情への配線は globalThis ブリッジ(liveliness.js の breathPulseDepth 等と同じ作法)。
 * emotion.js が毎 tick 書き、eye-cozmo.js/breath-face.js の occluder が毎フレーム読む
 * (値の更新は 1Hz、描画側は自前で軽い平滑化をかける)。他モジュール(mod.js の
 * breathFactor、liveliness.js の speedFactor/gainFactor、reactions.js の
 * gainFactor/recoveryFactor)は `getEmotion()` を関数呼び出しで読む(globalThis は
 * 使わない — 数値 1 個の受け渡しに関数呼び出しで十分)。
 *
 * 循環 import を避けるため、emotion.js は breath/liveliness・breath/reactions・
 * breath/cry を import しない(それらが emotion.js を import する非対称な依存関係を
 * 保つ)。クロスモジュールな複合アクション(シナリオの視線・鳴き声トリガ等)は
 * dev-server.js 側(既存の LIVE_ACTIONS と同じオーケストレーション層)で組み立てる。
 *
 * 例外は全て握って trace のみ(再スローしない)。Promise は使わない(cry.js /
 * liveliness.js / reactions.js / mic.js と同じ方針)。
 */

const PREF_KEY = 'emotion'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000 // status-bar.js と同じ
const TICK_MS = 1000
const MS_PER_MIN = 60000
const BURST_WINDOW_MS = 60000 // startle 連発・タッチ連発の判定窓

const defaults = {
  enabled: true,
  baseline: { v: 0.2, a: 0 },
  tau: { v: 180, a: 180 }, // 秒
  noise: { amp: 0.02 }, // ポアソン的微ノイズ(tick ごとのランダムウォーク振幅)
  night: { startHour: 23, endHour: 6, arousalCap: 0.3 },
  morning: { startHour: 6, endHour: 9, baselineADelta: -0.2 },
  events: {
    loudArousal: 0.25,
    voiceArousal: 0.05,
    voiceValence: 0.03,
    silenceArousal: -0.2,
    startleBurstValence: -0.3, // シナリオ13(萎縮): 60秒内3回以上
    startleBurstCount: 3,
    touchValence: 0.3,
    touchArousal: 0.1,
    touchBurstValence: -0.4, // シナリオ12(触られすぎ): 60秒内4回以上
    touchBurstArousal: 0.2,
    touchBurstCount: 4,
  },
  gain: { min: 0.2, max: 2.0 },
  sleepy: {
    arousalThreshold: -0.6,
    holdMs: 90000,
    flutterOpenTopLid: 0.35,
    flutterProbPerTick: 0.025, // tick(1Hz)あたりの発火確率。平均 ~40s(20〜60s のポアソン近似)
    flutterDurationMs: 700,
  },
  poll: {
    intervalMs: 30000, // voiceActive/silent の巡回チェック間隔(シナリオ14/15)
    voiceValenceTarget: 0.3,
    voiceArousalTarget: 0.15,
    voiceNudge: 0.3, // 目標値へ引く割合(0-1)
    silentArousalTarget: -0.3,
    silentNudge: 0.3,
  },
}

// path -> [min, max]。setEmotionParams / 復元時の安全クランプ(mic.js / reactions.js と同じ作法)。
const CLAMP_RANGES = {
  'tau.v': [5, 3600],
  'tau.a': [5, 3600],
  'noise.amp': [0, 0.2],
  'night.arousalCap': [-1, 1],
  'morning.baselineADelta': [-1, 1],
  'events.loudArousal': [0, 1],
  'events.voiceArousal': [0, 1],
  'events.voiceValence': [0, 1],
  'events.silenceArousal': [-1, 0],
  'events.startleBurstValence': [-1, 0],
  'events.startleBurstCount': [1, 20],
  'events.touchValence': [0, 1],
  'events.touchArousal': [0, 1],
  'events.touchBurstValence': [-1, 0],
  'events.touchBurstArousal': [0, 1],
  'events.touchBurstCount': [1, 20],
  'gain.min': [0.05, 1],
  'gain.max': [1, 4],
  'sleepy.arousalThreshold': [-1, 0],
  'sleepy.holdMs': [1000, 600000],
  'sleepy.flutterOpenTopLid': [0, 1],
  'sleepy.flutterProbPerTick': [0, 1],
  'sleepy.flutterDurationMs': [100, 5000],
  'poll.intervalMs': [1000, 300000],
  'poll.voiceValenceTarget': [-1, 1],
  'poll.voiceArousalTarget': [-1, 1],
  'poll.voiceNudge': [0, 1],
  'poll.silentArousalTarget': [-1, 1],
  'poll.silentNudge': [0, 1],
}

let params = deepClone(defaults)
let started = false
let tickTimerId = null

const state = { v: 0.2, a: 0 }

let sleepyConditionStartTicks = null // sleepy 条件(a<threshold && v>0)が連続して true になっている開始時刻
let sleepy = false
let lastIsNight = false
let flutterUntilTicks = 0
let nextAutoFlutterTicks = 0
let currentTopLidValue = 0 // triggerSleepFlutter() の復帰先(直近 tick が計算した非フラッター値)

const startleTimestamps = []
const touchTimestamps = []

let lastPollTicks = -Infinity
let lastManualSetTicks = -Infinity // setEmotionState() が最後に呼ばれた ticks(bug #5 対策 — 下記参照)
const MANUAL_SET_GUARD_MS = 5000 // 明示的な状態セット直後は ambient poll による上書きを一時抑制する

const emotionEventListeners = [] // onEmotionEvent(cb) の購読者(v1.2.0 E2 — LED の touch 演出用に最小追加)

// シナリオ用の一時オーバーライド(dev-server の POST /emotion/scenario から使う)。
// 実測値を偽装せず「この期間だけ条件を強制する」形にして、通常時の判定ロジックは変えない。
let manualVoiceActiveUntilTicks = -Infinity
let manualNightUntilTicks = -Infinity
let driftPerSecV = 0
let driftUntilTicks = -Infinity
let recoveryBoostUntilTicks = -Infinity
let recoveryBoostFactor = 1

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x
}

function clampState() {
  state.v = clamp(state.v, -1, 1)
  state.a = clamp(state.a, -1, 1)
}

function pruneOld(list, now, windowMs) {
  while (list.length && now - list[0] > windowMs) list.shift()
}

function hourJst(now) {
  const d = new Date(Date.now())
  // status-bar.js と同じ JST 変換(Date.now() 基準。tick の Time.ticks とは独立)。
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  return jst.getUTCHours()
}

function isNightHour(hour) {
  const cfg = params.night
  if (cfg.startHour === cfg.endHour) return false
  if (cfg.startHour < cfg.endHour) return hour >= cfg.startHour && hour < cfg.endHour
  return hour >= cfg.startHour || hour < cfg.endHour // 日付をまたぐ範囲(23〜6 等)
}

function isMorningHour(hour) {
  const cfg = params.morning
  return hour >= cfg.startHour && hour < cfg.endHour
}

// ---------------------------------------------------------------------------
// 派生モディファイア(getEmotion() が公開する。他モジュールはこれだけを読む)
// ---------------------------------------------------------------------------

function computeModifiers(v, a) {
  const speedFactor = 1 + 0.35 * a
  const gainFactor = clamp(1 + 0.5 * a + 0.3 * v, params.gain.min, params.gain.max)
  const breathFactor = clamp(1.25 - 0.2 * a, 0.85, 1.25)
  const recoveryFactor = v < 0 ? 1 + Math.abs(v) : 1 / (1 + 0.5 * v)
  return { speedFactor, gainFactor, breathFactor, recoveryFactor }
}

// ---------------------------------------------------------------------------
// 表情への配線(globalThis ブリッジ)
// ---------------------------------------------------------------------------

function applyFaceBridge(now) {
  const v = state.v
  const a = state.a

  let topLid = sleepy ? 0.95 : Math.max(0, -a) * 0.55
  if (now < flutterUntilTicks) topLid = Math.min(topLid, params.sleepy.flutterOpenTopLid)
  currentTopLidValue = topLid

  const topAngleDeg = v < 0 ? Math.abs(v) * 12 : 0
  // botArc(笑いの下弧)は 2026-07-08 廃止 — 喜びは LED・声色で表現(ユーザー確定)
  const eyeScale = 1 + 0.06 * a
  const eyeLift = a * 4

  globalThis.breathTopLid = topLid
  globalThis.breathTopAngleDeg = topAngleDeg
  globalThis.breathEyeScale = eyeScale
  globalThis.breathEyeLift = eyeLift
  globalThis.breathSleepy = sleepy
}

// ---------------------------------------------------------------------------
// メイン tick(1Hz、指数回帰 + 微ノイズ + 時刻変調 + 巡回イベント)
// ---------------------------------------------------------------------------

function performTick() {
  try {
    if (!params.enabled) return
    const now = Time.ticks
    const dtSec = TICK_MS / 1000
    const hour = hourJst(now)

    const forcedNight = now < manualNightUntilTicks
    const isNight = forcedNight || isNightHour(hour)
    const isMorning = isMorningHour(hour)
    lastIsNight = isNight

    const baselineV = params.baseline.v
    const baselineA = params.baseline.a + (isMorning ? params.morning.baselineADelta : 0)

    const tau = now < recoveryBoostUntilTicks ? { v: params.tau.v / recoveryBoostFactor, a: params.tau.a / recoveryBoostFactor } : params.tau

    const decayV = 1 - Math.exp(-dtSec / Math.max(0.001, tau.v))
    const decayA = 1 - Math.exp(-dtSec / Math.max(0.001, tau.a))
    state.v += (baselineV - state.v) * decayV
    state.a += (baselineA - state.a) * decayA

    if (now < driftUntilTicks) state.v += driftPerSecV * dtSec

    // ポアソン的微ノイズ(完全静止しない。厳密なポアソン間隔ではなく tick ごとの
    // 小さなランダムウォーク — 非線形原則の「常にわずかに揺れる」だけを満たせば十分)。
    state.v += (Math.random() * 2 - 1) * params.noise.amp
    state.a += (Math.random() * 2 - 1) * params.noise.amp

    clampState()

    if (isNight) state.a = Math.min(state.a, params.night.arousalCap)

    // sleepy 判定(シナリオ3): a が閾値未満 かつ v > 0 が holdMs 継続。
    const sleepyCondition = state.a < params.sleepy.arousalThreshold && state.v > 0
    if (sleepyCondition) {
      if (sleepyConditionStartTicks === null) sleepyConditionStartTicks = now
      sleepy = now - sleepyConditionStartTicks >= params.sleepy.holdMs
    } else {
      sleepyConditionStartTicks = null
      sleepy = false
      nextAutoFlutterTicks = 0
    }

    // 寝入り中のまれな薄目(シナリオ4)。手動トリガ(triggerSleepFlutter)と同じ経路。
    if (sleepy && now >= flutterUntilTicks) {
      if (nextAutoFlutterTicks === 0) nextAutoFlutterTicks = now + 20000 + Math.random() * 40000
      if (now >= nextAutoFlutterTicks && Math.random() < params.sleepy.flutterProbPerTick) {
        triggerSleepFlutter()
        nextAutoFlutterTicks = now + 20000 + Math.random() * 40000
      }
    }

    // voiceActive/silent の巡回チェック(シナリオ14/15。mic.js は変更しない — 既存の
    // getMicStatus() を低頻度で読むだけ)。
    if (now - lastPollTicks >= params.poll.intervalMs) {
      lastPollTicks = now
      pollAmbientState(now)
    }

    applyFaceBridge(now)
  } catch (error) {
    trace(`[emotion] tick failed: ${error}\n`)
  }
}

function pollAmbientState(now) {
  try {
    // bug #5 対策: 直前(MANUAL_SET_GUARD_MS 以内)に setEmotionState() で明示的に
    // セットされた値を、この巡回チェックが immediately 上書きしないようにする
    // (シナリオ実行直後に voiceActive 等の ambient nudge が乗ると「絶対値ハードセット」
    // のはずの値が数百 ms 後にはブレンドされたように見えてしまっていた)。
    if (now - lastManualSetTicks < MANUAL_SET_GUARD_MS) return

    const forcedVoice = now < manualVoiceActiveUntilTicks
    let voiceActive = forcedVoice
    let silent = false
    if (!forcedVoice) {
      const status = getMicStatus()
      voiceActive = !!status?.state?.voiceActive
      silent = !!status?.state?.silent
    }

    if (voiceActive) {
      const cfg = params.poll
      state.v += (cfg.voiceValenceTarget - state.v) * cfg.voiceNudge
      state.a += (cfg.voiceArousalTarget - state.a) * cfg.voiceNudge
      clampState()
      trace(`[emotion] ambient voiceActive nudge v=${state.v.toFixed(2)} a=${state.a.toFixed(2)}\n`)
    } else if (silent) {
      const cfg = params.poll
      state.a += (cfg.silentArousalTarget - state.a) * cfg.silentNudge
      clampState()
      trace(`[emotion] ambient silent nudge a=${state.a.toFixed(2)}\n`)
    }
  } catch (error) {
    trace(`[emotion] ambient poll failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// イベント入力(mic イベント購読 + タッチ)
// ---------------------------------------------------------------------------

function applyMicEventType(type, now) {
  const ev = params.events
  if (type === 'loud' || type === 'clap') {
    state.a += ev.loudArousal
    clampState()
    startleTimestamps.push(now)
    pruneOld(startleTimestamps, now, BURST_WINDOW_MS)
    if (startleTimestamps.length >= ev.startleBurstCount) {
      state.v += ev.startleBurstValence
      clampState()
      startleTimestamps.length = 0
      trace(`[emotion] startle burst -> v=${state.v.toFixed(2)}\n`)
    }
  } else if (type === 'voice') {
    state.a += ev.voiceArousal
    state.v += ev.voiceValence
    clampState()
  } else if (type === 'silence') {
    state.a += ev.silenceArousal
    clampState()
  } else {
    return false
  }
  trace(`[emotion] event ${type} -> v=${state.v.toFixed(2)} a=${state.a.toFixed(2)}\n`)
  return true
}

// ---------------------------------------------------------------------------
// v1.2.0 (E2) — 最小の購読ポイント(led.js の touch 演出用)。physical touch の
// 配線は依然なく、pushTouch() が呼ばれた(dev-server 経由・手動)瞬間に 'touch'
// イベントを通知するだけ。mic.js の onMicEvent と同じ形(登録した callback が
// 例外を投げても他の callback・emotion 本体の処理には波及しない)。
// ---------------------------------------------------------------------------

function notifyEmotionEventListeners(event) {
  for (const callback of emotionEventListeners) {
    try {
      callback(event)
    } catch (error) {
      trace(`[emotion] event listener failed: ${error}\n`)
    }
  }
}

/** callback は `(event) => {}` 形式(現時点では `{ type: 'touch', t }` のみ発火)。 */
export function onEmotionEvent(callback) {
  if (typeof callback !== 'function') return
  emotionEventListeners.push(callback)
}

function handleMicEvent(event) {
  try {
    if (!started || !params.enabled) return
    applyMicEventType(event.type, Time.ticks)
  } catch (error) {
    trace(`[emotion] mic event handling failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** mod.js から起動 +8s で一度だけ呼ぶ。 */
export function startEmotion(_robot) {
  if (started) return
  started = true
  params = loadParams(PREF_KEY, defaults, CLAMP_RANGES)
  state.v = params.baseline.v
  state.a = params.baseline.a

  try {
    onMicEvent(handleMicEvent)
  } catch (error) {
    trace(`[emotion] onMicEvent subscribe failed: ${error}\n`)
  }

  applyFaceBridge(Time.ticks)
  tickTimerId = Timer.repeat(performTick, TICK_MS)
  trace(`[emotion] started v=${state.v} a=${state.a}\n`)
}

/** 現在の状態 + 派生モディファイア + sleepy/night(GET /emotion の中核)。 */
export function getEmotion() {
  const modifiers = computeModifiers(state.v, state.a)
  return {
    v: Math.round(state.v * 1000) / 1000,
    a: Math.round(state.a * 1000) / 1000,
    modifiers: {
      speedFactor: Math.round(modifiers.speedFactor * 1000) / 1000,
      gainFactor: Math.round(modifiers.gainFactor * 1000) / 1000,
      breathFactor: Math.round(modifiers.breathFactor * 1000) / 1000,
      recoveryFactor: Math.round(modifiers.recoveryFactor * 1000) / 1000,
    },
    sleepy,
    night: lastIsNight,
    // デバッグ計器(2026-07-08 脈動停止の調査): 左目の実描画矩形(eye-cozmo の
    // rect ブリッジ)と mouth 由来の呼吸位相。脈動が生きていれば dbgEye.h が
    // 1 呼吸(±10 秒)で ~68〜84px を往復し、dbgPulse が 0..1 を往復する。
    dbgEye: globalThis.breathEyeRectL
      ? { h: globalThis.breathEyeRectL.h, top: globalThis.breathEyeRectL.top }
      : null,
    dbgPulse: Math.round((globalThis.breathPulse ?? -1) * 1000) / 1000,
    dbgPulseDepth: globalThis.breathPulseDepth ?? null,
  }
}

/**
 * PUT /emotion/state。直接移動(クランプ [-1,1]、加算ではない絶対値ハードセット)。
 * bug #5 対策: `lastManualSetTicks` を更新し、直後の ambient poll(pollAmbientState)
 * がこのセットを上書きしないようガードする(setEmotionState 自体は元から加算では
 * なかったが、直後の poll nudge がブレンドしたように見えていたため)。
 */
export function setEmotionState(v, a) {
  if (typeof v === 'number' && Number.isFinite(v)) state.v = clamp(v, -1, 1)
  if (typeof a === 'number' && Number.isFinite(a)) state.a = clamp(a, -1, 1)
  lastManualSetTicks = Time.ticks
  trace(`[emotion] state set v=${state.v.toFixed(2)} a=${state.a.toFixed(2)}\n`)
  return getEmotion()
}

/** 名前つきイベントの手動発火(POST /emotion/scenario 等が使う。mic 実イベントと同じ経路)。 */
export function pushEmotionEvent(name) {
  if (!started) return false
  try {
    return applyMicEventType(name, Time.ticks)
  } catch (error) {
    trace(`[emotion] pushEmotionEvent failed: ${error}\n`)
    return false
  }
}

/**
 * POST /emotion/touch(要 token、dev-server 側)。物理配線なしの touch 代替。
 *
 * bug #12 対策: 従来は `touchTimestamps.length >= touchBurstCount` で一度だけ
 * バーストペナルティを適用した後に `touchTimestamps.length = 0` で履歴をリセットして
 * いた。この one-shot デバウンスだと、ペナルティ(既定 -0.4)が touchValence(既定
 * +0.3)1〜2 回分で簡単に相殺されてしまい、連続タッチ中は大半の時間 v が +1.0
 * 天井に張り付いて見える(60 秒窓内に 4 回以上という条件を「一度満たしたら区間を
 * リセットする」のではなく「満たしている間は毎回適用する」状態条件にすべきだった)。
 * リセットを削除し、60 秒のスライディングウィンドウ内に touchBurstCount 回以上の
 * タッチが残っている間は毎回ペナルティを適用する(pruneOld が 60 秒超の履歴を
 * 自然に落とすため、タッチが間隔を空けて起これば通常どおりペナルティなしに戻る)。
 */
export function pushTouch() {
  if (!started) return false
  try {
    const now = Time.ticks
    const ev = params.events
    state.v += ev.touchValence
    state.a += ev.touchArousal
    clampState()

    touchTimestamps.push(now)
    pruneOld(touchTimestamps, now, BURST_WINDOW_MS)
    if (touchTimestamps.length >= ev.touchBurstCount) {
      state.v += ev.touchBurstValence
      state.a += ev.touchBurstArousal
      clampState()
      trace(`[emotion] touch burst (overstimulated) -> v=${state.v.toFixed(2)} a=${state.a.toFixed(2)}\n`)
    } else {
      trace(`[emotion] touch -> v=${state.v.toFixed(2)} a=${state.a.toFixed(2)}\n`)
    }
    notifyEmotionEventListeners({ type: 'touch', t: now })
    return true
  } catch (error) {
    trace(`[emotion] pushTouch failed: ${error}\n`)
    return false
  }
}

/**
 * 寝入り中の「まれな薄目」(シナリオ4)。自動スケジューラ(sleepy 中の低確率抽選)と
 * 手動トリガ(dev-server 経由)の両方がこの関数を呼ぶ。1Hz tick を待たず即座に
 * globalThis へ反映し、flutterDurationMs 後に(その時点の)非フラッター値へ戻す。
 */
export function triggerSleepFlutter() {
  try {
    const now = Time.ticks
    flutterUntilTicks = now + params.sleepy.flutterDurationMs
    globalThis.breathTopLid = params.sleepy.flutterOpenTopLid
    trace('[emotion] sleep flutter\n')
    Timer.set(() => {
      globalThis.breathTopLid = currentTopLidValue
    }, params.sleepy.flutterDurationMs)
    return true
  } catch (error) {
    trace(`[emotion] triggerSleepFlutter failed: ${error}\n`)
    return false
  }
}

/** シナリオ18(回復儀式)用: durationMs の間だけ tau を factor で割って回帰を加速する。 */
export function triggerRecoveryBoost(durationMs, factor) {
  const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 8000
  const f = typeof factor === 'number' && factor > 0 ? factor : 4
  recoveryBoostFactor = f
  recoveryBoostUntilTicks = Time.ticks + ms
  trace(`[emotion] recovery boost x${f} for ${ms}ms\n`)
  return true
}

/** シナリオ14(にぎやかな部屋)用: durationMs の間、voiceActive を強制する(実測を偽装しない一時オーバーライド)。 */
export function forceVoiceActive(durationMs) {
  const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 30000
  manualVoiceActiveUntilTicks = Time.ticks + ms
  trace(`[emotion] voiceActive forced for ${ms}ms\n`)
  return true
}

/** シナリオ17(夜更け)用: durationMs の間、夜間クランプを強制する。 */
export function forceNightMode(durationMs) {
  const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 600000
  manualNightUntilTicks = Time.ticks + ms
  trace(`[emotion] night mode forced for ${ms}ms\n`)
  return true
}

/** シナリオ20(場の共鳴デモ)用: vPerSec の一定ドリフトを durationMs だけ加える。 */
export function startValenceDrift(vPerSec, durationMs) {
  const rate = typeof vPerSec === 'number' ? vPerSec : 0.002
  const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 300000
  driftPerSecV = rate
  driftUntilTicks = Time.ticks + ms
  trace(`[emotion] valence drift ${rate}/s for ${ms}ms\n`)
  return true
}

/** 現在有効なパラメータ(GET /emotion/params 相当。今回は dev-server から未公開でも呼べる)。 */
export function getEmotionParams() {
  return deepClone(params)
}

/** 部分更新(PUT /emotion/params)。deep merge + 検証 + Preference 永続化。 */
export function setEmotionParams(partial) {
  if (!partial || typeof partial !== 'object') return getEmotionParams()
  params = sanitizeParams(mergeValidated(params, partial), CLAMP_RANGES)
  persistParams(PREF_KEY, params)
  trace(`[emotion] params updated ${JSON.stringify(Object.keys(partial))}\n`)
  return getEmotionParams()
}
