// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import { en } from '../src/client/locales.ts'
import type { SkillAdminDetail, SkillAdminItem } from '@ryanyujazz/dsh-skill-admin/types'

afterEach(cleanup)

const item: SkillAdminItem = {
  name: 'code-review', description: 'Review code changes', source: 'user-dsh', provider: 'filesystem',
  localizedDescriptions: { zh: '审查代码变更', en: 'Review code changes' },
  developer: 'Example Studio',
  enabled: true, invocation: { modelInvocable: true, userInvocable: true }, canToggle: true, canRemove: true,
  path: '/tmp/code-review/SKILL.md', resourceBase: { kind: 'directory', path: '/tmp/code-review' },
}
const detail: SkillAdminDetail = { ...item, content: '# Review\nFollow the checklist.', files: ['SKILL.md'] }
const t = ((key: keyof typeof en) => en[key]) as never

function mount() {
  const actions = {
    list: vi.fn(async () => [item]),
    detail: vi.fn(async () => detail),
    setEnabled: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    openLocation: vi.fn(async () => undefined),
    openPlugins: vi.fn(),
    description: vi.fn((value: SkillAdminItem) => value.localizedDescriptions?.zh ?? value.description),
  }
  render((<SkillsSection {...actions as never} t={t} close={vi.fn()} />) as never)
  return actions
}

describe('SkillsSection', () => {
  it('keeps the switch independent from card navigation and opens details from the card body', async () => {
    const actions = mount()
    expect(await screen.findByText('code-review')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /code-review/ }))
    await waitFor(() => { expect(actions.setEnabled).toHaveBeenCalledWith('code-review', false) })
    expect(actions.detail).not.toHaveBeenCalled()

    expect(screen.getByText('审查代码变更')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /code-review审查代码变更/ }))
    expect(await screen.findByText('Instructions')).toBeTruthy()
    expect(screen.getByText('Example Studio')).toBeTruthy()
    expect(screen.getByText(/Follow the checklist/)).toBeTruthy()
    expect(actions.detail).toHaveBeenCalledWith('code-review')
  })

  it('filters the shared card list locally', async () => {
    mount()
    expect(await screen.findByText('code-review')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.getByText('No matching skills.')).toBeTruthy()
  })

  it('searches both localized descriptions even when another locale is displayed', async () => {
    mount()
    expect(await screen.findByText('审查代码变更')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Review code' } })
    expect(screen.getByText('code-review')).toBeTruthy()
  })
})
