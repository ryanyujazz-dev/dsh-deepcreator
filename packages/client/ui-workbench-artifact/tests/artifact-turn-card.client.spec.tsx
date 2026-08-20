// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactTurnCard } from '../src/client/ArtifactTurnCard.tsx'

afterEach(cleanup)

describe('ArtifactTurnCard', () => {
  it('expands only this turn files, opens file artifacts, and has no undo action', () => {
    const openFile = vi.fn()
    const openArtifacts = vi.fn()
    const view = render(<ArtifactTurnCard {...({
      turn: { turn: 5 },
      matched: ['docs/report.md', 'src/index.ts'],
      openFile,
      openArtifacts,
      t: (key: string, params?: Record<string, unknown>) => key === 'turnCard.files'
        ? `产物 ${String(params?.count)} 个文件`
        : '查看',
    } as never)} />)

    expect(view.getByText('产物 2 个文件')).not.toBeNull()
    expect(view.queryByText('docs/report.md')).toBeNull()
    expect(view.queryByRole('button', { name: '撤销' })).toBeNull()
    fireEvent.click(view.getByText('产物 2 个文件'))
    fireEvent.click(view.getByText('docs/report.md'))
    expect(openFile).toHaveBeenCalledWith('docs/report.md')
    fireEvent.click(view.getByRole('button', { name: '查看' }))
    expect(openArtifacts).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-turn-artifact-card="5"]')).not.toBeNull()
  })
})
