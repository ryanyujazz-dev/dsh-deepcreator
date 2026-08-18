// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPanel } from '../src/client/ArtifactPanel.tsx'
import { EMPTY_ARTIFACTS_SNAPSHOT } from '../src/client/artifact-contract.ts'
import type { ArtifactsSnapshot } from '../src/client/artifact-contract.ts'

afterEach(cleanup)

function snapshotOf(records: Array<{ path: string; updatedAt: number; turn: number }>): ArtifactsSnapshot {
  return { records }
}

function props(snapshot: ArtifactsSnapshot, read: ReturnType<typeof vi.fn> = vi.fn()) {
  const contributions: Array<{ tabLabels: Record<string, string> }> = []
  return {
    input: {
      artifacts: { read },
      useSession: (selector: (state: never) => unknown) => selector({ views: new Map([['artifacts', snapshot]]) } as never),
      sessionId: 'session-1',
      route: 'home',
      typeId: 'artifact',
      tabs: [],
      openInstance: vi.fn(),
      activateInstance: vi.fn(),
      closeInstance: vi.fn(),
      showHome: vi.fn(),
      contributeHeaderActions: () => () => undefined,
      contributePanelInfo: (contribution: { tabLabels: Record<string, string> }) => { contributions.push(contribution); return () => undefined },
      renderArtifact: (owner: { artifactId: string; content: string }) => <pre data-artifact={owner.artifactId}>{owner.content}</pre>,
      t: (key: string) => key,
    } as unknown as ComponentProps<typeof ArtifactPanel>,
    contributions,
    read,
  }
}

describe('ArtifactPanel', () => {
  it('renders the produced-files list with basename, path and age, and opens instances', () => {
    const a = { path: 'E:/repo/plan.md', updatedAt: 1_000, turn: 1 }
    const b = { path: 'E:/repo/docs/notes.md', updatedAt: 2_000, turn: 2 }
    const input = props(snapshotOf([b, a]))
    const view = render(<ArtifactPanel {...input.input} />)

    expect(view.getByText('plan.md')).toBeTruthy()
    expect(view.getByText('E:/repo/plan.md')).toBeTruthy()
    expect(view.getByText('notes.md')).toBeTruthy()
    expect(view.getByText('E:/repo/docs/notes.md')).toBeTruthy()

    fireEvent.click(view.getByText('plan.md').closest('button')!)
    expect(input.input.openInstance).toHaveBeenCalledWith('E:/repo/plan.md')
  })

  it('shows the empty state when the projection has no records', () => {
    const input = props(EMPTY_ARTIFACTS_SNAPSHOT)
    const view = render(<ArtifactPanel {...input.input} />)
    expect(view.getByText('empty.title')).toBeTruthy()
    expect(view.getByText('empty.body')).toBeTruthy()
  })

  it('contributes deduplicated tab labels for repeated basenames', () => {
    const input = props(snapshotOf([
      { path: 'E:/repo/a/plan.md', updatedAt: 1_000, turn: 1 },
      { path: 'E:/repo/b/plan.md', updatedAt: 2_000, turn: 2 },
      { path: 'E:/repo/c/report.md', updatedAt: 3_000, turn: 3 },
    ]))
    render(<ArtifactPanel {...input.input} />)

    expect(input.contributions.at(-1)).toEqual({
      tabLabels: { 'E:/repo/a/plan.md': 'plan.md', 'E:/repo/b/plan.md': 'plan.md 2', 'E:/repo/c/report.md': 'report.md' },
    })
  })

  it('re-reads instance content only when the active path changes', async () => {
    let content = 'v1'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, content } }))
    const artifacts = { read }
    const instanceProps = (snapshot: ArtifactsSnapshot, active: string) => ({
      ...props(snapshot).input,
      artifacts,
      route: 'instance' as const,
      activeInstanceId: active,
    })
    const view = render(<ArtifactPanel {...instanceProps(snapshotOf([{ path: 'E:/repo/a.md', updatedAt: 1_000, turn: 1 }]), 'E:/repo/a.md')} />)

    await waitFor(() => { expect(view.getByText('v1')).toBeTruthy() })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('session-1', 'E:/repo/a.md')

    // Same path, fresh snapshot identity: no re-read.
    view.rerender(<ArtifactPanel {...instanceProps(snapshotOf([{ path: 'E:/repo/a.md', updatedAt: 1_000, turn: 1 }]), 'E:/repo/a.md')} />)
    await waitFor(() => { expect(view.getByText('v1')).toBeTruthy() })
    expect(read).toHaveBeenCalledTimes(1)

    // A different artifact path re-reads.
    content = 'v2'
    view.rerender(<ArtifactPanel {...instanceProps(snapshotOf([{ path: 'E:/repo/b.md', updatedAt: 2_000, turn: 2 }]), 'E:/repo/b.md')} />)
    await waitFor(() => { expect(view.getByText('v2')).toBeTruthy() })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('surfaces a read failure for an active path absent from the projection', async () => {
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, code: 'NOT_FOUND' as const, message: 'File missing' } }))
    const input = props(snapshotOf([{ path: 'E:/repo/a.md', updatedAt: 1_000, turn: 1 }]), read)
    const view = render(<ArtifactPanel {...{ ...input.input, route: 'instance', activeInstanceId: 'E:/repo/ghost.md' }} />)

    await waitFor(() => { expect(view.getByText('File missing')).toBeTruthy() })
    expect(read).toHaveBeenCalledWith('session-1', 'E:/repo/ghost.md')
  })
})
