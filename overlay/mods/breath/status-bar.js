import { readBatterySample } from 'm5stackchan/battery'
import { Container, Content, Label, Skin, Style } from 'piu/MC'
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

function formatBattery(sample) {
  if (!sample) return '--%'
  const prefix = sample.charging ? '+' : ''
  return `${prefix}${sample.pct}%`
}

class StatusBarBehavior extends Behavior {
  onCreate(content) {
    this.timeLabel = content.content('time')
    this.batteryLabel = content.content('battery')
    this.open = false
    this.labelTimer = null
    this.hideTimer = null
    this.slideY = SLIDE_HIDDEN
    this.applyPosition(content)
  }

  applyPosition(content) {
    content.coordinates = { left: 0, right: 0, top: this.slideY, height: BAR_HEIGHT }
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

  startHideTimer(content) {
    this.stopHideTimer()
    this.hideTimer = Timer.set(() => this.hideBar(content), AUTO_HIDE_MS)
  }

  stopHideTimer() {
    if (this.hideTimer) {
      Timer.clear(this.hideTimer)
      this.hideTimer = null
    }
  }

  showBar(content) {
    this.open = true
    this.slideY = 0
    content.visible = true
    this.applyPosition(content)
    this.startLabelTimer()
    this.startHideTimer(content)
    globalThis.breathStatusBarOpen = true
    globalThis.breathStatusShowCount = (globalThis.breathStatusShowCount ?? 0) + 1
    trace('[status-bar] showBar\n')
  }

  hideBar(content) {
    this.stopHideTimer()
    if (!this.open && this.slideY === SLIDE_HIDDEN) return
    this.open = false
    this.stopLabelTimer()
    this.slideY = SLIDE_HIDDEN
    content.visible = false
    this.applyPosition(content)
    globalThis.breathStatusBarOpen = false
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

export function attachStatusBar(robot) {
  const app = robot.renderer?.application
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
      onDisplaying(content) {
        const bounds = content.bounds
        globalThis.breathStatusSwipeBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        trace(`[status-bar] swipe zone displaying: ${content.width}x${content.height} bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height}\n`)
      }

      onTouchBegan(_content, id, x, y) {
        globalThis.breathStatusTouchCount = (globalThis.breathStatusTouchCount ?? 0) + 1
        this.touchStartY = y
        trace(`[status-bar] touch began: id=${id} x=${x} y=${y}\n`)
      }

      onTouchEnded(_content, id, x, y) {
        if (this.touchStartY == null) return
        const dy = y - this.touchStartY
        this.touchStartY = null
        globalThis.breathStatusLastDy = dy
        trace(`[status-bar] touch ended: id=${id} x=${x} y=${y} dy=${dy}\n`)
        const barBehavior = bar.behavior
        if (!barBehavior.open && dy >= MIN_SWIPE_DY) bar.delegate('showBar')
        else if (barBehavior.open && dy <= -MIN_SWIPE_DY) bar.delegate('hideBar')
      }
    },
  }))

  robot.renderer.addDecorator(new TopSwipeZone({}))
  robot.renderer.addDecorator(bar)

  trace(`[status-bar] attached v${STATUS_BAR_VERSION}\n`)
}
