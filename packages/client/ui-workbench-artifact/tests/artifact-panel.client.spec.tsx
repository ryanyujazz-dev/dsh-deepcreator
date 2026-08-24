// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRendererProps } from '@ryanyujazz/dsh-client-ui-workbench/client'

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: {
    loadAnimation: vi.fn((config: { container: HTMLElement }) => {
      config.container.innerHTML = '<svg data-lottie-player="folder"><path /></svg>'
      return {
        addEventListener: (_event: string, callback: () => void) => { queueMicrotask(callback) },
        removeEventListener: vi.fn(),
        destroy: vi.fn(),
        goToAndPlay: vi.fn(),
        goToAndStop: vi.fn(),
        setDirection: vi.fn(),
      }
    }),
  },
}))

import { ArtifactPanel } from '../src/client/ArtifactPanel.tsx'
import {
  ArtifactDocumentHtmlRenderer, ArtifactDocumentTextRenderer, ArtifactImageRenderer, ArtifactPdfRenderer,
} from '../src/client/ArtifactBinaryRenderers.tsx'
import { EMPTY_ARTIFACTS_SNAPSHOT, EMPTY_PLANS_SNAPSHOT } from '../src/client/artifact-contract.ts'
import type { ArtifactsSnapshot, PlansSnapshot } from '../src/client/artifact-contract.ts'
import {
  artifactParentDirectory, artifactPathSegments, planInstanceId, resolveMarkdownImageArtifactPath,
} from '../src/client/artifact-view-model.ts'

afterEach(cleanup)

function snapshotOf(records: Array<{ path: string; updatedAt: number; turn: number }>): ArtifactsSnapshot {
  return { records }
}

