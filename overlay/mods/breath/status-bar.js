import { onTouchBegan, onTouchEnded, onTouchMoved } from 'touch-debug'
import { Container, Label, Skin, Style } from 'piu/MC'
import Timer from 'timer'

/** 画面上端から下スワイプで表示する時刻・バッテリーバー（v1.0.1） */
const TOP_ZONE_Y = 80
const MIN_SWIPE_DY = 40
const AUTO_HIDE_MS = 5000
const BAR_HEIGHT = 22

const barSkin = new Skin({ fill: '#000000' })
const textStyle = new Style({ font: 'k8x12-12', color: '#ffffff' })

function formatTime(ms) {
  const d = new Date(ms)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function readTime(rtc) {
  if (!rtc) return '--:--'
  try {
    return formatTime(rtc.time)
  } catch (error) {
    trace(`[status-bar] RTC read failed: ${error}\n`)
    return '--:--'
  }
}

class StatusBarBehavior extends Behavior {
  onCreate(content, data) {
    this.rtc = data?.rtc
    this.timeLabel = content.first
    this.batteryLabel = content.last
  }

  updateLabels() {
    if (this.timeLabel) this.timeLabel.string = readTime(this.rtc)
    // AXP2101 は setup-target で既に使用中。二重 SMBus はクラッシュの原因になるため未読。
    if (this.batteryLabel) this.batteryLabel.string = '--%'
  }

  onTimeChanged(content) {
    if (!content.visible) return
    this.updateLabels()
  }

  show(content) {
    content.visible = true
    content.interval = 1000
    content.start()
    this.updateLabels()
  }

  hide(content) {
    content.visible = false
    content.stop()
  }
}

const StatusBar = Container.template(($) => ({
  name: 'breath-status-bar',
  top: 0,
  left: 0,
  right: 0,
  height: BAR_HEIGHT,
  visible: false,
  skin: barSkin,
  Behavior: StatusBarBehavior,
  contents: [
    Label($, { left: 8, style: textStyle, string: '--:--' }),
    Label($, { right: 8, style: textStyle, string: '--%' }),
  ],
}))

function createRtc(device) {
  if (!device?.peripheral?.RTC) return undefined
  try {
    return new device.peripheral.RTC({})
  } catch (error) {
    trace(`[status-bar] RTC init failed: ${error}\n`)
    return undefined
  }
}

export function attachStatusBar(robot, device) {
  const rtc = createRtc(device)
  const bar = new StatusBar({}, { rtc })

  robot.renderer?.addDecorator(bar)

  let touchStart = null
  let visible = false
  let hideTimer = null

  const hide = () => {
    if (hideTimer) {
      Timer.clear(hideTimer)
      hideTimer = null
    }
    bar.delegate?.('hide')
    visible = false
  }

  const show = () => {
    if (hideTimer) Timer.clear(hideTimer)
    bar.delegate?.('show')
    visible = true
    hideTimer = Timer.set(hide, AUTO_HIDE_MS)
  }

  onTouchBegan(({ x, y }) => {
    if (visible) {
      touchStart = { x, y, zone: 'bar' }
    } else if (y <= TOP_ZONE_Y) {
      touchStart = { x, y, zone: 'top' }
    }
  })

  onTouchMoved(({ x, y }) => {
    if (touchStart) {
      touchStart.lastX = x
      touchStart.lastY = y
    }
  })

  onTouchEnded(({ x, y }) => {
    if (!touchStart) return
    const dy = y - touchStart.y
    if (visible && dy <= -MIN_SWIPE_DY) {
      hide()
    } else if (!visible && touchStart.zone === 'top' && dy >= MIN_SWIPE_DY) {
      show()
    }
    touchStart = null
  })

  trace('[status-bar] attached\n')
}
