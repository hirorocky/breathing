import Preference from 'preference'
import Timer from 'timer'
import { playCry } from 'breath/cry'
import { getEmotion } from 'breath/emotion'

/**
 * v1.1.0 Phase 2a — 生存感エンジン(目線の微揺らぎ・深呼吸・まれな murmur)。
 *
 * 視線(gaze)の座標系(`stack-chan/firmware/stackchan/robot.ts` を読んで確認):
 *   `robot.lookAt([x, y, z])` の Vector3 は「ロボット正面を基準にしたターゲット位置
 *   (メートル)」。x = 前方距離(常に正)、y = 左右オフセット(正 = 見た目の向き依存、
 *   `Rotation.fromVector3` は `atan2(y, x)` を yaw にする)、z = 上下オフセット。
 *   `updateFace()` は `gazePoint` と両目位置(`pose.eyes.left/right.position`、既定
 *   x=0.03・y=±0.009・z=0)との差分から yaw/pitch を求め、
 *   `eye.gazeX = cos(yaw)` / `eye.gazeY = cos(pitch)` を作って renderer に渡す
 *   (renderer 側は `gazeX/gazeY` をそのまま瞳オフセットのスケールとして使う —
 *   `stackchan/renderers/simple-face.ts` の `offsetX = gazeX * 2` 等)。
 *   `lookAway()` は `#gazePoint = null` にする「正面に戻す」相当。
 *   実際の使用例(`stack-chan/firmware/mods/look_around/mod.js`,
 *   `stackchan/default-mods/on-robot-created.ts`)は x:0.4〜1.0・y:-0.4〜0.4・
 *   z:-0.02〜0.2 のレンジで `lookAt` している(z は y より小さい振れ幅、比 ≈ 0.3)。
 *   本エンジンはこれに倣い、正面から固定距離 `GAZE_FORWARD_M` 奥の点を基準に、
 *   y は `amplitude` の範囲、z は `amplitude * GAZE_VERTICAL_SCALE` の範囲で
 *   揺らす(既定 amplitude=0.3 は上記使用例と同じ単位・オーダーだが、控えめ側)。
 *
 * スケジューラ(gaze・murmur)はどちらも指数分布ベースのポアソン的間隔
 * (`poissonIntervalMs`)。固定周期は禁止(concept-v1 の非線形原則)。
 *
 * deepBreath はタイマーを持たない。呼吸ループの所有権は mod.js 側に残すため、
 * `shouldDeepBreathe()` / `getDeepBreathParams()` を mod.js がサイクル頭で
 * 問い合わせる形にする(Loop B の設計メモそのまま)。
 *
 * 例外は全て握って trace するのみ(再スローしない) — Promise は使わない
 * (cry.js / dev-server.js と同じ、unhandled rejection による XS abort を避ける方針)。
 */

const PREF_DOMAIN = 'breath'
const PREF_KEY = 'liveliness'

const GAZE_FORWARD_M = 0.7 // 正面からの固定奥行き(look_around 等の使用例 x:0.4〜1.0 の中間)
const GAZE_VERTICAL_SCALE = 0.3 // z の振れ幅は y より控えめ(既存使用例の y:z 比 ≈ 0.3 に倣う)
const GAZE_DISABLED_POLL_MS = 2000 // gaze.enabled=false の間、再有効化を待つポーリング間隔
const MURMUR_DISABLED_POLL_MS = 5000 // murmur.enabled=false の間の同上
const MS_PER_MIN = 60000

