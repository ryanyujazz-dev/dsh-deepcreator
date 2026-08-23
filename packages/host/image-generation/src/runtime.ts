import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  CreateImageResult, ImageGenerationRequestContext, ImageGenerationResultEvent,
  ImageGenerationMiddleware, ImageGenerationResultListener,
} from './types.ts'

/** Reversible, provider-neutral interception and observation boundary. */
export class ImageGenerationRuntime extends Service {
  private readonly middleware: ImageGenerationMiddleware[] = []
  private readonly listeners = new Set<ImageGenerationResultListener>()

  constructor(ctx: Context) { super(ctx, 'imageGenerationRuntime') }

  registerRequestMiddleware(middleware: ImageGenerationMiddleware): () => void {
    this.middleware.push(middleware)
    return () => {
      const index = this.middleware.indexOf(middleware)
      if (index >= 0) this.middleware.splice(index, 1)
    }
  }

  onResult(listener: ImageGenerationResultListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async run(request: ImageGenerationRequestContext, execute: () => Promise<CreateImageResult>): Promise<CreateImageResult> {
    let index = -1
    const dispatch = async (nextIndex: number): Promise<CreateImageResult> => {
      if (nextIndex <= index) throw new Error('Image generation middleware called next() more than once.')
      index = nextIndex
      const middleware = this.middleware[nextIndex]
      return middleware === undefined ? execute() : middleware(request, () => dispatch(nextIndex + 1))
    }
    try {
      const result = await dispatch(0)
      await this.publish({ status: 'succeeded', request, result })
      return result
    } catch (error) {
      await this.publish({ status: 'failed', request, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private async publish(event: ImageGenerationResultEvent): Promise<void> {
    // Persistence/telemetry observers are isolated from provider success.
    await Promise.allSettled([...this.listeners].map(async listener => { await listener(event) }))
  }
}
