import type { SkillInvocationPolicy, SkillResourceBase } from '@deepseek-ai/dsh-skill'

export type SkillInstallKind = 'copy' | 'link' | 'git'

/** Optional bilingual UI descriptions; `description` remains the canonical fallback. */
export interface SkillLocalizedDescriptions {
  readonly zh: string
  readonly en: string
}

export interface SkillInstallRequest {
  kind: SkillInstallKind
  value: string
}

export interface SkillAdminItem {
  name: string
  description: string
  localizedDescriptions?: SkillLocalizedDescriptions
  /** Declared author/content origin, distinct from the runtime provider and installation source. */
  developer?: string
  whenToUse?: string
  source: string
  provider: string
  enabled: boolean
  invocation: SkillInvocationPolicy
  resourceBase?: SkillResourceBase
  path?: string
  managedKind?: SkillInstallKind
  canToggle: boolean
  canRemove: boolean
}

export interface SkillAdminDetail extends SkillAdminItem {
  content: string
  files: string[]
}

export interface SkillInstallResult {
  name: string
  path: string
}

export interface SkillRemoveResult {
  name: string
}
