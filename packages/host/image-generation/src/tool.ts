import path from 'node:path'
import { realpath } from 'node:fs/promises'
import sharp from 'sharp'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool, type JsonValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { generateImage } from './providers.ts'
import { IMAGE_GENERATION_SETTINGS_KEY } from './settings.ts'
import type {
  CreateImageResult, ImageAspectRatio, ImageGenerationMode, ImageGenerationSettings, ImageInput,
  ImageModelProfile, ImageProviderProfile, ImageResolution,
} from './types.ts'
import { writeWorkspacePng } from './workspace.ts'
import type { ImageGenerationRetryPolicy } from './retry-policy.ts'

const ASPECT_RATIOS = ['source', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
const RESOLUTIONS = ['1K', '2K', '4K'] as const

function owner(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('create_image requires an owning Agent session.')
  return exec.agent
}

function config(ctx: Context): ImageGenerationSettings {
  return (ctx.get('settings')?.get(IMAGE_GENERATION_SETTINGS_KEY) as ImageGenerationSettings | undefined) ?? { providers: [] }
}

function selectProvider(settings: ImageGenerationSettings, providerId: string | undefined): ImageProviderProfile {
  const id = providerId ?? settings.defaultProvider ?? settings.providers[0]?.id
  const provider = settings.providers.find(candidate => candidate.id === id)
  if (provider === undefined) throw new Error(providerId === undefined ? 'No image provider is configured. Add one in Settings → Plugins → Plugin configuration.' : `Unknown image provider "${providerId}".`)
  return provider
}

function selectModel(provider: ImageProviderProfile, modelId: string | undefined): ImageModelProfile {
  const id = modelId ?? provider.defaultModel ?? provider.models[0]?.id
  const model = provider.models.find(candidate => candidate.id === id)
  if (model === undefined) throw new Error(modelId === undefined ? `Image provider "${provider.id}" has no configured model.` : `Provider "${provider.id}" has no model "${modelId}".`)
  return model
}

function isImageRef(value: unknown): value is ImageAttachmentRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.attachmentId === 'string' && typeof ref.mediaType === 'string' && typeof ref.bytes === 'number' && typeof ref.width === 'number' && typeof ref.height === 'number'
}

function sessionImages(events: readonly unknown[]): ImageAttachmentRef[] {
  const refs: ImageAttachmentRef[] = []
  for (const event of events) {
    if (typeof event !== 'object' || event === null || (event as { type?: unknown }).type !== 'user/message') continue
    const data = (event as { data?: unknown }).data
    if (typeof data !== 'object' || data === null) continue
    const content = (data as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (typeof block !== 'object' || block === null || (block as { type?: unknown }).type !== 'image') continue
      const attachment = (block as { attachment?: unknown }).attachment
      if (isImageRef(attachment)) refs.push(attachment)
    }
  }
  return refs
}

async function attachmentInputs(ctx: Context, exec: ToolRunContext, ids: readonly string[]): Promise<ImageInput[]> {
  const agent = owner(exec)
  const available = sessionImages(agent.session.events as readonly unknown[])
  const refs: ImageAttachmentRef[] = []
  for (const id of ids) {
    const ref = id === 'latest' ? available.at(-1) : available.find(candidate => candidate.attachmentId === id)
    if (ref === undefined) throw new Error(`Input attachment "${id}" is not present in this session. Use "latest" for the most recent uploaded image.`)
    refs.push(ref)
  }
  return Promise.all(refs.map(async ref => {
    const stored = await ctx.attachments.readImage(ref, exec.signal)
    return { data: stored.data, mediaType: stored.ref.mediaType, ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }) }
  }))
}

async function workspaceInputs(exec: ToolRunContext, paths: readonly string[]): Promise<ImageInput[]> {
  const agent = owner(exec)
  const root = path.resolve(agent.session.header.cwd ?? process.cwd())
  return Promise.all(paths.map(async inputPath => {
    if (path.isAbsolute(inputPath)) throw new Error(`input_paths must be workspace-relative: ${inputPath}`)
    const absolute = path.resolve(root, inputPath)
    const relative = path.relative(root, absolute)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`input path escapes the workspace: ${inputPath}`)
    const resolved = await realpath(absolute)
    const resolvedRelative = path.relative(root, resolved)
    if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) throw new Error(`input path resolves outside the workspace: ${inputPath}`)
    const buffer = await sharp(resolved).rotate().toBuffer()
    const metadata = await sharp(buffer).metadata()
    const mediaType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : metadata.format === 'gif' ? 'image/gif' : metadata.format === 'png' ? 'image/png' : undefined
    if (mediaType === undefined) throw new Error(`Unsupported input image format: ${inputPath}`)
    return { data: buffer, mediaType, name: path.basename(inputPath) }
  }))
}

