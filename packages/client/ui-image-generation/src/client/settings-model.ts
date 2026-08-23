import type {
  ImageAspectRatio, ImageGenerationSettings, ImageModelProfile, ImageProviderProfile,
  ImageProviderProtocol, ImageResolution,
} from '@ryanyujazz/dsh-image-generation/types'

export const ALL_RATIOS: ImageAspectRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']
export const ALL_RESOLUTIONS: ImageResolution[] = ['1K', '2K', '4K']

const defaults: Record<ImageProviderProtocol, { id: string; name: string; baseURL: string; apiKeyEnv: string; model: string; modelName?: string; ratios: ImageAspectRatio[]; resolutions: ImageResolution[] }> = {
  openai: { id: 'openai-image', name: 'OpenAI Images', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-image-2', ratios: ['1:1', '3:2', '2:3'], resolutions: ['1K'] },
  seedream: { id: 'seedream', name: 'Seedream', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'ARK_API_KEY', model: 'doubao-seedream-5-0-260128', ratios: ALL_RATIOS, resolutions: ALL_RESOLUTIONS },
  gemini: { id: 'gemini-image', name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY', model: 'gemini-3.1-flash-image', modelName: 'Nano Banana 2', ratios: ALL_RATIOS, resolutions: ALL_RESOLUTIONS },
}

export function protocolDefaults(protocol: ImageProviderProtocol) { return defaults[protocol] }

export function isPresetProvider(provider: ImageProviderProfile): boolean {
  const base = defaults[provider.protocol].id
  if (provider.id === base) return true
  if (!provider.id.startsWith(`${base}-`)) return false
  return /^\d+$/.test(provider.id.slice(base.length + 1))
}

export function uniqueProviderId(protocol: ImageProviderProtocol, providers: readonly ImageProviderProfile[]): string {
  const base = defaults[protocol].id
  if (!providers.some(provider => provider.id === base)) return base
  let suffix = 2
  while (providers.some(provider => provider.id === `${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function newProvider(protocol: ImageProviderProtocol, providers: readonly ImageProviderProfile[]): ImageProviderProfile {
  const preset = defaults[protocol]
  const id = uniqueProviderId(protocol, providers)
  return {
    id, name: preset.name, protocol, baseURL: preset.baseURL,
    apiKeyEnv: id === preset.id ? preset.apiKeyEnv : `${preset.apiKeyEnv}_${id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`,
    models: [{ id: preset.model, ...(preset.modelName === undefined ? {} : { name: preset.modelName }), modes: ['text-to-image', 'image-to-image'], aspectRatios: [...preset.ratios], resolutions: [...preset.resolutions] }],
    defaultModel: preset.model,
  }
}

export function newCustomProvider(providers: readonly ImageProviderProfile[]): ImageProviderProfile {
  let suffix = 1
  let id = 'custom-image'
  while (providers.some(provider => provider.id === id)) {
    suffix += 1
    id = `custom-image-${suffix}`
  }
  const credentialSuffix = suffix === 1 ? '' : `_${suffix}`
  return {
    id,
    name: '',
    protocol: 'openai',
    baseURL: '',
    apiKeyEnv: `CUSTOM_IMAGE_API_KEY${credentialSuffix}`,
    models: [],
  }
}

function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }

export function decodeSettings(value: unknown): ImageGenerationSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const settings = value as Partial<ImageGenerationSettings>
  if (!Array.isArray(settings.providers)) return undefined
  for (const provider of settings.providers) {
    if (typeof provider !== 'object' || provider === null || !['openai', 'seedream', 'gemini'].includes(provider.protocol)
      || typeof provider.id !== 'string' || typeof provider.baseURL !== 'string' || typeof provider.apiKeyEnv !== 'string' || !Array.isArray(provider.models)) return undefined
    for (const model of provider.models) {
      if (typeof model !== 'object' || model === null || typeof model.id !== 'string' || !strings(model.modes) || !strings(model.aspectRatios) || !strings(model.resolutions)) return undefined
    }
  }
  return settings as ImageGenerationSettings
}

export function parseModels(text: string, protocol: ImageProviderProtocol): ImageModelProfile[] {
  const preset = defaults[protocol]
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [id = '', name] = line.split('|').map(part => part.trim())
    return {
      id,
      ...(name === undefined || name === '' ? {} : { name }),
      modes: ['text-to-image', 'image-to-image'],
      aspectRatios: [...preset.ratios],
      resolutions: [...preset.resolutions],
    }
  })
}

export function modelsText(models: readonly ImageModelProfile[]): string {
  return models.map(model => model.name === undefined ? model.id : `${model.id} | ${model.name}`).join('\n')
}
