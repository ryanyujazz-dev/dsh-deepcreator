// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillAdmin } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

const temporary: string[] = []
const originalDshHome = process.env.DSH_HOME
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

async function bench() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skill-admin-'))
  temporary.push(home)
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(AgentRegistry).await()
  await ctx.plugin(SkillRegistry).await()
  const admin = new SkillAdmin(ctx)
  return { ctx, admin, home }
}

function registerAgent(ctx: Context, id: string) {
  const agent = { id } as unknown as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, {
    options: {}, session: { id, header: { cwd: process.cwd() } }, inbox: {}, status: 'idle', ctx: scope.ctx,
    cancel() {}, whenIdle: async () => undefined, runMaintenance: async () => undefined,
    send() {}, followup() {}, steer() {}, inject() {},
  })
  const unregister = ctx.agents.register(agent)
  return {
    agent,
    async dispose() {
      unregister()
      await scope.dispose()
    },
  }
}

async function seedSkill(root: string, name: string): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'SKILL.md')
  await writeFile(path, `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n\nFollow this skill.\n`)
  return path
}

describe('SkillAdmin', () => {
  it('lists official registry entries and disables one through a reversible policy provider', async () => {
    const { ctx, admin, home } = await bench()
    const path = await seedSkill(join(home, 'skills'), 'test-skill')
    ctx.skills.register({
      name: 'test-skill', description: 'test-skill description', source: 'user-dsh',
      path, resourceBase: { kind: 'directory', path: join(home, 'skills', 'test-skill') }, content: '# test-skill',
      metadata: { developer: 'Example Studio', localizedDescriptions: { zh: '测试技能说明', en: 'test-skill description' } },
    })

    expect(await admin.list()).toMatchObject([{
      name: 'test-skill', enabled: true, canToggle: true, canRemove: true,
      localizedDescriptions: { zh: '测试技能说明', en: 'test-skill description' },
      developer: 'Example Studio',
    }])
    await admin.setEnabled('test-skill', false)
    expect(await ctx.skills.list()).toMatchObject([{
      name: 'test-skill', provider: 'deepcreator-skill-policy',
      invocation: { modelInvocable: false, userInvocable: false },
    }])
    const disabled = await admin.detail('test-skill')
    expect(disabled).toMatchObject({
      enabled: false, provider: 'runtime', content: expect.stringContaining('Follow this skill.'),
      localizedDescriptions: { zh: '测试技能说明', en: 'test-skill description' },
      developer: 'Example Studio',
    })

    await admin.setEnabled('test-skill', true)
    expect(await admin.list()).toMatchObject([{ name: 'test-skill', enabled: true, provider: 'runtime' }])
  })

  it('copies and links local bundles into the personal Skill root', async () => {
    const { admin, home } = await bench()
    const sources = await mkdtemp(join(tmpdir(), 'dsh-skill-sources-'))
    temporary.push(sources)
    const copySource = join(sources, 'copy-source')
    const linkSource = join(sources, 'link-source')
    await seedSkill(sources, 'copy-source')
    await seedSkill(sources, 'link-source')

    expect(await admin.installSkill({ kind: 'copy', value: copySource })).toEqual({
      name: 'copy-source', path: join(home, 'skills', 'copy-source'),
    })
    expect(await readFile(join(home, 'skills', 'copy-source', 'SKILL.md'), 'utf8')).toContain('copy-source description')
    expect(await admin.installSkill({ kind: 'link', value: linkSource })).toEqual({
      name: 'link-source', path: join(home, 'skills', 'link-source'),
    })
    expect(await readFile(join(home, 'skills', 'link-source', 'SKILL.md'), 'utf8')).toContain('link-source description')
  })

  it('projects and disables the effective Skill catalog of a live Agent scope', async () => {
    const { ctx, admin, home } = await bench()
    const live = registerAgent(ctx, 'session-scope')
    const path = await seedSkill(join(home, 'skills'), 'scoped-skill')
    live.agent.ctx.get('skills')!.register({
      name: 'scoped-skill', description: 'scoped-skill description', source: 'user-dsh',
      path, resourceBase: { kind: 'directory', path: join(home, 'skills', 'scoped-skill') }, content: '# scoped',
    })
    const target = { cwd: process.cwd(), sessionId: String(live.agent.id) }

    expect(await admin.list()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'scoped-skill' })]))
    expect(await admin.list(target)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'scoped-skill', enabled: true, provider: 'runtime' }),
    ]))

    await admin.setEnabled('scoped-skill', false, target)
    expect(await ctx.skills.get('scoped-skill', { scope: live.agent })).toMatchObject({
      provider: 'deepcreator-skill-policy',
      invocation: { modelInvocable: false, userInvocable: false },
    })
    const disabled = await admin.detail('scoped-skill', target)
    expect(disabled).toMatchObject({ enabled: false, provider: 'runtime' })
    expect(disabled).not.toHaveProperty('localizedDescriptions')

    await admin.setEnabled('scoped-skill', true, target)
    expect(await ctx.skills.get('scoped-skill', { scope: live.agent })).toMatchObject({
      provider: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true },
    })
    await live.dispose()
  })

  it('removes only direct entries in managed personal or project roots', async () => {
    const { ctx, admin, home } = await bench()
    const path = await seedSkill(join(home, 'skills'), 'remove-me')
    ctx.skills.register({ name: 'remove-me', description: 'remove-me description', source: 'user-dsh', path, content: '# remove' })
    await expect(admin.removeSkill('remove-me')).resolves.toEqual({ name: 'remove-me' })
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const immutable = await seedSkill(home, 'immutable')
    ctx.skills.register({ name: 'immutable', description: 'immutable description', source: 'bundled', path: immutable, content: '# immutable' })
    await expect(admin.removeSkill('immutable')).rejects.toThrow(/immutable or unmanaged/)
  })
})
