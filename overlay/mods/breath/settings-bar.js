import { setBacklightVoltage, getBacklightVoltage } from 'm5stackchan/battery'
import { Container, Content, Label, Skin, Style } from 'piu/MC'
import Timer from 'timer'
import Preference from 'preference'
import { suspendCapture, resumeCapture } from 'breath/mic'

/** 画面下端から上スワイプで表示する設定バー（明るさ・音量） */
const SETTINGS_BAR_VERSION = 1
const BOTTOM_ZONE_HEIGHT = 80
const MIN_SWIPE_DY = 40
const AUTO_HIDE_MS = 8000
const BAR_HEIGHT = 72
const ROW_HEIGHT = 36
const SLIDE_HIDDEN = -BAR_HEIGHT

const PREF_DOMAIN = 'breath'
const PREF_KEY_BACKLIGHT_MV = 'backlightMv'
const PREF_KEY_AMP_VOLUME = 'ampVolume'

const BRIGHTNESS_MIN_LEVEL = 1
const BRIGHTNESS_MAX_LEVEL = 8
const BRIGHTNESS_DEFAULT_LEVEL = 8
const BRIGHTNESS_MV_BASE = 2500
const BRIGHTNESS_MV_STEP = 100

const VOLUME_MIN_LEVEL = 0
const VOLUME_MAX_LEVEL = 8
const VOLUME_DEFAULT_LEVEL = 8
const VOLUME_STEP = 32
const VOLUME_BEEP_HZ = 880
const VOLUME_BEEP_MS = 80
const VOLUME_BEEP_VOLUME = 0.5
// v1.1.0 Phase 3b — robot.tone も AudioOut TX を open するため mic 入力を殺す
// (CoreS3 の I2S クロックピン共有問題。cry.js と同じ理由)。ビープ長 + 500ms で resume する。
const VOLUME_BEEP_MIC_RESUME_DELAY_MS = 500

// 顔の画面（黒背景・白前景）と区別するため、あえて反転トーンにしている（status-bar と同じ意図）
const barSkin = new Skin({ fill: '#ffffff' })
const borderSkin = new Skin({ fill: '#cccccc' })
const labelStyle = new Style({ font: '20px Open Sans', color: '#000000', horizontal: 'left', vertical: 'middle' })
const buttonStyle = new Style({ font: '20px Open Sans', color: '#000000', horizontal: 'center', vertical: 'middle' })

// OpenSans-Regular-20（ビットマップフォント）は ASCII (0x20-0x7e) のみを内包しており、
// 日本語グリフ（明るさ/音量など）を描くと欠落する。status-bar と同じフォントを使う制約上、
// ラベルは ASCII の BRT / VOL にフォールバックする。
const BRIGHTNESS_LABEL = 'BRT'
const VOLUME_LABEL = 'VOL'

const LABEL_X = 16
const LABEL_WIDTH = 72
const MINUS_X = 100
const BUTTON_WIDTH = 56
const VALUE_X = 160
const VALUE_WIDTH = 56
const PLUS_X = 228

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mvFromBrightnessLevel(level) {
  return BRIGHTNESS_MV_BASE + level * BRIGHTNESS_MV_STEP
}

function brightnessLevelFromMv(mv) {
  return clamp(Math.round((mv - BRIGHTNESS_MV_BASE) / BRIGHTNESS_MV_STEP), BRIGHTNESS_MIN_LEVEL, BRIGHTNESS_MAX_LEVEL)
}

function ampVolumeFromLevel(level) {
  return level * VOLUME_STEP
}

function volumeLevelFromAmpVolume(value) {
  return clamp(Math.round(value / VOLUME_STEP), VOLUME_MIN_LEVEL, VOLUME_MAX_LEVEL)
}

function initialBrightnessLevel() {
  const saved = Preference.get(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV)
  if (saved != null) {
    const mv = Number(saved)
    if (Number.isFinite(mv)) return brightnessLevelFromMv(mv)
  }
  try {
    const mv = getBacklightVoltage()
    if (mv != null) return brightnessLevelFromMv(mv)
  } catch (error) {
    trace(`[settings-bar] getBacklightVoltage failed: ${error}\n`)
  }
  return BRIGHTNESS_DEFAULT_LEVEL
}

function initialVolumeLevel() {
  const saved = Preference.get(PREF_DOMAIN, PREF_KEY_AMP_VOLUME)
  if (saved != null) {
    const value = Number(saved)
    if (Number.isFinite(value)) return volumeLevelFromAmpVolume(value)
  }
  try {
    const value = globalThis.amp?.volume
    if (typeof value === 'number') return volumeLevelFromAmpVolume(value)
  } catch (error) {
    trace(`[settings-bar] amp.volume read failed: ${error}\n`)
  }
  return VOLUME_DEFAULT_LEVEL
}

