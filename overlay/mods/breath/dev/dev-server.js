import listen, { Headers, Response } from 'breath/dev/http-listen'
import MDNS from 'mdns'
import Net from 'net'
import config from 'mc/config'
import Time from 'time'
import { readBatterySample } from 'm5stackchan/battery'

/**
 * Wi-Fi 開発環境 Phase 1 — GET /status + mDNS（v1.0.1 dev tools）。
 *
 * stack-chan の `HttpServerService` は使わない: 現行 SDK の Headers.set が
 * `value.toString()` を要求するのに対し、同サービスの Response が
 * content-length に undefined を渡すため、任意のリクエスト 1 件で
 * unhandled rejection → XS abort → 再起動になる（2026-07-05 実機で確認。
 * upstream firmware/stackchan/services/http-server/http-server-service.js の
 * `headers.set('content-length', body.byteLength)` が変換前の文字列 body を
 * 参照しているのが原因）。
 *
 * SDK の `listen` モジュールも直接は使わない: HTTP パース失敗（ポートスキャンや
 * telnet の garbage 等）で onRequest 前に接続エラーになると、内部 Promise の
 * unhandled rejection で同じく XS abort → 再起動する（実機で再現）。
 * rejection ハンドラを事前接続した overlay コピー `breath/dev/http-listen` を使う。
 */
const MDNS_HOST_NAME = 'stackchan'
const HTTP_PORT = 80

function safeBattery() {
  try {
    return readBatterySample()
  } catch (_error) {
    return null
  }
}

function safeIp() {
  try {
    return Net.get('IP') ?? null
  } catch (_error) {
    return null
  }
}

function buildStatusPayload() {
  return {
    buildId: config?.buildId ?? 'unknown',
    ip: safeIp(),
    battery: safeBattery(),
    uptimeMs: Time.ticks,
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: new Headers([['content-type', 'application/json']]),
  })
}

function textResponse(text, status) {
  return new Response(text, { status })
}

async function serveHttp(port) {
  for await (const connection of listen({ port })) {
    let response
    try {
      const request = connection.request
      if (request.method === 'GET' && request.url.pathname === '/status') {
        response = jsonResponse(buildStatusPayload())
      } else {
        response = textResponse('Not Found', 404)
      }
    } catch (_error) {
      response = textResponse('Internal Server Error', 500)
    }
    // respondWith の失敗を握りつぶす。unhandled rejection は XS abort（再起動）になる。
    connection.respondWith(response).then(undefined, () => {})
  }
}

function startMdns() {
  try {
    new MDNS({ hostName: MDNS_HOST_NAME }, function (message, value) {
      if (MDNS.hostName === message && value) {
        trace(`[dev] mdns claimed ${value}.local\n`)
      }
    })
  } catch (error) {
    trace(`[dev] mdns failed: ${error}\n`)
  }
}

/** GET /status を公開し、mDNS で stackchan を名乗る。 */
export function startDevServer() {
  serveHttp(HTTP_PORT).then(undefined, (error) => {
    trace(`[dev] http server stopped: ${error}\n`)
  })
  startMdns()
}
