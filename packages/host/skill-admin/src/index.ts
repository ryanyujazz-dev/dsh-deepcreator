import { execFile } from 'node:child_process'
import {
  cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  isSkillName, type SkillCandidate, type SkillDefinition, type SkillProvider,
  type SkillProviderControl, type SkillResourceBase, type SkillSummary, type SkillViewOptions,
} from '@deepseek-ai/dsh-skill'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type {
  SkillAdminDetail, SkillAdminItem, SkillAdminTarget, SkillInstallKind, SkillInstallRequest,
  SkillInstallResult, SkillLocalizedDescriptions, SkillRemoveResult,
} from './types.ts'

export type {
  SkillAdminDetail, SkillAdminItem, SkillAdminTarget, SkillInstallKind, SkillInstallRequest,
  SkillInstallResult, SkillLocalizedDescriptions, SkillRemoveResult,
} from './types.ts'

const execFileAsync = promisify(execFile)
const POLICY_PROVIDER = 'deepcreator-skill-policy'
const SETTINGS_KEY = settingsNamespace('skill-management')
const MAX_FILES = 200

interface DisabledSkill {
  name: string
  description: string
  whenToUse?: string
  source: string
  provider: string
  path: string
  modelInvocable: boolean
  userInvocable: boolean
  localizedDescriptions?: SkillLocalizedDescriptions
  developer?: string
}

interface ManagedSkill {
  name: string
  kind: SkillInstallKind
  origin: string
}

interface SkillManagementSettings {
  disabled: DisabledSkill[]
  managed: ManagedSkill[]
}

const disabledSchema = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string(),
  source: z.string(),
  provider: z.string(),
  path: z.string(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
  localizedDescriptions: z.object({ zh: z.string(), en: z.string() }),
  developer: z.string(),
})

const managedSchema = z.object({
  name: z.string(),
  kind: z.union(['copy', 'link', 'git']),
  origin: z.string(),
})

const settingsSchema: z<SkillManagementSettings> = z.object({
  disabled: z.array(disabledSchema).default([]),
  managed: z.array(managedSchema).default([]),
})

interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  content: string
}

function parseSkill(raw: string, path: string): ParsedSkill {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) throw new Error(`${path} has no YAML frontmatter`)
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) throw new Error(`${path} has unterminated YAML frontmatter`)
  const frontmatter = parseYaml(normalized.slice(4, end)) as unknown
  if (typeof frontmatter !== 'object' || frontmatter === null) throw new Error(`${path} has invalid YAML frontmatter`)
  const fields = frontmatter as Record<string, unknown>
  const name = fields.name
  const description = fields.description
  if (typeof name !== 'string' || !isSkillName(name)) throw new Error(`${path} has an invalid skill name`)
  if (typeof description !== 'string' || description.trim() === '') throw new Error(`${path} has no description`)
  const whenToUse = fields.whenToUse
  return {
    name,
    description,
    ...(typeof whenToUse === 'string' ? { whenToUse } : {}),
    content: normalized.slice(end + 5).trimStart(),
  }
}

function resourceBaseFor(path: string): SkillResourceBase {
  return { kind: 'directory', path: dirname(path) }
}

function parseLocalizedDescriptions(value: unknown): SkillLocalizedDescriptions | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { zh, en } = value as Record<string, unknown>
  if (typeof zh !== 'string' || zh.trim() === '' || typeof en !== 'string' || en.trim() === '') return undefined
  return { zh, en }
}

function localizedDescriptions(metadata?: Readonly<Record<string, unknown>>): SkillLocalizedDescriptions | undefined {
  return parseLocalizedDescriptions(metadata?.localizedDescriptions)
}

