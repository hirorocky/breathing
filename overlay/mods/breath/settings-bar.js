import { getBacklightVoltage, setBacklightVoltage } from 'm5stackchan/battery'
import { Container, Content, Label, Skin, Style } from 'piu/MC'
import Preference from 'preference'
import Timer from 'timer'
import { getEmotion, setEmotionState } from 'breath/emotion'
import { getLedParams, setLedParams } from 'breath/led'
import { resumeCapture, suspendCapture } from 'breath/mic'

/** 画面下端から上スワイプで開く、全画面・2層構造の設定 UI。 */
const SETTINGS_BAR_VERSION = 2
const SCREEN_WIDTH = 320
const SCREEN_HEIGHT = 240
const BOTTOM_ZONE_HEIGHT = 80
const MIN_SWIPE_DY = 40
const AUTO_HIDE_MS = 15000

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
const VOLUME_BEEP_MIC_RESUME_DELAY_MS = 500

const LED_MIN_VALUE = 48
// 最大でも従来の環境光を少し強める程度に留め、設定画面が場の静けさを壊さないようにする。
const LED_LEVEL_VALUES = [0, 48, 60, 72, 90, 105, 120, 140, 160]

const backgroundSkin = new Skin({ fill: '#ffffff' })
const panelSkin = new Skin({ fill: '#eeeeee' })
const pressedSkin = new Skin({ fill: '#dddddd' })
const lineSkin = new Skin({ fill: '#cccccc' })
const graphSkin = new Skin({ fill: '#f4f4f4' })
const axisSkin = new Skin({ fill: '#bbbbbb' })
const markerSkin = new Skin({ fill: '#222222' })
const titleStyle = new Style({ font: '20px Open Sans', color: '#000000', horizontal: 'center', vertical: 'middle' })
const rowStyle = new Style({ font: '20px Open Sans', color: '#000000', horizontal: 'left', vertical: 'middle' })
const valueStyle = new Style({ font: '20px Open Sans', color: '#000000', horizontal: 'center', vertical: 'middle' })
const smallStyle = new Style({ font: '16px Open Sans', color: '#555555', horizontal: 'center', vertical: 'middle' })

const GRAPH_X = 42
const GRAPH_Y = 55
const GRAPH_WIDTH = 236
const GRAPH_HEIGHT = 150
const MARKER_SIZE = 12

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function findNamed(content, name) {
  if (content?.name === name) return content
  for (let child = content?.first; child; child = child.next) {
    const found = findNamed(child, name)
    if (found) return found
  }
  return null
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

function ledLevelFromParams(params) {
  if (!params?.enabled) return 0
  if (Number(params.brightnessScale) < 1) return 0.5
  const value = Number(params.coreBright)
  if (!Number.isFinite(value)) return 4
  let nearest = 1
  for (let level = 2; level <= 8; level++) {
    if (Math.abs(LED_LEVEL_VALUES[level] - value) < Math.abs(LED_LEVEL_VALUES[nearest] - value)) nearest = level
  }
  return nearest
}

function initialBrightnessLevel() {
  const saved = Preference.get(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV)
  if (saved != null && Number.isFinite(Number(saved))) return brightnessLevelFromMv(Number(saved))
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
  if (saved != null && Number.isFinite(Number(saved))) return volumeLevelFromAmpVolume(Number(saved))
  try {
    const value = globalThis.amp?.volume
    if (typeof value === 'number') return volumeLevelFromAmpVolume(value)
  } catch (error) {
    trace(`[settings-bar] amp.volume read failed: ${error}\n`)
  }
  return VOLUME_DEFAULT_LEVEL
}

/** 保存済みの画面輝度・音量を起動時に再適用する。LED 設定は led.js 自身が復元する。 */
export function applySavedSettings() {
  const savedMv = Preference.get(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV)
  if (savedMv != null && Number.isFinite(Number(savedMv))) {
    try {
      setBacklightVoltage(Number(savedMv))
    } catch (error) {
      trace(`[settings-bar] applySavedSettings backlight failed: ${error}\n`)
    }
  }

  const savedVolume = Preference.get(PREF_DOMAIN, PREF_KEY_AMP_VOLUME)
  if (savedVolume != null && Number.isFinite(Number(savedVolume))) {
    try {
      globalThis.amp.volume = Number(savedVolume)
    } catch (error) {
      trace(`[settings-bar] applySavedSettings volume failed: ${error}\n`)
    }
  }
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
    if (result && typeof result.catch === 'function') result.catch((error) => trace(`[settings-bar] tone failed: ${error}\n`))
  } catch (error) {
    trace(`[settings-bar] tone failed: ${error}\n`)
  } finally {
    Timer.set(() => {
      try {
        resumeCapture()
      } catch (error) {
        trace(`[settings-bar] resumeCapture failed: ${error}\n`)
      }
    }, VOLUME_BEEP_MS + VOLUME_BEEP_MIC_RESUME_DELAY_MS)
  }
}

