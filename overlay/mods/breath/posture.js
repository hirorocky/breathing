import Time from 'time'
import Timer from 'timer'
import { deepClone, mergeValidated, sanitizeParams, loadParams, persistParams } from 'breath/param-store'
import { getEmotion } from 'breath/emotion'

/**
 * v1.3.0 (E3) — 感情姿勢(頭の pitch)。サーボ解禁後、首を「振る」のは lookAt の自動追従
 * (robot.ts の updatePose、config.gazeServoFollowDeg で閾値調整済み)だけに任せ、ここでは
 * pitch(うつむき/上向き)だけをゆっくり動かす。yaw はここでは常に 0 固定。
 *
 * 2 つの動かし方がある:
 *   1. 感情姿勢ループ(5 秒 tick) — getEmotion() の v/a から目標 pitch を計算し、
 *      レート制限(moveMinIntervalS 以上・|Δpitch| >= deltaMinDeg)を満たしたときだけ
 *      ゆっくり(timeMin〜timeMax 秒)動かす。サーボが鳴くたびに存在感が出るため、
 *      頻度は抑える。
 *   2. startle リコイル(`triggerRecoil`) — reactions.js の performGlance 冒頭から
 *      静的 import で呼ばれる。のけぞり(pitch を浅く)→ 一定時間保持 → ゆっくり戻す。
 *
 * robot が setPose/setTorque を持たない(driver が none にフォールバックした場合等)は
 * 全ての適用処理が no-op になる(hasRobotPoseApi のガード)。例外は全て握って trace のみ
 * (再スローしない)。Promise/async/await は書かない — robot の非同期 API(setPose/
 * setTorque)を呼ぶときは常に `.then(undefined, e => trace(...))` で受ける
 * (unhandled rejection → XS abort の実績があるため)。
 */

const PREF_KEY = 'posture'
const TICK_MS = 5000 // 感情姿勢ループの周期

const defaults = {
  enabled: true,
  recoil: {
    enabled: true,
    pitchDeltaDeg: 6, // のけぞりで浅くする角度
    outTime: 0.15, // のけぞる速さ(秒)
    holdMs: 600, // のけぞりを保持する時間
    returnTime: 1.0, // 戻る速さ(秒)
  },
  pose: {
    pitchBase: 15, // v=0, a=0 のときの基準 pitch(度)
    pitchMin: 5, // 覚醒・快側の下限(見上げ側)
    pitchMax: 25, // 沈静・不快側の上限(うつむき側)
    pitchSleepy: 25, // sleepy 中はこの値に固定
    moveMinIntervalS: 45, // 感情姿勢の移動間隔の下限(秒)
    deltaMinDeg: 4, // この角度未満の差では動かさない
    timeMin: 1.2, // 移動時間の下限(秒)
    timeMax: 2.0, // 移動時間の上限(秒)
  },
}

// path -> [min, max]。setPostureParams / 復元時の安全クランプ(reactions.js 等と同じ作法)。
const CLAMP_RANGES = {
  'recoil.pitchDeltaDeg': [0, 30],
  'recoil.outTime': [0.05, 2],
  'recoil.holdMs': [100, 5000],
  'recoil.returnTime': [0.2, 5],
  'pose.pitchBase': [0, 45],
  'pose.pitchMin': [0, 45],
  'pose.pitchMax': [0, 90],
  'pose.pitchSleepy': [0, 90],
  'pose.moveMinIntervalS': [5, 300],
  'pose.deltaMinDeg': [0, 30],
  'pose.timeMin': [0.2, 5],
  'pose.timeMax': [0.2, 5],
}

let params = deepClone(defaults)
let robotRef = null
let started = false
let tickTimerId = null

let currentPitchDeg = null // 直近に適用した(または起動時に記録した)pitch。レート制限の差分計算に使う
let lastMoveTicks = -Infinity
let moveInProgress = false // setTorque(true) 〜 setTorque(false) の間 true(多重発火防止)

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x
}

function randomInRange(min, max) {
  return min + Math.random() * Math.max(0, max - min)
}

function hasRobotPoseApi(robot) {
  return !!robot && typeof robot.setPose === 'function' && typeof robot.setTorque === 'function'
}

