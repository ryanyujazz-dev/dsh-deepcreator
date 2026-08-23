// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ImageGenerationSettings } from '@ryanyujazz/dsh-image-generation/types'
import { ImageGenerationSettingsCard } from '../src/client/ImageGenerationSettingsCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function createSettings() {
  const listeners = new Set<() => void>()
  const initial = { value: { providers: [] } as ImageGenerationSettings, writable: true, error: undefined }
  const settings = {
    store: initial,
    subscribe(this: { store: typeof initial }, listener: () => void) {
      expect(this.store).toBeDefined()
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(this: { store: typeof initial }) {
      expect(this.store).toBeDefined()
      return this.store
    },
    set: vi.fn(function (this: { store: typeof initial }, key: keyof ImageGenerationSettings, value: unknown) {
      this.store = { ...this.store, value: { ...this.store.value, [key]: value } }
      listeners.forEach(listener => { listener() })
      return Promise.resolve()
    }),
    unset: vi.fn(function (this: { store: typeof initial }, key: keyof ImageGenerationSettings) {
      const value = { ...this.store.value }
      delete value[key]
      this.store = { ...this.store, value }
      listeners.forEach(listener => { listener() })
      return Promise.resolve()
    }),
  }
  return settings as unknown as SettingsScope<ImageGenerationSettings> & { set: ReturnType<typeof vi.fn> }
}

const api = {
  credentials: {
    describe: vi.fn(async ({ refs }: { refs: string[] }) => ({
      result: { ok: true, value: { credentials: Object.fromEntries(refs.map(ref => [ref, { configured: false }])) } },
    })),
    set: vi.fn(),
    unset: vi.fn(async () => ({ result: { ok: true, value: undefined } })),
  },
}
const t = ((key: keyof typeof en) => en[key]) as never

describe('ImageGenerationSettingsCard', () => {
  it('stays collapsed by default and subscribes without losing the SettingsScope receiver', () => {
    const settings = createSettings()
    const view = render(<ImageGenerationSettingsCard settings={settings} api={api as never} t={t} />)

    expect(view.queryByRole('button', { name: 'Add provider' })).toBeNull()
    const disclosure = view.getByRole<HTMLButtonElement>('button', { name: 'Expand settings: Image generation' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(disclosure)
    expect(view.getByRole<HTMLButtonElement>('button', { name: 'Add provider' }).disabled).toBe(false)
    expect(view.getByRole('button', { name: 'Add custom provider' })).toBeDefined()
  })

  it('keeps a new provider as a draft until Save, then renders it as a compact provider row', async () => {
    const settings = createSettings()
    const view = render(<ImageGenerationSettingsCard settings={settings} api={api as never} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'Expand settings: Image generation' }))
    fireEvent.click(view.getByRole('button', { name: 'Add provider' }))

    expect(settings.set).not.toHaveBeenCalled()
    expect(view.getByRole('region', { name: 'Configure provider' })).toBeDefined()
    expect(view.getByRole('button', { name: 'Provider' })).toBeDefined()
    expect(view.queryByLabelText('Provider ID')).toBeNull()
    expect(view.queryByLabelText('Display name')).toBeNull()
    expect(view.queryByLabelText('API URL')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Custom settings' }))
    expect(view.getByLabelText<HTMLInputElement>('API URL').value).toBe('https://api.openai.com/v1')
    expect(view.getByLabelText<HTMLInputElement>('Model ID').value).toBe('gpt-image-2')
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(view.getByRole('button', { name: 'Edit' })).toBeDefined() })
    expect(view.getByText('OpenAI Images')).toBeDefined()
    expect(settings.set).toHaveBeenCalledWith('providers', expect.arrayContaining([expect.objectContaining({ id: 'openai-image' })]))
  })

  it('keeps a custom provider local until its required visible fields are complete and saved', async () => {
    const settings = createSettings()
    const view = render(<ImageGenerationSettingsCard settings={settings} api={api as never} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'Expand settings: Image generation' }))
    fireEvent.click(view.getByRole('button', { name: 'Add custom provider' }))

    expect(view.getByRole('region', { name: 'Configure custom provider' })).toBeDefined()
    expect(view.getByLabelText<HTMLInputElement>('Provider name').value).toBe('')
    expect(view.getByRole('button', { name: 'API protocol' })).toBeDefined()
    expect(view.getByLabelText<HTMLInputElement>('API URL').value).toBe('')
    expect(view.getByText('No models are configured. Add a model ID before saving.')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: 'Add model' }))
    expect(view.getByLabelText<HTMLInputElement>('Model ID').value).toBe('')
    expect(settings.set).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Provider name'), { target: { value: 'Studio Image' } })
    fireEvent.change(view.getByLabelText('API URL'), { target: { value: 'https://images.example.com/v1' } })
    fireEvent.change(view.getByLabelText('Model ID'), { target: { value: 'studio-image-v1' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(view.getByText('Studio Image')).toBeDefined() })
    expect(view.queryByRole('region', { name: 'Configure custom provider' })).toBeNull()
    expect(settings.set).toHaveBeenCalledWith('providers', expect.arrayContaining([expect.objectContaining({ id: 'custom-image', name: 'Studio Image' })]))
  })
})
