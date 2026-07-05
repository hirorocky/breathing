import { startTraceMirror } from 'breath/dev/trace-udp'
import { startDevServer } from 'breath/dev/dev-server'

/** Wi-Fi 開発環境 Phase 1 のエントリポイント。呼吸ループには触れない。 */
export function startDevTools() {
  try {
    startTraceMirror()
    trace('[dev] trace mirror on\n')
  } catch (error) {
    trace(`[dev] trace mirror failed: ${error}\n`)
  }

  try {
    startDevServer()
    trace('[dev] server on http://<device-ip>/status\n')
  } catch (error) {
    trace(`[dev] server failed: ${error}\n`)
  }
}
