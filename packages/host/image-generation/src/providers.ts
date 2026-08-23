import type { GenerateImageRequest, GeneratedImage, ImageAspectRatio, ImageInput, ImageResolution } from './types.ts'
import { EnvHttpProxyAgent, type Dispatcher } from 'undici'

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function createProxyDispatcher(): EnvHttpProxyAgent | undefined {
  const configured = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
    .some(name => process.env[name]?.trim())
  if (!configured) return undefined
  try {
    return new EnvHttpProxyAgent()
  } catch (error) {
    throw new Error(`Image provider proxy configuration is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function networkCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') return cause.code
  return error.message
}

async function providerFetch(url: string, init: RequestInit, dispatcher: Dispatcher | undefined): Promise<Response> {
  try {
    if (dispatcher === undefined) return await fetch(url, init)
    return await fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher })
  } catch (error) {
    if (init.signal?.aborted) throw error
    const origin = (() => { try { return new URL(url).origin } catch { return 'the configured endpoint' } })()
    const detail = networkCause(error)
    if (dispatcher === undefined) {
      throw new Error(`Cannot reach image provider at ${origin}. No HTTP(S) system or environment proxy was available to the Host. Connect the VPN or enable the operating system proxy, then retry. Network error: ${detail}`, { cause: error })
    }
    throw new Error(`Cannot reach image provider at ${origin} through the configured system or environment proxy. Check that the VPN/proxy is running and can reach this provider, then retry. Network error: ${detail}`, { cause: error })
  }
}

async function responseError(response: Response): Promise<Error> {
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-goog-request-id')
  const text = (await response.text()).slice(0, 4_000)
  return new Error(`Image provider returned HTTP ${response.status}${requestId === null ? '' : ` (${requestId})`}: ${text || response.statusText}`)
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

async function download(url: string, signal: AbortSignal, dispatcher: Dispatcher | undefined): Promise<GeneratedImage> {
  const response = await providerFetch(url, { signal, redirect: 'follow' }, dispatcher)
  if (!response.ok) throw await responseError(response)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('Generated image exceeds the 64 MiB response limit.')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_RESPONSE_BYTES) throw new Error('Generated image exceeds the 64 MiB response limit.')
  return { data, mediaType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' }
}

function firstImagePayload(value: unknown): { base64?: string; url?: string; mediaType?: string } {
  if (typeof value !== 'object' || value === null) throw new Error('Image provider returned a non-object response.')
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== 'object' || data[0] === null) {
    throw new Error('Image provider did not return exactly one image.')
  }
  const item = data[0] as Record<string, unknown>
  return {
    ...(typeof item.b64_json === 'string' ? { base64: item.b64_json } : {}),
    ...(typeof item.url === 'string' ? { url: item.url } : {}),
    ...(typeof item.mime_type === 'string' ? { mediaType: item.mime_type } : {}),
  }
}

function openAIImageSize(ratio: ImageAspectRatio): string {
  if (ratio === 'source') return 'auto'
  if (ratio === '1:1') return '1024x1024'
  if (ratio === '3:2' || ratio === '4:3' || ratio === '16:9') return '1536x1024'
  return '1024x1536'
}

async function openAI(request: GenerateImageRequest, dispatcher: Dispatcher | undefined): Promise<GeneratedImage> {
  const url = endpoint(request.provider.baseURL, request.inputs.length === 0 ? 'images/generations' : 'images/edits')
  let body: string | FormData
  const headers: Record<string, string> = { Authorization: `Bearer ${request.apiKey}` }
  if (request.inputs.length === 0) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify({
      model: request.model.id,
      prompt: request.prompt,
      n: 1,
      size: openAIImageSize(request.aspectRatio),
      output_format: 'png',
    })
  } else {
    const form = new FormData()
    form.set('model', request.model.id)
    form.set('prompt', request.prompt)
    form.set('n', '1')
    form.set('size', openAIImageSize(request.aspectRatio))
    form.set('output_format', 'png')
    for (const [index, image] of request.inputs.entries()) {
      form.append('image[]', new Blob([image.data], { type: image.mediaType }), image.name ?? `input-${index + 1}`)
    }
    body = form
  }
  const response = await providerFetch(url, { method: 'POST', headers, body, signal: request.signal }, dispatcher)
  if (!response.ok) throw await responseError(response)
  const payload = firstImagePayload(await response.json())
  if (payload.base64 !== undefined) return { data: decodeBase64(payload.base64), mediaType: payload.mediaType ?? 'image/png' }
  if (payload.url !== undefined) return download(payload.url, request.signal, dispatcher)
  throw new Error('OpenAI Images returned neither base64 image data nor an image URL.')
}

function seedreamDimensions(ratio: ImageAspectRatio, resolution: ImageResolution): string {
  if (ratio === 'source') return resolution
  const [rw, rh] = ratio.split(':').map(Number) as [number, number]
  const longSide = resolution === '1K' ? 1536 : resolution === '2K' ? 2048 : 4096
  const scale = longSide / Math.max(rw, rh)
  const align = (value: number) => Math.max(512, Math.round(value / 64) * 64)
  return `${align(rw * scale)}x${align(rh * scale)}`
}

function dataUrl(image: ImageInput): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

async function seedream(request: GenerateImageRequest, dispatcher: Dispatcher | undefined): Promise<GeneratedImage> {
  const response = await providerFetch(endpoint(request.provider.baseURL, 'images/generations'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: request.model.id,
      prompt: request.prompt,
      ...(request.inputs.length === 0 ? {} : { image: request.inputs.map(dataUrl) }),
      size: seedreamDimensions(request.aspectRatio, request.resolution),
      sequential_image_generation: 'disabled',
      response_format: 'url',
      watermark: false,
    }),
    signal: request.signal,
  }, dispatcher)
  if (!response.ok) throw await responseError(response)
  const payload = firstImagePayload(await response.json())
  if (payload.base64 !== undefined) return { data: decodeBase64(payload.base64), mediaType: payload.mediaType ?? 'image/png' }
  if (payload.url !== undefined) return download(payload.url, request.signal, dispatcher)
  throw new Error('Seedream returned neither base64 image data nor an image URL.')
}

async function gemini(request: GenerateImageRequest, dispatcher: Dispatcher | undefined): Promise<GeneratedImage> {
  const input: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }]
  for (const image of request.inputs) {
    input.push({ type: 'image', mime_type: image.mediaType, data: Buffer.from(image.data).toString('base64') })
  }
  const response = await providerFetch(endpoint(request.provider.baseURL, 'interactions'), {
    method: 'POST',
    headers: { 'x-goog-api-key': request.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: request.model.id,
      input,
      response_format: {
        type: 'image',
        ...(request.aspectRatio === 'source' ? {} : { aspect_ratio: request.aspectRatio }),
        image_size: request.resolution,
      },
    }),
    signal: request.signal,
  }, dispatcher)
  if (!response.ok) throw await responseError(response)
  const value = await response.json() as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }> }
  const images = value.steps?.filter(step => step.type === 'model_output').flatMap(step => step.content ?? [])
    .filter(part => part.type === 'image' && part.data !== undefined) ?? []
  if (images.length !== 1 || images[0]?.data === undefined) throw new Error(`Gemini returned ${images.length} images; create_image requires exactly one.`)
  return { data: decodeBase64(images[0].data), mediaType: images[0].mime_type ?? 'image/png' }
}

export async function generateImage(request: GenerateImageRequest): Promise<GeneratedImage> {
  const dispatcher = createProxyDispatcher()
  try {
    switch (request.provider.protocol) {
      case 'openai': return await openAI(request, dispatcher)
      case 'seedream': return await seedream(request, dispatcher)
      case 'gemini': return await gemini(request, dispatcher)
    }
    throw new Error(`Unsupported image provider protocol: ${String(request.provider.protocol)}`)
  } finally {
    await dispatcher?.close()
  }
}
