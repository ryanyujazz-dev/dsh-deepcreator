// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@ryanyujazz/dsh-client-ui-primitives'
import {
  DeepCreatorIconActivity16, DeepCreatorIconArtifact16, DeepCreatorIconBrain16, DeepCreatorIconGearshape16,
  DeepCreatorIconPanelCollapse16, DeepCreatorIconPanelExpand16, DeepCreatorIconPin16,
  DeepCreatorIconPreview16, DeepCreatorIconReview16,
  DeepCreatorIconTerminal16, DeepCreatorIconTimer16,
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
  IconUnfoldLessOutline16, IconUnfoldMoreOutline16,
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
  it('keeps the 70 shared glyphs (66 official-compatible + 4 harness-only) separate from sixteen product glyphs', () => {
    expect(iconNames.length).toBe(70)
    expect(productIconNames.length).toBe(16)
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

  it('keeps the five Workbench type glyphs on their specified minimal geometry', () => {
    const activity = render(<DeepCreatorIconActivity16 />).container
    expect(activity.querySelectorAll('circle')).toHaveLength(2)
    expect(activity.querySelectorAll('rect')).toHaveLength(0)
    expect(activity.querySelector('path')!.getAttribute('d')).toBe('M6.25 5h7.5M6.25 11h7.5')

    const artifact = render(<DeepCreatorIconArtifact16 />).container
    expect(artifact.querySelectorAll('path')).toHaveLength(1)
    expect(artifact.querySelector('path')!.getAttribute('fill')).toBe('currentColor')

    const review = render(<DeepCreatorIconReview16 />).container
    expect(review.querySelectorAll('rect')).toHaveLength(1)
    expect(review.querySelector('rect')!.getAttribute('rx')).toBe('2')
    expect(review.querySelector('path')!.getAttribute('d')).toBe('M5.5 6h5M8 3.5v5M6.5 12h3')

    const terminal = render(<DeepCreatorIconTerminal16 />).container
    expect(terminal.querySelectorAll('rect, circle')).toHaveLength(0)
    expect(terminal.querySelector('path')!.getAttribute('d')).toContain('M2.5 4.25')

    const preview = render(<DeepCreatorIconPreview16 />).container
    expect(preview.querySelectorAll('rect, circle')).toHaveLength(0)
    expect(preview.querySelector('svg')!.getAttribute('data-deepcreator-icon')).toBe('workbench-preview')
    expect(preview.querySelector('path')!.getAttribute('d')).toContain('M4.51 1.57Q3.97 1.26')
    expect(preview.querySelector('path')!.getAttribute('transform')).toBe('translate(8 8) scale(.82) translate(-8 -8)')
    expect(preview.querySelector('path')!.getAttribute('fill')).toBe('none')
    expect(preview.querySelector('path')!.getAttribute('stroke')).toBe('currentColor')
  })

  it('keeps the compact model brain to one untextured outline path', () => {
    const brain = render(<DeepCreatorIconBrain16 />).container
    expect(brain.querySelectorAll('path')).toHaveLength(1)
    expect(brain.querySelector('path')!.getAttribute('fill')).toBeNull()
  })

  it('preserves the supplied Workbench expand and collapse directions', () => {
    const expand = render(<DeepCreatorIconPanelExpand16 />).container.querySelector('path')!
    const collapse = render(<DeepCreatorIconPanelCollapse16 />).container.querySelector('path')!
    expect(expand.getAttribute('d')).toContain('M1.58 6.43')
    expect(collapse.getAttribute('d')).toContain('M5.97 6.67')
    expect(expand.hasAttribute('transform')).toBe(false)
    expect(collapse.hasAttribute('transform')).toBe(false)
    expect(expand.getAttribute('fill')).toBe('currentColor')
    expect(collapse.getAttribute('fill')).toBe('currentColor')
  })

  it('keeps the Review expand-all and collapse-all list lines equal while reversing the arrows', () => {
    const expandRoot = render(<IconUnfoldMoreOutline16 />).container.querySelector('svg')!
    const collapseRoot = render(<IconUnfoldLessOutline16 />).container.querySelector('svg')!
    const expand = expandRoot.querySelector('path')!
    const collapse = collapseRoot.querySelector('path')!
    expect(expandRoot.getAttribute('width')).toBe('16')
    expect(collapseRoot.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(expand.getAttribute('d')).toBe('M7.25 6H13.25M7.25 10H13.25M4.5 6V2.5M2.75 4.25L4.5 2.5L6.25 4.25M4.5 10V13.5M2.75 11.75L4.5 13.5L6.25 11.75')
    expect(collapse.getAttribute('d')).toBe('M7.25 6H13.25M7.25 10H13.25M4.5 2.5V6M2.75 4.25L4.5 6L6.25 4.25M4.5 13.5V10M2.75 11.75L4.5 10L6.25 11.75')
    expect(expand.getAttribute('stroke-width')).toBe('1.35')
    expect(collapse.getAttribute('stroke-width')).toBe('1.35')
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
