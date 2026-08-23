import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export type ImageProviderProtocol = 'openai' | 'seedream' | 'gemini'
export type ImageGenerationMode = 'text-to-image' | 'image-to-image'
export type ImageAspectRatio = 'source' | '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16'
export type ImageResolution = '1K' | '2K' | '4K'

export interface ImageModelProfile {
  id: string
  name?: string
  modes: ImageGenerationMode[]
  aspectRatios: ImageAspectRatio[]
  resolutions: ImageResolution[]
}

export interface ImageProviderProfile {
  id: string
  name?: string
  protocol: ImageProviderProtocol
  baseURL: string
  apiKeyEnv: string
  models: ImageModelProfile[]
  defaultModel?: string
}

export interface ImageGenerationSettings {
  providers: ImageProviderProfile[]
  defaultProvider?: string
}

export interface ImageInput {
  data: Uint8Array
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  name?: string
}

export type ImageInputRole = 'generic' | 'init-image' | 'style-reference' | 'subject-reference'
  | 'composition-reference' | 'mask' | 'control-image'

export interface SemanticImageSource {
  kind: 'attachment' | 'workspace-path'
  value: string
  role: ImageInputRole
}

export interface GenerationCorrelation { namespace: string; id: string }

export interface ImageGenerationRequestContext {
  sessionId: string
  turn: number
  workspaceRoot: string
  provider: string
  model: string
  prompt: string
  aspectRatio: ImageAspectRatio
  resolution: ImageResolution
  inputs: readonly SemanticImageSource[]
  correlation?: GenerationCorrelation
  outputPath: string
}

export type ImageGenerationMiddleware = (
  request: ImageGenerationRequestContext,
  next: () => Promise<CreateImageResult>,
) => Promise<CreateImageResult>

export type ImageGenerationResultEvent =
  | { status: 'succeeded'; request: ImageGenerationRequestContext; result: CreateImageResult }
  | { status: 'failed'; request: ImageGenerationRequestContext; error: string }

export type ImageGenerationResultListener = (event: ImageGenerationResultEvent) => void | Promise<void>

export interface GenerateImageRequest {
  provider: ImageProviderProfile
  model: ImageModelProfile
  apiKey: string
  prompt: string
  aspectRatio: ImageAspectRatio
  resolution: ImageResolution
  inputs: readonly ImageInput[]
  signal: AbortSignal
}

export interface GeneratedImage {
  data: Uint8Array
  mediaType: string
}

export interface CreateImageResult {
  path: string
  provider: string
  model: string
  aspectRatio: ImageAspectRatio
  resolution: ImageResolution
  width: number
  height: number
  attachment: ImageAttachmentRef
}
