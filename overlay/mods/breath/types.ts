export interface GazeRobot {
  lookAt: (point: [number, number, number]) => void
}

export interface LedRobot {
  led?: { head?: { off: () => void } }
}

export interface PoseRobot {
  setPose: (pose: { rotation: { y: number; p: number; r: number } }, time?: number) => Promise<void>
  setTorque: (torque: boolean) => Promise<void>
  getRotation?: () => Promise<{ y: number; p: number; r: number } | null | undefined>
  driver?: { constructor?: { name?: string } }
  pose?: { body?: { rotation?: { y: number; p: number; r: number } } }
  led?: { head?: { off: () => void } }
}

export interface MicEvent {
  type?: string
  lagX100?: number | null
}

export interface EmotionEvent {
  type?: string
  t?: number
}
