import { createAppControllerApplication } from 'app-controller'
import { BreathFace } from 'breath-face'
import { ChatStatusBar } from 'chat-status-bar'
import { RendererCompat } from 'renderer-compat'

/**
 * v1.1.0 — breath-face(顔の再設計 B 案)専用レンダラー。
 * renderer-simple.ts と丸ごと同型: createAppControllerApplication({face, appBar})
 * を RendererCompat でラップし、robot.ts の 5 メソッド Renderer 契約を満たす
 * (renderer-compat.ts / app-controller.ts は無変更)。
 *
 * appBar は SimpleFace と同じ ChatStatusBar を渡す(省略しても common-view の既定に
 * フォールバックして実害なしと判明済みだが、renderer-simple.ts に揃えておく —
 * status-bar/settings-bar は mod.js 側で別途 attach されるオーバーレイなので無関係)。
 */

export function createRenderer(options) {
  return createAppControllerApplication(
    {
      face: new BreathFace(),
      appBar: new ChatStatusBar(),
    },
    { displayListLength: options?.displayListLength ?? 2048 },
  )
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends RendererCompat {
  constructor(options) {
    super({ controller: createRenderer(options) })
  }
}
