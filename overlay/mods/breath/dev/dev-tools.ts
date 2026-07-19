import { startBeacon } from 'breath/dev/beacon'
import { startDevServer } from 'breath/dev/dev-server'
import { startTraceMirror } from 'breath/dev/trace-udp'
import Net from 'net'
import Preference from 'preference'
import Time from 'time'
import Timer from 'timer'

type DevGlobals = typeof globalThis & {
  breathBootId?: string
  breathBootStartedAt?: number
  breathPreviousBootCompleted?: boolean
  breathLastHeartbeatMs?: number
  breathDevHealthy?: boolean
}

const devGlobals = globalThis as DevGlobals
let heartbeatTimer: ReturnType<typeof Timer.set> | null = null
let bootInitialized = false

function initializeBootState(): void {
  if (bootInitialized || devGlobals.breathBootId) return
  bootInitialized = true
  const previousCompleted = Preference.get('breath', 'bootCompleted') === '1'
  const bootId = `${Time.ticks}-${Math.floor(Math.random() * 0x10000).toString(16)}`
  Preference.set('breath', 'bootCompleted', '0')
  Preference.set('breath', 'bootId', bootId)
  devGlobals.breathBootId = bootId
  devGlobals.breathBootStartedAt = Time.ticks
  devGlobals.breathPreviousBootCompleted = previousCompleted
  if (devGlobals.breathDevHealthy !== true) devGlobals.breathDevHealthy = false
  devGlobals.breathLastHeartbeatMs = Time.ticks
}

function startHeartbeat(): void {
  if (heartbeatTimer) return
  const beat = () => {
    devGlobals.breathLastHeartbeatMs = Time.ticks
    heartbeatTimer = Timer.set(beat, 5000)
  }
  beat()
}

export function markDevHealthy(): void {
  devGlobals.breathDevHealthy = true
  Preference.set('breath', 'bootCompleted', '1')
  devGlobals.breathLastHeartbeatMs = Time.ticks
  trace('[dev] boot healthy\n')
}

function safeIp(): string {
  try {
    return Net.get('IP') ?? '<unknown-ip>'
  } catch (_error) {
    return '<unknown-ip>'
  }
}

/** Wi-Fi 開発環境 Phase 1/2 のエントリポイント。呼吸ループには触れない。 */
export function startDevTools(): void {
  try {
    initializeBootState()
    startHeartbeat()
  } catch (error) {
    trace(`[dev] boot state failed: ${error}\n`)
  }
  try {
    startTraceMirror()
    trace('[dev] trace mirror on\n')
  } catch (error) {
    trace(`[dev] trace mirror failed: ${error}\n`)
  }

  try {
    startDevServer()
    trace(`[dev] server on http://${safeIp()}/status\n`)
  } catch (error) {
    trace(`[dev] server failed: ${error}\n`)
  }

  try {
    startBeacon()
    trace('[dev] beacon on (udp/8687, 10s interval)\n')
  } catch (error) {
    trace(`[dev] beacon failed: ${error}\n`)
  }
}
