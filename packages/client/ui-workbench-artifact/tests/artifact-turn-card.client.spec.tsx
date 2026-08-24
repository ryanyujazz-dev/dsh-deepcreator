// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
      openInDeepCreator: vi.fn(async () => {}),
      openInSystemBrowser: vi.fn(async () => {}),
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

  it('puts the HTML split open control at the far right of its file row', async () => {
    const openFile = vi.fn()
    const openInDeepCreator = vi.fn(async () => {})
    const openInSystemBrowser = vi.fn(async () => {})
    const view = render(<ArtifactTurnCard {...({
      turn: { turn: 6 },
      matched: ['prototype.html', 'app.ts'],
      openFile,
      openArtifacts: vi.fn(),
      openInDeepCreator,
      openInSystemBrowser,
      t: (key: string) => key,
    } as never)} />)

    fireEvent.click(view.getByText('turnCard.files'))
    const htmlFileButton = view.getByText('prototype.html').closest('button')!
    const openButton = view.getByRole('button', { name: 'open' })
    expect(view.container.querySelector('[data-artifact-html-open="prototype.html"]')).not.toBeNull()
    expect(view.container.querySelectorAll('[data-artifact-html-open]')).toHaveLength(1)
    expect(htmlFileButton.contains(openButton)).toBe(false)
    expect(openButton.className).toMatch(/action/)

    fireEvent.click(openButton)
    await waitFor(() => { expect(openInDeepCreator).toHaveBeenCalledWith('prototype.html') })
    expect(openFile).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'openMenu' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'openInSystemBrowser' }))
    await waitFor(() => { expect(openInSystemBrowser).toHaveBeenCalledWith('prototype.html') })

    fireEvent.click(htmlFileButton)
    expect(openFile).toHaveBeenCalledWith('prototype.html')
  })

  it('keeps the same HTML file row but omits native preview actions remotely', () => {
    const openFile = vi.fn()
    const view = render(<ArtifactTurnCard {...({
      turn: { turn: 7 },
      matched: ['prototype.html'],
      openFile,
      openArtifacts: vi.fn(),
      t: (key: string) => key,
    } as never)} />)

    fireEvent.click(view.getByText('turnCard.files'))
    expect(view.queryByRole('button', { name: 'open' })).toBeNull()
    expect(view.container.querySelector('[data-artifact-html-open]')).toBeNull()
    fireEvent.click(view.getByText('prototype.html'))
    expect(openFile).toHaveBeenCalledWith('prototype.html')
  })

  it('matches the View action typography and transparent treatment', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-artifact/src/client/HtmlArtifactOpenControl.module.css'), 'utf8')
    expect(stylesheet).toMatch(/\.openSplit\s*\{[^}]*height:\s*28px;[^}]*gap:\s*2px;/)
    expect(stylesheet).toMatch(/\.openMenu\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border:\s*0;[^}]*border-radius:\s*6px;[^}]*background:\s*transparent;[^}]*font-size:\s*11px;[^}]*line-height:\s*16px;/)
    expect(stylesheet).not.toMatch(/box-shadow|button-elevated-fill|border-l2/)
  })
})
