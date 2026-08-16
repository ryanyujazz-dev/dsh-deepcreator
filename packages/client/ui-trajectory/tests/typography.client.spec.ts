/** Trajectory typography contract: every renderer reads one content role. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCss = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)),
  'utf8',
)

const viewCss = readCss('views.module.css')
const contentCss = [
  readCss('TrajectoryCell.module.css'),
  readCss('TrajectoryGroupHeader.module.css'),
  readCss('TrajectoryTurnHeader.module.css'),
  readCss('TrajectoryTable.module.css'),
  readCss('TrajectoryTimeline.module.css'),
].join('\n')

describe('trajectory typography', () => {
  it('defines one readable normal, strong, and code face on the view root', () => {
    expect(viewCss).toContain('--dsh-trajectory-content-font: var(--dsw-font-xxs-12);')
    expect(viewCss).toContain('--dsh-trajectory-content-strong-font: var(--dsw-font-xxs-strong-12);')
    expect(viewCss).toContain('--dsh-trajectory-code-font: 400 12px/18px var(--ds-font-family-code);')
  })

  it('does not reintroduce smaller or larger content type scales', () => {
    expect(contentCss).not.toContain('var(--dsw-font-xs-13)')
    expect(contentCss).not.toContain('var(--dsw-font-xxxs-11)')
    expect(contentCss).not.toMatch(/font:\s*(?:8|9|10|11|13|14|15|16)px\//)
    expect(contentCss).not.toMatch(/font-size:\s*(?:8|9|10|11|13|14|15|16)px/)
  })
})
