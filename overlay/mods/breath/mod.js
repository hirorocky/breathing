import { attachStatusBar } from 'status-bar'
import { attachSettingsBar, applySavedSettings } from 'settings-bar'
import Timer from 'timer'
import config from 'mc/config'
import { startDevTools } from 'breath/dev/dev-tools'
import { initCry } from 'breath/cry'
import { startLiveliness, shouldDeepBreathe, getDeepBreathParams, maybeSighForDeepBreath } from 'breath/liveliness'
import { startMic } from 'breath/mic'
import { startReactions } from 'breath/reactions'
import { startEmotion, getEmotion } from 'breath/emotion'
import { startLed } from 'breath/led'
import { startPowerControl } from 'breath/power'
import { startPosture } from 'breath/posture'

/** v1.0.0 Layer 0 — 吸 4s / 吐 6s。LCD（口 + breath motion）のみ。 */
const INHALE_SEC = 4
const EXHALE_SEC = 6
const MOUTH_INHALE = 0.22
const MOUTH_EXHALE = 0.04
// v1.1.0 Phase 2a — 深呼吸(liveliness.deepBreath)の口の開きの絶対上限。
const MOUTH_DEEP_MAX = 0.35

function jitter(seconds, spread = 0.03) {
  return seconds * (1 + (Math.random() * 2 - 1) * spread)
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function delay(ms) {
  return new Promise((resolve) => Timer.set(resolve, ms))
}

async function animateMouth(robot, from, to, durationMs) {
  const steps = Math.max(1, Math.floor(durationMs / 50))
  const stepMs = durationMs / steps
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mouthOpen = from + (to - from) * t
    robot.setMouthOpen(mouthOpen)
    // v1.2.0 (E2) — led.js が呼吸連動の明るさゆらぎに読む(0..1、口の開きを
    // MOUTH_EXHALE..MOUTH_DEEP_MAX で正規化)。led.js 不在時は誰も読まないだけ。
    globalThis.breathPulse = clamp01((mouthOpen - MOUTH_EXHALE) / (MOUTH_DEEP_MAX - MOUTH_EXHALE))
    await delay(stepMs)
  }
}

async function runBreathCycle(robot) {
  // v1.1.0 Phase 2a — サイクル頭で liveliness に深呼吸を問い合わせる。
  // liveliness 側が無効/未起動でも常に false を返す設計のため、通常サイクルの
  // 挙動(jitter の呼び順・scale=1・peak=MOUTH_INHALE)は 1 ビットも変わらない。
  let isDeepBreath = false
  let deepParams = null
  try {
    isDeepBreath = shouldDeepBreathe()
    if (isDeepBreath) deepParams = getDeepBreathParams()
  } catch (error) {
    trace(`[breath] liveliness query failed: ${error}\n`)
    isDeepBreath = false
  }

  const scale = isDeepBreath ? deepParams.scale : 1
  const peakMouthOpen = isDeepBreath ? Math.min(MOUTH_INHALE * deepParams.mouthScale, MOUTH_DEEP_MAX) : MOUTH_INHALE

  // v1.2.0 (E1) — 感情エンジンの breathFactor(覚醒で呼吸が速く・沈静で遅く)を
  // 1 個だけ読んで乗算する。emotion 不在/失敗時は 1(無変調)にフォールバックする。
  // クランプ 0.85〜1.25 は emotion.js 側で既に保証しているが、呼吸を壊さないよう
  // 呼び出し側でも同じ範囲に再クランプする(呼吸ループの構造自体は変えない)。
  let breathFactor = 1
  try {
    breathFactor = getEmotion()?.modifiers?.breathFactor ?? 1
  } catch (error) {
    trace(`[breath] emotion query failed: ${error}\n`)
    breathFactor = 1
  }
  breathFactor = Math.min(1.25, Math.max(0.85, breathFactor))

  const inhale = jitter(INHALE_SEC) * scale * breathFactor
  const exhale = jitter(EXHALE_SEC) * scale * breathFactor
  await animateMouth(robot, MOUTH_EXHALE, peakMouthOpen, inhale * 1000)

  if (isDeepBreath) {
    try {
      maybeSighForDeepBreath()
    } catch (error) {
      trace(`[breath] sigh trigger failed: ${error}\n`)
    }
  }

  await animateMouth(robot, peakMouthOpen, MOUTH_EXHALE, exhale * 1000)
}

