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
// 呼吸の上下(ボブ): 吸うと目が浮き、吐くと沈む(胸の上下のアナロジー)。脈動
// (サイズ変化)への追加(2026-07-08 ユーザー要望「サイズが変わりつつ上下もする」)。
// liveliness の face.breathBobPx(globalThis.breathBobPx 経由)でライブ調整できる。
const BREATH_BOB_PX_DEFAULT = 3
const QUANTIZE_PX = 0.5
const OCCLUDER_SMOOTH_RATIO = 0.15 // occluder の値平滑化(emotion.js の 1Hz tick を毎フレームなめらかに見せる)
const MIN_VISIBLE_LID_RATIO = 0.02 // これ未満の topLid/botArc は非表示にする(空のパスを作らない)
const OCCLUDER_FILL = '#000000' // 背景と同色(黒)。目の上に重ねて変形に見せる(Cozmo 手法)

function quantize(value, step) {
  return Math.round(value / step) * step
}

// v1.2.0 (E1) — emotion.js が毎 tick(1Hz)書く感情由来の目のパラメータ
// (globalThis.breathTopLid/breathTopAngleDeg/breathEyeScale/breathEyeLift)。
// occluder 側は同じ側の値をそのまま読む。ここでは eye 自身の eyeScale/eyeLift だけを
// このモジュール内(update())で消費する。
// eye-cozmo.js が毎フレーム書く「今フレームの最終的な目の矩形」(左右別)。occluder
// (このファイル下部の TopLidOccluder)がここを読んで自分の位置・幅を
// 合わせる。フレームごとの再アロケーションを避けるため、オブジェクト自体はモジュール
// ロード時に一度だけ作り、以後はフィールドをその場で書き換える。
if (!globalThis.breathEyeRectL) globalThis.breathEyeRectL = { left: 0, top: 0, w: 0, h: 0 }
if (!globalThis.breathEyeRectR) globalThis.breathEyeRectR = { left: 0, top: 0, w: 0, h: 0 }

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
        // v1.2.0 (E1) — emotion.js の eyeScale(1 + 0.06a)を脈動スケールに乗算する
        // (覚醒で目が大きく・沈静で小さく。疑似プロクセミクス)。
        const emoScale = globalThis.breathEyeScale ?? 1
        const scaleY = (1 + pulse * breathDepth) * emoScale
        const scaleX = (1 + pulse * breathDepth * BREATH_SCALE_X_RATIO) * emoScale

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
        // デバッグ計器(GET /status の dbgGaze から読む。一瞥の符号バグ調査 2026-07-07)
        if (side === 'left') globalThis.breathDbgGazeL = gazeX
        else globalThis.breathDbgGazeR = gazeX

        // v1.2.0 (E1) — emotion.js の eyeLift(a*4px)。覚醒で上へ(y は画面下方向が正なので減算)。
        const emoLift = globalThis.breathEyeLift ?? 0
        // 呼吸ボブ: 吸う(pulse→1)と浮き、吐く(pulse→0)と沈む。
        const bobY = pulse * (globalThis.breathBobPx ?? BREATH_BOB_PX_DEFAULT)

        const left = quantize(cx - w / 2 + gazeX + driftX, QUANTIZE_PX)
        const top = quantize(cy - h / 2 + gazeY + driftY - emoLift - bobY, QUANTIZE_PX)

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

        // occluder(topLid/botArc)がこのフレームの最終矩形に追従するためのブリッジ。
        // 事前に確保済みのオブジェクトのフィールドを書き換えるだけ(アロケーションなし)。
        const rect = side === 'left' ? globalThis.breathEyeRectL : globalThis.breathEyeRectR
        rect.left = left
        rect.top = top
        rect.w = w
        rect.h = h
      }

      rebuildOutline(shape, w, h) {
        const path = Outline.RoundRectPath(0, 0, w, h, radius)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
      }
    },
  }
})

/**
 * v1.2.0 (E1) — 表情変形(B 案の occluder 方式)。目本体(CozmoEye)の Outline は
 * 変えず、黒い遮蔽シェイプを目の上に重ねて変形に見せる(背景が黒なので遮蔽 = 変形。
 * Cozmo と同じ手法)。breath-face.js が各 CozmoEye の直後にこれらを contents へ追加する。
 *
 * 位置合わせは globalThis.breathEyeRectL/R(CozmoEye が毎フレーム書く最終矩形)を読む。
 * 形状パラメータ(topLid/topAngleDeg/botArc)は emotion.js が 1Hz で globalThis に書く
 * 値をそのまま読み、occluder 側で軽く指数平滑化する(OCCLUDER_SMOOTH_RATIO)ことで
 * 1 秒ごとの値更新を毎フレームなめらかに見せる(値そのものの補間は emotion.js ではなく
 * 描画側の責務にして、emotion.js は単純な状態機械のままにする)。
 */
