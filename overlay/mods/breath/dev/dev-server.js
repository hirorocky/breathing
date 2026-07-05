import HTTPServer from 'embedded:network/http/server'
import Listener from 'embedded:io/socket/listener'
import OTA from 'embedded:update'
import flash from 'embedded:storage/flash'
import WebPage from 'embedded:network/http/server/options/webpage'
import Timer from 'timer'
import FFI from 'mc/ffi'
import MDNS from 'mdns'
import Net from 'net'
import config from 'mc/config'
import Time from 'time'
import { readBatterySample } from 'm5stackchan/battery'

/**
 * Wi-Fi 開発環境 Phase 1/2 — GET /status・PUT /ota + mDNS（v1.0.1 dev tools）。
 *
 * Phase 1 では `breath/dev/http-listen`（Promise ベースの async generator）を
 * 使っていたが、あれは受信ボディをまるごと ArrayBuffer へ concat してから
 * 初めて読めるようになる作り（小さな JSON レスポンス向け）。PUT /ota は数 MB
 * のファーム丸ごとを受け取るため、その方式では受信ごとに O(n^2) のコピーが
 * 走り、書込み開始も全受信後になってしまい使えない。
 *
 * ここでは SDK の `examples/io/listener/httpserverota` に倣い、
 * `embedded:network/http/server` を直接ルーティングし、受信チャンクを
 * その場で OTA へ書き込む。このレイヤは Promise を一切使わない
 * （コールバックのみ）。Phase 1 で踏んだ「unhandled rejection → XS abort →
 * 約 40 秒後 WDT 再起動」を構造的に避けるための選択でもある。各コールバック
 * は例外を握って status を立てるだけで、再スローしない。
 *
 * 異常系（トークン不一致・書込み失敗・転送中断）では OTA を complete() せず
 * close() のみ呼ぶ（= cancel）。complete() を呼ばない限り esp_ota_set_boot_partition
 * は実行されないため、次回起動は現行ファームのまま — SDK 例の onResponse は
 * status に関わらず complete() を呼んでしまうため、そこは意図的に例から外した。
 */
const MDNS_HOST_NAME = 'stackchan'
const HTTP_PORT = 80
const RESTART_DELAY_MS = 1000

const Natives = new FFI()

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

function isAuthorized(request) {
  const token = request.headers.get('x-dev-token')
  return !!config?.devToken && token === config.devToken
}

const notFound = {
  ...WebPage,
  data: ArrayBuffer.fromString('Not Found\n'),
}

/** GET /status。ボディは毎リクエストその場で組み立てる（route ではなく connection に持たせる）。 */
const statusRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    try {
      this.status = 200
      this.data = ArrayBuffer.fromString(JSON.stringify(buildStatusPayload()))
    } catch (error) {
      trace(`[dev] status build failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString('')
    }
  },
  onResponse(response) {
    response.status = this.status
    response.headers.set('content-type', 'application/json')
    response.headers.set('content-length', this.data.byteLength)
    this.respond(response)
  },
  onWritable(count) {
    const remaining = this.data.byteLength - this.sent
    if (remaining <= 0) {
      this.write()
      return
    }
    const use = Math.min(count, remaining)
    this.write(new Uint8Array(this.data, this.sent, use))
    this.sent += use
  },
  onError(message) {
    trace(`[dev] status connection error: ${message}\n`)
  },
}

/** PUT /ota。受信チャンクをその場で OTA パーティションへ書き込む。 */
const otaRoute = {
  onRequest(request) {
    this.bytesReceived = 0
    this.updater = null

    if (!isAuthorized(request)) {
      this.status = 401
      trace('[dev] ota rejected: bad or missing x-dev-token\n')
      return
    }
    if ('PUT' !== request.method) {
      this.status = 405
      return
    }
    try {
      this.status = 200
      this.updater = OTA.open({ partition: flash.open({ path: 'nextota' }) })
      trace('[dev] ota open\n')
    } catch (error) {
      trace(`[dev] ota open failed: ${error}\n`)
      this.status = 500
      this.updater = null
    }
  },
  onReadable(count) {
    // 認証/オープン失敗時も含め、必ず読み切って state machine を進める
    // （読まないと HTTP レスポンスに進めず接続がハングする）。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] ota read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 !== this.status || !this.updater || !bytes) return
    try {
      this.updater.write(bytes)
      this.bytesReceived += bytes.byteLength
    } catch (error) {
      trace(`[dev] ota write failed: ${error}\n`)
      this.status = 500
      try {
        this.updater.close() // complete() を呼ばない = cancel
      } catch (_closeError) {
        // 握りつぶす。abort させない。
      }
      this.updater = null
    }
  },
  onResponse(response) {
    if (200 === this.status && this.updater) {
      try {
        this.updater.complete()
        this.updater = null
        trace(`[dev] ota complete: ${this.bytesReceived} bytes, restarting in ${RESTART_DELAY_MS}ms\n`)
        Timer.set(() => Natives.esp_restart(), RESTART_DELAY_MS)
      } catch (error) {
        trace(`[dev] ota complete failed: ${error}\n`)
        this.status = 500
      }
    } else if (this.updater) {
      try {
        this.updater.close() // complete() を呼ばない = cancel。旧ファームのまま生存させる
      } catch (_closeError) {
        // 握りつぶす。
      }
      this.updater = null
      trace(`[dev] ota cancelled (status=${this.status})\n`)
    }
    response.status = this.status
    response.headers.set('content-length', 0)
    this.respond(response)
  },
  onError(message) {
    trace(`[dev] ota connection error: ${message}\n`)
    if (this.updater) {
      try {
        this.updater.close()
      } catch (_closeError) {
        // 握りつぶす。
      }
      this.updater = null
    }
  },
}

const router = new Map([
  ['/status', statusRoute],
  ['/ota', otaRoute],
])

function startHttpServer(port) {
  new HTTPServer({
    io: Listener,
    port,
    onConnect(connection) {
      connection.accept({
        onRequest(request) {
          this.route = router.get(request.path) ?? notFound
        },
        onError(message) {
          trace(`[dev] connection error before routing: ${message}\n`)
        },
      })
    },
  })
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

/** GET /status・PUT /ota を公開し、mDNS で stackchan を名乗る。 */
export function startDevServer() {
  startHttpServer(HTTP_PORT)
  startMdns()
}