function props(snapshot: ArtifactsSnapshot, read: ReturnType<typeof vi.fn> = vi.fn(), plans: PlansSnapshot = EMPTY_PLANS_SNAPSHOT) {
  const contributions: Array<{ tabLabels: Record<string, string>; tabFilePaths: Record<string, string> }> = []
  return {
    input: {
      artifacts: { read },
      useSession: (selector: (state: never) => unknown) => selector({ views: new Map([['artifacts', snapshot], ['plans', plans]]) } as never),
      sessionId: 'session-1',
      route: 'home',
      typeId: 'artifact',
      tabs: [],
      openInstance: vi.fn(),
      openContainingFolder: vi.fn(),
      closeInstance: vi.fn(),
      showHome: vi.fn(),
      contributeHeaderActions: () => () => undefined,
      contributePanelInfo: (contribution: { tabLabels: Record<string, string>; tabFilePaths: Record<string, string> }) => { contributions.push(contribution); return () => undefined },
      renderArtifact: (owner: ArtifactRendererProps) => {
        if (owner.kind === 'image') return <ArtifactImageRenderer {...owner} />
        if (owner.kind === 'pdf') return <ArtifactPdfRenderer {...owner} />
        if (owner.kind === 'document-html') return <ArtifactDocumentHtmlRenderer {...owner} />
        if (owner.kind === 'document-text') return <ArtifactDocumentTextRenderer {...owner} />
        return <pre data-artifact={owner.artifactId}>{owner.content}</pre>
      },
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

  it('resolves encoded Markdown image destinations from the document directory across path formats', () => {
    expect(resolveMarkdownImageArtifactPath('/repo/docs/report.md', 'images/chart%20one.png?raw=1#view'))
      .toBe('/repo/docs/images/chart one.png')
    expect(resolveMarkdownImageArtifactPath('E:\\repo\\docs\\report.md', '..\\images\\chart.png'))
      .toBe('E:\\repo\\docs\\..\\images\\chart.png')
    expect(resolveMarkdownImageArtifactPath('/repo/docs/report.md', 'https://example.com/chart.png')).toBeUndefined()
    expect(resolveMarkdownImageArtifactPath('/repo/docs/report.md', '%2Foutside.png')).toBeUndefined()
    expect(resolveMarkdownImageArtifactPath('/repo/docs/report.md', 'bad%ZZ.png')).toBeUndefined()
  })

  it('keeps the path tail visible and fades its leading edge only when truncated', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-artifact/src/client/ArtifactPanel.module.css'), 'utf8')
    expect(stylesheet).toMatch(/\.panel\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/)
    expect(stylesheet).toMatch(/\.pathBar\s*\{[^}]*flex:\s*none;/)
    expect(stylesheet).toMatch(/\.content\s*\{[^}]*flex:\s*1;[^}]*overflow:\s*auto;/)
    expect(stylesheet).toMatch(/\.embeddedContent\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/)
    expect(stylesheet).toMatch(/\.markdownDocument\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*var\(--dsh-reading-content-width,\s*748px\);[^}]*margin:\s*0 auto;/)
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

  it('renders current-session plans as a list group before files and opens a markdown plan instance', () => {
    const plan = {
      callId: 'plan-2', title: 'Ship the picker', markdown: '# Ship the picker\n\n- render rows',
      status: 'pending' as const, turn: 4, updatedAt: 3_000, seq: 30,
    }
    const input = props(snapshotOf([{ path: 'E:/repo/a.ts', updatedAt: 2_000, turn: 3 }]), vi.fn(), { records: [plan] })
    const view = render(<ArtifactPanel {...input.input} />)

    const headings = view.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
    expect(headings).toEqual(['group.plans1', 'group.files1'])
    fireEvent.click(view.getByText('Ship the picker').closest('button')!)
    expect(input.input.openInstance).toHaveBeenCalledWith(planInstanceId('plan-2'))

    view.rerender(<ArtifactPanel {...input.input} tabs={[planInstanceId('plan-2')]} route="instance" activeInstanceId={planInstanceId('plan-2')} />)
    expect(view.getByRole('heading', { name: 'Ship the picker', level: 1 })).toBeTruthy()
    expect(view.getByText('render rows')).toBeTruthy()
    expect(input.read).not.toHaveBeenCalled()
    expect(input.contributions.at(-1)).toEqual({
      tabLabels: { 'E:/repo/a.ts': 'a.ts', [planInstanceId('plan-2')]: 'Ship the picker' },
      tabFilePaths: { 'E:/repo/a.ts': 'E:/repo/a.ts' },
    })
  })

  it('consumes a plan reveal target once its current-session projection is available', async () => {
    const plan = {
      callId: 'plan-9', title: 'Reveal me', markdown: '# Reveal me',
      status: 'pending' as const, turn: 5, updatedAt: 5_000, seq: 50,
    }
    const input = props(EMPTY_ARTIFACTS_SNAPSHOT, vi.fn(), { records: [plan] })
    render(<ArtifactPanel {...input.input} reveal={{ target: 'plan-9', parameters: { kind: 'plan' }, nonce: 1 }} />)
    await waitFor(() => { expect(input.input.openInstance).toHaveBeenCalledWith(planInstanceId('plan-9')) })
  })

  it('normalizes every entry point and merges restored relative tabs into one file identity', () => {
    const input = props(snapshotOf([{ path: 'image.png', updatedAt: 1_000, turn: 1 }]))
    const replaceInstanceId = vi.fn()
    const view = render(<ArtifactPanel
      {...input.input}
      workspaceRoot="/workspace"
      tabs={['image.png', '/workspace/image.png']}
      replaceInstanceId={replaceInstanceId}
    />)

    expect(replaceInstanceId).toHaveBeenCalledWith('image.png', '/workspace/image.png')
    fireEvent.click(view.getAllByText('image.png').find(node => node.tagName === 'STRONG')!.closest('button')!)
    expect(input.input.openInstance).toHaveBeenCalledWith('/workspace/image.png')
    expect(input.contributions.at(-1)).toEqual({
      tabLabels: { '/workspace/image.png': 'image.png' },
      tabFilePaths: { '/workspace/image.png': '/workspace/image.png' },
    })
  })

  it('treats HTML as an ordinary Artifact home row without a Browser open action', () => {
    const path = 'E:/repo/prototype/index.html'
    const input = props(snapshotOf([
      { path, updatedAt: 2_000, turn: 2 },
      { path: 'E:/repo/app.ts', updatedAt: 1_000, turn: 1 },
    ]))
    const view = render(<ArtifactPanel {...input.input} />)

    expect(view.getByText('index.html')).toBeTruthy()
    expect(view.container.querySelector('[data-artifact-html-open]')).toBeNull()
    expect(view.queryByRole('button', { name: 'open' })).toBeNull()
    fireEvent.click(view.getByText('index.html').closest('button')!)
    expect(input.input.openInstance).toHaveBeenCalledWith(path)
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
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, kind: 'text' as const, content: 'export const value = 1' } }))
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
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, kind: 'text' as const, content } }))
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
    expect(view.getByRole('button', { name: 'openFolder' })
      .querySelector('[data-deepcreator-icon="animated-folder"]')
      ?.getAttribute('data-optical-scale')).toBe('false')
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

  it('omits the native containing-folder action for a remote surface', async () => {
    const path = 'E:/repo/a.md'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, kind: 'text' as const, content: 'remote' } }))
    const input = props(snapshotOf([{ path, updatedAt: 1_000, turn: 1 }]), read)
    const { openContainingFolder: _openContainingFolder, ...remoteInput } = input.input
    const view = render(<ArtifactPanel {...remoteInput} route="instance" activeInstanceId={path} />)

    await waitFor(() => { expect(view.getByText('remote')).toBeTruthy() })
    expect(view.queryByRole('button', { name: 'openFolder' })).toBeNull()
  })

  it('defaults Markdown to conversation-grade preview and switches to the code renderer', async () => {
    const path = 'E:/repo/report.md'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, kind: 'text' as const, content: '# 标题\n\n正文' } }))
    const input = props(snapshotOf([{ path, updatedAt: 1_000, turn: 1 }]), read)
    const view = render(<ArtifactPanel {...{ ...input.input, route: 'instance', activeInstanceId: path }} />)

    await waitFor(() => { expect(view.getByRole('heading', { name: '标题' })).toBeTruthy() })
    const switcher = view.getByRole('group', { name: 'renderMode' })
    const preview = view.getByRole('button', { name: 'renderMode.preview' })
    const code = view.getByRole('button', { name: 'renderMode.code' })
    const folder = view.getByRole('button', { name: 'openFolder' })
    expect(preview.getAttribute('aria-pressed')).toBe('true')
    expect(preview.querySelector('[data-deepcreator-icon="markdown-preview"]')).not.toBeNull()
    expect(code.querySelector('[data-deepcreator-icon="markdown-code"]')).not.toBeNull()
    expect(preview.textContent).toBe('')
    expect(switcher.nextElementSibling).toBe(folder)
    expect(view.container.querySelector('[data-artifact]')).toBeNull()
    expect(view.container.querySelector('[data-artifact-markdown-document]')).not.toBeNull()

    fireEvent.mouseEnter(code)
    expect(view.getByRole('tooltip').textContent).toBe('renderMode.code')
    fireEvent.mouseLeave(code)

    fireEvent.click(code)
    expect(code.getAttribute('aria-pressed')).toBe('true')
    expect(view.getByText(/# 标题/)).toBeTruthy()
    expect(view.container.querySelector('[data-artifact]')).not.toBeNull()
    expect(view.container.querySelector('[data-artifact-markdown-document]')).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('loads relative Markdown images from the document directory through fenced artifact URLs', async () => {
    const path = '/workspace/docs/report.md'
    const markdown = [
      '![chart](images/chart.png)',
      '![chart duplicate](images/chart.png)',
      '![legend][shared]',
      '![remote](https://example.com/remote.png)',
      '',
      '[shared]: ../shared/legend.png',
    ].join('\n\n')
    const read = vi.fn(async (_sessionId: string, requestedPath: string) => {
      if (requestedPath === path) {
        return { ok: true as const, value: { ok: true as const, kind: 'text' as const, content: markdown } }
      }
      if (requestedPath === '/workspace/docs/images/chart.png') {
        return {
          ok: true as const,
          value: { ok: true as const, kind: 'image' as const, url: 'http://127.0.0.1:3199/chart.png', mediaType: 'image/png' },
        }
      }
      if (requestedPath === '/workspace/docs/../shared/legend.png') {
        return {
          ok: true as const,
          value: { ok: true as const, kind: 'image' as const, url: 'http://127.0.0.1:3199/legend.png', mediaType: 'image/png' },
        }
      }
      return { ok: true as const, value: { ok: false as const, code: 'NOT_FOUND' as const, message: 'missing' } }
    })
    const input = props(snapshotOf([{ path, updatedAt: 1_000, turn: 1 }]), read)
    const view = render(<ArtifactPanel {...{ ...input.input, route: 'instance', activeInstanceId: path }} />)

    await waitFor(() => {
      expect([...view.container.querySelectorAll('[data-artifact-markdown-document] img')].map(image => image.getAttribute('src'))).toEqual([
        'http://127.0.0.1:3199/chart.png',
        'http://127.0.0.1:3199/chart.png',
        'http://127.0.0.1:3199/legend.png',
        'https://example.com/remote.png',
      ])
    })
    expect(read.mock.calls).toEqual([
      ['session-1', path],
      ['session-1', '/workspace/docs/images/chart.png'],
      ['session-1', '/workspace/docs/../shared/legend.png'],
    ])
  })

  it('keeps non-Markdown artifacts on code rendering without a mode switch', async () => {
    const path = 'E:/repo/index.ts'
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, kind: 'text' as const, content: 'export const ok = true' } }))
    const input = props(snapshotOf([{ path, updatedAt: 1_000, turn: 1 }]), read)
    const view = render(<ArtifactPanel {...{ ...input.input, route: 'instance', activeInstanceId: path }} />)

    await waitFor(() => { expect(view.getByText('export const ok = true')).toBeTruthy() })
    expect(view.queryByRole('group', { name: 'renderMode' })).toBeNull()
    expect(view.container.querySelector('[data-artifact]')).not.toBeNull()
  })

  it('renders images, PDFs, DOCX HTML and legacy DOC text inside the Artifact instance', async () => {
    const imagePath = 'E:/repo/output.png'
    const imageInput = props(snapshotOf([{ path: imagePath, updatedAt: 1_000, turn: 1 }]), vi.fn(async () => ({
      ok: true as const,
      value: { ok: true as const, kind: 'image' as const, url: 'http://127.0.0.1:1234/output.png', mediaType: 'image/png' },
    })))
    const view = render(<ArtifactPanel {...{ ...imageInput.input, route: 'instance', activeInstanceId: imagePath }} />)
    await waitFor(() => { expect(view.container.querySelector(`[data-artifact-image="${imagePath}"]`)).not.toBeNull() })
    expect(view.getByRole('img', { name: 'output.png' }).getAttribute('src')).toBe('http://127.0.0.1:1234/output.png')

    const pdfPath = 'E:/repo/report.pdf'
    const pdfInput = props(snapshotOf([{ path: pdfPath, updatedAt: 2_000, turn: 1 }]), vi.fn(async () => ({
      ok: true as const,
      value: { ok: true as const, kind: 'pdf' as const, url: 'http://127.0.0.1:1234/report.pdf', mediaType: 'application/pdf' as const },
    })))
    view.rerender(<ArtifactPanel {...{ ...pdfInput.input, route: 'instance', activeInstanceId: pdfPath }} />)
    await waitFor(() => { expect(view.container.querySelector(`[data-artifact-pdf="${pdfPath}"]`)).not.toBeNull() })
    expect(view.getByTitle('report.pdf').getAttribute('src')).toBe('http://127.0.0.1:1234/report.pdf')
    expect(view.getByTitle('report.pdf').parentElement?.className).toContain('embeddedContent')

    const docxPath = 'E:/repo/brief.docx'
    const docxInput = props(snapshotOf([{ path: docxPath, updatedAt: 3_000, turn: 1 }]), vi.fn(async () => ({
      ok: true as const,
      value: { ok: true as const, kind: 'document' as const, contentType: 'html' as const, content: '<h1>Brief</h1><p>Body</p>' },
    })))
    view.rerender(<ArtifactPanel {...{ ...docxInput.input, route: 'instance', activeInstanceId: docxPath }} />)
    await waitFor(() => { expect(view.container.querySelector('[data-artifact-document="docx"]')).not.toBeNull() })
    const docx = view.getByTitle('brief.docx')
    expect(docx.getAttribute('sandbox')).toBe('')
    expect(docx.getAttribute('srcdoc')).toContain('<h1>Brief</h1>')

    const docPath = 'E:/repo/legacy.doc'
    const docInput = props(snapshotOf([{ path: docPath, updatedAt: 4_000, turn: 1 }]), vi.fn(async () => ({
      ok: true as const,
      value: { ok: true as const, kind: 'document' as const, contentType: 'text' as const, content: 'Legacy body' },
    })))
    view.rerender(<ArtifactPanel {...{ ...docInput.input, route: 'instance', activeInstanceId: docPath }} />)
    await waitFor(() => { expect(view.getByText('Legacy body')).toBeTruthy() })
    expect(view.container.querySelector('[data-artifact-document="doc"]')).not.toBeNull()
  })

  it('surfaces a read failure for an active path absent from the projection', async () => {
    const read = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, code: 'NOT_FOUND' as const, message: 'File missing' } }))
    const input = props(snapshotOf([{ path: 'E:/repo/a.md', updatedAt: 1_000, turn: 1 }]), read)
    const view = render(<ArtifactPanel {...{ ...input.input, route: 'instance', activeInstanceId: 'E:/repo/ghost.md' }} />)

    await waitFor(() => { expect(view.getByText('File missing')).toBeTruthy() })
    expect(read).toHaveBeenCalledWith('session-1', 'E:/repo/ghost.md')
  })
})
