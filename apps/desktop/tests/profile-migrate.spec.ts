import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MANAGED_PROFILE_VERSION,
  managedProfileNeedsRefresh,
  requiredWorkspaceLinks,
} from '../../../scripts/profile-migrate/contract.mjs'

const root = resolve(import.meta.dirname, '..', '..', '..')
const bundlePath = join(root, 'packages', 'bundle', 'deepcreator-web')

describe('managed DeepCreator profile contract', () => {
  it('derives independent Presentation and Browser packages from the bundle', () => {
    const links = requiredWorkspaceLinks(root, bundlePath)
    expect(links.get('@ryanyujazz/dsh-presentation')).toBe(`link:${join(root, 'packages', 'host', 'presentation')}`)
    expect(links.get('@ryanyujazz/dsh-client-presentation')).toBe(`link:${join(root, 'packages', 'client', 'presentation')}`)
    expect(links.get('@ryanyujazz/dsh-browser')).toBe(`link:${join(root, 'packages', 'host', 'browser')}`)
    expect(links.get('@ryanyujazz/dsh-client-ui-browser')).toBe(`link:${join(root, 'packages', 'client', 'ui-browser')}`)
  })

  it('refreshes stale, missing, and retired installed links', async () => {
    const targetDir = await mkdtemp(join(tmpdir(), 'dcb-profile-'))
    const name = '@example/browser'
    const spec = 'link:/workspace/browser'
    const links = new Map([[name, spec]])
    const current = {
      dependencies: { [name]: spec },
      deepcreator: { managed: true, profileVersion: MANAGED_PROFILE_VERSION },
    }
    try {
      await mkdir(join(targetDir, 'node_modules', '@example', 'browser'), { recursive: true })
      expect(managedProfileNeedsRefresh(targetDir, current, links)).toBe(false)
      expect(managedProfileNeedsRefresh(targetDir, {
        ...current,
        deepcreator: { managed: true, profileVersion: MANAGED_PROFILE_VERSION - 1 },
      }, links)).toBe(true)
      expect(managedProfileNeedsRefresh(targetDir, {
        ...current,
        dependencies: { ...current.dependencies, '@ryanyujazz/dsh-browser-mcp': 'link:/retired' },
      }, links)).toBe(true)
      expect(managedProfileNeedsRefresh(targetDir, current, new Map([['@example/missing', spec]]))).toBe(true)
    } finally {
      await rm(targetDir, { recursive: true, force: true })
    }
  })
})
