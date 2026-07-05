import { Container, Label, Skin, Style } from 'piu/MC'
import Timer from 'timer'

/** タッチ座標・状態のデバッグ表示（v1.0.1 調査用） */
const TOP_ZONE_Y = 80
const ATTACH_DELAY_MS = 1500
const BAR_HEIGHT = 56

const barSkin = new Skin({ fill: '#222222' })
const textStyle = new Style({ font: 'k8x12-12', color: '#ffffff' })

const touchHandlers = {
  onBegan: [],
  onMoved: [],
  onEnded: [],
}

export function onTouchBegan(handler) {
  touchHandlers.onBegan.push(handler)
}

export function onTouchMoved(handler) {
  touchHandlers.onMoved.push(handler)
}

export function onTouchEnded(handler) {
  touchHandlers.onEnded.push(handler)
}

function dispatch(phase, x, y) {
  const payload = { x, y, source: 'piu' }
  for (const handler of touchHandlers[`on${phase}`]) {
    try {
      handler(payload)
    } catch (error) {
      trace(`[touch-debug] handler error: ${error}\n`)
    }
  }
}

class TouchDebugBehavior extends Behavior {
  onCreate(content, data) {
    this.state = data.state
    this.labels = []
  }

  onDisplaying(content) {
    for (let label = content.first; label; label = label.next) {
      this.labels.push(label)
    }
    this.refresh(content)
  }

  setLine(index, text) {
    const label = this.labels[index]
    if (label) label.string = text
  }

  refresh(content) {
    const { phase, x, y, swipe, appSize } = this.state
    this.setLine(0, `TOUCH ${phase} x=${x} y=${y}`)
    this.setLine(1, `top<=${TOP_ZONE_Y} ${swipe}`)
    this.setLine(2, appSize)
    this.setLine(3, 'breath mod active')
  }

  updateSwipe(content, text) {
    this.state.swipe = text
    this.refresh(content)
  }

  onTouchBegan(content, _id, x, y) {
    trace(`[touch-debug] PIU began x=${x} y=${y}\n`)
    this.state.phase = 'DOWN'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Began', x, y)
  }

  onTouchMoved(content, _id, x, y) {
    this.state.phase = 'MOVE'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Moved', x, y)
  }

  onTouchEnded(content, _id, x, y) {
    trace(`[touch-debug] PIU ended x=${x} y=${y}\n`)
    this.state.phase = 'UP'
    this.state.x = x
    this.state.y = y
    this.refresh(content)
    dispatch('Ended', x, y)
  }
}

const TouchDebugPanel = Container.template(($) => ({
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

function hookSwipeDebug(panel, state) {
  let touchStart = null
  onTouchBegan(({ x, y }) => {
    touchStart = { x, y }
    panel.delegate?.('updateSwipe', `start (${x},${y}) top=${y <= TOP_ZONE_Y}`)
  })
  onTouchMoved(({ x, y }) => {
    if (!touchStart) return
    const dy = y - touchStart.y
    panel.delegate?.(
      'updateSwipe',
      `dy=${dy} (${touchStart.x},${touchStart.y})->(${x},${y})`,
    )
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

export function attachTouchDebug(robot) {
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
      const panel = new TouchDebugPanel({}, { state })
      robot.renderer?.addDecorator(panel)
      hookSwipeDebug(panel, state)
      trace('[touch-debug] PIU panel attached\n')
    } catch (error) {
      trace(`[touch-debug] attach failed: ${error}\n`)
    }
  }, ATTACH_DELAY_MS)
}
