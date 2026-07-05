import { attachStatusBar } from 'status-bar'
import Timer from 'timer'
import config from 'mc/config'
import { startDevTools } from 'breath/dev/dev-tools'

/** v1.0.0 Layer 0 — 吸 4s / 吐 6s。LCD（口 + breath motion）のみ。 */
const INHALE_SEC = 4
const EXHALE_SEC = 6
const MOUTH_INHALE = 0.22
const MOUTH_EXHALE = 0.04

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
  const inhale = jitter(INHALE_SEC)
  const exhale = jitter(EXHALE_SEC)
  await animateMouth(robot, MOUTH_EXHALE, MOUTH_INHALE, inhale * 1000)
  await animateMouth(robot, MOUTH_INHALE, MOUTH_EXHALE, exhale * 1000)
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
  }, 2000)

  Timer.set(() => {
    if (!config.breathDevTools) return
    try {
      startDevTools()
    } catch (error) {
      trace(`[dev] start failed: ${error}\n`)
    }
  }, 3000)
}

export default {
  onRobotCreated,
}