/** 保存済みの明るさ・音量を起動時に再適用する（バー UI 未 attach でも呼べる）。 */
export function applySavedSettings() {
  const savedMv = Preference.get(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV)
  if (savedMv != null) {
    const mv = Number(savedMv)
    if (Number.isFinite(mv)) {
      try {
        setBacklightVoltage(mv)
      } catch (error) {
        trace(`[settings-bar] applySavedSettings backlight failed: ${error}\n`)
      }
    }
  }

  const savedVolume = Preference.get(PREF_DOMAIN, PREF_KEY_AMP_VOLUME)
  if (savedVolume != null) {
    const value = Number(savedVolume)
    if (Number.isFinite(value)) {
      try {
        globalThis.amp.volume = value
      } catch (error) {
        trace(`[settings-bar] applySavedSettings volume failed: ${error}\n`)
      }
    }
  }
}

function scheduleMicResumeAfterBeep() {
  Timer.set(() => {
    try {
      resumeCapture()
    } catch (error) {
      trace(`[settings-bar] resumeCapture failed: ${error}\n`)
    }
  }, VOLUME_BEEP_MS + VOLUME_BEEP_MIC_RESUME_DELAY_MS)
}

function playBeep(robot) {
  if (!robot) return

  try {
    suspendCapture()
  } catch (error) {
    trace(`[settings-bar] suspendCapture failed: ${error}\n`)
  }

  try {
    const result = robot.tone(VOLUME_BEEP_HZ, VOLUME_BEEP_MS, VOLUME_BEEP_VOLUME)
    if (result && typeof result.catch === 'function') {
      result.catch((error) => trace(`[settings-bar] tone failed: ${error}\n`))
    }
  } catch (error) {
    trace(`[settings-bar] tone failed: ${error}\n`)
  } finally {
    // tone が同期的に throw しても resume は必ず走らせる(mic 永久停止を防ぐ)。
    scheduleMicResumeAfterBeep()
  }
}

class SettingsBarBehavior extends Behavior {
  onCreate(content, data) {
    this.robot = data?.robot ?? null
    this.open = false
    this.hideTimer = null
    this.slideY = SLIDE_HIDDEN
    this.brightnessLevel = initialBrightnessLevel()
    this.volumeLevel = initialVolumeLevel()
    this.brightnessValueLabel = content.content('brightnessValue')
    this.volumeValueLabel = content.content('volumeValue')
    this.applyPosition(content)
    this.updateLabels()
  }

  applyPosition(content) {
    content.coordinates = { left: 0, right: 0, bottom: this.slideY, height: BAR_HEIGHT }
  }

  updateLabels() {
    if (this.brightnessValueLabel) this.brightnessValueLabel.string = `${this.brightnessLevel}/${BRIGHTNESS_MAX_LEVEL}`
    if (this.volumeValueLabel) this.volumeValueLabel.string = `${this.volumeLevel}/${VOLUME_MAX_LEVEL}`
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
    this.startHideTimer(content)
    globalThis.breathSettingsBarOpen = true
    globalThis.breathSettingsShowCount = (globalThis.breathSettingsShowCount ?? 0) + 1
    trace('[settings-bar] showBar\n')
    return true
  }

  hideBar(content) {
    this.stopHideTimer()
    if (!this.open && this.slideY === SLIDE_HIDDEN) return true
    this.open = false
    this.slideY = SLIDE_HIDDEN
    content.visible = false
    this.applyPosition(content)
    globalThis.breathSettingsBarOpen = false
    trace('[settings-bar] hideBar\n')
    return true
  }

  bumpBrightness(content, delta) {
    const next = clamp(this.brightnessLevel + delta, BRIGHTNESS_MIN_LEVEL, BRIGHTNESS_MAX_LEVEL)
    if (next !== this.brightnessLevel) {
      const mv = mvFromBrightnessLevel(next)
      let ok = false
      try {
        ok = setBacklightVoltage(mv)
      } catch (error) {
        trace(`[settings-bar] setBacklightVoltage failed: ${error}\n`)
      }
      if (ok) {
        this.brightnessLevel = next
        this.updateLabels()
        try {
          Preference.set(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV, String(mv))
        } catch (error) {
          trace(`[settings-bar] Preference.set backlightMv failed: ${error}\n`)
        }
      }
    }
    this.startHideTimer(content)
    return true
  }

