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
import { CRY_NAMES, getRecipes, playCry, setRecipes } from 'breath/cry'
import { getParams, setParams, requestDeepBreath, triggerGaze, deferGaze } from 'breath/liveliness'
import { getMicStatus, setMicParams } from 'breath/mic'
import { getReactParams, setReactParams, triggerStartle } from 'breath/reactions'
import {
  getEmotion,
  setEmotionState,
  pushTouch,
  getEmotionParams,
  setEmotionParams,
  triggerSleepFlutter,
  triggerRecoveryBoost,
  forceVoiceActive,
  forceNightMode,
  startValenceDrift,
} from 'breath/emotion'
import { getLedStatus, setLedParams, testLed, setLedSingle, startLedSweep } from 'breath/led'
import { getPostureStatus, setPostureParams, testPosture } from 'breath/posture'

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
    // デバッグ計器(eye-cozmo が毎フレーム書く描画オフセット px。一瞥の符号バグ調査 2026-07-07)
    dbgGaze: { l: globalThis.breathDbgGazeL ?? null, r: globalThis.breathDbgGazeR ?? null },
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

/** GET /cry/recipes・PUT /cry/recipes（要 x-dev-token）。本体は小さい JSON なので溜めてから処理する。 */
const cryRecipesRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('GET' === request.method) {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getRecipes()))
      } catch (error) {
        trace(`[dev] cry recipes build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] cry recipes rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める（otaRoute と同じ理由）。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] cry recipes read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const updated = setRecipes(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, updated }))
      } catch (error) {
        trace(`[dev] cry recipes update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] cry recipes connection error: ${message}\n`)
  },
}

/**
 * GET /params・PUT /params(要 x-dev-token)。liveliness(生存感エンジン)のライブパラメータ
 * (Loop B の心臓部)。本体は小さい JSON なので溜めてから処理する
 * (cryRecipesRoute と同型)。
 */
const paramsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('GET' === request.method) {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getParams()))
      } catch (error) {
        trace(`[dev] params build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] params connection error: ${message}\n`)
  },
}

/**
 * GET /mic（現在レベル・リングバッファ要約・avgProcUs・params）・
 * PUT /mic/params（要 x-dev-token、部分更新）。v1.1.0 Phase 3a マイク観測基盤。
 * 本体は小さい JSON なので溜めてから処理する（paramsRoute と同型）。
 */
const micRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('GET' === request.method) {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getMicStatus()))
      } catch (error) {
        trace(`[dev] mic status build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。body は想定しないが読み切ってハングを避ける。
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
    trace(`[dev] mic connection error: ${message}\n`)
  },
}

const micParamsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] mic params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める（otaRoute と同じ理由）。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] mic params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setMicParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] mic params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] mic params connection error: ${message}\n`)
  },
}

/**
 * GET /react。reactions(v1.1.0 Phase 3c #1 — startle + 方向つき一瞥)の現在パラメータ。
 * 本体は小さい JSON なので溜めてから処理する(paramsRoute と同型)。
 */
const reactRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    try {
      this.status = 200
      this.data = ArrayBuffer.fromString(JSON.stringify(getReactParams()))
    } catch (error) {
      trace(`[dev] react params build failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。body は想定しないが読み切ってハングを避ける。
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
    trace(`[dev] react connection error: ${message}\n`)
  },
}

/** PUT /react/params(要 x-dev-token)。部分更新(paramsRoute の PUT 分岐と同型)。 */
const reactParamsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] react params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] react params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setReactParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] react params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] react params connection error: ${message}\n`)
  },
}

/**
 * POST /react/startle(要 x-dev-token)。body JSON `{"dir": 1}`(-1/0/1、省略時は
 * ランダム)で拍手なしの目視テストを行う(Loop C / Phase 3c の心臓部)。本体は
 * 小さい JSON なので溜めてから処理する(cryRecipesRoute の PUT 分岐と同型)。
 */
const reactStartleRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] react startle rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200 // 本文を読み終えてから onResponse で確定する
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] react startle read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let dir
        if (this.chunks.length) {
          let total = 0
          for (const chunk of this.chunks) total += chunk.byteLength
          const merged = new Uint8Array(total)
          let offset = 0
          for (const chunk of this.chunks) {
            merged.set(new Uint8Array(chunk), offset)
            offset += chunk.byteLength
          }
          const text = String.fromArrayBuffer(merged.buffer)
          if (text.trim()) {
            const body = JSON.parse(text)
            dir = body?.dir
          }
        }
        const ok = triggerStartle(dir)
        this.status = ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok }))
      } catch (error) {
        trace(`[dev] react startle failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] react startle connection error: ${message}\n`)
  },
}

/** POST /cry/<name>。キャッシュ済みバッファを即再生する（Loop A の心臓部）。 */
function makeCryPlayRoute(name) {
  return {
    onRequest(request) {
      this.sent = 0
      if ('POST' !== request.method) {
        this.status = 405
        this.data = ArrayBuffer.fromString('')
        return
      }
      try {
        const result = playCry(name)
        this.status = result.ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify(result))
      } catch (error) {
        trace(`[dev] cry play failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, name, error: String(error) }))
      }
    },
    onReadable(count) {
      // body は想定しないが、送られてきても読み切ってハングを避ける。
      try {
        this.read(count)
      } catch (_error) {
        // 握りつぶす。
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
      trace(`[dev] cry play connection error: ${message}\n`)
    },
  }
}