class SettingsBehavior extends Behavior {
  onCreate(content, data) {
    this.robot = data?.robot ?? null
    this.open = false
    this.hideTimer = null
    this.selected = null
    this.brightnessLevel = initialBrightnessLevel()
    this.volumeLevel = initialVolumeLevel()
    this.ledLevel = ledLevelFromParams(getLedParams())
    const emotion = getEmotion()
    this.valence = clamp(emotion?.v ?? 0, -1, 1)
    this.arousal = clamp(emotion?.a ?? 0, -1, 1)
    this.selectionLayer = findNamed(content, 'selectionLayer')
    this.stepLayer = findNamed(content, 'stepLayer')
    this.emotionLayer = findNamed(content, 'emotionLayer')
    this.detailTitle = findNamed(content, 'detailTitle')
    this.detailValue = findNamed(content, 'detailValue')
    this.zeroButton = findNamed(content, 'zeroButton')
    this.halfButton = findNamed(content, 'halfButton')
    this.emotionValue = findNamed(content, 'emotionValue')
    this.emotionMarker = findNamed(content, 'emotionMarker')
    this.volumeSummary = findNamed(content, 'volumeSummary')
    this.screenSummary = findNamed(content, 'screenSummary')
    this.ledSummary = findNamed(content, 'ledSummary')
    this.emotionSummary = findNamed(content, 'emotionSummary')
    if (!this.selectionLayer || !this.stepLayer || !this.emotionLayer || !this.detailTitle || !this.detailValue
      || !this.zeroButton || !this.halfButton || !this.emotionValue || !this.emotionMarker || !this.volumeSummary
      || !this.screenSummary || !this.ledSummary || !this.emotionSummary) throw new Error('settings UI element missing')
    content.visible = false
    content.active = false
    this.showSelection(content)
  }

  startHideTimer(content) {
    if (this.hideTimer) Timer.clear(this.hideTimer)
    this.hideTimer = Timer.set(() => this.hideBar(content), AUTO_HIDE_MS)
  }

  stopHideTimer() {
    if (!this.hideTimer) return
    Timer.clear(this.hideTimer)
    this.hideTimer = null
  }

  showBar(content) {
    this.open = true
    content.visible = true
    content.active = true
    this.showSelection(content)
    this.startHideTimer(content)
    globalThis.breathSettingsBarOpen = true
    globalThis.breathSettingsShowCount = (globalThis.breathSettingsShowCount ?? 0) + 1
    trace('[settings-bar] show\n')
    return true
  }

  hideBar(content) {
    this.stopHideTimer()
    this.open = false
    content.active = false
    content.visible = false
    globalThis.breathSettingsBarOpen = false
    trace('[settings-bar] hide\n')
    return true
  }

  showSelection(content) {
    this.selected = null
    this.selectionLayer.visible = true
    this.stepLayer.visible = false
    this.emotionLayer.visible = false
    this.refreshSelectionValues(content)
    if (this.open) this.startHideTimer(content)
    return true
  }

  refreshSelectionValues(content) {
    this.volumeSummary.string = this.volumeLevel === 0 ? 'MUTE' : `${this.volumeLevel}/8`
    this.screenSummary.string = `${this.brightnessLevel}/8`
    this.ledSummary.string = this.ledLevel === 0 ? 'OFF' : `${this.ledLevel}/8`
    this.emotionSummary.string = `${this.valence.toFixed(1)}, ${this.arousal.toFixed(1)}`
  }