async function breathLoop(robot) {
  trace('[breath] start (face only, servo off)\n')

  robot.setEmotion('NEUTRAL')
  robot.setColor('primary', 0xff, 0xff, 0xff)
  robot.setColor('secondary', 0x00, 0x00, 0x00)
  robot.setMouthOpen(MOUTH_EXHALE)

  // setTorque(false) は UART 応答待ちで WDT 再起動することがあるため省略（v1.0.1 調査中）
  trace('[breath] loop running\n')

  while (true) {
    await runBreathCycle(robot)
  }
}

export function onRobotCreated(robot) {
  trace('[breath] mod onRobotCreated\n')

  try {
    startPowerControl(robot)
  } catch (error) {
    trace(`[power] start failed: ${error}\n`)
  }

  Timer.set(() => {
    void breathLoop(robot).catch((error) => {
      trace(`[breath] error ${error}\n`)
    })
  }, 500)

  Timer.set(() => {
    try {
      attachStatusBar(robot)
    } catch (error) {
      trace(`[status-bar] attach failed: ${error}\n`)
    }

    try {
      applySavedSettings()
    } catch (error) {
      trace(`[settings-bar] applySavedSettings failed: ${error}\n`)
    }

    try {
      attachSettingsBar(robot)
    } catch (error) {
      trace(`[settings-bar] attach failed: ${error}\n`)
    }
  }, 2000)

  Timer.set(() => {
    if (!config.breathDevTools) return
    try {
      startDevTools()
    } catch (error) {
      trace(`[dev] start failed: ${error}\n`)
    }
  }, 3000)

  // キャッシュ生成の開始のみ。再生は dev サーバの POST /cry/<name>、および
  // v1.1.0 Phase 2a の liveliness(murmur スケジューラ・深呼吸の sigh)経由。
  Timer.set(() => {
    try {
      initCry()
    } catch (error) {
      trace(`[cry] init failed: ${error}\n`)
    }
  }, 4000)

  // v1.1.0 Phase 2a — 生存感エンジン(gaze・murmur スケジューラ)を開始する。
  // 呼吸ループ自体は breathLoop が既に持っており、deepBreath はここでは触れない
  // (mod.js 側から shouldDeepBreathe() を毎サイクル問い合わせる形)。
  Timer.set(() => {
    try {
      startLiveliness(robot)
    } catch (error) {
      trace(`[live] start failed: ${error}\n`)
    }
  }, 5000)

  // v1.1.0 Phase 3a — マイク観測基盤(レベルのみ)。見た目・振る舞いには触れない。
  Timer.set(() => {
    try {
      startMic(robot)
    } catch (error) {
      trace(`[mic] start failed: ${error}\n`)
    }
  }, 6000)

  // v1.1.0 Phase 3c #1 — startle + 方向つき一瞥(mic の loud/clap イベントに反応)。
  Timer.set(() => {
    try {
      startReactions(robot)
    } catch (error) {
      trace(`[react] start failed: ${error}\n`)
    }
  }, 7000)

  // v1.2.0 (E1) — 感情 2 次元エンジン(v/a の指数回帰・イベント入力・表情への配線)。
  Timer.set(() => {
    try {
      startEmotion(robot)
    } catch (error) {
      trace(`[emotion] start failed: ${error}\n`)
    }
  }, 8000)

  // v1.2.0 (E2) — ヘッド LED を感情の環境光にする。
  Timer.set(() => {
    try {
      startLed(robot)
    } catch (error) {
      trace(`[led] start failed: ${error}\n`)
    }
  }, 9000)

  // v1.3.0 (E3) — サーボ解禁 + 感情姿勢(頭の pitch)。robot が pose API を持たない
  // (driver が none にフォールバックした)場合も startPosture 内で安全に no-op になる。
  Timer.set(() => {
    try {
      startPosture(robot)
    } catch (error) {
      trace(`[posture] start failed: ${error}\n`)
    }
  }, 10000)
}

export default {
  onRobotCreated,
}
