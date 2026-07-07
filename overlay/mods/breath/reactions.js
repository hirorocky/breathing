import Time from 'time'
import Timer from 'timer'
import { deepClone, mergeValidated, sanitizeParams, loadParams, persistParams } from 'breath/param-store'
import { onMicEvent } from 'breath/mic'
import { playCry } from 'breath/cry'
import { deferGaze } from 'breath/liveliness'
import { getEmotion } from 'breath/emotion'
import { triggerRecoil } from 'breath/posture'

/**
 * v1.1.0 Phase 3c #1 — 総合表現「startle + 方向つき一瞥」
 * (`docs/tasks/elegnt-expression-design.md` の Attitude(startle)+ Attention(一瞥))。
 *
 * トリガは `breath/mic` の `onMicEvent` が発火する 'loud'/'clap'(3b)。方向は
 * 3b+ の相互相関(オンセット基準・放物線補間)による `lagX100`(正 = ユーザー
 * 視点で左、負 = 右)から決める。反応は稀(不応期 8s 既定)・弱(目・LED は使わない)・
 * 「間」あり(200〜600ms のランダム遅延) — concept-v1 の非指示・第三焦点の原則
 * そのまま。v1.3.0(E3)でサーボを解禁した際、`performGlance` 冒頭だけ
 * `breath/posture` の `triggerRecoil()`(のけぞり)を静的 import で追加した
 * (params.recoil.enabled が false なら no-op。首を振る動作自体は依然 lookAt の
 * 自動追従にのみ任せ、ここから明示的に yaw を動かすことはしない)。
 *
 * 視線は `breath/liveliness` の `lookAt` 座標系(x=前方距離固定 0.7、y=左右)
 * に倣う。反応中は liveliness の gaze スケジューラが idle 視線で上書きしない
 * よう `deferGaze()` で一時停止する(liveliness.js 自体は変更しない、追加した
 * 最小 export のみ使う)。
 *
 * 多重発火防止は二重: (1) 不応期(`params.startle.refractoryMs`、検出のみの
 * loud.refractoryMs=1500ms より大幅に長い) (2) `reactionInProgress` フラグ
 * (delay タイマー〜hold タイマーの間、タイマー中の再入を確実に防ぐ)。
 * 手動トリガ(`triggerStartle`、目視テスト用)は不応期を無視するが
 * `reactionInProgress` は尊重する(進行中の反応を壊さない)。
 *
 * 全コールバックで例外を握って trace のみ(再スローしない)。Promise は一切
 * 使わない(mic.js / liveliness.js / cry.js と同じ方針)。
 */

const PREF_KEY = 'reactions'

const GAZE_FORWARD_M = 0.7 // liveliness.js の GAZE_FORWARD_M と同じ値(モジュール分離のため複製)
const CENTER_JITTER_Y = 0.1 // dir=0(方向不明)のときの微小ランダム
const GAZE_DEFER_MARGIN_MS = 200 // deferGaze の再開が returnToCenter の直後に来るための余裕

const defaults = {
  enabled: true,
  startle: {
    refractoryMs: 8000, // 検出の loud.refractoryMs(1500ms)より大幅に長い — 「反応は稀」
    cryProb: 0.15,
  },
  glance: {
    delayMs: [200, 600], // concept の「間」
    holdMs: [1000, 2500],
    sideY: 0.6,
    lagSideMin: 60, // |lagX100| >= これで左右、それ未満は中央扱い
    invert: false, // ロボット座標 +y の画面上の向きが未検証なため、逆なら反転できるようにする
  },
}

// path (e.g. 'startle.refractoryMs') -> [min, max]。setReactParams / 復元時の安全クランプ。
// delayMs/holdMs/invert は範囲チェック対象外(liveliness.js の settleMs と同じ扱い —
// mergeValidated が型・配列長だけ検証する)。
const CLAMP_RANGES = {
  'startle.refractoryMs': [1000, 120000],
  'startle.cryProb': [0, 1],
  'glance.sideY': [0, 1],
  'glance.lagSideMin': [0, 400],
}

