export type BreathPolicyHost = Readonly<{ apiVersion: number }>

export type BreathPolicy = Readonly<{
  apiVersion: number
  nextBreathScale: (phase: number) => number
}>

export function createPolicy(host: BreathPolicyHost): BreathPolicy {
  if (host.apiVersion !== 1) {
    throw new Error('unsupported breath policy host API')
  }

  return Object.freeze({
    apiVersion: 1,
    nextBreathScale(phase) {
      const normalized = Math.max(0, Math.min(1, Number(phase) || 0))
      return 0.96 + 0.04 * Math.sin(normalized * Math.PI)
    },
  })
}
