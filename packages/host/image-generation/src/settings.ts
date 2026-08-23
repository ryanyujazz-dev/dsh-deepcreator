import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ImageGenerationSettings } from './types.ts'

export const IMAGE_GENERATION_SETTINGS_NAMESPACE = 'image-generation'
export const IMAGE_GENERATION_SETTINGS_KEY = settingsNamespace(IMAGE_GENERATION_SETTINGS_NAMESPACE)

const aspectRatio = z.union(['source', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'])
const resolution = z.union(['1K', '2K', '4K'])
const mode = z.union(['text-to-image', 'image-to-image'])

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  modes: z.array(mode),
  aspectRatios: z.array(aspectRatio),
  resolutions: z.array(resolution),
})

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.union(['openai', 'seedream', 'gemini']),
  baseURL: z.string(),
  apiKeyEnv: z.string(),
  models: z.array(modelSchema),
  defaultModel: z.string(),
})

export const ImageGenerationSettingsSchema: z<ImageGenerationSettings> = z.object({
  providers: z.array(providerSchema).default([]),
  defaultProvider: z.string(),
})