function skillDeveloper(metadata?: Readonly<Record<string, unknown>>): string | undefined {
  const value = metadata?.developer
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

class DisabledSkillProvider implements SkillProvider {
  readonly name = POLICY_PROVIDER

  constructor(private readonly settings: SettingsScope<SkillManagementSettings>) {}

  async list(): Promise<readonly SkillCandidate[]> {
    return this.settings.get().disabled.map((skill) => {
      const descriptions = parseLocalizedDescriptions(skill.localizedDescriptions)
      return {
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        invocation: { modelInvocable: false, userInvocable: false },
        source: skill.source,
        provider: POLICY_PROVIDER,
        resourceBase: resourceBaseFor(skill.path),
        rank: 0,
        locator: skill.name,
        path: skill.path,
        metadata: {
          originalProvider: skill.provider,
          ...(skill.developer === undefined ? {} : { developer: skill.developer }),
          ...(descriptions === undefined ? {} : { localizedDescriptions: descriptions }),
        },
      }
    })
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const record = this.settings.get().disabled.find(skill => skill.name === candidate.name)
    if (record === undefined) return undefined
    let parsed: ParsedSkill
    try {
      parsed = parseSkill(await readFile(record.path, 'utf8'), record.path)
    } catch {
      return undefined
    }
    const descriptions = parseLocalizedDescriptions(record.localizedDescriptions)
    return {
      name: record.name,
      description: record.description,
      ...(record.whenToUse === undefined ? {} : { whenToUse: record.whenToUse }),
      invocation: { modelInvocable: false, userInvocable: false },
      source: record.source,
      provider: POLICY_PROVIDER,
      resourceBase: resourceBaseFor(record.path),
      path: record.path,
      metadata: {
        originalProvider: record.provider,
        ...(record.developer === undefined ? {} : { developer: record.developer }),
        ...(descriptions === undefined ? {} : { localizedDescriptions: descriptions }),
      },
      content: parsed.content,
    }
  }
}

/** Host-side Skill catalog and lifecycle operations for the Settings UI. */
export class SkillAdmin extends TypertRemoteService {
  static inject = ['agents', 'skills', 'settings']

  private readonly settings: SettingsScope<SkillManagementSettings>
  private readonly invalidates = new Set<() => void>()
  private readonly scopedPolicies = new Map<Agent, { dispose(): Promise<void> }>()

  constructor(ctx: Context) {
    super(ctx, 'skill-admin')
    this.settings = ctx.settings.register(SETTINGS_KEY, settingsSchema)
    this.registerPolicy(ctx)
    const attachPolicy = (agent: Agent): void => {
      if (this.scopedPolicies.has(agent)) return
      this.scopedPolicies.set(agent, agent.ctx.inject(['skills'], ready => this.registerPolicy(ready)))
    }
    for (const agent of ctx.agents.list()) attachPolicy(agent)
    ctx.on('agent/created', ({ agent }) => { attachPolicy(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      const policy = this.scopedPolicies.get(agent)
      this.scopedPolicies.delete(agent)
      if (policy !== undefined) void policy.dispose()
    })
    ctx.effect(() => () => {
      for (const policy of this.scopedPolicies.values()) void policy.dispose()
      this.scopedPolicies.clear()
    }, 'skill-admin: scoped policy providers')
    ctx.effect(() => this.settings.watch(() => { this.invalidateCatalogs() }), 'skill-admin: policy settings watcher')
  }

  @Remote('list')
  async list(target?: SkillAdminTarget): Promise<SkillAdminItem[]> {
    const lookup = this.lookup(target)
    const summaries = await this.ctx.skills.list(lookup)
    return Promise.all(summaries.map(summary => this.item(summary, target?.cwd, lookup)))
  }

  @Remote('detail')
  async detail(name: string, target?: SkillAdminTarget): Promise<SkillAdminDetail> {
    const lookup = this.lookup(target)
    const definition = await this.ctx.skills.get(name, lookup)
    if (definition === undefined) throw new Error(`Skill "${name}" was not found.`)
    const item = await this.item(definition, target?.cwd, lookup)
    return {
      ...item,
      content: definition.content,
      files: definition.path === undefined ? [] : await listSkillFiles(definition.path),
    }
  }

  @Remote('setEnabled')
  async setEnabled(name: string, enabled: boolean, target?: SkillAdminTarget): Promise<void> {
    const current = this.settings.get()
    const disabled = current.disabled.find(skill => skill.name === name)
    if (enabled) {
      if (disabled === undefined) return
      await this.settings.update({ disabled: current.disabled.filter(skill => skill.name !== name) })
      this.invalidateCatalogs()
      return
    }
    if (disabled !== undefined) return
    const definition = await this.ctx.skills.get(name, this.lookup(target))
    if (definition === undefined) throw new Error(`Skill "${name}" was not found.`)
    if (definition.path === undefined || !isAbsolute(definition.path)) {
      throw new Error(`Skill "${name}" has no host-local definition and cannot be disabled individually.`)
    }
    const descriptions = localizedDescriptions(definition.metadata)
    const developer = skillDeveloper(definition.metadata)
    const record: DisabledSkill = {
      name: definition.name,
      description: definition.description,
      ...(definition.whenToUse === undefined ? {} : { whenToUse: definition.whenToUse }),
      source: definition.source,
      provider: definition.provider,
      path: definition.path,
      modelInvocable: definition.invocation.modelInvocable,
      userInvocable: definition.invocation.userInvocable,
      ...(descriptions === undefined ? {} : { localizedDescriptions: descriptions }),
      ...(developer === undefined ? {} : { developer }),
    }
    await this.settings.update({ disabled: [...current.disabled, record] })
    this.invalidateCatalogs()
  }

  @Remote('installSkill')
  async installSkill(request: SkillInstallRequest): Promise<SkillInstallResult> {
    const value = request.value.trim()
    if (value === '') throw new Error('A source path or Git URL is required.')
    const userRoot = userSkillRoot()
    await mkdir(userRoot, { recursive: true })
    if (request.kind === 'git') return this.installGit(value, userRoot)
    const source = resolve(value)
    const stat = await lstat(source)
    if (!stat.isDirectory()) throw new Error('The selected Skill source is not a directory.')
    const parsed = parseSkill(await readFile(join(source, 'SKILL.md'), 'utf8'), join(source, 'SKILL.md'))
    const target = join(userRoot, parsed.name)
    await assertTargetAvailable(target)
    if (request.kind === 'link') {
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    } else {
      await atomicCopy(source, target, userRoot)
    }
    await this.rememberManaged(parsed.name, request.kind, value)
    return { name: parsed.name, path: target }
  }

  @Remote('removeSkill')
  async removeSkill(name: string, target?: SkillAdminTarget): Promise<SkillRemoveResult> {
    const definition = await this.ctx.skills.get(name, this.lookup(target))
    if (definition?.path === undefined) throw new Error(`Skill "${name}" has no removable host path.`)
    const removable = await removableTarget(definition.path, target?.cwd)
    if (removable === undefined) throw new Error(`Skill "${name}" is provided by an immutable or unmanaged source.`)
    await rm(removable, { recursive: true, force: false })
    const current = this.settings.get()
    await this.settings.update({
      disabled: current.disabled.filter(skill => skill.name !== name),
      managed: current.managed.filter(skill => skill.name !== name),
    })
    this.invalidateCatalogs()
    return { name }
  }

  private async item(summary: SkillSummary, cwd: string | undefined, lookup: SkillViewOptions): Promise<SkillAdminItem> {
    const disabled = this.settings.get().disabled.find(skill => skill.name === summary.name)
    const definition = await this.ctx.skills.get(summary.name, lookup)
    const path = definition?.path ?? disabled?.path
    const provider = disabled?.provider ?? summary.provider
    const managedKind = this.settings.get().managed.find(skill => skill.name === summary.name)?.kind
    const descriptions = parseLocalizedDescriptions(disabled?.localizedDescriptions)
      ?? localizedDescriptions(definition?.metadata)
    const developer = disabled?.developer ?? skillDeveloper(definition?.metadata)
    return {
      name: summary.name,
      description: disabled?.description ?? summary.description,
      ...(descriptions === undefined ? {} : { localizedDescriptions: descriptions }),
      ...(developer === undefined ? {} : { developer }),
      ...((disabled?.whenToUse ?? summary.whenToUse) === undefined
        ? {}
        : { whenToUse: disabled?.whenToUse ?? summary.whenToUse }),
      source: disabled?.source ?? summary.source,
      provider,
      enabled: disabled === undefined,
      invocation: disabled === undefined
        ? summary.invocation
        : { modelInvocable: disabled.modelInvocable, userInvocable: disabled.userInvocable },
      ...(summary.resourceBase === undefined ? {} : { resourceBase: summary.resourceBase }),
      ...(path === undefined ? {} : { path }),
      ...(managedKind === undefined ? {} : { managedKind }),
      canToggle: path !== undefined,
      canRemove: path !== undefined && await removableTarget(path, cwd) !== undefined,
    }
  }

  private async rememberManaged(name: string, kind: SkillInstallKind, origin: string): Promise<void> {
    const current = this.settings.get()
    await this.settings.update({
      managed: [...current.managed.filter(skill => skill.name !== name), { name, kind, origin }],
    })
    this.invalidateCatalogs()
  }

  private registerPolicy(owner: Context): () => void {
    const skills = owner.get('skills')
    if (skills === undefined) throw new Error('Skill policy registration requires the official skills service.')
    return skills.registerProvider((control: SkillProviderControl) => {
      const invalidate = control.invalidate
      this.invalidates.add(invalidate)
      control.signal.addEventListener('abort', () => { this.invalidates.delete(invalidate) }, { once: true })
      return new DisabledSkillProvider(this.settings)
    })
  }

  private invalidateCatalogs(): void {
    for (const invalidate of this.invalidates) invalidate()
  }

  private lookup(target?: SkillAdminTarget): SkillViewOptions {
    const lookup = normalizeLookup(target?.cwd)
    const sessionId = target?.sessionId?.trim()
    if (sessionId === undefined || sessionId === '') return lookup
    const agent = this.ctx.agents.get(sessionId as Agent['id'])
    return agent === undefined ? lookup : { ...lookup, scope: agent }
  }

  private async installGit(url: string, userRoot: string): Promise<SkillInstallResult> {
    assertGitUrl(url)
    const checkout = await mkdtemp(join(tmpdir(), 'deepcreator-skill-git-'))
    try {
      await execFileAsync('git', ['clone', '--depth', '1', '--', url, checkout], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
      })
      const source = await findSkillRoot(checkout)
      const skillFile = join(source, 'SKILL.md')
      const parsed = parseSkill(await readFile(skillFile, 'utf8'), skillFile)
      const target = join(userRoot, parsed.name)
      await assertTargetAvailable(target)
      await atomicCopy(source, target, userRoot)
      await this.rememberManaged(parsed.name, 'git', url)
      return { name: parsed.name, path: target }
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  }
}

function normalizeLookup(cwd?: string): { cwd?: string } {
  const value = cwd?.trim()
  return value === undefined || value === '' ? {} : { cwd: resolve(value) }
}

function dshHome(): string {
  return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
}

function agentsHome(): string {
  return resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
}

function userSkillRoot(): string { return join(dshHome(), 'skills') }

async function projectRoot(cwd: string): Promise<string> {
  let cursor = resolve(cwd)
  while (true) {
    try {
      const git = await lstat(join(cursor, '.git'))
      if (git.isDirectory() || git.isFile()) return cursor
    } catch {
      // Absence means continue to the parent; other failures are judged when a
      // concrete Skill target is validated.
    }
    const parent = dirname(cursor)
    if (parent === cursor) return resolve(cwd)
    cursor = parent
  }
}

async function allowedRoots(cwd?: string): Promise<string[]> {
  const roots = [userSkillRoot(), join(agentsHome(), 'skills')]
  if (cwd !== undefined && cwd.trim() !== '') {
    const project = await projectRoot(cwd)
    roots.unshift(join(project, '.dsh', 'skills'), join(project, '.agents', 'skills'))
  }
  return roots.map(root => resolve(root))
}

function directChild(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) && !rel.includes(sep)
}

async function removableTarget(skillFile: string, cwd?: string): Promise<string | undefined> {
  const absolute = resolve(skillFile)
  const target = basename(absolute) === 'SKILL.md' ? dirname(absolute) : absolute
  const roots = await allowedRoots(cwd)
  return roots.some(root => directChild(root, target)) ? target : undefined
}

async function listSkillFiles(skillFile: string): Promise<string[]> {
  const root = basename(skillFile) === 'SKILL.md' ? dirname(skillFile) : dirname(skillFile)
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_FILES) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) break
      const absolute = join(directory, entry.name)
      const rel = relative(root, absolute).split(sep).join('/')
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) files.push(rel)
    }
  }
  try { await visit(root) } catch { return [] }
  return files.sort((a, b) => a.localeCompare(b))
}

