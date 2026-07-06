import { Outline } from 'commodetto/outline'
import { defaultFaceContext } from 'face-context'
import Time from 'time'

/**
 * v1.1.0 — 顔の再設計 B 案(Cozmo 理念)の目。1 枚の丸角矩形で、呼吸(脈動)・
 * まばたき(縦スケール)・視線(平行移動)・微小な漂い(sin/cos)を合成する
 * (docs/tasks/open-items.md「顔の再設計 — B 案(Cozmo 理念)で確定」の確定レシピ)。
 *
 * 瞳・瞼のレイヤーは持たない(B 案は目全体が動き・変形する — parts/eye.ts の
 * Iris/Eyelid 二重構造とは別物)。parts/eye.ts の Eyelid と同じ Shape +
 * Outline.RoundRectPath + dirty-check の作法だけ流用する。
 *
 * dirty-check: Outline(RoundRectPath)の再構築は幅・高さが変わった時だけ
 * (脈動・まばたきの合成後の値)。平行移動(視線・漂い)は shape.coordinates の
 * 代入で済ませ、Outline 再構築は起こさない。すべて 0.5px 単位に量子化し、
 * 浮動小数点のジッタで無駄な再構築・再描画が起きないようにする。
 *
 * 例外は全て握って trace するだけ(再スローしない) — PIU の onCreate/
 * onFaceContext で throw すると起動不能・以後の更新停止につながるため。
 */

// 確定レシピ(docs/tasks/open-items.md)。脈動深さ・漂い量は liveliness の
// face パラメータ(globalThis 経由)で実行時に上書きできる(Loop B チューニング用)。
const BREATH_DEPTH_DEFAULT = 0.14 // scaleY = 1 + pulse * breathDepth
const BREATH_SCALE_X_RATIO = 0.35 // scaleX は scaleY の 35%
const BREATH_OPEN_MIN = 0.04 // mod.js MOUTH_EXHALE と同じ基準線
const BREATH_OPEN_RANGE = 0.18 // MOUTH_INHALE(0.22) - MOUTH_EXHALE(0.04)
const MICRO_DRIFT_PX_DEFAULT = 3.8
const MICRO_DRIFT_PERIOD_X_MS = 3400
const MICRO_DRIFT_PERIOD_Y_MS = 5100
const MICRO_DRIFT_Y_RATIO = 0.7
const MIN_BLINK_HEIGHT_RATIO = 0.06 // Cozmo 流の「潰れるまばたき」の下限(0 だと完全に消える)
const QUANTIZE_PX = 0.5

function quantize(value, step) {
  return Math.round(value / step) * step
}

export const CozmoEye = Shape.template((opts) => {
  const cx = opts.cx
  const cy = opts.cy
  const baseWidth = opts.width ?? 57
  const baseHeight = opts.height ?? 68
  const radius = opts.radius ?? 7
  const side = opts.side

  return {
    left: cx - baseWidth / 2,
    top: cy - baseHeight / 2,
    width: baseWidth,
    height: baseHeight,
    skin: new Skin({ fill: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      startTicks = null
      lastOutlineW = -1
      lastOutlineH = -1
      lastLeft = Number.NaN
      lastTop = Number.NaN

      onCreate(shape) {
        try {
          this.rebuildOutline(shape, baseWidth, baseHeight)
          this.lastOutlineW = baseWidth
          this.lastOutlineH = baseHeight
        } catch (error) {
          trace(`[breath-face] eye-cozmo(${side}) onCreate failed: ${error}\n`)
        }
      }

      onFaceSkin(shape, palette) {
        try {
          shape.skin = palette.palette
          shape.state = palette.primaryState
        } catch (error) {
          trace(`[breath-face] eye-cozmo(${side}) onFaceSkin failed: ${error}\n`)
        }
      }

      onFaceContext(shape, face) {
        try {
          this.update(shape, face)
        } catch (error) {
          trace(`[breath-face] eye-cozmo(${side}) onFaceContext failed: ${error}\n`)
        }
      }

      update(shape, face) {
        if (this.startTicks === null) {
          this.startTicks = Time.ticks
        }
        const elapsed = Time.ticks - this.startTicks

        const eye = face.eyes?.[side]
        const mouthOpen = face.mouth?.open ?? BREATH_OPEN_MIN
        const pulse = Math.max(0, (mouthOpen - BREATH_OPEN_MIN) / BREATH_OPEN_RANGE)
        const breathDepth = globalThis.breathPulseDepth ?? BREATH_DEPTH_DEFAULT
        const scaleY = 1 + pulse * breathDepth
        const scaleX = 1 + pulse * breathDepth * BREATH_SCALE_X_RATIO

        const blinkOpen = eye ? Math.max(MIN_BLINK_HEIGHT_RATIO, eye.open) : 1

        const w = Math.max(1, quantize(baseWidth * scaleX, QUANTIZE_PX))
        const h = Math.max(1, quantize(baseHeight * scaleY * blinkOpen, QUANTIZE_PX))

        const driftPx = globalThis.breathMicroDrift ?? MICRO_DRIFT_PX_DEFAULT
        const driftX = driftPx * Math.sin((2 * Math.PI * elapsed) / MICRO_DRIFT_PERIOD_X_MS)
        const driftY = driftPx * MICRO_DRIFT_Y_RATIO * Math.cos((2 * Math.PI * elapsed) / MICRO_DRIFT_PERIOD_Y_MS)

        // liveliness.js の gaze.pixelScale が globalThis.breathGazeScale に反映する
        // (parts/eye.ts の瞳オフセットと同じ既存機構をそのまま流用。既定 2 = upstream 相当)。
        const gazeScale = globalThis.breathGazeScale ?? 2
        const gazeX = eye ? (eye.gazeX ?? 0) * gazeScale : 0
        const gazeY = eye ? (eye.gazeY ?? 0) * gazeScale : 0

        const left = quantize(cx - w / 2 + gazeX + driftX, QUANTIZE_PX)
        const top = quantize(cy - h / 2 + gazeY + driftY, QUANTIZE_PX)

        const sizeChanged = w !== this.lastOutlineW || h !== this.lastOutlineH
        if (sizeChanged) {
          this.rebuildOutline(shape, w, h)
          this.lastOutlineW = w
          this.lastOutlineH = h
        }
        if (sizeChanged || left !== this.lastLeft || top !== this.lastTop) {
          this.lastLeft = left
          this.lastTop = top
          shape.coordinates = { left, top, width: w, height: h }
        }
      }

      rebuildOutline(shape, w, h) {
        const path = Outline.RoundRectPath(0, 0, w, h, radius)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
      }
    },
  }
})
