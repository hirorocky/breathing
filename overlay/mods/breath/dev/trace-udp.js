import { Socket } from 'socket'
import config from 'mc/config'

/**
 * globalThis.trace を差し替えて UDP へミラーする（v1.0.1 dev tools）。
 * 元の trace は必ず呼ぶ。UDP 送信の失敗は trace 自体を壊してはいけない
 * （このファイル内で trace() を呼ばない・再帰ガードを持つ）。
 *
 * 送信先はグローバルブロードキャスト（255.255.255.255）。実機で動作確認済み。
 * サブネットブロードキャスト（IP から /24 を仮定した x.y.z.255）は使わない —
 * /22 等のネットワーク（例: TP-Link Deco）では通常ホスト宛になり、ARP 未解決の
 * pbuf が滞留して ERR_MEM → 再起動ループに至る（2026-07-05 実機で確認）。
 * `mc/config` の devLogHost があればそちら（ユニキャスト）を優先。
 */
const UDP_PORT = 8686
const GLOBAL_BROADCAST = '255.255.255.255'

let started = false
let originalTrace = null
let socket = null
let sending = false

function resolveDestination() {
  try {
    return config?.devLogHost ?? GLOBAL_BROADCAST
  } catch (_error) {
    return GLOBAL_BROADCAST
  }
}

function ensureSocket() {
  if (!socket) socket = new Socket({ kind: 'UDP' })
  return socket
}

function mirrorToUdp(text) {
  const buffer = ArrayBuffer.fromString(text)
  ensureSocket().write(resolveDestination(), UDP_PORT, buffer)
}

function stringifyArgs(args) {
  let text = ''
  for (const arg of args) text += String(arg)
  return text
}

/** globalThis.trace を差し替える。二重に開始しない。 */
export function startTraceMirror() {
  if (started) return
  started = true
  originalTrace = globalThis.trace

  globalThis.trace = function tracedMirror(...args) {
    originalTrace.apply(this, args)

    if (sending) return
    sending = true
    try {
      mirrorToUdp(stringifyArgs(args))
    } catch (_error) {
      // UDP ミラーの失敗は無視する。trace 自体・呼び出し元を壊さない。
    } finally {
      sending = false
    }
  }
}
