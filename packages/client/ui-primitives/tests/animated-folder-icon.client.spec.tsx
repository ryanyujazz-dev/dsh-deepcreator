// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const animation = vi.hoisted(() => ({
  goToAndStop: vi.fn(),
  setDirection: vi.fn(),
  goToAndPlay: vi.fn(),
}))

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: {
    loadAnimation: vi.fn((config: { container: HTMLElement }) => {
      config.container.innerHTML = '<svg data-lottie-player="folder"><path /></svg>'
      return {
        ...animation,
        addEventListener: (_event: string, callback: () => void) => { queueMicrotask(callback) },
        removeEventListener: vi.fn(),
        destroy: vi.fn(),
      }
    }),
  },
}))

import { DeepCreatorIconAnimatedFolder16 } from '@ryanyujazz/dsh-client-ui-primitives'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('DeepCreatorIconAnimatedFolder16', () => {
  it('corrects the source composition padding without enlarging the layout box', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-primitives/src/icons/AnimatedFolderIcon.module.css'), 'utf8')
    expect(stylesheet).toContain('.opticalScale > :global(div) {\n  transform: scale(1.3);')
    expect(stylesheet).not.toContain('.root :global(svg) {\n  transform:')
  })

  it('snaps to its initial frame, then animates forward and backward with state', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const view = render(<DeepCreatorIconAnimatedFolder16 size={14} />)

    await waitFor(() => { expect(animation.goToAndStop).toHaveBeenCalledWith(0, true) })
    const root = view.container.querySelector('[data-deepcreator-icon="animated-folder"]')!
    expect(root.getAttribute('style')).toContain('width: 14px')
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.getAttribute('data-optical-scale')).toBe('true')

    view.rerender(<DeepCreatorIconAnimatedFolder16 expanded size={14} />)
    expect(animation.setDirection).toHaveBeenLastCalledWith(1)
    expect(animation.goToAndPlay).toHaveBeenLastCalledWith(0, true)

    view.rerender(<DeepCreatorIconAnimatedFolder16 size={14} />)
    expect(animation.setDirection).toHaveBeenLastCalledWith(-1)
    expect(animation.goToAndPlay).toHaveBeenLastCalledWith(7, true)
  })

  it('jumps directly to the target frame when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const view = render(<DeepCreatorIconAnimatedFolder16 />)
    await waitFor(() => { expect(animation.goToAndStop).toHaveBeenCalledWith(0, true) })

    view.rerender(<DeepCreatorIconAnimatedFolder16 expanded />)
    expect(animation.goToAndStop).toHaveBeenLastCalledWith(7, true)
    expect(animation.goToAndPlay).not.toHaveBeenCalled()
  })
})
