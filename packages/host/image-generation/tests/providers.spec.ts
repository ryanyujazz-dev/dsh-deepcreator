import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImage } from '../src/providers.ts'
import type { GenerateImageRequest, ImageProviderProtocol } from '../src/types.ts'

function request(protocol: ImageProviderProtocol): GenerateImageRequest {
  return {
    provider: { id: protocol, protocol, baseURL: `https://${protocol}.example.test/v1`, apiKeyEnv: 'TEST_KEY', models: [], defaultModel: 'model' },
    model: { id: 'model', modes: ['text-to-image', 'image-to-image'], aspectRatios: ['1:1'], resolutions: ['1K'] },
    apiKey: 'secret', prompt: 'a small blue house', aspectRatio: '1:1', resolution: '1K', inputs: [], signal: new AbortController().signal,
  }
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('native image providers', () => {
  it('honors deployment HTTP proxy environment variables', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await generateImage(request('openai'))
    const [, init] = fetch.mock.calls[0]!
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
  })

  it('returns an actionable VPN/system-proxy error when direct access is unavailable', async () => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) vi.stubEnv(name, '')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }) })
    }))
    await expect(generateImage(request('gemini'))).rejects.toThrow(
      'No HTTP(S) system or environment proxy was available to the Host. Connect the VPN or enable the operating system proxy',
    )
  })

  it('distinguishes an unavailable configured proxy from a missing proxy', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) })
    }))
    await expect(generateImage(request('gemini'))).rejects.toThrow(
      'through the configured system or environment proxy. Check that the VPN/proxy is running',
    )
  })

  it('sends one OpenAI Images generation and decodes its base64 result', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await generateImage(request('openai'))
    expect(Buffer.from(result.data).toString()).toBe('png')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://openai.example.test/v1/images/generations')
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'model', n: 1, size: '1024x1024', output_format: 'png' })
  })

  it('sends OpenAI reference images under the native multipart image field', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const edit = request('openai')
    edit.inputs = [{ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png', name: 'source.png' }]
    await generateImage(edit)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://openai.example.test/v1/images/edits')
    expect(init?.body).toBeInstanceOf(FormData)
    const body = init?.body as FormData
    expect(body.getAll('image[]')).toHaveLength(1)
    expect(body.getAll('image')).toHaveLength(0)
  })

  it('disables Seedream group output and leaves image format to model-compatible defaults', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('seedream').toString('base64') }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await generateImage(request('seedream'))
    const [, init] = fetch.mock.calls[0]!
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.sequential_image_generation).toBe('disabled')
    expect(body).not.toHaveProperty('output_format')
  })

  it('uses the Gemini Interactions image format and returns exactly one image block', async () => {
    const encoded = Buffer.from('image').toString('base64')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'image', data: encoded, mime_type: 'image/png' }] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await generateImage(request('gemini'))
    expect(Buffer.from(result.data).toString()).toBe('image')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://gemini.example.test/v1/interactions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'model',
      input: [{ type: 'text', text: 'a small blue house' }],
      response_format: { type: 'image', aspect_ratio: '1:1', image_size: '1K' },
    })
  })
})