/** POST /live/<action>。生存感エンジンのチューニング用即時トリガ(Loop B 用)。 */
function makeLiveActionRoute(name, action) {
  return {
    onRequest(request) {
      this.sent = 0
      if ('POST' !== request.method) {
        this.status = 405
        this.data = ArrayBuffer.fromString('')
        return
      }
      try {
        const ok = action()
        this.status = ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok, action: name }))
      } catch (error) {
        trace(`[dev] live action failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, action: name, error: String(error) }))
      }
    },
    onReadable(count) {
      try {
        this.read(count)
      } catch (_error) {
        // 握りつぶす。
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
      trace(`[dev] live action connection error: ${message}\n`)
    },
  }
}

const LIVE_ACTIONS = {
  'deep-breath': requestDeepBreath, // 次の呼吸サイクルを深呼吸に(発動まで最大 ~10s)
  gaze: triggerGaze, // 視線イベントを即時発火
}

// ---------------------------------------------------------------------------
// GET/PUT /emotion・POST /emotion/{touch,scenario}・GET /emotion/scenarios
// (v1.2.0 E1 — 感情 2 次元エンジン)。
//
// クロスモジュールな複合アクション(視線バースト・startle 流用・鳴き声トリガ)は
// emotion.js に持たせず、既存の LIVE_ACTIONS と同じ「dev-server がオーケストレーション
// する」形にする(emotion.js が breath/liveliness・breath/reactions を import すると
// それらが emotion.js を import し返す循環 import になるため — この層で合成する)。
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { id: 1, name: 'ごきげん' },
  { id: 2, name: 'はしゃぎ疲れ' },
  { id: 3, name: 'まどろみ' },
  { id: 4, name: '寝起きの微覚醒' },
  { id: 5, name: '不機嫌' },
  { id: 6, name: '疑心暗鬼' },
  { id: 7, name: '驚きの色分け' },
  { id: 8, name: '好奇心' },
  { id: 9, name: '退屈' },
  { id: 10, name: '退屈の自己刺激' },
  { id: 11, name: 'かまってもらえた' },
  { id: 12, name: '触られすぎ' },
  { id: 13, name: '萎縮' },
  { id: 14, name: 'にぎやかな部屋' },
  { id: 15, name: '静かな作業部屋' },
  { id: 16, name: '朝の立ち上がり' },
  { id: 17, name: '夜更け' },
  { id: 18, name: '機嫌の回復儀式' },
  { id: 19, name: 'いじけ' },
  { id: 20, name: '場の共鳴' },
]

let lastScenario = null // { id, name, t } — GET /emotion の scenarioLast

function touchBurst(count, intervalMs) {
  for (let i = 0; i < count; i++) {
    Timer.set(() => {
      try {
        pushTouch()
      } catch (error) {
        trace(`[dev] scenario touch burst failed: ${error}\n`)
      }
    }, i * intervalMs)
  }
}

function gazeBurst(count, intervalMs) {
  for (let i = 0; i < count; i++) {
    Timer.set(() => {
      try {
        triggerGaze()
      } catch (error) {
        trace(`[dev] scenario gaze burst failed: ${error}\n`)
      }
    }, i * intervalMs)
  }
}

/**
 * docs/tasks/emotion-space-scenarios.md のシナリオ 20 表に対応するデモ実行。
 * 実際の質感確認はユーザーに委ねる(合格ラインはクラッシュ・再起動がないこと)。
 * 未知の id は false を返す(呼び出し側で 400 にする)。
 */
function runScenario(id) {
  switch (id) {
    case 1:
      setEmotionState(0.7, 0.3)
      return true
    case 2:
      setEmotionState(0.8, 0.9) // 以後は自然減衰(このメソッドは何もしない)を観察する
      return true
    case 3:
      setEmotionState(0.4, -0.7)
      return true
    case 4:
      setEmotionState(0.3, -0.8)
      Timer.set(() => triggerSleepFlutter(), 800)
      return true
    case 5:
      setEmotionState(-0.6, -0.1)
      return true
    case 6:
      setEmotionState(-0.6, 0.5)
      return true
    case 7:
      triggerStartle() // 状態はそのまま(reactions の startle を流用)
      return true
    case 8:
      setEmotionState(0.3, 0.4)
      triggerGaze()
      deferGaze(3000) // 長い注視(次の gaze スケジューラを 3 秒抑止)
      return true
    case 9:
      setEmotionState(-0.2, -0.5)
      return true
    case 10:
      gazeBurst(3, 1000) // キョロキョロバースト
      Timer.set(() => {
        try {
          playCry('murmur')
        } catch (error) {
          trace(`[dev] scenario10 murmur failed: ${error}\n`)
        }
      }, 500)
      return true
    case 11:
      pushTouch()
      return true
    case 12:
      touchBurst(5, 150) // 短時間の連続タッチ(触られすぎ)
      return true
    case 13:
      setEmotionState(-0.5, -0.4)
      return true
    case 14:
      setEmotionState(0.3, 0.1)
      forceVoiceActive(30000) // voiceActive 相当を 30 秒維持
      return true
    case 15:
      setEmotionState(0.2, -0.5)
      return true
    case 16:
      setEmotionState(0, -0.6)
      return true
    case 17:
      setEmotionState(0.1, 0)
      forceNightMode(600000) // 夜間クランプを 10 分間強制
      return true
    case 18:
      triggerGaze() // 様子を見る一瞥
      Timer.set(() => {
        try {
          const emo = getEmotion()
          setEmotionState(Math.min(1, emo.v + 0.35), emo.a) // smile 一瞬(v を短時間ブースト)
          triggerRecoveryBoost(8000, 4) // ベースラインへ加速回帰
        } catch (error) {
          trace(`[dev] scenario18 recovery step failed: ${error}\n`)
        }
      }, 1000)
      return true
    case 19:
      setEmotionState(-0.8, -0.5)
      return true
    case 20:
      startValenceDrift(0.002, 300000) // v ドリフト +0.02/10s を 5 分
      return true
    default:
      return false
  }
}

function buildEmotionPayload() {
  return { ...getEmotion(), scenarioLast: lastScenario }
}

/** GET /emotion。本体は小さい JSON なので溜めずにその場で組み立てる(statusRoute と同型)。 */
const emotionRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    try {
      this.status = 200
      this.data = ArrayBuffer.fromString(JSON.stringify(buildEmotionPayload()))
    } catch (error) {
      trace(`[dev] emotion build failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。body は想定しないが読み切ってハングを避ける。
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
    trace(`[dev] emotion connection error: ${message}\n`)
  },
}

