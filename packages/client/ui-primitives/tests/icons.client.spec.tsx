// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@ryanyujazz/dsh-client-ui-primitives'
import {
  DeepCreatorIconGearshape16, DeepCreatorIconPin16, DeepCreatorIconTimer16,
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
} from '@ryanyujazz/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)
const productIcons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('DeepCreatorIcon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const productIconNames = Object.keys(productIcons)

describe('ic_ds_ icon set', () => {
  it('keeps the 66 official-compatible glyphs separate from seven product glyphs', () => {
    expect(iconNames.length).toBe(66)
    expect(productIconNames.length).toBe(7)
  })

  it.each(productIconNames)('%s renders from the marked DeepCreator product set', (name) => {
    const Icon = productIcons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-deepcreator-icon')).toBeTruthy()
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
  })

  it.each([
    ['gearshape', DeepCreatorIconGearshape16],
    ['pin', DeepCreatorIconPin16],
  ] as const)('preserves the supplied 24px %s source geometry', (name, Icon) => {
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-deepcreator-icon')).toBe(name)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('optically fits the supplied timer geometry to the 14px sidebar grid', () => {
    const { container } = render(<DeepCreatorIconTimer16 size={14} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-deepcreator-icon')).toBe('timer')
    expect(svg.getAttribute('viewBox')).toBe('0 0 14 14')
    expect(svg.getAttribute('width')).toBe('14')
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })

})

describe('FishLogo', () => {
  it('renders the fish path in currentColor at the native ratio', () => {
    const { container } = render(<primitives.FishLogo />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(17.66, 1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toContain('M0 0L23.16')
  })
})

describe('DeepCreator wordmark', () => {
  it('keeps the whale on the shared sidebar icon scale and renders the new label', () => {
    const { container } = render(<primitives.BrandWordmark />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs[0]?.getAttribute('height')).toBe('18')
    expect(svgs[1]?.getAttribute('width')).toBe(String(primitives.SIDEBAR_BRAND_ICON_SIZE))
    expect(container.querySelector('text')?.textContent?.trim()).toBe('DeepCreator')
    expect(container.innerHTML).not.toContain('HARNESS')
  })
})
