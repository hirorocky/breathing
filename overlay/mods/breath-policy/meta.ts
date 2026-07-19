import config from 'mod/config'

const policyConfig = config as typeof config & { policyBuildId?: string }

export type BreathPolicyMeta = Readonly<{
  apiVersion: number
  minHostApiVersion: number
  maxHostApiVersion: number
  schemaVersion: number
  modBuildId: string
}>

const modBuildId = policyConfig.policyBuildId
if (typeof modBuildId !== 'string' || modBuildId.trim().length === 0) {
  throw new Error('policyBuildId build config is required')
}

const meta: BreathPolicyMeta = Object.freeze({
  apiVersion: 1,
  minHostApiVersion: 1,
  maxHostApiVersion: 1,
  schemaVersion: 1,
  modBuildId,
})

export default meta
