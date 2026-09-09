/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import {
  type ISessions,
  type SessionFace,
} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  type SessionId, type SessionSeq,
} from '@deepseek-ai/dsh-session/types'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSeq as WireSeq } from '@deepseek-ai/dsh-session/types'

// The fork's controller carries the official 0.1.2 jump loader (the turn
// rail's unloaded-jump transport) on the conversation service face.
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface IConversation {
    /** Page history back until the scoped Session's window covers `seq`. */
    loadThrough(seq: WireSeq): Promise<void>
    /** Resolve one durable image into a session-authorized browser URL. */
    resolveImage(sessionId: import('@deepseek-ai/dsh-session/types').SessionId, attachment: import('@deepseek-ai/dsh-attachment').ImageAttachmentRef): Promise<string>
  }
}
import type {
  ComposerAttachment, ComposerFileAttachment, ComposerImageAttachment, DraftFileUpload,
} from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './input/blocks.ts'
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply. Declared by the official conversation client; the
 * fork re-exports it so downstream packages keep their import path.
 */
export type { IConversation }

/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(file: File): ComposerImageAttachment {
  return {
    kind: 'image',
    id: crypto.randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

/** Fill image dimensions when the browser exposes them; presentation falls back to CSS sizing. */
function probeDimensions(attachment: ComposerImageAttachment): void {
  if (typeof Image !== 'function') return
  const probe = new Image()
  probe.onload = () => {
    attachment.width = probe.naturalWidth
    attachment.height = probe.naturalHeight
  }
  probe.src = attachment.previewUrl
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  /** Live upload state per generic-file draft; image drafts never enter this store. */
  readonly fileUploads: SnapshotStore<Record<string, DraftFileUpload>> = createSnapshotStore<Record<string, DraftFileUpload>>({})
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly fileUploadOperations = new Map<DraftAttachmentId, AbortController>()
  private readonly pendingFileUploads = new Set<Promise<void>>()
  private readonly fileUploadQueue: Array<{ readonly run: () => Promise<void>; readonly settle: () => void }> = []
  private activeFileUploads = 0
  private readonly maxConcurrentFileUploads: number
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly imageLeases = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: {
    input: SessionInputResolver
    blocks: ComposerBlocks
    maxConcurrentFileUploads?: number
  }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    this.maxConcurrentFileUploads = config.maxConcurrentFileUploads ?? 2
    ctx.effect(() => async () => {
      this.disposed = true
      for (const controller of this.fileUploadOperations.values()) controller.abort()
      await Promise.allSettled([...this.pendingFileUploads])
      this.fileUploadOperations.clear()
      this.fileUploadQueue.length = 0
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftAttachments.clear()
      this.fileUploads.set({})
      this.imageUrls.clear()
      this.imageGenerations.clear()
      this.imageLeases.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft attachments with text through one host admission.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param attachmentIds - ordered draft-local attachment ids.
   * @param mode - queue or steer delivery selected by composer policy.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
  ): Promise<void> {
    const attachments = this.resolveDraftAttachments(attachmentIds)
    if (attachments.length !== attachmentIds.length) {
      throw new Error('conversation.sendSession: one or more draft attachments are no longer available')
    }
    const uploads = this.fileUploads.getSnapshot()
    const uploaded: Parameters<SessionFace['prompt']>[0] = await Promise.all(attachments.map(async (attachment) => {
      if (attachment.kind === 'image') {
        return {
          type: 'image' as const,
          mediaType: imageMediaType(attachment.file.type),
          data: bytesToBase64(new Uint8Array(await attachment.file.arrayBuffer())),
          ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
        }
      }
      const upload = uploads[attachment.id]
      if (upload === undefined || upload.status !== 'ready') {
        throw new Error('conversation.sendSession: one or more files have not finished uploading')
      }
      return { type: 'file' as const, receiptId: upload.receiptId }
    }))
    const content = [...uploaded, ...(text === '' ? [] : [{ type: 'text' as const, text }])]
    const result = await session.prompt(content, mode)
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
    this.releaseDraftAttachments(attachments)
  }

  /** Register image previews and generic-file background uploads for one Session. */
  createDrafts(sessionId: SessionId, files: readonly File[]): readonly ComposerAttachment[] {
    return files.map((file) => {
      if (isImageMediaType(file.type)) {
        const attachment = browserDraftAttachment(file)
        this.draftAttachments.set(attachment.id, attachment)
        this.createdImageUrls.add(attachment.previewUrl)
        probeDimensions(attachment)
        return attachment
      }
      const attachment: ComposerFileAttachment = {
        kind: 'file',
        id: crypto.randomUUID() as DraftAttachmentId,
        file,
      }
      this.draftAttachments.set(attachment.id, attachment)
      this.beginFileUpload(sessionId, attachment)
      return attachment
    })
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerImageAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftAttachments.set(attachment.id, attachment)
      this.createdImageUrls.add(attachment.previewUrl)
      return attachment
    })
  }

  /** Resolve ordered input ids to every live draft kind. */
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft images.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerImageAttachment[] {
    const attachments: ComposerImageAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment?.kind === 'image') attachments.push(attachment)
    }
    return attachments
  }

  /** Serialize draft images for a command that explicitly accepts attachments. */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly {
    type: 'image'
    mediaType: ImageMediaType
    data: string
    name?: string
  }[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    return Promise.all(attachments.map(async ({ file }) => ({
      type: 'image' as const,
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    })))
  }

  /** Serialize image bytes or completed file-upload receipts for commands. */
  async serializeDraftAttachments(attachmentIds: readonly DraftAttachmentId[]): Promise<{
    readonly attachments: readonly import('@deepseek-ai/dsh-client-ui-conversation/client').SubmitAttachment[]
  }> {
    const attachments = this.resolveDraftAttachments(attachmentIds)
    if (attachments.length !== attachmentIds.length) {
      throw new Error('conversation.serializeDraftAttachments: one or more draft attachments are no longer available')
    }
    const uploads = this.fileUploads.getSnapshot()
    return {
      attachments: await Promise.all(attachments.map(async (attachment) => {
        if (attachment.kind === 'image') {
          return {
            type: 'image' as const,
            mediaType: imageMediaType(attachment.file.type),
            data: bytesToBase64(new Uint8Array(await attachment.file.arrayBuffer())),
            ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
          }
        }
        const upload = uploads[attachment.id]
        if (upload === undefined || upload.status !== 'ready') {
          throw new Error('conversation.serializeDraftAttachments: one or more files have not finished uploading')
        }
        return { type: 'file' as const, receiptId: upload.receiptId }
      })),
    }
  }

  /** Restart a failed generic-file upload. */
  retryFileUpload(sessionId: SessionId, id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment?.kind !== 'file' || this.fileUploads.getSnapshot()[id]?.status !== 'error') return
    this.beginFileUpload(sessionId, attachment)
  }

  /** Re-stage carried generic files when the composer moves to another Session. */
  rebindDraftFiles(sessionId: SessionId, ids: readonly DraftAttachmentId[]): void {
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment?.kind === 'file') this.beginFileUpload(sessionId, attachment)
    }
  }

  /** Release any draft kind and cancel a live generic-file upload. */
  releaseDraftAttachment(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.fileUploadOperations.get(id)?.abort()
    this.fileUploadOperations.delete(id)
    this.draftAttachments.delete(id)
    if (attachment.kind === 'image') {
      this.createdImageUrls.delete(attachment.previewUrl)
      revokePreview(attachment.previewUrl)
      return
    }
    this.fileUploads.set(Object.fromEntries(
      Object.entries(this.fileUploads.getSnapshot()).filter(([key]) => key !== id),
    ))
  }

  /** Release an ordered group of draft attachments. */
  releaseDraftAttachments(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftAttachment(attachment.id)
  }

  /**
   * Release one browser-owned draft image and preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    if (this.draftAttachments.get(id)?.kind === 'image') this.releaseDraftAttachment(id)
  }

  /**
   * Release a set of browser-owned draft images.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerImageAttachment[]): void {
    this.releaseDraftAttachments(attachments)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /**
   * Retain one rendered occurrence's historical-image cache. The final
   * release invalidates pending loads and revokes URLs; simultaneous main and
   * Activity surfaces therefore cannot release each other's images.
   */
  retainSessionImages(sessionId: SessionId): () => void {
    this.imageLeases.set(sessionId, (this.imageLeases.get(sessionId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.imageLeases.get(sessionId) ?? 1) - 1
      if (next > 0) {
        this.imageLeases.set(sessionId, next)
        return
      }
      this.imageLeases.delete(sessionId)
      this.releaseSessionImages(sessionId)
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'session/steer-unavailable' || result.error.code === 'session/queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Page history back until the scoped Session's window covers `seq` (turn-rail jumps). */
  async loadThrough(seq: SessionSeq): Promise<void> {
    await this.scopedSession('loadThrough').loadThrough(seq)
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  private beginFileUpload(sessionId: SessionId, attachment: ComposerFileAttachment): void {
    this.fileUploadOperations.get(attachment.id)?.abort()
    const controller = new AbortController()
    this.fileUploadOperations.set(attachment.id, controller)
    this.fileUploads.update((draft) => {
      draft[attachment.id] = { status: 'uploading', loaded: 0 }
    })
    let settle!: () => void
    const done = new Promise<void>((resolve) => { settle = resolve })
    this.pendingFileUploads.add(done)
    void done.then(() => { this.pendingFileUploads.delete(done) })
    const run = async (): Promise<void> => {
      try {
        if (controller.signal.aborted || this.fileUploadOperations.get(attachment.id) !== controller) return
        const result = await this.ctx.fileUpload.upload(
          sessionId,
          attachment.file,
          attachment.file.name === '' ? undefined : attachment.file.name,
          controller.signal,
          (progress) => {
            if (this.fileUploadOperations.get(attachment.id) !== controller) return
            this.fileUploads.update((draft) => {
              if (!(attachment.id in draft)) return
              draft[attachment.id] = {
                status: 'uploading',
                loaded: progress.loaded,
                ...(progress.total === undefined ? {} : { total: progress.total }),
              }
            })
          },
        )
        if (this.fileUploadOperations.get(attachment.id) !== controller) return
        this.fileUploads.update((draft) => {
          if (!(attachment.id in draft)) return
          draft[attachment.id] = result.ok
            ? { status: 'ready', receiptId: result.value.receiptId, file: result.value.file }
            : { status: 'error', message: result.error.message }
        })
      } catch (error) {
        if (this.fileUploadOperations.get(attachment.id) !== controller) return
        this.fileUploads.update((draft) => {
          if (!(attachment.id in draft)) return
          draft[attachment.id] = { status: 'error', message: error instanceof Error ? error.message : String(error) }
        })
      } finally {
        if (this.fileUploadOperations.get(attachment.id) === controller) this.fileUploadOperations.delete(attachment.id)
      }
    }
    this.fileUploadQueue.push({ run, settle })
    this.pumpFileUploads()
  }

  private pumpFileUploads(): void {
    while (this.activeFileUploads < this.maxConcurrentFileUploads) {
      const task = this.fileUploadQueue.shift()
      if (task === undefined) return
      this.activeFileUploads += 1
      void task.run().finally(() => {
        this.activeFileUploads -= 1
        task.settle()
        this.pumpFileUploads()
      })
    }
  }

}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function isImageMediaType(value: string): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
