import { readBatterySample } from 'm5stackchan/battery'
import 'piu/MC'
import type { Container as PiuContainer, Label as PiuLabel } from 'piu/MC'
import Timer from 'timer'

/** 画面上端から下スワイプで表示する時刻・バッテリーバー */
const STATUS_BAR_VERSION = 17
const TOP_ZONE_HEIGHT = 80
const MIN_SWIPE_DY = 40
const AUTO_HIDE_MS = 5000
const BAR_HEIGHT = 28
const SLIDE_HIDDEN = -BAR_HEIGHT
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// 顔の画面（黒背景・白前景）と区別するため、あえて反転トーンにしている
const barSkin = new Skin({ fill: '#ffffff' })
const borderSkin = new Skin({ fill: '#cccccc' })
const textStyle = new Style({ font: '20px Open Sans', color: '#000000' })

function formatTimeJst() {
  const d = new Date(Date.now() + JST_OFFSET_MS)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

type BatterySample = { charging: boolean; pct: number }
type RobotWithRenderer = { renderer?: { application?: unknown; addDecorator(content: PiuContainer): void } }
type StatusGlobals = typeof globalThis & {
  breathStatusBarOpen?: boolean
  breathStatusShowCount?: number
  breathStatusSwipeBounds?: { x: number; y: number; width: number; height: number }
  breathStatusTouchCount?: number
  breathStatusLastDy?: number
}
const statusGlobal = globalThis as StatusGlobals

function formatBattery(sample: BatterySample | null | undefined) {
  if (!sample) return '--%'
  const prefix = sample.charging ? '+' : ''
  return `${prefix}${sample.pct}%`
}

class StatusBarBehavior extends Behavior {
  timeLabel: PiuLabel | null = null
  batteryLabel: PiuLabel | null = null
  open: boolean = false
  labelTimer: ReturnType<typeof Timer.set> | null = null
  hideTimer: ReturnType<typeof Timer.set> | null = null
  slideY = SLIDE_HIDDEN

  override onCreate(content: PiuContainer) {
    this.timeLabel = content.content('time') as PiuLabel
    this.batteryLabel = content.content('battery') as PiuLabel
    this.open = false
    this.labelTimer = null
    this.hideTimer = null
    this.slideY = SLIDE_HIDDEN
    this.applyPosition(content)
  }

  applyPosition(content: PiuContainer) {
    content.coordinates = { left: 0, right: 0, top: this.slideY, height: BAR_HEIGHT } as never
  }

  updateLabels() {
    if (this.timeLabel) this.timeLabel.string = formatTimeJst()
    if (this.batteryLabel) this.batteryLabel.string = formatBattery(readBatterySample())
  }

  startLabelTimer() {
    this.stopLabelTimer()
    this.updateLabels()
    const tick = () => {
      if (!this.open) return
      this.updateLabels()
      this.labelTimer = Timer.set(tick, 1000)
    }
    this.labelTimer = Timer.set(tick, 1000)
  }

  stopLabelTimer() {
    if (this.labelTimer) {
      Timer.clear(this.labelTimer)
      this.labelTimer = null
    }
  }

  startHideTimer(content: PiuContainer) {
    this.stopHideTimer()
    this.hideTimer = Timer.set(() => this.hideBar(content), AUTO_HIDE_MS)
  }

  stopHideTimer() {
    if (this.hideTimer) {
      Timer.clear(this.hideTimer)
      this.hideTimer = null
    }
  }

  showBar(content: PiuContainer) {
    this.open = true
    this.slideY = 0
    content.visible = true
    this.applyPosition(content)
    this.startLabelTimer()
    this.startHideTimer(content)
    statusGlobal.breathStatusBarOpen = true
    statusGlobal.breathStatusShowCount = (statusGlobal.breathStatusShowCount ?? 0) + 1
    trace('[status-bar] showBar\n')
  }

  hideBar(content: PiuContainer) {
    this.stopHideTimer()
    if (!this.open && this.slideY === SLIDE_HIDDEN) return
    this.open = false
    this.stopLabelTimer()
    this.slideY = SLIDE_HIDDEN
    content.visible = false
    this.applyPosition(content)
    statusGlobal.breathStatusBarOpen = false
    trace('[status-bar] hideBar\n')
  }
}

const StatusBar = Container.template(() => ({
  name: 'breath-status-bar',
  left: 0,
  right: 0,
  height: BAR_HEIGHT,
  visible: false,
  skin: barSkin,
  Behavior: StatusBarBehavior,
  contents: [
    new Label(null, { name: 'time', left: 8, top: 4, style: textStyle, string: '--:--' }),
    new Label(null, { name: 'battery', right: 8, top: 4, style: textStyle, string: '--%' }),
    new Content(null, { left: 0, right: 0, bottom: 0, height: 1, skin: borderSkin }),
  ],
}))

export function attachStatusBar(robot: RobotWithRenderer) {
  const renderer = robot.renderer
  const app = renderer?.application
  if (!app) throw new Error('renderer application is unavailable')

  const bar = new StatusBar({})

  const TopSwipeZone = Container.template(() => ({
    name: 'breath-status-swipe',
    left: 0,
    right: 0,
    top: 0,
    height: TOP_ZONE_HEIGHT,
    active: true,
    backgroundTouch: true,
    Behavior: class extends Behavior {
      touchStartY: number | null = null

      override onDisplaying(content: PiuContainer) {
        const bounds = content.bounds
        statusGlobal.breathStatusSwipeBounds = {
          x: bounds.x ?? 0,
          y: bounds.y ?? 0,
          width: bounds.width ?? 0,
          height: bounds.height ?? 0,
        }
        trace(
          `[status-bar] swipe zone displaying: ${content.width}x${content.height} bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height}\n`,
        )
      }

      override onTouchBegan(_content: PiuContainer, id: number, x: number, y: number) {
        statusGlobal.breathStatusTouchCount = (statusGlobal.breathStatusTouchCount ?? 0) + 1
        this.touchStartY = y
        trace(`[status-bar] touch began: id=${id} x=${x} y=${y}\n`)
      }

      onTouchEnded(_content: PiuContainer, id: number, x: number, y: number) {
        if (this.touchStartY === null) return
        const dy = y - this.touchStartY
        this.touchStartY = null
        statusGlobal.breathStatusLastDy = dy
        trace(`[status-bar] touch ended: id=${id} x=${x} y=${y} dy=${dy}\n`)
        const barBehavior = bar.behavior as StatusBarBehavior
        if (!barBehavior.open && dy >= MIN_SWIPE_DY) bar.delegate('showBar')
        else if (barBehavior.open && dy <= -MIN_SWIPE_DY) bar.delegate('hideBar')
      }
    },
  }))

  renderer.addDecorator(new TopSwipeZone({}))
  renderer.addDecorator(bar)

  trace(`[status-bar] attached v${STATUS_BAR_VERSION}\n`)
}