let params = deepClone(defaults)
let robotRef = null
let started = false

let reactionInProgress = false // delay タイマー〜hold タイマーの間 true(再入防止)
let lastReactionTicks = -Infinity // 不応期の基準点(自動発火のみが更新。手動トリガも更新する)

let glanceTimerId = null
let holdTimerId = null

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function formatDir(dir) {
  if (dir > 0) return `+${dir}`
  return `${dir}`
}

function randomInRange(range) {
  const [min, max] = range
  return min + Math.random() * Math.max(0, max - min)
}

/**
 * v1.2.0 (E1) — 感情エンジンの gainFactor/recoveryFactor を読む薄いヘルパー。
 * emotion 不在/失敗時は無変調(1)にフォールバックする。萎縮中(v が大きく下がった
 * 状態)は gainFactor が自然に下がるため、cry 確率・glance 振幅は特別分岐なしで
 * 自然に小さくなる(getEmotion() の式そのものが萎縮を表現している)。
 */
function emotionModifiers() {
  try {
    return getEmotion()?.modifiers ?? {}
  } catch (error) {
    trace(`[react] emotion query failed: ${error}\n`)
    return {}
  }
}

function clearReactionTimers() {
  if (glanceTimerId != null) {
    Timer.clear(glanceTimerId)
    glanceTimerId = null
  }
  if (holdTimerId != null) {
    Timer.clear(holdTimerId)
    holdTimerId = null
  }
}

/**
 * イベントの `lagX100`(サブサンプルラグ x100。正 = ユーザー視点で左、負 = 右)から
 * 方向を決める。`|lagX100| < lagSideMin` または lagX100 が無い場合は 0(中央扱い)。
 * `invert` が true なら符号を反転する(方向決定自体の一部。以後 trace・glance の
 * 両方でこの反転済み dir を使う)。
 */
function computeDirection(event) {
  const lagX100 = typeof event.lagX100 === 'number' ? event.lagX100 : null
  let dir = 0
  if (lagX100 !== null) {
    if (lagX100 >= params.glance.lagSideMin) dir = 1
    else if (lagX100 <= -params.glance.lagSideMin) dir = -1
  }
  if (dir !== 0 && params.glance.invert) dir = -dir
  return { dir, lagX100 }
}

// ---------------------------------------------------------------------------
// 反応本体(delay → glance(+cry) → hold → center)
// ---------------------------------------------------------------------------

function returnToCenter() {
  try {
    if (robotRef) robotRef.lookAt([GAZE_FORWARD_M, 0, 0])
  } catch (error) {
    trace(`[react] return-to-center lookAt failed: ${error}\n`)
  }
  reactionInProgress = false
  trace('[react] return to center\n')
}

function performGlance(dir, willCry, holdMs, ampScale) {
  try {
    triggerRecoil()
  } catch (error) {
    trace(`[react] recoil trigger failed: ${error}\n`)
  }

  try {
    if (robotRef) {
      const y = dir === 0 ? (Math.random() * 2 - 1) * CENTER_JITTER_Y * ampScale : dir * params.glance.sideY * ampScale
      robotRef.lookAt([GAZE_FORWARD_M, y, 0])
    }
  } catch (error) {
    trace(`[react] glance lookAt failed: ${error}\n`)
  }

  if (willCry) {
    try {
      const result = playCry('startle')
      trace(`[react] cry ${result.ok ? 'ok' : `skip:${result.status ?? result.error ?? 'unknown'}`}\n`)
    } catch (error) {
      trace(`[react] cry failed: ${error}\n`)
    }
  }

  holdTimerId = Timer.set(() => {
    holdTimerId = null
    returnToCenter()
  }, holdMs)
}

/**
 * 実際の反応を仕掛ける。呼び出し前提: reactionInProgress チェック済み
 * (自動発火は不応期チェックも済み)。`lagX100` は trace 用(手動トリガでは null)。
 */