async function assertTargetAvailable(target: string): Promise<void> {
  try {
    await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error(`A Skill already exists at ${target}.`)
}

async function atomicCopy(source: string, target: string, parent: string): Promise<void> {
  const staging = await mkdtemp(join(parent, '.deepcreator-skill-install-'))
  try {
    // `cp` with errorOnExist requires a non-existent destination. mkdtemp
    // reserves an unpredictable sibling name first; remove only that empty,
    // exact reservation before filling it and atomically renaming it.
    await rm(staging, { recursive: true })
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false })
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

function assertGitUrl(value: string): void {
  if (/^git@[A-Za-z0-9.-]+:[^\s]+$/.test(value)) return
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Enter a valid Git URL.') }
  if (!['https:', 'ssh:', 'git:'].includes(url.protocol)) {
    throw new Error('Only HTTPS, SSH, and git protocol URLs are supported.')
  }
}

async function findSkillRoot(checkout: string): Promise<string> {
  try {
    await lstat(join(checkout, 'SKILL.md'))
    return checkout
  } catch {
    // Fall through to one top-level directory bundle.
  }
  const matches: string[] = []
  for (const entry of await readdir(checkout, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue
    const candidate = join(checkout, entry.name)
    try {
      await lstat(join(candidate, 'SKILL.md'))
      matches.push(candidate)
    } catch {
      // Not a Skill bundle.
    }
  }
  if (matches.length !== 1) {
    throw new Error('The Git repository must contain one Skill at its root or in one top-level directory.')
  }
  return matches[0]!
}

export default SkillAdmin
