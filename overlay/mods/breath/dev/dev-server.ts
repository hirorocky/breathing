import Listener from 'embedded:io/socket/listener'
import type { HTTPConnection, HTTPConnectionHandlers, HTTPRequest, HTTPResponse } from 'embedded:network/http/server'
import HttpServer from 'embedded:network/http/server'
import WebPage from 'embedded:network/http/server/options/webpage'
import type { Flash } from 'embedded:storage/flash'
import flash from 'embedded:storage/flash'
import type { Updater } from 'embedded:update'
import OTA from 'embedded:update'
import type { CryName } from 'breath/cry'
import { CRY_NAMES, getRecipes, playCry, setRecipes } from 'breath/cry'
import {
  forceNightMode,
  forceVoiceActive,
  getEmotion,
  getEmotionParams,
  pushTouch,
  setEmotionParams,
  setEmotionState,
  startValenceDrift,
  triggerRecoveryBoost,
  triggerSleepFlutter,
} from 'breath/emotion'
import { getLedStatus, setLedParams, setLedSingle, startLedSweep, testLed } from 'breath/led'
import { deferGaze, getParams, requestDeepBreath, setParams, triggerGaze } from 'breath/liveliness'
import { getMicStatus, setMicParams } from 'breath/mic'
import { getPostureStatus, setPostureParams, testPosture } from 'breath/posture'
import { getReactParams, setReactParams, triggerStartle } from 'breath/reactions'
import {
  BREATH_POLICY_API_VERSION,
  BREATH_POLICY_HOST_API_VERSION,
  BREATH_POLICY_SCHEMA_VERSION,
  setBreathPolicyDisabled,
} from 'breath-policy-loader'
import { readBatterySample } from 'm5stackchan/battery'
import config from 'mc/config'
import FFI from 'mc/ffi'
import MDNS from 'mdns'
import Net from 'net'
import Time from 'time'
import Timer from 'timer'

const breathConfig = config as typeof config & { buildId?: string; devToken?: string }

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
const OTA_PROGRESS_BYTES = 1024 * 1024
const POLICY_HEADER_BYTES = 8
const POLICY_CANDIDATE_OFFSET = 0x15000
const POLICY_MAX_BYTES = 0x14000
const POLICY_MARKER_OFFSET = POLICY_CANDIDATE_OFFSET + POLICY_MAX_BYTES
const POLICY_BUILD_ID_MAX_LENGTH = 128
const POLICY_API_HEADER = 'x-policy-api-version'
const POLICY_MIN_HOST_API_HEADER = 'x-policy-min-host-api-version'
const POLICY_MAX_HOST_API_HEADER = 'x-policy-max-host-api-version'
const POLICY_SCHEMA_HEADER = 'x-policy-schema-version'
const POLICY_BUILD_ID_HEADER = 'x-policy-build-id'

const Natives = new FFI() as unknown as { esp_restart(): void }

type BreathGlobal = typeof globalThis & {
  screen?: { touch?: unknown }
  breathBootError?: string
  breathBootId?: string
  breathBootStartedAt?: number
  breathPreviousBootCompleted?: boolean
  breathLastHeartbeatMs?: number
  breathDevHealthy?: boolean
  breathDeployNoticeScheduled?: boolean
  breathDeployNoticeShown?: boolean
  breathDeployNoticeError?: string
  breathPolicyState?: string
  breathPolicyHostApiVersion?: number
  breathPolicyBuildId?: string
  breathPolicyLastError?: string
  breathDbgGazeL?: number
  breathDbgGazeR?: number
  breathStatusSwipeBounds?: unknown
  breathSettingsSwipeBounds?: unknown
  breathStatusTouchCount?: number
  breathSettingsTouchCount?: number
  breathStatusLastDy?: number
  breathSettingsLastDy?: number
  breathStatusBarOpen?: boolean
  breathSettingsBarOpen?: boolean
  breathStatusShowCount?: number
  breathSettingsShowCount?: number
  breathSettingsAttachError?: string
  breathPowerRawState?: unknown
  breathPowerRawEventCount?: number
  breathPowerLastKeyState?: unknown
  breathPowerOnSource?: unknown
  breathIntentionalOff?: boolean
}