  selectSetting(content, setting) {
    this.selected = setting
    this.selectionLayer.visible = false
    if (setting === 'emotion') {
      const emotion = getEmotion()
      this.valence = clamp(emotion?.v ?? this.valence, -1, 1)
      this.arousal = clamp(emotion?.a ?? this.arousal, -1, 1)
      this.stepLayer.visible = false
      this.emotionLayer.visible = true
      this.updateEmotionDisplay()
    } else {
      this.stepLayer.visible = true
      this.emotionLayer.visible = false
      this.detailTitle.string = setting === 'volume' ? 'VOLUME' : setting === 'screen' ? 'SCREEN' : 'LED'
      this.zeroButton.visible = setting !== 'screen'
      this.zeroButton.coordinates = { left: 12, top: 82, width: setting === 'led' ? 43 : 92, height: 43 }
      this.halfButton.visible = setting === 'led'
      this.updateStepDisplay()
    }
    this.startHideTimer(content)
    return true
  }

  updateStepDisplay() {
    const level = this.selected === 'volume' ? this.volumeLevel : this.selected === 'screen' ? this.brightnessLevel : this.ledLevel
    this.detailValue.string = this.selected === 'volume' && level === 0 ? 'MUTE' : this.selected === 'led' && level === 0 ? 'OFF' : `${level} / 8`
  }

  selectLevel(content, level) {
    if (this.selected === 'volume') this.setVolume(level)
    else if (this.selected === 'screen') this.setScreen(level)
    else if (this.selected === 'led') this.setLed(level)
    this.updateStepDisplay()
    this.startHideTimer(content)
    return true
  }

  setVolume(level) {
    const next = clamp(level, VOLUME_MIN_LEVEL, VOLUME_MAX_LEVEL)
    if (next === this.volumeLevel) return
    const value = ampVolumeFromLevel(next)
    try {
      globalThis.amp.volume = value
      this.volumeLevel = next
      Preference.set(PREF_DOMAIN, PREF_KEY_AMP_VOLUME, String(value))
      if (next > 0) playBeep(this.robot)
    } catch (error) {
      trace(`[settings-bar] volume set failed: ${error}\n`)
    }
  }

  setScreen(level) {
    const next = clamp(level, BRIGHTNESS_MIN_LEVEL, BRIGHTNESS_MAX_LEVEL)
    if (next === this.brightnessLevel) return
    const mv = mvFromBrightnessLevel(next)
    try {
      if (setBacklightVoltage(mv)) {
        this.brightnessLevel = next
        Preference.set(PREF_DOMAIN, PREF_KEY_BACKLIGHT_MV, String(mv))
      }
    } catch (error) {
      trace(`[settings-bar] screen brightness set failed: ${error}\n`)
    }
  }

  setLed(level) {
    const next = clamp(level, 0, 8)
    if (next === this.ledLevel) return
    try {
      if (next === 0) setLedParams({ enabled: false })
      else if (next === 0.5) setLedParams({ enabled: true, coreBright: LED_MIN_VALUE, brightnessScale: 0.5 })
      else setLedParams({ enabled: true, coreBright: Math.max(LED_MIN_VALUE, LED_LEVEL_VALUES[next]), brightnessScale: 1 })
      this.ledLevel = next
    } catch (error) {
      trace(`[settings-bar] LED brightness set failed: ${error}\n`)
    }
  }

  setEmotionValues(content, values) {
    this.valence = clamp(values.v, -1, 1)
    this.arousal = clamp(values.a, -1, 1)
    try {
      setEmotionState(this.valence, this.arousal)
    } catch (error) {
      trace(`[settings-bar] emotion set failed: ${error}\n`)
    }
    this.updateEmotionDisplay()
    this.startHideTimer(content)
    return true
  }

  updateEmotionDisplay() {
    this.emotionValue.string = `V ${this.valence.toFixed(1)}   A ${this.arousal.toFixed(1)}`
    const x = GRAPH_X + ((this.valence + 1) / 2) * GRAPH_WIDTH - MARKER_SIZE / 2
    const y = GRAPH_Y + ((1 - this.arousal) / 2) * GRAPH_HEIGHT - MARKER_SIZE / 2
    this.emotionMarker.coordinates = { left: Math.round(x), top: Math.round(y), width: MARKER_SIZE, height: MARKER_SIZE }
  }
}

