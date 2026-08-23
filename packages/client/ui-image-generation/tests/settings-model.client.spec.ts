import { describe, expect, it } from 'vitest'
import { decodeSettings, isPresetProvider, newCustomProvider, newProvider, parseModels, protocolDefaults } from '../src/client/settings-model.ts'

describe('image generation settings model', () => {
  it('uses the current native provider endpoints and stable model IDs', () => {
    expect(protocolDefaults('openai')).toMatchObject({ baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2' })
    expect(protocolDefaults('seedream')).toMatchObject({ baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-260128' })
    expect(protocolDefaults('gemini')).toMatchObject({ name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image', modelName: 'Nano Banana 2' })
    expect(newProvider('gemini', []).models[0]).toMatchObject({ id: 'gemini-3.1-flash-image', name: 'Nano Banana 2' })
  })

  it('creates distinct same-protocol provider instances', () => {
    const first = newProvider('openai', [])
    const second = newProvider('openai', [first])
    expect(first.id).toBe('openai-image')
    expect(second.id).toBe('openai-image-2')
    expect(second.apiKeyEnv).not.toBe(first.apiKeyEnv)
  })

  it('parses user-added model ids and display names with protocol capabilities', () => {
    const models = parseModels('image-alpha | Alpha\nimage-beta', 'gemini')
    expect(models.map(model => [model.id, model.name])).toEqual([['image-alpha', 'Alpha'], ['image-beta', undefined]])
    expect(models[0]?.modes).toEqual(['text-to-image', 'image-to-image'])
    expect(models[0]?.resolutions).toEqual(['1K', '2K', '4K'])
  })

  it('creates an unsaved custom provider draft with a unique identity', () => {
    const first = newCustomProvider([])
    const second = newCustomProvider([first])
    expect(first.id).toBe('custom-image')
    expect(first.baseURL).toBe('')
    expect(first.models).toEqual([])
    expect(second.id).toBe('custom-image-2')
    expect(second.apiKeyEnv).toBe('CUSTOM_IMAGE_API_KEY_2')
    expect(isPresetProvider(first)).toBe(false)
    expect(isPresetProvider(newProvider('openai', []))).toBe(true)
  })

  it('rejects malformed settings snapshots', () => {
    expect(decodeSettings({ providers: [{ id: 'bad' }] })).toBeUndefined()
  })
})
