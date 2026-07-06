import { startTraceMirror } from 'breath/dev/trace-udp'
import { startDevServer } from 'breath/dev/dev-server'
import { startBeacon } from 'breath/dev/beacon'
import Net from 'net'

function safeIp() {
  try {
    return Net.get('IP') ?? '<unknown-ip>'
  } catch (_error) {
    return '<unknown-ip>'
  }
}

/** Wi-Fi 開発環境 Phase 1/2 のエントリポイント。呼吸ループには触れない。 */
export function startDevTools() {
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
