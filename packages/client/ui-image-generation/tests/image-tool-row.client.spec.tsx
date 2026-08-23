// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { ImageToolRow } from '../src/client/ImageToolRow.tsx'
import { GeneratedTurnImages } from '../src/client/GeneratedTurnImages.tsx'

afterEach(cleanup)

const packageRoot = existsSync(resolve(process.cwd(), 'src/client/ImageToolRow.module.css'))
  ? process.cwd()
  : resolve(process.cwd(), 'packages/client/ui-image-generation')
const styles = readFileSync(resolve(packageRoot, 'src/client/ImageToolRow.module.css'), 'utf8')
const turnImageStyles = readFileSync(resolve(packageRoot, 'src/client/GeneratedTurnImages.module.css'), 'utf8')
const result = {
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'image-1',
  call: { name: 'create_image', argsRaw: '{"prompt":"a puppy","output_path":"puppy.png"}' },
  callTime: 1_000, isError: false, callView: null, resultView: null, subCalls: [],
  content: [{
    type: 'image',
    attachment: { attachmentId: 'image-attachment', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'puppy.png' },
  }],
} as unknown as ToolResultNode

describe('ImageToolRow', () => {
  it('puts expanded generated media on the execflow rail and title column', () => {
    const view = render(
      <ImageToolRow
        callId="image-1"
        toolName="create_image"
        block={result}
        openFile={vi.fn()}
        execflow
        renderMessageImages={() => <span data-generated-image />}
        t={((key: string) => key) as never}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: /Created image/ }))
    const wrap = view.container.querySelector('[data-image-tool-body-wrap]')
    expect(wrap).not.toBeNull()
    expect(wrap?.querySelector('[data-generated-image]')).not.toBeNull()
    expect(styles).toMatch(/\.root\[data-execflow\] \.bodyWrap::before[^}]*left: var\(--dsh-execflow-icon-axis, 7\.5px\)/)
    expect(styles).toMatch(/\.root\[data-execflow\] \.body[^}]*margin: 4px 0 4px var\(--dsh-execflow-title-column, 22px\)/)
  })
})

describe('GeneratedTurnImages', () => {
  it('renders every final-answer image separately at half the conversation width', () => {
    const second = {
      ...result,
      callId: 'image-2',
      call: { name: 'create_image', argsRaw: '{"prompt":"a kitten","output_path":"kitten.png"}' },
      content: [{
        type: 'image',
        attachment: { attachmentId: 'image-attachment-2', mediaType: 'image/png', bytes: 1, width: 16, height: 9, name: 'kitten.png' },
      }],
    } as unknown as ToolResultNode
    const nodes = new Map([
      ['call:image-1', { kind: 'tool-call', data: { root: result } }],
      ['call:image-2', { kind: 'tool-call', data: { root: second } }],
    ])
    const snapshot = { chat: { locations: { getTurn: () => [...nodes.keys()] }, nodes } }
    const renderMessageImages = vi.fn(() => <span data-final-image />)
    const renderSlot = vi.fn(() => null)
    const view = render(
      <GeneratedTurnImages
        turn={{ turn: 1 } as never}
        renderMessageImages={renderMessageImages}
        renderSlot={renderSlot as never}
        useSession={((selector: (value: typeof snapshot) => unknown) => selector(snapshot)) as never}
      />,
    )

    expect(view.container.querySelectorAll('[data-generated-turn-image]')).toHaveLength(2)
    expect(renderMessageImages).toHaveBeenNthCalledWith(1, { images: [{ attachment: result.content[0]?.attachment }], align: 'start' })
    expect(renderMessageImages).toHaveBeenNthCalledWith(2, { images: [{ attachment: second.content[0]?.attachment }], align: 'start' })
    expect(renderSlot).toHaveBeenCalledTimes(2)
    expect(turnImageStyles).toMatch(/\.image\s*\{[^}]*width: 50%/)
    expect(turnImageStyles).toContain('aspect-ratio: var(--dsh-generated-image-ratio)')
  })
})
