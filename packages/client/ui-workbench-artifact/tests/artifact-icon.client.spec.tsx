// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactIcon } from '../src/client/ArtifactIcon.tsx'
import { markArtifactsSeen, readArtifactsSeen } from '../src/client/artifact-badge-store.ts'
import type { ArtifactsSnapshot, PlansSnapshot } from '../src/client/artifact-contract.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function snapshotOf(updatedAt: number): ArtifactsSnapshot {
  return updatedAt === 0 ? { records: [] } : { records: [{ path: 'E:/repo/a.md', updatedAt, turn: 1 }] }
}

function renderIcon(snapshot: ArtifactsSnapshot, sessionId = 'session-1', visible = true, plans: PlansSnapshot = { records: [] }) {
  return render((
    <ArtifactIcon
      size={14}
      visible={visible}
      sessionId={sessionId}
      useSession={(selector: (state: never) => unknown) => selector({ views: new Map([['artifacts', snapshot], ['plans', plans]]) } as never)}
    />
  ))
}

describe('ArtifactIcon badge', () => {
  it('includes a newly submitted plan in the unread watermark', () => {
    markArtifactsSeen('session-1', 100)
    const view = renderIcon(snapshotOf(0), 'session-1', false, { records: [{
      callId: 'p1', title: 'Plan', markdown: '# Plan', status: 'pending', turn: 1, updatedAt: 5_000, seq: 5,
    }] })
    expect(view.container.querySelector('[data-artifact-badge]')).not.toBeNull()
  })

  it('shows no dot without produced files and no dot after the session was seen', () => {
    const unseen = renderIcon(snapshotOf(0))
    expect(unseen.container.querySelector('[data-artifact-badge]')).toBeNull()

    markArtifactsSeen('session-1', 5_000)
    const seen = renderIcon(snapshotOf(1_000))
    expect(seen.container.querySelector('[data-artifact-badge]')).toBeNull()
  })

  it('advances the seen watermark while visible so the dot clears', async () => {
    markArtifactsSeen('session-1', 100)
    const view = renderIcon(snapshotOf(5_000))
    await waitFor(() => { expect(readArtifactsSeen('session-1')).toBe(5_000) })
    await waitFor(() => { expect(view.container.querySelector('[data-artifact-badge]')).toBeNull() })
  })

  it('keeps the dot while the group is hidden and only marks seen when visible', async () => {
    markArtifactsSeen('session-1', 100)
    const hidden = renderIcon(snapshotOf(5_000), 'session-1', false)
    expect(hidden.container.querySelector('[data-artifact-badge]')).not.toBeNull()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(readArtifactsSeen('session-1')).toBe(100)

    const visible = renderIcon(snapshotOf(5_000))
    await waitFor(() => { expect(readArtifactsSeen('session-1')).toBe(5_000) })
    await waitFor(() => { expect(visible.container.querySelector('[data-artifact-badge]')).toBeNull() })
  })

  it('keeps per-session watermarks separate', async () => {
    markArtifactsSeen('session-1', 100)
    const hidden = renderIcon(snapshotOf(5_000), 'session-2', false)
    expect(hidden.container.querySelector('[data-artifact-badge]')).not.toBeNull()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(readArtifactsSeen('session-1')).toBe(100)
    expect(readArtifactsSeen('session-2')).toBe(0)
  })
})