const defaults = {
  gaze: {
    enabled: true,
    meanIntervalMs: 9000, // 視線を動かす平均間隔(2026-07-07 FB「大きく・速く・まれに」で 5000 → 9000)
    minIntervalMs: 2500,
    amplitude: 0.8, // 中心からの最大オフセット(lookAt 座標系)。2026-07-08 サーボ騒音 FB で 1 → 0.8(最大 yaw 44° < 首追従閾値 45° = idle で首が動かない)。E3.1 の follow-ratio 導入後に 1.0 へ戻す候補
    pixelScale: 40, // 目全体の平行移動倍率(px)。eye-cozmo の globalThis.breathGazeScale へ反映(B 案は目自体が動くため大きい)
    centerBias: 0.25, // この確率で中心(正面)に戻す
    settleMs: [300, 1500], // 動かした後の余白(concept の「間」)
  },
  deepBreath: {
    enabled: true,
    probPerCycle: 0.06, // 呼吸 1 サイクルごとの深呼吸確率(平均 ~17 サイクル ≈ 3 分に 1 回)
    scale: 1.5, // 吸・吐の時間倍率
    mouthScale: 1.3, // 口の開き倍率(MOUTH_INHALE * これ。上限は mod.js 側で 0.35 にクランプ)
    sighProb: 0, // 確定(2026-07-06 Loop B): 深呼吸は無音。sigh はため息に聞こえ場の空気を下げるため不採用
  },
  murmur: {
    enabled: true,
    meanIntervalMin: 10, // 平均 10 分に 1 回(「沈黙が正しい」— まれ)
    minIntervalMin: 3,
  },
  face: {
    pulseDepth: 0.24, // 呼吸による目の脈動深さ(2026-07-07 FB「呼吸の動きを大きく」で 0.14 → 0.24)
    microDriftPx: 0, // 常時の漂い(2026-07-07 FB「漂いではなくサッカードとして」で 0 = 無効)
    breathBobPx: 75, // 呼吸の上下(吸うと浮く)。2026-07-08 ユーザー確定 — 大きな浮き沈みが呼吸として読める値(吸気ピークで目が画面上端に達する寸前まで浮く)
  },
}

// path (e.g. 'gaze.amplitude') -> [min, max]。setParams / 復元時の安全クランプ。
const CLAMP_RANGES = {
  'gaze.meanIntervalMs': [50, 10 * MS_PER_MIN],
  'gaze.minIntervalMs': [50, 10 * MS_PER_MIN],
  'gaze.amplitude': [0, 1],
  'gaze.pixelScale': [1, 80],
  'face.pulseDepth': [0, 0.5],
  'face.microDriftPx': [0, 8],
  'face.breathBobPx': [0, 100], // 実験用に広め(目の上端は静止時 ~75px 位置。それ以上は吸気ピークで画面外にクリップされる)
  'gaze.centerBias': [0, 1],
  'deepBreath.probPerCycle': [0, 1],
  'deepBreath.scale': [1, 4],
  'deepBreath.mouthScale': [1, 3],
  'deepBreath.sighProb': [0, 1],
  'murmur.meanIntervalMin': [0.05, 24 * 60],
  'murmur.minIntervalMin': [0.01, 24 * 60],
}

let params = deepClone(defaults)
let robotRef = null
let started = false
let deepBreathRequested = false // POST /live/deep-breath による「次サイクル強制」フラグ

let gazeTimerId = null
let gazeSettleTimerId = null
let murmurTimerId = null

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `base` の形(キー・型・配列長)だけを信頼して `patch` を再帰的に反映する。
 * 未知のキー・型不一致・長さ不一致は黒く無視して `base` 側の値を残す
 * (cry.js の setRecipes と同じ「壊れた入力では変更しない」方針)。
 */
function mergeValidated(base, patch) {
  if (Array.isArray(base)) {
    if (!Array.isArray(patch) || patch.length !== base.length) return base
    return patch.map((value, i) => (typeof value === typeof base[i] && typeof value !== 'object' ? value : base[i]))
  }
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) return base
    const merged = { ...base }
    for (const key of Object.keys(patch)) {
      if (!(key in base)) continue
      merged[key] = mergeValidated(base[key], patch[key])
    }
    return merged
  }
  return typeof patch === typeof base ? patch : base
}

function sanitizeParams(target) {
  for (const path of Object.keys(CLAMP_RANGES)) {
    const [section, key] = path.split('.')
    const [min, max] = CLAMP_RANGES[path]
    const value = target[section]?.[key]
    if (typeof value === 'number') {
      target[section][key] = Math.min(max, Math.max(min, value))
    }
  }
  return target
}

/** 指数分布(-mean * ln(1 - U))による間隔。下限でクランプする(非線形原則 + 暴走防止)。 */
function poissonIntervalMs(meanMs, minMs) {
  if (!(meanMs > 0)) return minMs
  const raw = -meanMs * Math.log(1 - Math.random())
  return Math.max(minMs, raw)
}

// v1.2.0 (E1) — 感情エンジンの speedFactor/gainFactor を読むだけの薄いヘルパー。
// emotion 不在/失敗時は 1(無変調)にフォールバックする。スケジューラの構造自体は
// 変えない(scheduleNext* の interval 計算に 1 行ずつ乗算するだけ)。
function emotionSpeedFactor() {
  try {
    return getEmotion()?.modifiers?.speedFactor ?? 1
  } catch (error) {
    trace(`[live] emotion query failed: ${error}\n`)
    return 1
  }
}