const breathGlobal = globalThis as BreathGlobal

interface DevConnection extends HTTPConnection {
  byteLength: number
  bytesReceived: number
  bytesWritten: number
  chunks: ArrayBuffer[]
  data: ArrayBuffer
  maxReadBytes: number
  method: string
  minReadBytes: number
  nextProgressBytes: number
  otaStartedAt: number
  readCalls: number
  sent: number
  status: number
  updater: Updater | null
  writeCalls: number
  writeMs: number
  policyFlash: Flash | null
  policyHeader: Uint8Array
  policyHeaderBytes: number
  policyBuildId: string
}

interface Route {
  onRequest?(this: DevConnection, request: HTTPRequest): void
  onReadable?(this: DevConnection, count: number): void
  onResponse?(this: DevConnection, response: HTTPResponse): void
  onWritable?(this: DevConnection, count: number): void
  onError?(this: DevConnection, message?: unknown): void
}

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
    buildId: breathConfig.buildId ?? 'unknown',
    bootError: breathGlobal.breathBootError ?? null,
    boot: {
      id: breathGlobal.breathBootId ?? null,
      startedAtMs: breathGlobal.breathBootStartedAt ?? null,
      healthy: breathGlobal.breathDevHealthy ?? false,
      lastHeartbeatMs: breathGlobal.breathLastHeartbeatMs ?? null,
      previousCompleted: breathGlobal.breathPreviousBootCompleted ?? null,
      deployNotice: {
        scheduled: breathGlobal.breathDeployNoticeScheduled ?? false,
        shown: breathGlobal.breathDeployNoticeShown ?? false,
        error: breathGlobal.breathDeployNoticeError ?? null,
      },
    },
    policy: {
      state: breathGlobal.breathPolicyState ?? 'builtin',
      hostApiVersion: breathGlobal.breathPolicyHostApiVersion ?? 1,
      modBuildId: breathGlobal.breathPolicyBuildId ?? null,
      lastError: breathGlobal.breathPolicyLastError ?? null,
    },
    ip: safeIp(),
    battery: safeBattery(),
    uptimeMs: Time.ticks,
    // デバッグ計器(eye-cozmo が毎フレーム書く描画オフセット px。一瞥の符号バグ調査 2026-07-07)
    dbgGaze: { l: breathGlobal.breathDbgGazeL ?? null, r: breathGlobal.breathDbgGazeR ?? null },
    touchDebug: {
      screenTouch: Boolean(breathGlobal.screen?.touch),
      statusBounds: breathGlobal.breathStatusSwipeBounds ?? null,
      settingsBounds: breathGlobal.breathSettingsSwipeBounds ?? null,
      statusTouches: breathGlobal.breathStatusTouchCount ?? 0,
      settingsTouches: breathGlobal.breathSettingsTouchCount ?? 0,
      statusLastDy: breathGlobal.breathStatusLastDy ?? null,
      settingsLastDy: breathGlobal.breathSettingsLastDy ?? null,
      statusOpen: breathGlobal.breathStatusBarOpen ?? false,
      settingsOpen: breathGlobal.breathSettingsBarOpen ?? false,
      statusShows: breathGlobal.breathStatusShowCount ?? 0,
      settingsShows: breathGlobal.breathSettingsShowCount ?? 0,
      settingsAttachError: breathGlobal.breathSettingsAttachError ?? null,
      powerRawState: breathGlobal.breathPowerRawState ?? null,
      powerRawEvents: breathGlobal.breathPowerRawEventCount ?? 0,
      powerLastKeyState: breathGlobal.breathPowerLastKeyState ?? null,
      powerOnSource: breathGlobal.breathPowerOnSource ?? null,
      intentionalOff: breathGlobal.breathIntentionalOff ?? null,
    },
  }
}

function isAuthorized(request: HTTPRequest): boolean {
  const token = request.headers.get('x-dev-token')
  return !!breathConfig.devToken && token === breathConfig.devToken
}

const notFound = {
  ...WebPage,
  data: ArrayBuffer.fromString('Not Found\n'),
}

/** GET /status。ボディは毎リクエストその場で組み立てる（route ではなく connection に持たせる）。 */
const statusRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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

