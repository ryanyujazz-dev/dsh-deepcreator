// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FileIcon, FileLabel, resolveFileIcon } from '../src/index.ts'

afterEach(cleanup)

describe('Material file icon resolution', () => {
  it('prefers special filenames, path rules and longest compound extensions', () => {
    expect(resolveFileIcon('/repo/package.json').name).toBe('nodejs')
    expect(resolveFileIcon('C:\\repo\\.devcontainer\\devcontainer.json').name).toBe('container')
    expect(resolveFileIcon('/repo/models/user.schema.json').name).toBe('json_schema')
    expect(resolveFileIcon('/repo/src/view.TSX').name).toBe('react_ts')
  })

  it('keeps the native light variant independent from code themes', () => {
    const icon = resolveFileIcon('/repo/settings.toml')
    expect(icon.name).toBe('toml')
    expect(icon.lightName).toBe('toml_light')
  })

  it('falls back to the generic file definition for an unknown extensionless name', () => {
    const icon = resolveFileIcon('/repo/unknown-file-kind')
    expect(icon.name).toBe('file')
    expect(icon.lightName).toBe('file')
  })
})

describe('FileIcon and FileLabel', () => {
  it('renders decorative local images while keeping the filename as the only accessible text', () => {
    const view = render(<FileLabel path="src/a.ts" label="a.ts" />)
    const icon = view.container.querySelector('[data-file-icon="typescript"]')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/u)
    expect(view.getByText('a.ts')).toBeTruthy()
  })

  it('exposes light and dark definition ids when the upstream theme has a variant', () => {
    const view = render(<FileIcon path="settings.toml" />)
    const icon = view.container.querySelector('[data-file-icon]')
    expect(icon?.getAttribute('data-file-icon')).toBe('toml')
    expect(icon?.getAttribute('data-file-icon-light')).toBe('toml_light')
    expect(icon?.querySelectorAll('img')).toHaveLength(2)
  })
})