function description(settings: ImageGenerationSettings): string {
  const routes = settings.providers.flatMap(provider => provider.models.map(model =>
    `${provider.id}/${model.id} (${model.modes.join(', ')}; ratios ${model.aspectRatios.join(', ')}; resolutions ${model.resolutions.join(', ')})`))
  return [
    'Create exactly one image from text, or edit/generate from reference images. The result is saved as a workspace PNG and returned as a durable image attachment.',
    'aspect_ratio and resolution are REQUIRED user decisions. If the user did not specify either value, you MUST call ask_user_question before this tool and ask only the missing value(s), using the selected model supported values as the single-select options; never infer them from words such as landscape, portrait, poster, or from an input image. "square" explicitly means 1:1. For image-to-image, "preserve source ratio" maps to aspect_ratio="source". If the user explicitly says you may decide or use defaults, choose a supported value without asking.',
    'For an uploaded conversation image, pass input_attachment_ids:["latest"] (or its exact attachment id). For workspace images, pass input_paths. Omit both for text-to-image. output_path must be workspace-relative and end in .png.',
    routes.length === 0 ? 'No provider is currently configured; tell the user to configure one in Settings → Plugins → Plugin configuration.' : `Configured routes: ${routes.join('; ')}.`,
  ].join(' ')
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }

export interface ImageGenerationToolEnvironment {
  retryPolicy: ImageGenerationRetryPolicy
  turnOf(agent: ReturnType<typeof owner>): number
}

export function createImageTool(ctx: Context, env: ImageGenerationToolEnvironment): ToolDefinition {
  return defineTool({
    name: 'create_image',
    description: description(config(ctx)),
    parameters: {
      prompt: { type: 'string', required: true },
      provider: { type: 'string' },
      model: { type: 'string' },
      aspect_ratio: { type: 'string', required: true, enum: ASPECT_RATIOS },
      resolution: { type: 'string', required: true, enum: RESOLUTIONS },
      input_attachment_ids: { type: 'array', items: { type: 'string' } },
      input_paths: { type: 'array', items: { type: 'string' } },
      output_path: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        const result = value as unknown as CreateImageResult
        return [
          { type: 'text', text: JSON.stringify({ path: result.path, provider: result.provider, model: result.model, aspectRatio: result.aspectRatio, resolution: result.resolution, width: result.width, height: result.height }) },
          { type: 'image', attachment: result.attachment },
        ]
      },
      presentationMeta(_args, value) {
        const result = value as unknown as CreateImageResult
        return json({ kind: 'generated-image', path: result.path, attachment: result.attachment })
      },
    },
    timeoutMs: 180_000,
    presentCall: args => ({ card: 'generic', title: 'Creating image', kind: 'edit', rawInput: args.prompt, locations: [{ path: args.output_path }] }),
    async execute(args, exec) {
      const agent = owner(exec)
      const attempt = { sessionId: String(agent.id), turn: env.turnOf(agent) }
      env.retryPolicy.assertCanAttempt(attempt)
      try {
        const settings = config(ctx)
        const provider = selectProvider(settings, args.provider)
        const model = selectModel(provider, args.model)
        const mode: ImageGenerationMode = (args.input_attachment_ids?.length ?? 0) + (args.input_paths?.length ?? 0) > 0 ? 'image-to-image' : 'text-to-image'
        if (!model.modes.includes(mode)) throw new Error(`Model "${provider.id}/${model.id}" does not support ${mode}.`)
        const aspectRatio = args.aspect_ratio as ImageAspectRatio
        const resolution = args.resolution as ImageResolution
        if (aspectRatio === 'source' && mode !== 'image-to-image') throw new Error('aspect_ratio="source" requires at least one input image.')
        if (aspectRatio !== 'source' && !model.aspectRatios.includes(aspectRatio)) throw new Error(`Model "${provider.id}/${model.id}" does not support aspect ratio ${aspectRatio}. Supported: ${model.aspectRatios.join(', ')}.`)
        if (!model.resolutions.includes(resolution)) throw new Error(`Model "${provider.id}/${model.id}" does not support resolution ${resolution}. Supported: ${model.resolutions.join(', ')}.`)
        if (provider.protocol === 'openai' && resolution !== '1K') throw new Error('The native OpenAI Images adapter supports resolution 1K only.')
        const resolved = await ctx.credentials.resolve(credentialRef(provider.apiKeyEnv))
        if (resolved === undefined) throw new Error(`No API key is configured for provider "${provider.id}" (${provider.apiKeyEnv}).`)
        const inputs = [
          ...await attachmentInputs(ctx, exec, args.input_attachment_ids ?? []),
          ...await workspaceInputs(exec, args.input_paths ?? []),
        ]
        const generated = await generateImage({ provider, model, apiKey: resolved.value, prompt: args.prompt, aspectRatio, resolution, inputs, signal: exec.signal })
        const png = await sharp(generated.data).rotate().png().toBuffer()
        const metadata = await sharp(png).metadata()
        if (metadata.width === undefined || metadata.height === undefined) throw new Error('Generated image has no readable dimensions.')
        const writtenPath = await writeWorkspacePng(agent.session.header.cwd ?? process.cwd(), args.output_path, png)
        const attachment = await ctx.attachments.saveImage({ data: png, mediaType: 'image/png' as ImageMediaType, name: path.basename(writtenPath) })
        const result = json({ path: writtenPath, provider: provider.id, model: model.id, aspectRatio, resolution, width: metadata.width, height: metadata.height, attachment })
        env.retryPolicy.recordSuccess(attempt)
        return result
      } catch (error) {
        if (exec.signal.aborted) throw error
        throw env.retryPolicy.recordFailure(attempt, error)
      }
    },
  })
}
