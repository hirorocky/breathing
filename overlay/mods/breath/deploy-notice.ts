import 'piu/MC'
import type { Container as PiuContainer } from 'piu/MC'
import Timer from 'timer'

const noticeSkin = new Skin({ fill: '#ffffff' })
const noticeStyle = new Style({ font: '20px Open Sans', color: '#000000' })

const Notice = Container.template(() => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  skin: noticeSkin,
  contents: [new Label(null, { left: 0, right: 0, top: 92, height: 40, style: noticeStyle, string: 'UPDATED' })],
}))

type NoticeRobot = {
  renderer?: { addDecorator(content: PiuContainer): void }
  lightRainbow?(name: string): void
  lightOff?(name: string): void
}
type NoticeGlobals = typeof globalThis & {
  breathDeployNoticeScheduled?: boolean
  breathDeployNoticeShown?: boolean
  breathDeployNoticeError?: string
}

/** 起動後の更新通知。音は鳴らさず、画面とヘッドLEDだけを短時間使う。 */
export function showDeployNotice(robot: NoticeRobot): void {
  const globals = globalThis as NoticeGlobals
  globals.breathDeployNoticeScheduled = true
  Timer.set(() => {
    try {
      const notice = new Notice({})
      robot.renderer?.addDecorator(notice)
      robot.lightRainbow?.('head')
      globals.breathDeployNoticeShown = true
      Timer.set(() => {
        notice.visible = false
        robot.lightOff?.('head')
      }, 8000)
      trace('[deploy-notice] UPDATED shown (silent)\n')
    } catch (error) {
      globals.breathDeployNoticeError = String(error)
      trace(`[deploy-notice] failed: ${error}\n`)
    }
  }, 1000)
}