function emotionGainFactor() {
  try {
    return getEmotion()?.modifiers?.gainFactor ?? 1
  } catch (error) {
    trace(`[live] emotion query failed: ${error}\n`)
    return 1
  }
}

function persistParams() {
  try {
    Preference.set(PREF_DOMAIN, PREF_KEY, JSON.stringify(params))
  } catch (error) {
    trace(`[live] persist failed: ${error}\n`)
  }
}

function loadPersistedParams() {
  try {
    const raw = Preference.get(PREF_DOMAIN, PREF_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    params = sanitizeParams(mergeValidated(defaults, saved))
    trace('[live] restored params from Preference\n')
  } catch (error) {
    trace(`[live] restore failed: ${error}\n`)
  }
}

// ---------------------------------------------------------------------------
// gaze スケジューラ
// ---------------------------------------------------------------------------

function clearGazeTimers() {
  if (gazeTimerId != null) {
    Timer.clear(gazeTimerId)
    gazeTimerId = null
  }
  if (gazeSettleTimerId != null) {
    Timer.clear(gazeSettleTimerId)
    gazeSettleTimerId = null
  }
}

function performGazeTick() {
  const cfg = params.gaze
  if (Math.random() < cfg.centerBias) {
    // lookAway() は gazePoint=null にするだけで視線値を凍結する(中央に戻らない)ため、
    // 明示的に正面の点を見る。
    robotRef.lookAt([GAZE_FORWARD_M, 0, 0])
    trace('[live] gaze center\n')
  } else {
    const y = (Math.random() * 2 - 1) * cfg.amplitude
    const z = (Math.random() * 2 - 1) * cfg.amplitude * GAZE_VERTICAL_SCALE
    robotRef.lookAt([GAZE_FORWARD_M, y, z])
    trace(`[live] gaze x=${GAZE_FORWARD_M.toFixed(2)} y=${y.toFixed(3)} z=${z.toFixed(3)}\n`)
  }
  const [minSettle, maxSettle] = cfg.settleMs
  const settle = minSettle + Math.random() * Math.max(0, maxSettle - minSettle)
  gazeSettleTimerId = Timer.set(() => {
    gazeSettleTimerId = null
    scheduleNextGaze()
  }, settle)
}

function scheduleNextGaze() {
  if (!started) return
  const cfg = params.gaze
  if (!cfg.enabled) {
    gazeTimerId = Timer.set(scheduleNextGaze, GAZE_DISABLED_POLL_MS)
    return
  }
  const interval = poissonIntervalMs(cfg.meanIntervalMs, cfg.minIntervalMs) / Math.max(0.1, emotionSpeedFactor())
  gazeTimerId = Timer.set(() => {
    gazeTimerId = null
    try {
      performGazeTick()
    } catch (error) {
      trace(`[live] gaze error: ${error}\n`)
      scheduleNextGaze()
    }
  }, interval)
}

// ---------------------------------------------------------------------------
// murmur スケジューラ
// ---------------------------------------------------------------------------

function clearMurmurTimer() {
  if (murmurTimerId != null) {
    Timer.clear(murmurTimerId)
    murmurTimerId = null
  }
}

function performMurmurTick() {
  try {
    const result = playCry('murmur')
    trace(`[live] murmur ${result.ok ? 'ok' : `skip:${result.status ?? result.error ?? 'unknown'}`}\n`)
  } catch (error) {
    trace(`[live] murmur error: ${error}\n`)
  }
  scheduleNextMurmur()
}

function scheduleNextMurmur() {
  if (!started) return
  const cfg = params.murmur
  if (!cfg.enabled) {
    murmurTimerId = Timer.set(scheduleNextMurmur, MURMUR_DISABLED_POLL_MS)
    return
  }
  const meanMs = cfg.meanIntervalMin * MS_PER_MIN
  const minMs = cfg.minIntervalMin * MS_PER_MIN
  const interval = poissonIntervalMs(meanMs, minMs) / Math.max(0.1, emotionGainFactor())
  murmurTimerId = Timer.set(() => {
    murmurTimerId = null
    performMurmurTick()
  }, interval)
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 起動 ~5s 後に mod.js から一度だけ呼ぶ。gaze・murmur スケジューラを開始する。 */
function applyGazePixelScale() {
  globalThis.breathGazeScale = params.gaze.pixelScale
}

function applyFaceParams() {
  globalThis.breathPulseDepth = params.face.pulseDepth
  globalThis.breathMicroDrift = params.face.microDriftPx
  globalThis.breathBobPx = params.face.breathBobPx
}

export function startLiveliness(robot) {
  if (started) return
  started = true
  robotRef = robot
  loadPersistedParams()
  applyGazePixelScale()
  applyFaceParams()
  scheduleNextGaze()
  scheduleNextMurmur()
  trace('[live] started\n')
}

/**
 * 呼吸ループ(mod.js)がサイクル頭で問い合わせる。deepBreath はタイマーを持たず、
 * この呼び出し自体が 1 サイクル分の抽選になる(呼ぶたびに 1 回 Math.random を消費)。
 */
export function shouldDeepBreathe() {
  const cfg = params.deepBreath
  if (deepBreathRequested) {
    // HTTP トリガ(チューニング用)は enabled に関わらず 1 回だけ発動する
    deepBreathRequested = false
    trace(`[live] deep-breath (requested) scale=${cfg.scale} mouthScale=${cfg.mouthScale}\n`)
    return true
  }
  if (!cfg.enabled) return false
  const hit = Math.random() < cfg.probPerCycle
  if (hit) trace(`[live] deep-breath scale=${cfg.scale} mouthScale=${cfg.mouthScale}\n`)
  return hit
}

/** POST /live/deep-breath(チューニング用): 次の呼吸サイクルを深呼吸にする。発動まで最大 1 サイクル(~10s)。 */
export function requestDeepBreath() {
  deepBreathRequested = true
  trace('[live] deep-breath requested for next cycle\n')
  return true
}

/**
 * リアクション(breath/reactions 等、v1.1.0 Phase 3c)が視線を占有する間、gaze
 * スケジューラの次回発火を先送りする。保留中のタイマーを破棄し、`ms` 後に
 * scheduleNextGaze() を仕掛け直すだけ(started ガード付き。既存の
 * clearGazeTimers/scheduleNextGaze を再利用するのみで、他のロジックは変更しない)。
 */
export function deferGaze(ms) {
  if (!started) return
  clearGazeTimers()
  gazeTimerId = Timer.set(() => {
    gazeTimerId = null
    scheduleNextGaze()
  }, ms)
}

/** POST /live/gaze(チューニング用): 視線イベントを即時発火する(以後のスケジュールは通常に戻る)。 */
export function triggerGaze() {
  if (!started || !robotRef) return false
  clearGazeTimers()
  try {
    performGazeTick()
  } catch (error) {
    trace(`[live] gaze trigger error: ${error}\n`)
    scheduleNextGaze()
  }
  return true
}

/** shouldDeepBreathe() が true を返したサイクルでのみ mod.js が読む倍率パラメータ。 */
export function getDeepBreathParams() {
  const cfg = params.deepBreath
  return { scale: cfg.scale, mouthScale: cfg.mouthScale, sighProb: cfg.sighProb }
}

/** 深呼吸サイクルの吐き始めに mod.js が呼ぶ。sighProb の抽選 + 'sigh' の再生まで内包する。 */
export function maybeSighForDeepBreath() {
  // 深呼吸サイクル中にしか呼ばれない(強制トリガ時も sigh 抽選を有効にするため enabled は見ない)
  const cfg = params.deepBreath
  if (Math.random() < cfg.sighProb) {
    try {
      playCry('sigh')
    } catch (error) {
      trace(`[live] sigh trigger failed: ${error}\n`)
    }
  }
}

/** 現在有効なパラメータ(GET /params)。 */
export function getParams() {
  return params
}

/**
 * 部分更新(PUT /params)。deep merge + 検証 + Preference 永続化 + 即時反映。
 * gaze/murmur が変わった場合は保留中のタイマーを破棄してその場で再スケジュールする
 * (次の interval 計算から新しい値を使う。Loop B でのライブチューニングの心臓部)。
 */
export function setParams(partial) {
  if (!partial || typeof partial !== 'object') return getParams()

  params = sanitizeParams(mergeValidated(params, partial))
  persistParams()
  trace(`[live] params updated ${JSON.stringify(Object.keys(partial))}\n`)

  if (started) {
    if ('gaze' in partial) {
      applyGazePixelScale()
      clearGazeTimers()
      scheduleNextGaze()
    }
    if ('murmur' in partial) {
      clearMurmurTimer()
      scheduleNextMurmur()
    }
    if ('face' in partial) {
      applyFaceParams()
    }
  }

  return getParams()
}