/** robot.setTorque(bool) を fire-and-forget で呼ぶ(await しない。reject のみ trace)。 */
function safeSetTorque(torque) {
  try {
    robotRef.setTorque(torque).then(undefined, (error) => {
      trace(`[posture] setTorque(${torque}) failed: ${error}\n`)
    })
  } catch (error) {
    trace(`[posture] setTorque(${torque}) call failed: ${error}\n`)
  }
}

/** robot.setPose({rotation:{y:0,p,r:0}}, time) を fire-and-forget で呼ぶ。 */
function safeSetPose(pitchRad, yawRad, time) {
  try {
    robotRef.setPose({ rotation: { y: yawRad, p: pitchRad, r: 0 } }, time).then(undefined, (error) => {
      trace(`[posture] setPose failed: ${error}\n`)
    })
  } catch (error) {
    trace(`[posture] setPose call failed: ${error}\n`)
  }
}

/**
 * 姿勢を適用する共通手順: setTorque(true) → setPose → time+200ms 後に setTorque(false)。
 * moveInProgress で多重発火を防ぐ。呼び出し前提: hasRobotPoseApi(robotRef) 済み。
 */
function applyPosture(pitchDeg, yawDeg, time, label) {
  if (moveInProgress) {
    trace(`[posture] ${label} skipped: move in progress\n`)
    return false
  }
  moveInProgress = true
  const pitchRad = (pitchDeg * Math.PI) / 180
  const yawRad = ((yawDeg ?? 0) * Math.PI) / 180
  trace(`[posture] ${label} pitch=${pitchDeg.toFixed(1)}deg yaw=${(yawDeg ?? 0).toFixed(1)}deg time=${time.toFixed(2)}s\n`)
  safeSetTorque(true)
  safeSetPose(pitchRad, yawRad, time)
  Timer.set(() => {
    safeSetTorque(false)
    moveInProgress = false
  }, time * 1000 + 200)
  return true
}

// ---------------------------------------------------------------------------
// 感情姿勢ループ(5 秒ごと)
// ---------------------------------------------------------------------------

