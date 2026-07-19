import 'piu/MC'
import type { Container as PiuContainer, Label as PiuLabel } from 'piu/MC'
import Timer from 'timer'

/** タッチ座標・状態のデバッグ表示（v1.0.1 調査用） */
const TOP_ZONE_Y = 80
const ATTACH_DELAY_MS = 1500
const BAR_HEIGHT = 56

const barSkin = new Skin({ fill: '#222222' })
const textStyle = new Style({ font: 'k8x12-12', color: '#ffffff' })

type TouchPayload = { x: number; y: number; source: 'piu' }
type TouchHandler = (payload: TouchPayload) => void
type TouchPhase = 'Began' | 'Moved' | 'Ended'
type TouchState = { phase: string; x: number | string; y: number | string; swipe: string; appSize: string }
type RobotWithRenderer = {
  renderer?: { application?: { width?: number; height?: number }; addDecorator(content: PiuContainer): void }
}

const touchHandlers: Record<`on${TouchPhase}`, TouchHandler[]> = {
  onBegan: [],
  onMoved: [],
  onEnded: [],
}

export function onTouchBegan(handler: TouchHandler) {
  touchHandlers.onBegan.push(handler)
}

export function onTouchMoved(handler: TouchHandler) {
  touchHandlers.onMoved.push(handler)
}

export function onTouchEnded(handler: TouchHandler) {
  touchHandlers.onEnded.push(handler)
}

function dispatch(phase: TouchPhase, x: number, y: number) {
  const payload: TouchPayload = { x, y, source: 'piu' }
  for (const handler of touchHandlers[`on${phase}`]) {
    try {
      handler(payload)
    } catch (error) {
      trace(`[touch-debug] handler error: ${error}\n`)
    }
  }
}

class TouchDebugBehavior extends Behavior {
  state!: TouchState
  labels: PiuLabel[] = []

  override onCreate(_content: PiuContainer, data: { state: TouchState }) {
    this.state = data.state
    this.labels = []
  }

  override onDisplaying(content: PiuContainer) {
    for (let label = content.first; label; label = label.next) {
      this.labels.push(label as PiuLabel)
    }
    this.refresh(content)
  }

  setLine(index: number, text: string) {
    const label = this.labels[index]
    if (label) label.string = text
  }

  refresh(_content: PiuContainer) {
    const { phase, x, y, swipe, appSize } = this.state
    this.setLine(0, `TOUCH ${phase} x=${x} y=${y}`)
    this.setLine(1, `top<=${TOP_ZONE_Y} ${swipe}`)
    this.setLine(2, appSize)
    this.setLine(3, 'breath mod active')
  }

  updateSwipe(content: PiuContainer, text: string) {
    this.state.swipe = text
    this.refresh(content)
  }

  override onTouchBegan(content: PiuContainer, _id: number, x: number, y: number) {
    trace(`[touch-debug] PIU began x=${x} y=${y}\n`)
    this.state.phase = 'DOWN'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Began', x, y)
  }

  override onTouchMoved(content: PiuContainer, _id: number, x: number, y: number) {
    this.state.phase = 'MOVE'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Moved', x, y)
  }

  onTouchEnded(content: PiuContainer, _id: number, x: number, y: number) {
    trace(`[touch-debug] PIU ended x=${x} y=${y}\n`)
    this.state.phase = 'UP'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Ended', x, y)
  }
}

const TouchDebugPanel = Container.template(($: { state: TouchState }) => ({
  name: 'touch-debug',
  left: 0,
  right: 0,
  bottom: 0,
  height: BAR_HEIGHT,
  active: true,
  skin: barSkin,
  Behavior: TouchDebugBehavior,
  contents: [
    Label($, { left: 4, top: 2, style: textStyle, string: 'TOUCH idle' }),
    Label($, { left: 4, top: 14, style: textStyle, string: 'swipe --' }),
    Label($, { left: 4, top: 26, style: textStyle, string: 'app --' }),
    Label($, { left: 4, top: 38, style: textStyle, string: 'breath mod' }),
  ],
}))

function hookSwipeDebug(panel: PiuContainer, _state: TouchState) {
  let touchStart: { x: number; y: number } | null = null
  onTouchBegan(({ x, y }) => {
    touchStart = { x, y }
    panel.delegate?.('updateSwipe', `start (${x},${y}) top=${y <= TOP_ZONE_Y}`)
  })
  onTouchMoved(({ x, y }) => {
    if (!touchStart) return
    const dy = y - touchStart.y
    panel.delegate?.('updateSwipe', `dy=${dy} (${touchStart.x},${touchStart.y})->(${x},${y})`)
  })
  onTouchEnded(({ x, y }) => {
    if (!touchStart) {
      panel.delegate?.('updateSwipe', `end (${x},${y}) no-start`)
      return
    }
    const dy = y - touchStart.y
    panel.delegate?.('updateSwipe', `end dy=${dy} top=${touchStart.y <= TOP_ZONE_Y}`)
    touchStart = null
  })
}

export function attachTouchDebug(robot: RobotWithRenderer) {
  const app = robot.renderer?.application
  const state = {
    phase: 'idle',
    x: '-',
    y: '-',
    swipe: 'dy=--',
    appSize: `app ${app?.width ?? 0}x${app?.height ?? 0}`,
  }

  Timer.set(() => {
    try {
      const panel = new TouchDebugPanel({ state })
      robot.renderer?.addDecorator(panel)
      hookSwipeDebug(panel, state)
      trace('[touch-debug] PIU panel attached\n')
    } catch (error) {
      trace(`[touch-debug] attach failed: ${error}\n`)
    }
  }, ATTACH_DELAY_MS)
}