/** PUT /emotion/state(要 x-dev-token)。body `{"v":0.5,"a":-0.3}`(cryRecipesRoute の PUT 分岐と同型)。 */
const emotionStateRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []
    if ('PUT' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] emotion state rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion state read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const emo = setEmotionState(body?.v, body?.a)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, emotion: emo }))
      } catch (error) {
        trace(`[dev] emotion state update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] emotion state connection error: ${message}\n`)
  },
}

/** GET /emotion/params・PUT /emotion/params(要 x-dev-token)。paramsRoute と同型。 */
const emotionParamsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('GET' === request.method) {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getEmotionParams()))
      } catch (error) {
        trace(`[dev] emotion params build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] emotion params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setEmotionParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] emotion params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] emotion params connection error: ${message}\n`)
  },
}

/** POST /emotion/touch(要 x-dev-token)。物理タッチ配線なしの代替(シナリオ11/12)。 */
const emotionTouchRoute = {
  onRequest(request) {
    this.sent = 0
    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] emotion touch rejected: bad or missing x-dev-token\n')
      return
    }
    try {
      const ok = pushTouch()
      this.status = ok ? 200 : 503
      this.data = ArrayBuffer.fromString(JSON.stringify({ ok, emotion: getEmotion() }))
    } catch (error) {
      trace(`[dev] emotion touch failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。
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
    trace(`[dev] emotion touch connection error: ${message}\n`)
  },
}

/** POST /emotion/scenario(要 x-dev-token)。body `{"id": 1}`。GET /emotion/scenarios で一覧。 */
const emotionScenarioRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []
    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] emotion scenario rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion scenario read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const id = Number(body?.id)
        const entry = SCENARIOS.find((s) => s.id === id)
        const ok = entry ? runScenario(id) : false
        if (ok) lastScenario = { id, name: entry.name, t: Time.ticks }
        this.status = ok ? 200 : 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok, id, name: entry?.name }))
        trace(`[dev] emotion scenario ${id} (${entry?.name ?? 'unknown'}) -> ${ok ? 'ok' : 'failed'}\n`)
      } catch (error) {
        trace(`[dev] emotion scenario failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] emotion scenario connection error: ${message}\n`)
  },
}

/** GET /emotion/scenarios。id と名前の一覧。 */
const emotionScenariosRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    this.status = 200
    this.data = ArrayBuffer.fromString(JSON.stringify({ scenarios: SCENARIOS }))
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。
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
    trace(`[dev] emotion scenarios connection error: ${message}\n`)
  },
}

/**
 * GET /led。現在色・テスト中フラグ・params(v1.2.0 E2 — ヘッド LED の環境光)。
 * 本体は小さい JSON なので溜めずにその場で組み立てる(statusRoute/reactRoute と同型)。
 */
const ledRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    try {
      this.status = 200
      this.data = ArrayBuffer.fromString(JSON.stringify(getLedStatus()))
    } catch (error) {
      trace(`[dev] led status build failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。body は想定しないが読み切ってハングを避ける。
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
    trace(`[dev] led connection error: ${message}\n`)
  },
}

