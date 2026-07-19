declare module 'py32-io-expander' {
  export interface PY32IOExpander {
    setLedColor(index: number, r: number, g: number, b: number): void
    refreshLeds(): void
  }
  export function getSharedPY32IOExpander(): PY32IOExpander
}

declare module 'm5stackchan/battery' {
  export function getBacklightVoltage(): number | null
  export function setBacklightVoltage(mv: number): boolean
  export function readBatterySample(): { charging: boolean; pct: number } | null
  export function readPowerKeyState(): number | null
  export function readPowerOnSource(): number | null
  export function requestPowerOff(): boolean
}

declare module 'embedded:storage/flash' {
  export interface Flash {
    close(): void
    eraseBlock(startBlock: number, endBlock?: number): void
    read(byteLength: number, byteOffset: number): ArrayBuffer
    write(data: ArrayBuffer | ArrayBufferView, byteOffset: number): void
    status(): { size: number; blockLength: number; blocks: number }
  }
  const flash: {
    open(options: { path: string; mode?: 'r' | 'r+' }): Flash
  }
  export default flash
}

declare module 'embedded:network/http/server/options/webpage' {
  import type { HTTPConnectionHandlers } from 'embedded:network/http/server'

  const WebPage: HTTPConnectionHandlers
  export default WebPage
}

declare module 'breath-policy-loader' {
  export const BREATH_POLICY_API_VERSION: number
  export const BREATH_POLICY_HOST_API_VERSION: number
  export const BREATH_POLICY_SCHEMA_VERSION: number
  export function setBreathPolicyDisabled(disabled: boolean): void
}

declare module 'robot' {
  import type { Container } from 'piu/MC'

  interface AudioInput {
    readonly channels?: number
    readonly sampleRate?: number
    level?(buffer: ArrayBuffer): number
    read(byteLength: number): ArrayBuffer | undefined
  }

  interface Microphone {
    onReadable?: (this: AudioInput, byteLength: number) => void
    start(): void
    stop(): void
  }

  export interface Robot {
    setEmotion(emotion: string): void
    setColor(target: string, red: number, green: number, blue: number): void
    setMouthOpen(value: number): void
    lookAt(point: [number, number, number]): void
    microphone?: Microphone
    led?: Record<string, { off(): void }>
    driver?: { onDetached?: () => void }
    renderer?: { application?: unknown; addDecorator(content: Container): void }
    tone(hz: number, ms: number, volume: number): Promise<unknown> | undefined
  }
}

declare module 'face-skin' {
  import type { Skin } from 'piu/MC'
  export interface FaceSkinPalette {
    palette: Skin
    primaryState: number
  }
}

declare module 'behaviors/face' {
  import type { Container, ContainerDictionary, Content } from 'piu/MC'
  export interface FaceBaseParams {
    contents?: Content[]
    left?: number
    top?: number
    right?: number
    bottom?: number
    width?: number
    height?: number
  }
  interface FaceTemplate {
    new (data?: FaceBaseParams): Container
    template<T>(factory: (data: T) => ContainerDictionary): { new (data?: T): Container }
  }
  export const FaceBase: FaceTemplate
}

declare module 'motions/blink' {
  import type { FaceContext } from 'face-context'
  export function createBlinkMotion(options: {
    openMin: number
    openMax: number
    closeMin: number
    closeMax: number
  }): (tickMillis: number, face: FaceContext) => void
}

declare module 'app-controller' {
  export interface AppController {}
  export function createAppControllerApplication(
    view: { face: object; appBar: object },
    options: { displayListLength: number },
  ): AppController
}

declare module 'chat-status-bar' {
  export class ChatStatusBar {}
}

declare module 'policy-error' {
  export function attachPolicyError(robot: { renderer?: { addDecorator(content: object): void } }): void
}

declare module 'deploy-notice' {
  export function showDeployNotice(robot: {
    renderer?: { application?: unknown; addDecorator(content: object): void }
    lightRainbow?(name: string): void
    lightOff?(name: string): void
  }): void
}

declare module 'renderer-compat' {
  import type { AppController } from 'app-controller'
  export class RendererCompat {
    constructor(options: { controller: AppController })
  }
}

declare var breathPulse: number | undefined
declare var breathPulseDepth: number | undefined
declare var breathGazeScale: number | undefined
declare var breathMicroDrift: number | undefined
declare var breathBobPx: number | undefined
declare var breathTopLid: number | undefined
declare var breathTopAngleDeg: number | undefined
declare var breathEyeScale: number | undefined
declare var breathEyeLift: number | undefined
declare var breathSleepy: boolean | undefined
declare var breathEyeRectL: { h: number; top: number } | undefined
