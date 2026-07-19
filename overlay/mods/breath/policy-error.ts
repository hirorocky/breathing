import 'piu/MC'
import type { Container as PiuContainer } from 'piu/MC'

const errorSkin = new Skin({ fill: '#ffffff' })
const titleStyle = new Style({ font: '24px Open Sans', color: '#000000' })
const bodyStyle = new Style({ font: '16px Open Sans', color: '#000000' })

const PolicyError = Container.template(() => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  skin: errorSkin,
  contents: [
    new Label(null, { left: 12, right: 12, top: 42, height: 32, style: titleStyle, string: 'POLICY ERROR' }),
    new Label(null, {
      left: 12,
      right: 12,
      top: 86,
      height: 72,
      style: bodyStyle,
      string: 'XSA update failed.\nUSB or host OTA recovery required.',
    }),
  ],
}))

type ErrorRobot = { renderer?: { application?: unknown; addDecorator(content: PiuContainer): void } }
type ErrorGlobals = typeof globalThis & { breathPolicyNativeError?: string; breathPolicyNativeBuildId?: string }

export function attachPolicyError(robot: ErrorRobot): void {
  const globals = globalThis as ErrorGlobals
  const app = robot.renderer?.application
  if (!app || !globals.breathPolicyNativeError) return
  const screen = new PolicyError({})
  robot.renderer?.addDecorator(screen)
  trace(
    `[policy] error screen: ${globals.breathPolicyNativeError} build=${globals.breathPolicyNativeBuildId ?? 'unknown'}\n`,
  )
}
