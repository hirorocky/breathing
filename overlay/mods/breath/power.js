import Timer from 'timer'
import Preference from 'preference'
import { readPowerKeyState, readPowerOnSource, requestPowerOff } from 'm5stackchan/battery'
import { stopLed } from 'breath/led'

const POWER_KEY_LONG_PRESS = 0x04
const POWER_KEY_SHORT_PRESS = 0x08
const POWER_OFF_SETTLE_MS = 120
const PREF_DOMAIN = 'breath'
const PREF_KEY_INTENTIONAL_OFF = 'intentionalOff'
const POWER_ON_BY_CHARGED_BATTERY = 1 << 3
const POWER_ON_BY_VBUS = 1 << 2
const POWER_ON_BY_BUTTON = 1 << 0

let shuttingDown = false

function shutdown(robot, reason) {
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

export function startPowerControl(robot) {
  try {
    const intentionalOff = Preference.get(PREF_DOMAIN, PREF_KEY_INTENTIONAL_OFF) === '1'
    const source = readPowerOnSource()
    globalThis.breathPowerOnSource = source
    globalThis.breathIntentionalOff = intentionalOff
    trace(`[power] boot source=${source == null ? 'unknown' : `0x${source.toString(16)}`} intentionalOff=${intentionalOff}\n`)
    if (intentionalOff && source != null) {
      if (source & POWER_ON_BY_BUTTON) {
        Preference.set(PREF_DOMAIN, PREF_KEY_INTENTIONAL_OFF, '0')
        globalThis.breathIntentionalOff = false
      } else if (source & (POWER_ON_BY_VBUS | POWER_ON_BY_CHARGED_BATTERY)) {
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
    globalThis.breathPowerRawEventCount = (globalThis.breathPowerRawEventCount ?? 0) + 1
    globalThis.breathPowerRawState = state
    globalThis.breathPowerLastKeyState = state
    if (state & POWER_KEY_LONG_PRESS) shutdown(robot, 'long press')
    else if (state & POWER_KEY_SHORT_PRESS) trace('[power] short press ignored\n')
  }, 20)
  trace('[power] control started (direct AXP2101 short/long press IRQ polling)\n')
}