const ActionButton = Label.template(($) => ({
  name: $.name,
  visible: $.visible ?? true,
  active: true,
  backgroundTouch: true,
  skin: $.skin ?? panelSkin,
  style: $.style ?? valueStyle,
  string: $.string,
  left: $.left,
  right: $.right,
  top: $.top,
  bottom: $.bottom,
  width: $.width,
  height: $.height,
  Behavior: class extends Behavior {
    onTouchBegan(content) {
      content.skin = pressedSkin
    }
    onTouchEnded(content) {
      content.skin = $.skin ?? panelSkin
      content.bubble($.methodName, $.value)
    }
  },
}))

const SelectionRow = Container.template(($) => ({
  left: 12,
  right: 12,
  top: $.top,
  height: 43,
  active: true,
  backgroundTouch: true,
  skin: panelSkin,
  Behavior: class extends Behavior {
    onTouchBegan(content) {
      content.skin = pressedSkin
    }
    onTouchEnded(content) {
      content.skin = panelSkin
      content.bubble('selectSetting', $.setting)
    }
  },
  contents: [
    new Label(null, { left: 12, width: 170, top: 0, bottom: 0, style: rowStyle, string: $.label }),
    new Label(null, { name: $.summaryName, right: 12, width: 110, top: 0, bottom: 0, style: valueStyle, string: '-' }),
  ],
}))

const EmotionPad = Container.template(() => ({
  left: GRAPH_X,
  top: GRAPH_Y,
  width: GRAPH_WIDTH,
  height: GRAPH_HEIGHT,
  active: true,
  backgroundTouch: true,
  skin: graphSkin,
  Behavior: class extends Behavior {
    onTouchBegan(content, _id, x, y) {
      this.update(content, x, y)
    }
    onTouchMoved(content, _id, x, y) {
      this.update(content, x, y)
    }
    update(content, x, y) {
      const localX = clamp(x - content.x, 0, content.width)
      const localY = clamp(y - content.y, 0, content.height)
      content.bubble('setEmotionValues', {
        v: (localX / content.width) * 2 - 1,
        a: 1 - (localY / content.height) * 2,
      })
    }
  },
  contents: [
    new Content(null, { left: GRAPH_WIDTH / 2, top: 0, width: 1, bottom: 0, skin: axisSkin }),
    new Content(null, { left: 0, top: GRAPH_HEIGHT / 2, right: 0, height: 1, skin: axisSkin }),
  ],
}))

