import { FaceBase } from 'behaviors/face'
import { createBlinkMotion } from 'motions/blink'
import { CozmoEye, TopLidOccluder, BotArcOccluder } from 'eye-cozmo'

/**
 * v1.1.0 — breath-face(顔の再設計 B 案・Cozmo 理念)。口なし・目 2 つのみ。
 * behaviors/face.ts の FaceBase.template() に乗る(まばたき・視線分配・スキンは
 * FaceBase から無料で継承。behaviors/face.ts 自体は変更しない)。
 *
 * 確定レシピ(docs/tasks/open-items.md「顔の再設計 — B 案(Cozmo 理念)で確定」):
 *   eyeW 57 / eyeH 68 / radius 7 / spacing 122(中心間) / centerY 118
 *   blink 0.9〜5.2s(openMin/openMax) / closeMin 200 / closeMax 400
 *
 * motions は createBlinkMotion だけを渡す。createBreathMotion(FaceBase 既定の
 * 6 秒周期ボブ)は渡さない — B 案では呼吸は目の脈動(eye-cozmo.js が
 * faceContext.mouth.open から計算)であり、独立したボブは「2 つの呼吸」問題の
 * 源になるため(調査済み・再検討不要)。
 *
 * 実機の画面解像度 320×240 を前提にした絶対配置(Breath Face Lab モックアップと
 * 同じ座標系)。呼吸ループ(mod.js)・liveliness.js は無変更で faceContext 経由の
 * まま届く。
 */

const EYE_WIDTH = 57
const EYE_HEIGHT = 68
const EYE_RADIUS = 7
const EYE_SPACING = 122 // 中心間
const EYE_CENTER_Y = 118

const DEFAULT_FACE_LEFT = 0
const DEFAULT_FACE_TOP = 0
const DEFAULT_FACE_WIDTH = 320
const DEFAULT_FACE_HEIGHT = 240

export const BreathFace = FaceBase.template(($ = {}) => {
  const left = $.left ?? DEFAULT_FACE_LEFT
  const top = $.top ?? DEFAULT_FACE_TOP
  const width = $.width ?? DEFAULT_FACE_WIDTH
  const height = $.height ?? DEFAULT_FACE_HEIGHT
  const centerX = width / 2

  return {
    left,
    top,
    width,
    height,
    motions: [createBlinkMotion({ openMin: 900, openMax: 5200, closeMin: 200, closeMax: 400 })],
    contents: [
      new CozmoEye({
        cx: centerX - EYE_SPACING / 2,
        cy: EYE_CENTER_Y,
        width: EYE_WIDTH,
        height: EYE_HEIGHT,
        radius: EYE_RADIUS,
        side: 'left',
      }),
      // v1.2.0 (E1) — 表情変形(occluder)。目本体の直後に置くことで、同一フレーム内で
      // globalThis.breathEyeRectL/R(目本体が書く)を occluder が読める(FaceBase の
      // onFaceContext は distribute で全 contents に配られるため、実際は前後関係に
      // 厳密には依存しないが、意図が伝わるようこの順で並べる)。
      new TopLidOccluder({ cx: centerX - EYE_SPACING / 2, cy: EYE_CENTER_Y, width: EYE_WIDTH, height: EYE_HEIGHT, side: 'left' }),
      new BotArcOccluder({ cx: centerX - EYE_SPACING / 2, cy: EYE_CENTER_Y, width: EYE_WIDTH, height: EYE_HEIGHT, side: 'left' }),
      new CozmoEye({
        cx: centerX + EYE_SPACING / 2,
        cy: EYE_CENTER_Y,
        width: EYE_WIDTH,
        height: EYE_HEIGHT,
        radius: EYE_RADIUS,
        side: 'right',
      }),
      new TopLidOccluder({ cx: centerX + EYE_SPACING / 2, cy: EYE_CENTER_Y, width: EYE_WIDTH, height: EYE_HEIGHT, side: 'right' }),
      new BotArcOccluder({ cx: centerX + EYE_SPACING / 2, cy: EYE_CENTER_Y, width: EYE_WIDTH, height: EYE_HEIGHT, side: 'right' }),
    ],
  }
})