export const TopLidOccluder = Shape.template((opts) => {
  const side = opts.side
  const initialWidth = opts.width ?? 57
  const initialHeight = opts.height ?? 68

  return {
    left: 0,
    top: 0,
    width: initialWidth,
    height: initialHeight,
    visible: false,
    skin: new Skin({ fill: OCCLUDER_FILL }),
    Behavior: class extends Behavior {
      smLid = 0
      lastW = -1
      lastBottomLeft = -1
      lastBottomRight = -1
      lastLeft = Number.NaN
      lastTop = Number.NaN

      onCreate(shape) {
        try {
          const path = Outline.PolygonPath(0, 0, 1, 0, 1, 1, 0, 1)
          shape.fillOutline = Outline.fill(path)
          shape.strokeOutline = undefined
        } catch (error) {
          trace(`[breath-face] top-lid(${side}) onCreate failed: ${error}\n`)
        }
      }

      onFaceContext(shape, face) {
        try {
          this.update(shape, face)
        } catch (error) {
          trace(`[breath-face] top-lid(${side}) onFaceContext failed: ${error}\n`)
        }
      }

      update(shape, face) {
        const rect = side === 'left' ? globalThis.breathEyeRectL : globalThis.breathEyeRectR
        if (!rect || rect.w <= 0) {
          shape.visible = false
          return
        }

        const eye = face.eyes?.[side]
        const blinkOpen = eye ? eye.open : 1
        const emoTopLid = globalThis.breathTopLid ?? 0
        // まばたき(eye.open)との合成は「小さい方の開き」を採用(= より閉じた方が勝つ)。
        const targetLid = Math.max(emoTopLid, 1 - blinkOpen)
        this.smLid += (targetLid - this.smLid) * OCCLUDER_SMOOTH_RATIO

        if (this.smLid <= MIN_VISIBLE_LID_RATIO) {
          shape.visible = false
          return
        }

        const angleDeg = globalThis.breathTopAngleDeg ?? 0
        const lidH = quantize(Math.min(rect.h, this.smLid * rect.h), QUANTIZE_PX)
        const tiltPx = quantize(Math.tan((angleDeg * Math.PI) / 180) * (rect.w / 2), QUANTIZE_PX)
        const inner = Math.max(0, lidH - tiltPx / 2)
        const outer = Math.min(rect.h, lidH + tiltPx / 2)
        // 険しさ(v<0): 外側(鼻から遠い側)がより下がる。side ごとに外側が左右反転する。
        const bottomLeft = side === 'left' ? outer : inner
        const bottomRight = side === 'left' ? inner : outer

        const w = rect.w
        const changed = w !== this.lastW || bottomLeft !== this.lastBottomLeft || bottomRight !== this.lastBottomRight
        if (changed) {
          try {
            const path = Outline.PolygonPath(0, 0, w, 0, w, bottomRight, 0, bottomLeft)
            shape.fillOutline = Outline.fill(path)
            shape.strokeOutline = undefined
          } catch (error) {
            trace(`[breath-face] top-lid(${side}) rebuild failed: ${error}\n`)
            shape.visible = false
            return
          }
          this.lastW = w
          this.lastBottomLeft = bottomLeft
          this.lastBottomRight = bottomRight
        }

        shape.visible = true
        const left = quantize(rect.left, QUANTIZE_PX)
        const top = quantize(rect.top, QUANTIZE_PX)
        if (changed || left !== this.lastLeft || top !== this.lastTop) {
          this.lastLeft = left
          this.lastTop = top
          shape.coordinates = { left, top, width: w, height: Math.max(1, Math.max(bottomLeft, bottomRight)) }
        }
      }
    },
  }
})

// BotArcOccluder(笑いの下弧)は 2026-07-08 に廃止 — ユーザー FB「笑ったときの目に違和感。
// 喜びは目ではなく LED・声色・動きで表現する」。喜び表現は led.js(暖色)・cry(音色)が担う。
