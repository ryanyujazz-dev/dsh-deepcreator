// @vitest-environment node
// The bundled official-skill provider: eleven packaged deepseek-harness
// skills register through `ctx.skills` with parsed frontmatter, stripped
// bodies, and a resource base that resolves each skill's packaged files.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'

const OFFICIAL_SKILL_NAMES = [
  'dsh-archive-agent-notes', 'dsh-code-review', 'dsh-doc-site-sync', 'dsh-doc-standards',
  'dsh-find-simplifications', 'dsh-merging-stacked-prs', 'dsh-pre-push-checks', 'dsh-prose-standard',
  'dsh-translate-docs', 'dsh-trim-cot-leakage', 'record-browser-gif',
]

/** Drive `apply()` against a stub `ctx.skills` and return the registered provider. */
async function registeredProvider(): Promise<SkillProvider> {
  let provider: SkillProvider | undefined
  const ctx = {
    skills: {
      registerProvider: (create: (control: { signal: AbortSignal; invalidate: () => void }) => SkillProvider) => {
        provider = create({ signal: new AbortController().signal, invalidate: () => undefined })
        return () => undefined
      },
    },
  }
  apply(ctx as never)
  expect(provider).toBeDefined()
  return provider!
}

describe('bundled official skills provider', () => {
  it('declares the plugin name and required service', () => {
    expect(name).toBe('skills')
    expect(inject).toEqual(['skills'])
  })

  it('lists the eleven official skills as bundled candidates', async () => {
    const provider = await registeredProvider()
    const candidates = await provider.list({}) as readonly SkillCandidate[]
    expect(candidates.map(candidate => candidate.name)).toEqual(OFFICIAL_SKILL_NAMES)
    for (const candidate of candidates) {
      expect(candidate.source).toBe('bundled')
      expect(candidate.provider).toBe('deepcreator-bundled')
      expect(candidate.description.length).toBeGreaterThan(20)
      expect(candidate.rank).toBe(600)
      expect(candidate.resourceBase).toMatchObject({ kind: 'directory' })
      expect(typeof candidate.locator).toBe('string')
    }
  })

  it('serves each body with frontmatter stripped and the invocation policy parsed', async () => {
    const provider = await registeredProvider()
    const candidates = await provider.list({}) as readonly SkillCandidate[]
    for (const candidate of candidates) {
      const definition = await provider.get(candidate, {}) as SkillDefinition
      expect(definition.content).not.toContain('---\nname:')
      expect(definition.content.startsWith('#')).toBe(true)
      expect(definition.name).toBe(candidate.name)
      expect(definition.resourceBase).toEqual(candidate.resourceBase)
    }
    const translate = candidates.find(candidate => candidate.name === 'dsh-translate-docs')
    expect(translate?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    const review = candidates.find(candidate => candidate.name === 'dsh-code-review')
    expect(review?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('resolves packaged skill resources through the directory resource base', async () => {
    const provider = await registeredProvider()
    const candidates = await provider.list({}) as readonly SkillCandidate[]
    const gif = candidates.find(candidate => candidate.name === 'record-browser-gif')
    const prose = candidates.find(candidate => candidate.name === 'dsh-prose-standard')
    const base = gif?.resourceBase
    expect(base?.kind).toBe('directory')
    if (base?.kind === 'directory') {
      const script = await readFile(join(base.path, 'record-browser-gif', 'scripts', 'encode_gif.py'), 'utf8')
      expect(script).toContain('def ')
      const examples = await readFile(join(base.path, 'dsh-prose-standard', 'references', 'examples.md'), 'utf8')
      expect(examples.length).toBeGreaterThan(0)
      expect(prose?.description).toContain('prose')
    }
  })
})
