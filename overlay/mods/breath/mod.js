import { attachStatusBar } from 'status-bar'
import { attachSettingsBar, applySavedSettings } from 'settings-bar'
import Timer from 'timer'
import config from 'mc/config'
import { startDevTools } from 'breath/dev/dev-tools'
import { initCry } from 'breath/cry'
import { startLiveliness, shouldDeepBreathe, getDeepBreathParams, maybeSighForDeepBreath } from 'breath/liveliness'

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

function delay(ms) {
  return new Promise((resolve) => Timer.set(resolve, ms))
}

async function animateMouth(robot, from, to, durationMs) {
  const steps = Math.max(1, Math.floor(durationMs / 50))
  const stepMs = durationMs / steps
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    robot.setMouthOpen(from + (to - from) * t)
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

  const inhale = jitter(INHALE_SEC) * scale
  const exhale = jitter(EXHALE_SEC) * scale
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
}

export default {
  onRobotCreated,
}