/** PUT /led/params(要 x-dev-token)。部分更新(micParamsRoute/reactParamsRoute と同型)。 */
const ledParamsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] led params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setLedParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] led params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] led params connection error: ${message}\n`)
  },
}

/**
 * POST /led/test(要 x-dev-token)。body `{"r":255,"g":0,"b":0,"ms":1000}` で直接点灯
 * テスト(reactStartleRoute と同型)。
 */
const ledTestRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] led test rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200 // 本文を読み終えてから onResponse で確定する
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led test read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const ok = testLed(body?.r, body?.g, body?.b, body?.ms)
        this.status = ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok }))
      } catch (error) {
        trace(`[dev] led test failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] led test connection error: ${message}\n`)
  },
}

/**
 * POST /led/set(要 x-dev-token)。body `{"index":0..11,"r":..,"g":..,"b":..,"ms":2000}`
 * で単一 LED を生の物理 index で点灯(v1.2.1 E2.1 — 物理配置の目視特定用。
 * ledTestRoute と同型)。
 */
const ledSetRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] led set rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200 // 本文を読み終えてから onResponse で確定する
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led set read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const ok = setLedSingle(body?.index, body?.r, body?.g, body?.b, body?.ms)
        this.status = ok ? 200 : 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok }))
      } catch (error) {
        trace(`[dev] led set failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] led set connection error: ${message}\n`)
  },
}

/**
 * POST /led/sweep(要 x-dev-token)。body `{"ms":800}`(省略可 — 空ボディは既定値)。
 * index 0→11 を順に 1 個ずつ白点灯するデモ(v1.2.1 E2.1 — 物理配置の目視特定用)。
 * レスポンスは `{ok, totalMs}`。
 */
const ledSweepRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] led sweep rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200 // 本文を読み終えてから onResponse で確定する
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led sweep read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = total > 0 ? JSON.parse(String.fromArrayBuffer(merged.buffer)) : {}
        const totalMs = startLedSweep(body?.ms)
        const ok = totalMs > 0
        this.status = ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok, totalMs }))
      } catch (error) {
        trace(`[dev] led sweep failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] led sweep connection error: ${message}\n`)
  },
}

/**
 * GET /posture(v1.3.0 E3 — サーボ解禁 + 感情姿勢)。現在パラメータ + 状態
 * (currentPitchDeg・moveInProgress・hasPoseApi・lastMoveAgoS)。reactRoute と同型。
 */
const postureRoute = {
  onRequest(request) {
    this.sent = 0
    if ('GET' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    try {
      this.status = 200
      this.data = ArrayBuffer.fromString(JSON.stringify(getPostureStatus()))
    } catch (error) {
      trace(`[dev] posture status build failed: ${error}\n`)
      this.status = 500
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    try {
      this.read(count)
    } catch (_error) {
      // 握りつぶす。body は想定しないが読み切ってハングを避ける。
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
    trace(`[dev] posture connection error: ${message}\n`)
  },
}

/** PUT /posture/params(要 x-dev-token)。部分更新(reactParamsRoute と同型)。 */
const postureParamsRoute = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if ('PUT' === request.method) {
      if (!isAuthorized(request)) {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] posture params rejected: bad or missing x-dev-token\n')
      } else {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] posture params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if ('PUT' === this.method && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if ('PUT' === this.method && 200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const params = setPostureParams(body)
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: true, params }))
      } catch (error) {
        trace(`[dev] posture params update failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] posture params connection error: ${message}\n`)
  },
}

/**
 * POST /posture/test(要 x-dev-token)。body `{"yawDeg":0,"pitchDeg":15,"time":1.0}` で
 * レート制限を無視した直接姿勢テスト(reactStartleRoute/ledTestRoute と同型)。
 */
const postureTestRoute = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if ('POST' !== request.method) {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
      return
    }
    if (!isAuthorized(request)) {
      this.status = 401
      this.data = ArrayBuffer.fromString('')
      trace('[dev] posture test rejected: bad or missing x-dev-token\n')
      return
    }
    this.status = 200 // 本文を読み終えてから onResponse で確定する
  },
  onReadable(count) {
    let bytes
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] posture test read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (200 === this.status && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (200 === this.status) {
      try {
        let total = 0
        for (const chunk of this.chunks) total += chunk.byteLength
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(new Uint8Array(chunk), offset)
          offset += chunk.byteLength
        }
        const body = JSON.parse(String.fromArrayBuffer(merged.buffer))
        const ok = testPosture(body?.yawDeg, body?.pitchDeg, body?.time)
        this.status = ok ? 200 : 503
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok }))
      } catch (error) {
        trace(`[dev] posture test failed: ${error}\n`)
        this.status = 400
        this.data = ArrayBuffer.fromString(JSON.stringify({ ok: false, error: String(error) }))
      }
    }
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
    trace(`[dev] posture test connection error: ${message}\n`)
  },
}

const router = new Map([
  ['/status', statusRoute],
  ['/ota', otaRoute],
  ['/cry/recipes', cryRecipesRoute],
  ['/params', paramsRoute],
  ['/mic', micRoute],
  ['/mic/params', micParamsRoute],
  ['/react', reactRoute],
  ['/react/params', reactParamsRoute],
  ['/react/startle', reactStartleRoute],
  ['/emotion', emotionRoute],
  ['/emotion/state', emotionStateRoute],
  ['/emotion/params', emotionParamsRoute],
  ['/emotion/touch', emotionTouchRoute],
  ['/emotion/scenario', emotionScenarioRoute],
  ['/emotion/scenarios', emotionScenariosRoute],
  ['/led', ledRoute],
  ['/led/params', ledParamsRoute],
  ['/led/test', ledTestRoute],
  ['/led/set', ledSetRoute],
  ['/led/sweep', ledSweepRoute],
  ['/posture', postureRoute],
  ['/posture/params', postureParamsRoute],
  ['/posture/test', postureTestRoute],
])

const CRY_PLAY_PREFIX = '/cry/'
const LIVE_ACTION_PREFIX = '/live/'

function resolveRoute(path) {
  if (router.has(path)) return router.get(path)
  if (path.startsWith(CRY_PLAY_PREFIX)) {
    const name = path.slice(CRY_PLAY_PREFIX.length)
    if (CRY_NAMES.includes(name)) return makeCryPlayRoute(name)
  }
  if (path.startsWith(LIVE_ACTION_PREFIX)) {
    const name = path.slice(LIVE_ACTION_PREFIX.length)
    if (name in LIVE_ACTIONS) return makeLiveActionRoute(name, LIVE_ACTIONS[name])
  }
  return notFound
}

function startHttpServer(port) {
  new HTTPServer({
    io: Listener,
    port,
    onConnect(connection) {
      connection.accept({
        onRequest(request) {
          this.route = resolveRoute(request.path)
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
