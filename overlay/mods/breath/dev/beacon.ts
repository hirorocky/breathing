import config from 'mc/config'
import Net from 'net'
import { Socket } from 'socket'
import Timer from 'timer'

const breathConfig = config as typeof config & { buildId?: string }

/**
 * デバイス IP 自動発見用の UDP ビーコン（v1.0.3 dev tools）。
 *
 * mDNS（stackchan.local）は自宅 Deco IoT SSID でクライアント間 multicast が
 * 遮断され使えない（`dev-server.js` 参照）。デバイス → Mac の UDP グローバル
 * ブロードキャストは trace-udp.js で実証済みのため、同じ方向・同じ送信先
 * 方針（255.255.255.255 固定、/24 仮定のサブネットブロードキャストは使わない）
 * で IP 自動発見にも使う。逆方向（Mac → デバイス）は未実証のため使わない。
 *
 * 10 秒ごとに { name, ip, buildId } の JSON を 1 パケット送信する。起動直後の
 * 発見を速くするため、開始時に 1 発即時送信してから周期に入る。
 *
 * trace-udp.js と同じ流儀: 全体を try/catch し、送信失敗はループを止めない。
 * 失敗 trace は初回のみに絞り、trace() を多発させない（trace 自体は呼ぶが
 * このモジュール内で再帰・大量発火はしない）。Promise は使わない。
 */
const UDP_PORT = 8687
const GLOBAL_BROADCAST = '255.255.255.255'
const INTERVAL_MS = 10_000
const BEACON_NAME = 'stackchan'

let started = false
type UdpSocket = { write(host: string, port: number, data: ArrayBuffer): void }
type UdpSocketConstructor = new (options: { kind: 'UDP' }) => UdpSocket

let socket: UdpSocket | null = null
let failureTraced = false

function ensureSocket(): UdpSocket {
  if (!socket) socket = new (Socket as unknown as UdpSocketConstructor)({ kind: 'UDP' })
  return socket
}

function safeIp(): string | null {
  try {
    return Net.get('IP') ?? null
  } catch (_error) {
    return null
  }
}

function buildPayload(): string {
  return JSON.stringify({
    name: BEACON_NAME,
    ip: safeIp(),
    buildId: breathConfig.buildId ?? 'unknown',
  })
}

function sendBeacon(): void {
  try {
    const buffer = ArrayBuffer.fromString(buildPayload())
    ensureSocket().write(GLOBAL_BROADCAST, UDP_PORT, buffer)
  } catch (error) {
    if (!failureTraced) {
      failureTraced = true
      try {
        trace(`[dev] beacon send failed: ${error}\n`)
      } catch (_traceError) {
        // 握りつぶす。trace 自体を壊さない。
      }
    }
  }
}

/** 10 秒周期の UDP ビーコンを開始する。二重に開始しない。 */
export function startBeacon(): void {
  if (started) return
  started = true

  sendBeacon() // 起動直後の発見を速くするための即時送信
  Timer.repeat(sendBeacon, INTERVAL_MS)
}