function performTick() {
  try {
    if (!started || !params.enabled) return
    if (!hasRobotPoseApi(robotRef)) return

    let emo
    try {
      emo = getEmotion()
    } catch (error) {
      trace(`[posture] emotion query failed: ${error}\n`)
      return
    }

    const cfg = params.pose
    const targetPitch = emo.sleepy
      ? cfg.pitchSleepy
      : clamp(cfg.pitchBase - emo.v * 6 - emo.a * 8, cfg.pitchMin, cfg.pitchMax)

    if (currentPitchDeg === null) {
      // 初回 tick は基準値を記録するだけ(起動直後にいきなり動かさない)。
      currentPitchDeg = targetPitch
      return
    }

    const now = Time.ticks
    const sinceLastMoveS = (now - lastMoveTicks) / 1000
    const delta = Math.abs(targetPitch - currentPitchDeg)
    if (sinceLastMoveS < cfg.moveMinIntervalS || delta < cfg.deltaMinDeg) return

    const time = randomInRange(cfg.timeMin, cfg.timeMax)
    if (applyPosture(targetPitch, 0, time, 'mood shift')) {
      currentPitchDeg = targetPitch
      lastMoveTicks = now
    }
  } catch (error) {
    trace(`[posture] tick failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// startle リコイル
// ---------------------------------------------------------------------------

/**
 * のけぞる(pitch を一時的に浅く)→ holdMs 保持 → ゆっくり戻す。reactions.js の
 * performGlance 冒頭から静的 import で呼ばれる。params.recoil.enabled が false、
 * 未起動、robot に pose API が無い(none フォールバック)、既に移動中のいずれかなら
 * no-op(false)。
 */
export function triggerRecoil() {
  try {
    if (!started || !params.enabled || !params.recoil.enabled) return false
    if (!hasRobotPoseApi(robotRef)) return false
    if (moveInProgress) {
      trace('[posture] recoil skipped: move in progress\n')
      return false
    }

    const base = currentPitchDeg ?? params.pose.pitchBase
    const recoilPitch = clamp(base - params.recoil.pitchDeltaDeg, 0, 90)

    moveInProgress = true
    trace(`[posture] recoil pitch=${recoilPitch.toFixed(1)}deg (base=${base.toFixed(1)})\n`)
    safeSetTorque(true)
    safeSetPose((recoilPitch * Math.PI) / 180, 0, params.recoil.outTime)

    Timer.set(() => {
      safeSetPose((base * Math.PI) / 180, 0, params.recoil.returnTime)
      Timer.set(() => {
        safeSetTorque(false)
        moveInProgress = false
        currentPitchDeg = base
        lastMoveTicks = Time.ticks
      }, params.recoil.returnTime * 1000 + 200)
    }, params.recoil.holdMs)

    return true
  } catch (error) {
    trace(`[posture] triggerRecoil failed: ${error}\n`)
    moveInProgress = false
    return false
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** mod.js から起動 +10s で一度だけ呼ぶ。 */
export function startPosture(robot) {
  if (started) return
  started = true
  robotRef = robot
  params = loadParams(PREF_KEY, defaults, CLAMP_RANGES)

  if (!hasRobotPoseApi(robotRef)) {
    trace('[posture] started (no-op: robot has no pose API — none driver?)\n')
    return
  }

  tickTimerId = Timer.repeat(performTick, TICK_MS)
  trace('[posture] started\n')
}

/**
 * driver から実際に読み取った現在姿勢(度)。`robot.pose`(公開 getter)は
 * Robot 内部の updatePose(10Hz)が `driver.getRotation()` で継続更新している値
 * なので、none ドライバへフォールバックしていないか・サーボが実際に動いたかの
 * 物理的な確認に使える(none ドライバは常に {y:0,p:0,r:0} を返す)。
 */
function readRotationDeg() {
  try {
    const rotation = robotRef?.pose?.body?.rotation
    if (!rotation) return null
    return {
      yaw: Math.round(((rotation.y * 180) / Math.PI) * 10) / 10,
      pitch: Math.round(((rotation.p * 180) / Math.PI) * 10) / 10,
    }
  } catch (error) {
    trace(`[posture] rotation read failed: ${error}\n`)
    return null
  }
}

/**
 * 実機診断用: 実際に構築された Driver クラス名(`robot.driver`、公開 getter)。
 * "NoneDriver" ならフォールバックした/config が効いていない、
 * "M5StackChanServoDriver" なら意図した通り構築されている(2026-07-07 E3 診断で追加)。
 */
function readDriverName() {
  try {
    return robotRef?.driver?.constructor?.name ?? null
  } catch (error) {
    trace(`[posture] driver name read failed: ${error}\n`)
    return null
  }
}

/** GET /posture 相当。 */
export function getPostureStatus() {
  return {
    params: deepClone(params),
    currentPitchDeg,
    moveInProgress,
    hasPoseApi: hasRobotPoseApi(robotRef),
    driverName: readDriverName(),
    rotationDeg: readRotationDeg(),
    lastMoveAgoS: lastMoveTicks === -Infinity ? null : Math.round((Time.ticks - lastMoveTicks) / 1000),
  }
}

/** 現在有効なパラメータ。 */
export function getPostureParams() {
  return deepClone(params)
}

/** 部分更新(PUT /posture/params)。deep merge + 検証 + Preference 永続化。 */
export function setPostureParams(partial) {
  if (!partial || typeof partial !== 'object') return getPostureParams()
  params = sanitizeParams(mergeValidated(params, partial), CLAMP_RANGES)
  persistParams(PREF_KEY, params)
  trace(`[posture] params updated ${JSON.stringify(Object.keys(partial))}\n`)
  return getPostureParams()
}

/**
 * POST /posture/test(要 token、dev-server 側)。直接姿勢テスト用 — レート制限を無視して
 * 即座に適用する。robot に pose API が無ければ false。
 */
export function testPosture(yawDeg, pitchDeg, time) {
  if (!started) return false
  if (!hasRobotPoseApi(robotRef)) return false
  if (moveInProgress) {
    trace('[posture] test skipped: move in progress\n')
    return false
  }
  const deg = typeof pitchDeg === 'number' && Number.isFinite(pitchDeg) ? clamp(pitchDeg, 0, 90) : params.pose.pitchBase
  const yaw = typeof yawDeg === 'number' && Number.isFinite(yawDeg) ? clamp(yawDeg, -90, 90) : 0
  const t =
    typeof time === 'number' && Number.isFinite(time) && time > 0
      ? time
      : randomInRange(params.pose.timeMin, params.pose.timeMax)

  const ok = applyPosture(deg, yaw, t, 'test')
  if (ok) {
    currentPitchDeg = deg
    lastMoveTicks = Time.ticks
  }
  return ok
}