  bumpVolume(content, delta) {
    const next = clamp(this.volumeLevel + delta, VOLUME_MIN_LEVEL, VOLUME_MAX_LEVEL)
    if (next !== this.volumeLevel) {
      const ampVolume = ampVolumeFromLevel(next)
      try {
        globalThis.amp.volume = ampVolume
        this.volumeLevel = next
        this.updateLabels()
        try {
          Preference.set(PREF_DOMAIN, PREF_KEY_AMP_VOLUME, String(ampVolume))
        } catch (error) {
          trace(`[settings-bar] Preference.set ampVolume failed: ${error}\n`)
        }
        playBeep(this.robot)
      } catch (error) {
        trace(`[settings-bar] amp.volume set failed: ${error}\n`)
      }
    }
    this.startHideTimer(content)
    return true
  }
}

/** [-] / [+] ボタン。当たり判定を可視テキストより大きく取る（44px 角以上を目安）。 */
const StepButton = Label.template(($) => ({
  active: true,
  style: buttonStyle,
  string: $.string,
  left: $.left,
  top: $.top,
  width: $.width,
  height: $.height,
  Behavior: class extends Behavior {
    onTouchEnded(content) {
      content.bubble($.methodName, $.delta)
    }
  },
}))

const SettingsBar = Container.template(() => ({
  name: 'breath-settings-bar',
  left: 0,
  right: 0,
  height: BAR_HEIGHT,
  visible: false,
  skin: barSkin,
  Behavior: SettingsBarBehavior,
  contents: [
    new Label(null, { left: LABEL_X, top: 0, width: LABEL_WIDTH, height: ROW_HEIGHT, style: labelStyle, string: BRIGHTNESS_LABEL }),
    new StepButton({ left: MINUS_X, top: 0, width: BUTTON_WIDTH, height: ROW_HEIGHT, string: '-', methodName: 'bumpBrightness', delta: -1 }),
    new Label(null, { name: 'brightnessValue', left: VALUE_X, top: 0, width: VALUE_WIDTH, height: ROW_HEIGHT, style: buttonStyle, string: '-/8' }),
    new StepButton({ left: PLUS_X, top: 0, width: BUTTON_WIDTH, height: ROW_HEIGHT, string: '+', methodName: 'bumpBrightness', delta: 1 }),

    new Label(null, { left: LABEL_X, top: ROW_HEIGHT, width: LABEL_WIDTH, height: ROW_HEIGHT, style: labelStyle, string: VOLUME_LABEL }),
    new StepButton({ left: MINUS_X, top: ROW_HEIGHT, width: BUTTON_WIDTH, height: ROW_HEIGHT, string: '-', methodName: 'bumpVolume', delta: -1 }),
    new Label(null, { name: 'volumeValue', left: VALUE_X, top: ROW_HEIGHT, width: VALUE_WIDTH, height: ROW_HEIGHT, style: buttonStyle, string: '-/8' }),
    new StepButton({ left: PLUS_X, top: ROW_HEIGHT, width: BUTTON_WIDTH, height: ROW_HEIGHT, string: '+', methodName: 'bumpVolume', delta: 1 }),

    new Content(null, { left: 0, right: 0, top: 0, height: 1, skin: borderSkin }),
  ],
}))

export function attachSettingsBar(robot) {
  const app = robot.renderer?.application
  if (!app) throw new Error('renderer application is unavailable')

  // Piu の第1引数が Behavior#onCreate の data。dictionary へ robot を渡しても
  // SettingsBarBehavior からは参照できない。
  const bar = new SettingsBar({ robot })

  const BottomSwipeZone = Container.template(() => ({
    name: 'breath-settings-swipe',
    left: 0,
    right: 0,
    bottom: 0,
    height: BOTTOM_ZONE_HEIGHT,
    active: true,
    backgroundTouch: true,
    Behavior: class extends Behavior {
      onDisplaying(content) {
        const bounds = content.bounds
        globalThis.breathSettingsSwipeBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        trace(`[settings-bar] swipe zone displaying: ${content.width}x${content.height} bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height}\n`)
      }

      onTouchBegan(_content, id, x, y) {
        globalThis.breathSettingsTouchCount = (globalThis.breathSettingsTouchCount ?? 0) + 1
        this.touchStartY = y
        trace(`[settings-bar] touch began: id=${id} x=${x} y=${y}\n`)
      }

      onTouchEnded(_content, id, x, y) {
        if (this.touchStartY == null) return
        const dy = y - this.touchStartY
        this.touchStartY = null
        globalThis.breathSettingsLastDy = dy
        trace(`[settings-bar] touch ended: id=${id} x=${x} y=${y} dy=${dy}\n`)
        const barBehavior = bar.behavior
        if (!barBehavior.open && dy <= -MIN_SWIPE_DY) bar.delegate('showBar')
        else if (barBehavior.open && dy >= MIN_SWIPE_DY) bar.delegate('hideBar')
      }
    },
  }))

  robot.renderer.addDecorator(new BottomSwipeZone({}))
  robot.renderer.addDecorator(bar)

  trace(`[settings-bar] attached v${SETTINGS_BAR_VERSION}\n`)
}