function writeOtaChunk(connection: DevConnection, bytes: ArrayBuffer): void {
  const startedAt = Time.ticks
  const updater = connection.updater
  if (!updater) return
  updater.write(bytes)
  connection.writeMs += Time.ticks - startedAt
  connection.writeCalls++
  connection.bytesWritten += bytes.byteLength
}

/** PUT /ota。受信チャンクをその場で OTA パーティションへ書き込む。 */
const otaRoute: Route = {
  onRequest(request) {
    this.bytesReceived = 0
    this.bytesWritten = 0
    this.byteLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
    this.nextProgressBytes = OTA_PROGRESS_BYTES
    this.updater = null
    this.readCalls = 0
    this.writeCalls = 0
    this.writeMs = 0
    this.minReadBytes = Number.MAX_SAFE_INTEGER
    this.maxReadBytes = 0
    this.otaStartedAt = Time.ticks

    if (!isAuthorized(request)) {
      this.status = 401
      trace('[dev] ota rejected: bad or missing x-dev-token\n')
      return
    }
    if (request.method !== 'PUT') {
      this.status = 405
      return
    }
    if (!Number.isFinite(this.byteLength) || this.byteLength <= 0) {
      this.status = 411
      trace('[dev] ota rejected: valid content-length required\n')
      return
    }
    try {
      this.status = 200
      this.updater = OTA.open({ partition: flash.open({ path: 'nextota' }) })
      trace(`[dev] ota open: ${this.byteLength} bytes\n`)
    } catch (error) {
      trace(`[dev] ota open failed: ${error}\n`)
      this.status = 500
      this.updater = null
    }
  },
  onReadable(_count) {
    // 認証/オープン失敗時も含め、必ず読み切って state machine を進める
    // （読まないと HTTP レスポンスに進めず接続がハングする）。
    let bytes: ArrayBuffer | undefined
    try {
      // HTTPServer の公式 OTA 例と同じく、通知された count を socket read の
      // 引数にせず、HTTP body として現在読めるチャンクを取得する。
      bytes = this.read()
    } catch (error) {
      trace(`[dev] ota read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status !== 200 || !this.updater || !bytes) return
    try {
      this.readCalls++
      this.minReadBytes = Math.min(this.minReadBytes, bytes.byteLength)
      this.maxReadBytes = Math.max(this.maxReadBytes, bytes.byteLength)
      writeOtaChunk(this, bytes)
      this.bytesReceived += bytes.byteLength
      if (this.bytesReceived >= this.nextProgressBytes) {
        trace(`[dev] ota progress: ${this.bytesReceived}/${this.byteLength}\n`)
        this.nextProgressBytes += OTA_PROGRESS_BYTES
      }
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
    if (this.status === 200 && this.bytesReceived !== this.byteLength) {
      trace(`[dev] ota size mismatch: ${this.bytesReceived}/${this.byteLength}\n`)
      this.status = 400
    }

    if (this.status === 200 && this.updater) {
      try {
        this.updater.complete()
        this.updater.close()
        this.updater = null
        trace(`[dev] ota complete: ${this.bytesReceived} bytes, restarting in ${RESTART_DELAY_MS}ms\n`)
        Timer.set(() => Natives.esp_restart(), RESTART_DELAY_MS)
      } catch (error) {
        trace(`[dev] ota complete failed: ${error}\n`)
        this.status = 500
        try {
          this.updater?.close()
        } catch (_closeError) {
          // 握りつぶす。abort させない。
        }
        this.updater = null
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
    const elapsedMs = Time.ticks - this.otaStartedAt
    const minReadBytes = this.readCalls ? this.minReadBytes : 0
    trace(
      `[dev] ota metrics: elapsed=${elapsedMs}ms readCalls=${this.readCalls} readBytes=${minReadBytes}..${this.maxReadBytes} writeCalls=${this.writeCalls} writeMs=${this.writeMs} bytesWritten=${this.bytesWritten}\n`,
    )
    response.status = this.status
    response.headers.set('content-length', 0)
    response.headers.set('x-ota-elapsed-ms', elapsedMs)
    response.headers.set('x-ota-read-calls', this.readCalls)
    response.headers.set('x-ota-read-bytes', `${minReadBytes}-${this.maxReadBytes}`)
    response.headers.set('x-ota-write-calls', this.writeCalls)
    response.headers.set('x-ota-write-ms', this.writeMs)
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

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  )
}

function closePolicyFlash(connection: DevConnection): void {
  try {
    connection.policyFlash?.close()
  } catch (_error) {
    // Flash close failure must not abort the HTTP state machine.
  }
  connection.policyFlash = null
}

function preparePolicyFlash(connection: DevConnection): void {
  const header = connection.policyHeader
  const declaredSize = readUint32BE(header, 0)
  const hasSignature =
    header[4] === 'X'.charCodeAt(0) &&
    header[5] === 'S'.charCodeAt(0) &&
    header[6] === '_'.charCodeAt(0) &&
    header[7] === 'A'.charCodeAt(0)
  if (!hasSignature || declaredSize !== connection.byteLength || declaredSize < POLICY_HEADER_BYTES)
    throw new RangeError('invalid XS_A header or declared size')

  const partition = flash.open({ path: 'xs', mode: 'r+' })
  connection.policyFlash = partition
  const status = partition.status()
  if (declaredSize > POLICY_MAX_BYTES || POLICY_MARKER_OFFSET + 0x1000 > status.size) {
    throw new RangeError(`policy archive too large: ${declaredSize}/${POLICY_MAX_BYTES}`)
  }
  const eraseBlocks = Math.ceil(POLICY_MAX_BYTES / status.blockLength)
  partition.eraseBlock(POLICY_CANDIDATE_OFFSET / status.blockLength, eraseBlocks)
  connection.bytesWritten = 0
}

function verifyPolicyHeader(connection: DevConnection): void {
  const actual = new Uint8Array(
    connection.policyFlash?.read(POLICY_HEADER_BYTES, POLICY_CANDIDATE_OFFSET) ?? new ArrayBuffer(0),
  )
  if (actual.byteLength !== POLICY_HEADER_BYTES) throw new Error('policy header read-back failed')
  for (let index = 0; index < POLICY_HEADER_BYTES; index++) {
    if (actual[index] !== connection.policyHeader[index]) throw new Error('policy header read-back mismatch')
  }
}

function writeAndVerifyPolicyBody(connection: DevConnection, bytes: Uint8Array): void {
  const partition = connection.policyFlash
  if (!partition) throw new Error('policy flash is not open')
  const offset = POLICY_CANDIDATE_OFFSET + POLICY_HEADER_BYTES + connection.bytesWritten
  partition.write(bytes, offset)
  const actual = new Uint8Array(partition.read(bytes.byteLength, offset))
  if (actual.byteLength !== bytes.byteLength) throw new Error('policy body read-back failed')
  for (let index = 0; index < bytes.byteLength; index++) {
    if (actual[index] !== bytes[index]) throw new Error(`policy body read-back mismatch at ${offset + index}`)
  }
  connection.bytesWritten += bytes.byteLength
}

function invalidatePolicyArchive(connection: DevConnection): void {
  try {
    const status = connection.policyFlash?.status()
    if (status)
      connection.policyFlash?.eraseBlock(
        POLICY_CANDIDATE_OFFSET / status.blockLength,
        Math.ceil(POLICY_MAX_BYTES / status.blockLength),
      )
  } catch (_error) {
    // The disabled preference remains set even if invalidation itself fails.
  }
}

function writePolicyActivationMarker(connection: DevConnection): void {
  const partition = connection.policyFlash
  if (!partition) throw new Error('policy flash is not open')
  const status = partition.status()
  partition.eraseBlock(POLICY_MARKER_OFFSET / status.blockLength)
  const marker = new Uint8Array(256)
  marker.fill(0xff)
  marker.set([0x42, 0x50, 0x43, 0x31])
  const build = ArrayBuffer.fromString(connection.policyBuildId)
  marker.set(new Uint8Array(build).subarray(0, 128), 4)
  partition.write(marker, POLICY_MARKER_OFFSET)
}

/** Authenticated raw XSA install/disable. Failed and interrupted writes remain disabled. */
const policyRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.status = 200
    this.byteLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
    this.bytesReceived = 0
    this.bytesWritten = 0
    this.policyFlash = null
    this.policyHeader = new Uint8Array(POLICY_HEADER_BYTES)
    this.policyHeaderBytes = 0
    this.policyBuildId = ''

    if (!isAuthorized(request)) {
      this.status = 401
      trace('[dev] policy rejected: bad or missing x-dev-token\n')
      return
    }
    if (request.method !== 'PUT' && request.method !== 'DELETE') {
      this.status = 405
      return
    }

    if (request.method === 'DELETE') return
    if (breathGlobal.breathPolicyState !== 'disabled') {
      this.status = 409
      trace('[dev] policy update rejected: disable and reboot before replacing the archive\n')
      return
    }

    const apiVersion = Number.parseInt(request.headers.get(POLICY_API_HEADER) ?? '', 10)
    const minHostApiVersion = Number.parseInt(request.headers.get(POLICY_MIN_HOST_API_HEADER) ?? '', 10)
    const maxHostApiVersion = Number.parseInt(request.headers.get(POLICY_MAX_HOST_API_HEADER) ?? '', 10)
    const schemaVersion = Number.parseInt(request.headers.get(POLICY_SCHEMA_HEADER) ?? '', 10)
    const buildId = request.headers.get(POLICY_BUILD_ID_HEADER) ?? ''
    if (
      apiVersion !== BREATH_POLICY_API_VERSION ||
      schemaVersion !== BREATH_POLICY_SCHEMA_VERSION ||
      !Number.isInteger(minHostApiVersion) ||
      !Number.isInteger(maxHostApiVersion) ||
      minHostApiVersion < 1 ||
      minHostApiVersion > maxHostApiVersion ||
      minHostApiVersion > BREATH_POLICY_HOST_API_VERSION ||
      maxHostApiVersion < BREATH_POLICY_HOST_API_VERSION
    ) {
      this.status = 409
      trace(
        `[dev] policy incompatible: api=${apiVersion} schema=${schemaVersion} host=${minHostApiVersion}..${maxHostApiVersion}\n`,
      )
      return
    }
    if (!buildId || buildId.length > POLICY_BUILD_ID_MAX_LENGTH) {
      this.status = 400
      trace(`[dev] policy rejected: api=${apiVersion} schema=${schemaVersion} build=${buildId}\n`)
      return
    }
    if (!Number.isFinite(this.byteLength) || this.byteLength < POLICY_HEADER_BYTES) {
      this.status = 411
      trace('[dev] policy rejected: valid content-length required\n')
      return
    }
    this.policyBuildId = buildId
  },
  onReadable(_count) {
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read()
    } catch (error) {
      this.status = 500
      trace(`[dev] policy read failed: ${error}\n`)
      return
    }
    if (!bytes) return
    this.bytesReceived += bytes.byteLength
    if (this.method !== 'PUT' || this.status !== 200) return
    if (this.bytesReceived > this.byteLength) {
      this.status = 400
      closePolicyFlash(this)
      trace(`[dev] policy body exceeds content-length: ${this.bytesReceived}/${this.byteLength}\n`)
      return
    }

    const chunk = new Uint8Array(bytes)
    let chunkOffset = 0
    try {
      if (!this.policyFlash) {
        const needed = POLICY_HEADER_BYTES - this.policyHeaderBytes
        const take = Math.min(needed, chunk.byteLength)
        this.policyHeader.set(chunk.subarray(0, take), this.policyHeaderBytes)
        this.policyHeaderBytes += take
        chunkOffset = take
        if (this.policyHeaderBytes < POLICY_HEADER_BYTES) return
        preparePolicyFlash(this)
      }
      if (chunkOffset < chunk.byteLength) {
        const remainder = chunk.subarray(chunkOffset)
        writeAndVerifyPolicyBody(this, remainder)
      }
    } catch (error) {
      this.status = error instanceof RangeError ? 400 : 500
      closePolicyFlash(this)
      trace(`[dev] policy write failed: ${error}\n`)
    }
  },
  onResponse(response) {
    if (this.method === 'DELETE' && this.status === 200) {
      try {
        setBreathPolicyDisabled(true)
        this.status = 202
        trace('[dev] policy disabled, restarting\n')
        Timer.set(() => Natives.esp_restart(), RESTART_DELAY_MS)
      } catch (error) {
        this.status = 500
        trace(`[dev] policy disable failed: ${error}\n`)
      }
    } else if (this.method === 'PUT' && this.status === 200) {
      if (
        this.bytesReceived !== this.byteLength ||
        this.bytesWritten !== this.byteLength - POLICY_HEADER_BYTES ||
        this.policyHeaderBytes !== POLICY_HEADER_BYTES
      ) {
        this.status = 400
        trace(
          `[dev] policy size mismatch: received=${this.bytesReceived} written=${this.bytesWritten}/${this.byteLength}\n`,
        )
      } else {
        try {
          this.policyFlash?.write(this.policyHeader, POLICY_CANDIDATE_OFFSET)
          verifyPolicyHeader(this)
          writePolicyActivationMarker(this)
          setBreathPolicyDisabled(false)
          closePolicyFlash(this)
          this.status = 202
          trace(`[dev] policy installed build=${this.policyBuildId}, restarting\n`)
          Timer.set(() => Natives.esp_restart(), RESTART_DELAY_MS)
        } catch (error) {
          this.status = 500
          invalidatePolicyArchive(this)
          try {
            setBreathPolicyDisabled(true)
          } catch (_disableError) {
            // Already disabled at update start; keep processing the HTTP response.
          }
          trace(`[dev] policy enable failed: ${error}\n`)
        }
      }
    }

    if (this.status !== 200) closePolicyFlash(this)
    response.status = this.status
    response.headers.set('content-length', 0)
    if (this.policyBuildId) response.headers.set(POLICY_BUILD_ID_HEADER, this.policyBuildId)
    this.respond(response)
  },
  onError(message) {
    closePolicyFlash(this)
    trace(`[dev] policy connection error: ${message}\n`)
  },
}

/** GET /cry/recipes・PUT /cry/recipes（要 x-dev-token）。本体は小さい JSON なので溜めてから処理する。 */
const cryRecipesRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'GET') {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getRecipes()))
      } catch (error) {
        trace(`[dev] cry recipes build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] cry recipes rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める（otaRoute と同じ理由）。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] cry recipes read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const paramsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'GET') {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getParams()))
      } catch (error) {
        trace(`[dev] params build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const micRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'GET') {
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

const micParamsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] mic params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める（otaRoute と同じ理由）。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] mic params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const reactRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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
const reactParamsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] react params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] react params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const reactStartleRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] react startle read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
      try {
        let dir: number | undefined
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
            const body = JSON.parse(text) as unknown
            if (typeof body === 'object' && body !== null && 'dir' in body && typeof body.dir === 'number')
              dir = body.dir
          }
        }
        const ok = triggerStartle(dir ?? null)
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
function makeCryPlayRoute(name: string): Route {
  return {
    onRequest(request) {
      this.sent = 0
      if (request.method !== 'POST') {
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
function makeLiveActionRoute(name: string, action: () => boolean): Route {
  return {
    onRequest(request) {
      this.sent = 0
      if (request.method !== 'POST') {
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

let lastScenario: { id: number; name: string; t: number } | null = null // GET /emotion の scenarioLast

function touchBurst(count: number, intervalMs: number): void {
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

function gazeBurst(count: number, intervalMs: number): void {
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
function runScenario(id: number): boolean {
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
      ;(triggerStartle as (direction?: number) => void)() // 状態はそのまま(reactions の startle を流用)
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
      forceVoiceActive(30_000) // voiceActive 相当を 30 秒維持
      return true
    case 15:
      setEmotionState(0.2, -0.5)
      return true
    case 16:
      setEmotionState(0, -0.6)
      return true
    case 17:
      setEmotionState(0.1, 0)
      forceNightMode(600_000) // 夜間クランプを 10 分間強制
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
      startValenceDrift(0.002, 300_000) // v ドリフト +0.02/10s を 5 分
      return true
    default:
      return false
  }
}

function buildEmotionPayload() {
  return { ...getEmotion(), scenarioLast: lastScenario }
}

/** GET /emotion。本体は小さい JSON なので溜めずにその場で組み立てる(statusRoute と同型)。 */
const emotionRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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
const emotionStateRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []
    if (request.method !== 'PUT') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion state read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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
const emotionParamsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'GET') {
      try {
        this.status = 200
        this.data = ArrayBuffer.fromString(JSON.stringify(getEmotionParams()))
      } catch (error) {
        trace(`[dev] emotion params build failed: ${error}\n`)
        this.status = 500
        this.data = ArrayBuffer.fromString('')
      }
    } else if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] emotion params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const emotionTouchRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'POST') {
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
const emotionScenarioRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []
    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] emotion scenario read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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
        if (ok && entry) lastScenario = { id, name: entry.name, t: Time.ticks }
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
const emotionScenariosRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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
const ledRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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
const ledParamsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] led params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const ledTestRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led test read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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
const ledSetRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led set read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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
const ledSweepRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] led sweep read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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
const postureRoute: Route = {
  onRequest(request) {
    this.sent = 0
    if (request.method !== 'GET') {
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
const postureParamsRoute: Route = {
  onRequest(request) {
    this.method = request.method
    this.sent = 0
    this.chunks = []

    if (request.method === 'PUT') {
      if (isAuthorized(request)) {
        this.status = 200 // 本文を読み終えてから onResponse で確定する
      } else {
        this.status = 401
        this.data = ArrayBuffer.fromString('')
        trace('[dev] posture params rejected: bad or missing x-dev-token\n')
      }
    } else {
      this.status = 405
      this.data = ArrayBuffer.fromString('')
    }
  },
  onReadable(count) {
    // 認証失敗時も含め、必ず読み切って state machine を進める(otaRoute と同じ理由)。
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] posture params read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.method === 'PUT' && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.method === 'PUT' && this.status === 200) {
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
const postureTestRoute: Route = {
  onRequest(request) {
    this.sent = 0
    this.chunks = []

    if (request.method !== 'POST') {
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
    let bytes: ArrayBuffer | undefined
    try {
      bytes = this.read(count)
    } catch (error) {
      trace(`[dev] posture test read failed: ${error}\n`)
      this.status = 500
      return
    }
    if (this.status === 200 && bytes) this.chunks.push(bytes)
  },
  onResponse(response) {
    if (this.status === 200) {
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

const router = new Map<string, Route>([
  ['/status', statusRoute],
  ['/ota', otaRoute],
  ['/policy', policyRoute],
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

function isCryName(value: string): value is CryName {
  return (CRY_NAMES as readonly string[]).includes(value)
}

function isLiveAction(value: string): value is keyof typeof LIVE_ACTIONS {
  return value in LIVE_ACTIONS
}

function resolveRoute(path: string): Route {
  const exactRoute = router.get(path)
  if (exactRoute) return exactRoute
  if (path.startsWith(CRY_PLAY_PREFIX)) {
    const name = path.slice(CRY_PLAY_PREFIX.length)
    if (isCryName(name)) return makeCryPlayRoute(name)
  }
  if (path.startsWith(LIVE_ACTION_PREFIX)) {
    const name = path.slice(LIVE_ACTION_PREFIX.length)
    if (isLiveAction(name)) return makeLiveActionRoute(name, LIVE_ACTIONS[name])
  }
  return notFound
}

function startHttpServer(port: number): void {
  const server = new HttpServer({
    io: Listener,
    port,
    onConnect(connection) {
      connection.accept({
        onRequest(this: HTTPConnection, request: HTTPRequest) {
          this.route = resolveRoute(request.path) as unknown as HTTPConnectionHandlers
        },
        onError(this: HTTPConnection, message: unknown) {
          trace(`[dev] connection error before routing: ${message}\n`)
        },
      } as unknown as HTTPConnectionHandlers)
    },
  })
  void server
}

function startMdns(): void {
  try {
    const responder = new MDNS({ hostName: MDNS_HOST_NAME }, (message: number, value?: string) => {
      if ((MDNS as unknown as { hostName: number }).hostName === message && value) {
        trace(`[dev] mdns claimed ${value}.local\n`)
      }
    })
    void responder
  } catch (error) {
    trace(`[dev] mdns failed: ${error}\n`)
  }
}

/** GET /status・PUT /ota を公開し、mDNS で stackchan を名乗る。 */
export function startDevServer(): void {
  startHttpServer(HTTP_PORT)
  startMdns()
}