const SettingsPanel = Container.template(() => ({
  name: 'breath-settings-bar',
  left: 0,
  top: 0,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  visible: false,
  active: true,
  backgroundTouch: true,
  skin: backgroundSkin,
  Behavior: SettingsBehavior,
  contents: [
    new Container(null, {
      name: 'selectionLayer', left: 0, right: 0, top: 0, bottom: 0,
      contents: [
        new Label(null, { left: 70, right: 70, top: 2, height: 38, style: titleStyle, string: 'SETTINGS' }),
        new ActionButton({ right: 8, top: 4, width: 58, height: 34, string: 'X', methodName: 'hideBar' }),
        new SelectionRow({ top: 42, label: 'VOLUME', summaryName: 'volumeSummary', setting: 'volume' }),
        new SelectionRow({ top: 89, label: 'SCREEN', summaryName: 'screenSummary', setting: 'screen' }),
        new SelectionRow({ top: 136, label: 'LED', summaryName: 'ledSummary', setting: 'led' }),
        new SelectionRow({ top: 183, label: 'EMOTION', summaryName: 'emotionSummary', setting: 'emotion' }),
      ],
    }),
    new Container(null, {
      name: 'stepLayer', left: 0, right: 0, top: 0, bottom: 0, visible: false,
      contents: [
        new ActionButton({ left: 8, top: 8, width: 58, height: 38, string: '<', methodName: 'showSelection' }),
        new Label(null, { name: 'detailTitle', left: 70, right: 70, top: 8, height: 38, style: titleStyle, string: '-' }),
        new ActionButton({ right: 8, top: 8, width: 58, height: 38, string: 'X', methodName: 'hideBar' }),
        new Label(null, { name: 'detailValue', left: 80, right: 80, top: 48, height: 30, style: valueStyle, string: '-' }),
        new ActionButton({ name: 'zeroButton', left: 12, top: 82, width: 92, height: 43, string: '0', methodName: 'selectLevel', value: 0 }),
        new ActionButton({ name: 'halfButton', left: 61, top: 82, width: 43, height: 43, visible: false, string: '.5', methodName: 'selectLevel', value: 0.5 }),
        new ActionButton({ left: 114, top: 82, width: 92, height: 43, string: '1', methodName: 'selectLevel', value: 1 }),
        new ActionButton({ left: 216, top: 82, width: 92, height: 43, string: '2', methodName: 'selectLevel', value: 2 }),
        new ActionButton({ left: 12, top: 133, width: 92, height: 43, string: '3', methodName: 'selectLevel', value: 3 }),
        new ActionButton({ left: 114, top: 133, width: 92, height: 43, string: '4', methodName: 'selectLevel', value: 4 }),
        new ActionButton({ left: 216, top: 133, width: 92, height: 43, string: '5', methodName: 'selectLevel', value: 5 }),
        new ActionButton({ left: 12, top: 184, width: 92, height: 43, string: '6', methodName: 'selectLevel', value: 6 }),
        new ActionButton({ left: 114, top: 184, width: 92, height: 43, string: '7', methodName: 'selectLevel', value: 7 }),
        new ActionButton({ left: 216, top: 184, width: 92, height: 43, string: '8', methodName: 'selectLevel', value: 8 }),
      ],
    }),
    new Container(null, {
      name: 'emotionLayer', left: 0, right: 0, top: 0, bottom: 0, visible: false,
      contents: [
        new ActionButton({ left: 8, top: 8, width: 58, height: 38, string: '<', methodName: 'showSelection' }),
        new Label(null, { left: 70, right: 70, top: 8, height: 38, style: titleStyle, string: 'EMOTION' }),
        new ActionButton({ right: 8, top: 8, width: 58, height: 38, string: 'X', methodName: 'hideBar' }),
        new EmotionPad({}),
        new Content(null, { name: 'emotionMarker', left: 154, top: 124, width: MARKER_SIZE, height: MARKER_SIZE, skin: markerSkin }),
        new Label(null, { name: 'emotionValue', left: 70, right: 70, top: 208, height: 28, style: smallStyle, string: 'V 0.0   A 0.0' }),
        new Label(null, { left: 0, width: 42, top: 115, height: 24, style: smallStyle, string: '-' }),
        new Label(null, { right: 0, width: 42, top: 115, height: 24, style: smallStyle, string: '+' }),
        new Label(null, { left: 278, width: 42, top: 47, height: 20, style: smallStyle, string: 'A+' }),
        new Label(null, { left: 278, width: 42, top: 196, height: 20, style: smallStyle, string: 'A-' }),
      ],
    }),
    new Content(null, { left: 0, right: 0, top: 0, height: 1, skin: lineSkin }),
  ],
}))

export function attachSettingsBar(robot) {
  const app = robot.renderer?.application
  if (!app) throw new Error('renderer application is unavailable')

  const panel = new SettingsPanel({ robot })
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
        trace(`[settings-bar] swipe zone displaying: ${bounds.x},${bounds.y},${bounds.width},${bounds.height}\n`)
      }
      onTouchBegan(_content, _id, _x, y) {
        globalThis.breathSettingsTouchCount = (globalThis.breathSettingsTouchCount ?? 0) + 1
        this.touchStartY = y
        trace(`[settings-bar] touch began y=${y}\n`)
      }
      onTouchEnded(_content, _id, _x, y) {
        if (this.touchStartY == null) return
        const dy = y - this.touchStartY
        this.touchStartY = null
        globalThis.breathSettingsLastDy = dy
        trace(`[settings-bar] touch ended y=${y} dy=${dy}\n`)
        if (!panel.behavior.open && dy <= -MIN_SWIPE_DY) panel.delegate('showBar')
      }
    },
  }))

  robot.renderer.addDecorator(new BottomSwipeZone({}))
  robot.renderer.addDecorator(panel)
  trace(`[settings-bar] attached v${SETTINGS_BAR_VERSION}\n`)
}
