// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPanel } from '../src/client/ArtifactPanel.tsx'
import { EMPTY_ARTIFACTS_SNAPSHOT } from '../src/client/artifact-contract.ts'
import type { ArtifactsSnapshot } from '../src/client/artifact-contract.ts'
import { artifactParentDirectory, artifactPathSegments } from '../src/client/artifact-view-model.ts'

afterEach(cleanup)

function snapshotOf(records: Array<{ path: string; updatedAt: number; turn: number }>): ArtifactsSnapshot {
  return { records }
}

function props(snapshot: ArtifactsSnapshot, read: ReturnType<typeof vi.fn> = vi.fn()) {
  const contributions: Array<{ tabLabels: Record<string, string>; tabFilePaths: Record<string, string> }> = []
  return {
    input: {
      artifacts: { read },
      useSession: (selector: (state: never) => unknown) => selector({ views: new Map([['artifacts', snapshot]]) } as never),
      sessionId: 'session-1',
      route: 'home',
      typeId: 'artifact',
      tabs: [],
      openInstance: vi.fn(),
      openContainingFolder: vi.fn(),
      activateInstance: vi.fn(),
      closeInstance: vi.fn(),
      showHome: vi.fn(),
      contributeHeaderActions: () => () => undefined,
      contributePanelInfo: (contribution: { tabLabels: Record<string, string>; tabFilePaths: Record<string, string> }) => { contributions.push(contribution); return () => undefined },
      renderArtifact: (owner: { artifactId: string; content: string }) => <pre data-artifact={owner.artifactId}>{owner.content}</pre>,
      t: (key: string) => key,
    } as unknown as ComponentProps<typeof ArtifactPanel>,
    contributions,
    read,
  }
}

describe('ArtifactPanel', () => {
  it('omits absolute slash roots while keeping meaningful breadcrumb segments', () => {
    expect(artifactPathSegments('/repo/src/a.ts')).toEqual(['repo', 'src', 'a.ts'])
    expect(artifactPathSegments('E:\\repo\\src\\a.ts')).toEqual(['E:', 'repo', 'src', 'a.ts'])
    expect(artifactPathSegments('\\\\server\\share\\a.ts')).toEqual(['server', 'share', 'a.ts'])
  })

  it('resolves containing folders across host path formats', () => {
    expect(artifactParentDirectory('/repo/src/a.ts')).toBe('/repo/src')
    expect(artifactParentDirectory('E:\\repo\\src\\a.ts')).toBe('E:\\repo\\src')
    expect(artifactParentDirectory('/a.ts')).toBe('/')
    expect(artifactParentDirectory('E:\\a.ts')).toBe('E:\\')
  })

  it('keeps the path tail visible and fades its leading edge only when truncated', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-artifact/src/client/ArtifactPanel.module.css'), 'utf8')
    expect(stylesheet).toMatch(/\.pathViewport\[data-truncated\]\s*\{[^}]*justify-content:\s*flex-end;/)
    expect(stylesheet).toMatch(/\.pathViewport\[data-truncated\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right, transparent 0, #000 16px, #000 100%\);/)
  })

  it('renders the produced-files list with basename, path and age, and opens instances', () => {
    const a = { path: 'E:/repo/plan.md', updatedAt: 1_000, turn: 1 }
    const b = { path: 'E:/repo/docs/notes.md', updatedAt: 2_000, turn: 2 }
    const input = props(snapshotOf([b, a]))
    const view = render(<ArtifactPanel {...input.input} />)

    expect(view.getByText('plan.md')).toBeTruthy()
    expect(view.getByText('E:/repo/plan.md')).toBeTruthy()
    expect(view.getByText('notes.md')).toBeTruthy()
    expect(view.getByText('E:/repo/docs/notes.md')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-file-icon="markdown"]')).toHaveLength(2)

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
      tabFilePaths: { 'E:/repo/a/plan.md': 'E:/repo/a/plan.md', 'E:/repo/b/plan.md': 'E:/repo/b/plan.md', 'E:/repo/c/report.md': 'E:/repo/c/report.md' },
    })
  })

  it('renders a Read-opened workspace file even when it is not a produced record', async () => {
    const path = '/workspace/src/read-only.ts'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, content: 'export const value = 1' } }))
    const input = props(EMPTY_ARTIFACTS_SNAPSHOT, read)
    const view = render(<ArtifactPanel {...input.input} tabs={[path]} route="instance" activeInstanceId={path} />)

    await waitFor(() => { expect(view.getByText('export const value = 1')).toBeTruthy() })
    expect(read).toHaveBeenCalledWith('session-1', path)
    expect(input.contributions.at(-1)).toEqual({
      tabLabels: { [path]: 'read-only.ts' },
      tabFilePaths: { [path]: path },
    })
  })

  it('re-reads instance content only when the active path changes', async () => {
    let content = 'v1'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, content } }))
    const artifacts = { read }
    const openContainingFolder = vi.fn()
    const instanceProps = (snapshot: ArtifactsSnapshot, active: string) => ({
      ...props(snapshot).input,
      artifacts,
      openContainingFolder,
      route: 'instance' as const,
      activeInstanceId: active,
    })
    const view = render(<ArtifactPanel {...instanceProps(snapshotOf([{ path: 'E:/repo/a.md', updatedAt: 1_000, turn: 1 }]), 'E:/repo/a.md')} />)

    await waitFor(() => { expect(view.getByText('v1')).toBeTruthy() })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('session-1', 'E:/repo/a.md')
    const pathBar = view.container.querySelector('[data-artifact-path="E:/repo/a.md"]')
    expect(pathBar?.getAttribute('aria-label')).toBe('E:/repo/a.md')
    expect([...pathBar!.querySelectorAll('[data-artifact-path-segment]')].map(segment => segment.textContent)).toEqual(['E:', 'repo', 'a.md'])
    expect(pathBar?.querySelector('[data-file-icon="markdown"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'openFolder' }))
    expect(openContainingFolder).toHaveBeenCalledWith('E:/repo/a.md')

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
