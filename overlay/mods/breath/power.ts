import { stopLed } from 'breath/led'
import { readPowerKeyState, readPowerOnSource, requestPowerOff } from 'm5stackchan/battery'
import Preference from 'preference'
import Timer from 'timer'

const POWER_KEY_LONG_PRESS = 0x04
const POWER_KEY_SHORT_PRESS = 0x08
const POWER_OFF_SETTLE_MS = 120
const PREF_DOMAIN = 'breath'
const PREF_KEY_INTENTIONAL_OFF = 'intentionalOff'
const POWER_ON_BY_CHARGED_BATTERY = 8
const POWER_ON_BY_VBUS = 4
const POWER_ON_BY_BUTTON = 1
const POWER_ON_BY_CHARGING = POWER_ON_BY_VBUS + POWER_ON_BY_CHARGED_BATTERY

let shuttingDown = false

type PowerRobot = {
  driver?: {
    onDetached?: () => void
  }
  led?: { head?: { off: () => void } }
}

type BreathPowerGlobals = typeof globalThis & {
  breathPowerOnSource?: number | null
  breathIntentionalOff?: boolean
  breathPowerRawEventCount?: number
  breathPowerRawState?: number
  breathPowerLastKeyState?: number
}

const globals = globalThis as BreathPowerGlobals

function shutdown(robot: PowerRobot | null | undefined, reason: string): void {
  if (shuttingDown) return
  shuttingDown = true
  trace(`[power] shutdown requested (${reason})\n`)
  try {
    Preference.set(PREF_DOMAIN, PREF_KEY_INTENTIONAL_OFF, '1')
  } catch (error) {
    trace(`[power] intentional-off marker write failed: ${error}\n`)
  }
  stopLed(robot)
  try {
    robot?.driver?.onDetached?.()
  } catch (error) {
    trace(`[power] servo power-off failed: ${error}\n`)
  }

  Timer.set(() => {
    if (!requestPowerOff()) {
      shuttingDown = false
      trace('[power] shutdown request was not accepted\n')
    }
  }, POWER_OFF_SETTLE_MS)
}

export function startPowerControl(robot: PowerRobot): void {
  try {
    const intentionalOff = Preference.get(PREF_DOMAIN, PREF_KEY_INTENTIONAL_OFF) === '1'
    const source = readPowerOnSource()
    globals.breathPowerOnSource = source
    globals.breathIntentionalOff = intentionalOff
    trace(
      `[power] boot source=${source === null ? 'unknown' : `0x${source.toString(16)}`} intentionalOff=${intentionalOff}\n`,
    )
    if (intentionalOff && source !== null) {
      // biome-ignore lint/suspicious/noBitwiseOperators: AXP2101 reports independent source flags as a bitmask.
      if (source & POWER_ON_BY_BUTTON) {
        Preference.set(PREF_DOMAIN, PREF_KEY_INTENTIONAL_OFF, '0')
        globals.breathIntentionalOff = false
      } else if (
        // biome-ignore lint/suspicious/noBitwiseOperators: AXP2101 reports independent source flags as a bitmask.
        source & POWER_ON_BY_CHARGING
      ) {
        shutdown(robot, 'charge-only boot')
        return
      }
    }
  } catch (error) {
    trace(`[power] retained-off check failed: ${error}\n`)
  }

  Timer.repeat(() => {
    const state = readPowerKeyState()
    if (!state) return
    trace(`[power] key state=0x${state.toString(16)}\n`)
    globals.breathPowerRawEventCount = (globals.breathPowerRawEventCount ?? 0) + 1
    globals.breathPowerRawState = state
    globals.breathPowerLastKeyState = state
    // biome-ignore lint/suspicious/noBitwiseOperators: AXP2101 reports independent key events as a bitmask.
    if (state & POWER_KEY_LONG_PRESS) shutdown(robot, 'long press')
    // biome-ignore lint/suspicious/noBitwiseOperators: AXP2101 reports independent key events as a bitmask.
    else if (state & POWER_KEY_SHORT_PRESS) trace('[power] short press ignored\n')
  }, 20)
  trace('[power] control started (direct AXP2101 short/long press IRQ polling)\n')
}