function runReaction(dir, lagX100, now) {
  const mod = emotionModifiers()
  const gainFactor = typeof mod.gainFactor === 'number' ? mod.gainFactor : 1
  const recoveryFactor = typeof mod.recoveryFactor === 'number' ? mod.recoveryFactor : 1
  const ampScale = Math.min(1, Math.max(0.5, gainFactor)) // glance の sideY はここでのみ 0.5〜1 に絞る

  const delayMs = Math.round(randomInRange(params.glance.delayMs))
  const holdMs = Math.round(randomInRange(params.glance.holdMs) * recoveryFactor) // v<0 で回復が遅い(シナリオ7)
  const willCry = Math.random() < params.startle.cryProb * gainFactor

  reactionInProgress = true
  lastReactionTicks = now

  try {
    deferGaze(delayMs + holdMs + GAZE_DEFER_MARGIN_MS)
  } catch (error) {
    trace(`[react] deferGaze failed: ${error}\n`)
  }

  clearReactionTimers()
  glanceTimerId = Timer.set(() => {
    glanceTimerId = null
    performGlance(dir, willCry, holdMs, ampScale)
  }, delayMs)

  trace(`[react] startle dir=${formatDir(dir)} lagX100=${lagX100 ?? 'none'} delay=${delayMs} hold=${holdMs} cry=${willCry ? 'yes' : 'no'} gain=${gainFactor.toFixed(2)} recovery=${recoveryFactor.toFixed(2)}\n`)
}

function handleMicEvent(event) {
  try {
    if (!started || !robotRef) return
    if (!params.enabled) return
    if ('clap' !== event.type && 'loud' !== event.type) return
    if (reactionInProgress) return

    const now = Time.ticks
    if (now - lastReactionTicks < params.startle.refractoryMs) return

    const { dir, lagX100 } = computeDirection(event)
    runReaction(dir, lagX100, now)
  } catch (error) {
    trace(`[react] mic event handling failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** mod.js から起動 +7s で一度だけ呼ぶ。 */
export function startReactions(robot) {
  if (started) return
  started = true
  robotRef = robot
  params = loadParams(PREF_KEY, defaults, CLAMP_RANGES)

  try {
    onMicEvent(handleMicEvent)
  } catch (error) {
    trace(`[react] onMicEvent subscribe failed: ${error}\n`)
    return
  }
  trace('[react] started\n')
}

/** 現在有効なパラメータ(GET /react)。 */
export function getReactParams() {
  return deepClone(params)
}

/** 部分更新(PUT /react/params)。deep merge + 検証 + Preference 永続化 + 即時反映。 */
export function setReactParams(partial) {
  if (!partial || typeof partial !== 'object') return getReactParams()
  params = sanitizeParams(mergeValidated(params, partial), CLAMP_RANGES)
  persistParams(PREF_KEY, params)
  trace(`[react] params updated ${JSON.stringify(Object.keys(partial))}\n`)
  return getReactParams()
}

/**
 * 手動発火(POST /react/startle、目視テスト用)。`dir` は -1/0/1 のいずれかで
 * なければランダムに選ぶ。不応期は無視するが、反応進行中(`reactionInProgress`)
 * なら false を返して何もしない(進行中の反応を壊さない)。
 */
export function triggerStartle(dir) {
  if (!started || !robotRef) return false
  if (reactionInProgress) {
    trace('[react] triggerStartle ignored: reaction in progress\n')
    return false
  }
  let resolvedDir = dir
  if (-1 !== resolvedDir && 0 !== resolvedDir && 1 !== resolvedDir) {
    resolvedDir = Math.floor(Math.random() * 3) - 1
  }
  try {
    runReaction(resolvedDir, null, Time.ticks)
  } catch (error) {
    trace(`[react] triggerStartle failed: ${error}\n`)
    reactionInProgress = false
    return false
  }
  return true
}
