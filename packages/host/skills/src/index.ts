/**
 * The official deepseek-harness development skills, bundled as one immutable
 * provider on `ctx.skills`. The eleven skill directories ship verbatim under
 * `assets/skills/` (SKILL.md plus each skill's agents/references/scripts), so
 * a DeepCreator installation gains the same skills the official repository
 * uses for its own development: code review, simplification finding,
 * pre-push checks, docs standards, prose standard, translation, CoT-leakage
 * trimming, agent-note archiving, stacked-PR merging, doc-site sync, and
 * browser-GIF recording.
 *
 * The provider parses each SKILL.md frontmatter the same way the official
 * filesystem provider does (name/description plus the invocation flags), and
 * serves the markdown body with the packaged directory as the resource base,
 * so relative references (references/, agents/, scripts/) resolve.
 */

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'deepcreator-bundled'
const SKILLS_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))
const RESOURCE_BASE = { kind: 'directory', path: SKILLS_DIR } as const

/** Frontmatter fields the provider reads; the official skills only use scalars. */
interface SkillMeta {
  name: string
  description: string
  invocation: SkillInvocationPolicy
}

/** Parse `---`-delimited frontmatter: `key: value` scalar lines. Returns
 *  undefined for a missing fence or required fields, mirroring the official
 *  filesystem provider's contract. */
function parseFrontmatter(raw: string): { meta: SkillMeta; body: string } | undefined {
  if (!raw.startsWith('---\n')) return undefined
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return undefined
  const fields = new Map<string, string>()
  for (const line of raw.slice(4, end).split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const name = fields.get('name')
  const description = fields.get('description')
  if (name === undefined || name === '' || description === undefined || description === '') return undefined
  const unquote = (value: string): string => {
    const trimmed = value.trim()
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }
  return {
    meta: {
      name,
      description: unquote(description),
      invocation: {
        modelInvocable: fields.get('disable-model-invocation') !== 'true',
        userInvocable: fields.get('user-invocable') !== 'false',
      },
    },
    body: raw.slice(end + 5).trimStart(),
  }
}

interface BundledSkill {
  meta: SkillMeta
  /** Absolute path of the skill's SKILL.md. */
  path: string
}

async function loadSkills(): Promise<BundledSkill[]> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  const loaded: BundledSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const markdown = join(SKILLS_DIR, entry.name, 'SKILL.md')
    const parsed = parseFrontmatter(await readFile(markdown, 'utf8'))
    if (parsed === undefined) throw new Error(`bundled skill ${markdown} is missing valid frontmatter`)
    if (parsed.meta.name !== entry.name) {
      throw new Error(`bundled skill ${markdown} frontmatter name does not match its directory`)
    }
    loaded.push({ meta: parsed.meta, path: markdown })
  }
  return loaded
}

// Lazy, once: list() may be the very first interaction with the provider, so
// the packaged catalog loads then — never an empty catalog racing apply().
let skillsPromise: Promise<BundledSkill[]> | undefined

function ensureSkills(): Promise<BundledSkill[]> {
  skillsPromise ??= loadSkills()
  return skillsPromise
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    return (await ensureSkills()).map(skill => ({
      name: skill.meta.name,
      description: skill.meta.description,
      invocation: skill.meta.invocation,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: RESOURCE_BASE,
      rank: BUNDLED_SKILL_RANK,
      path: skill.path,
      locator: skill.path,
    }))
  },
  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (typeof candidate.locator !== 'string') return undefined
    const parsed = parseFrontmatter(await readFile(candidate.locator, 'utf8'))
    if (parsed === undefined) return undefined
    return {
      name: parsed.meta.name,
      description: parsed.meta.description,
      invocation: parsed.meta.invocation,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: RESOURCE_BASE,
      content: parsed.body,
      path: candidate.locator,
    }
  },
}

/** Cordis plugin name. */
export const name = 'skills'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled official-skill provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
