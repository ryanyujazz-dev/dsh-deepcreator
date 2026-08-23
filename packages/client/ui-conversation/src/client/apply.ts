/** Registers the conversation components, shared store, and service callbacks. */
import type { Context } from '@deepseek-ai/cordis'
import { resolveSlotLabel, type BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import {
  resolveWorkspacePath, type ISessions, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@ryanyujazz/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@ryanyujazz/dsh-client-locale/client'
// Type-only: the ctx.workbench Context merge — file opening and change reveal
// read the optional service; ui-workbench stays an undirected collaborator.
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { ViewTab } from './contract/views.ts'
import type {
  ApprovalWait, ChatNodeTurnDataInjected, ChatScrollPosition, ChatViewInjected, ComposerBarInjected,
  ComposerChainProps, ConversationInjected, ConversationSessionHeaderInjected, ConversationSessionInjected,
} from './contract/slots.ts'
import type { InputNotice } from './input/contract.ts'
import { createChatStore } from './stores.ts'
import { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
import type { IConversation } from './service.ts'
import { ComposerBlockRegistry } from './input/blocks.ts'
import type { ComposerBlock } from './input/blocks.ts'
import { InputHub } from './input/hub.ts'
import { ComposerSubmissionPolicy } from './input/submission-policy.ts'
import { RenderModePreference } from './chat/render-mode-preference.ts'
import { InputBar } from './skeleton/InputBar.tsx'
import { EnterBehaviorRow } from './settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowInjected } from './settings/EnterBehaviorRow.tsx'
import { DefaultRenderModeRow } from './settings/DefaultRenderModeRow.tsx'
import type { DefaultRenderModeRowInjected } from './settings/DefaultRenderModeRow.tsx'
import { ChatView } from './chat/ChatView.tsx'
import { ChatRenderStandard } from './chat/ChatRenderStandard.tsx'
import {
  ConversationEmbed, ConversationEmbedSurface, type ConversationEmbedSurfaceInjected,
} from './chat/ConversationEmbed.tsx'
import { ExecFlowBody, type ExecFlowBodyInjected } from './chat/ExecFlowBody.tsx'
import { StatsLine } from './chat/StatsLine.tsx'
import { ApprovalPanel } from './skeleton/ApprovalPanel.tsx'
import { todoDockEntry } from './skeleton/TodoPanel.tsx'
import { queueDockEntry } from './queue/QueueDock.tsx'
import { ConversationRoot } from './skeleton/ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from './skeleton/ConversationSession.tsx'
import { en, NS, zh, type ConversationKey } from './locales.ts'
import { registerConversationNodes } from './conversation-nodes/register.ts'
import { registerChatNodeRenderers } from './chat/register-node-renderers.ts'
import { ConversationSurfaceRegistry } from './surface-registry.ts'
import {
  BUSY_ENTER_BEHAVIORS, CONVERSATION_RENDER_MODES, CONVERSATION_SETTINGS_NAMESPACE,
  type ConversationSettings,
} from '../submission-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The conversation skeleton, chat flow, commands, details, and docks copy. */
    conversation: ConversationKey
  }
}

/** Services required by the conversation plugin. */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'settingsScope',
  'conversationEvents', 'conversationViews',
]

// Static no-session sources for the composer-bar hooks compartment: module
// constants so the render side's per-source hook cache (observableHook) keeps
// one identity across every no-session render.
const ABSENT_NOTICES = {
  getSnapshot: (): InputNotice | null => null,
  subscribe: () => () => {},
}
/** No session, therefore nothing to block; same one-identity rule as above. */
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
}
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()
const ABSENT_LEXICON = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => {},
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
}

const CHAT_NODE_INJECT: ChatNodeTurnDataInjected = {
  hooks: {
    turnData: ({ useSession }, nodeKey) => function useTurnData(key) {
      return useSession((snapshot) => {
        const location = snapshot.chat.nodes.get(nodeKey)?.location
        return location?.kind === 'turn' || location?.kind === 'step'
          ? location.turn.data.get(key)
          : undefined
      })
    },
  },
}

/** Resolve the session-scoped conversation face (scope-addressed send/cancel), failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable through the session scope')
  return conversation
}

/** Resolve package-internal attachment operations from the public service registration. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/** Chain routing: claim the composer while an approval wait is pending (pure — owner props only). */
function selectApproval({ interactions }: ComposerChainProps): ApprovalWait | null {
  return interactions.find((i): i is ApprovalWait => i.kind === 'approval') ?? null
}

/** Mounts the conversation plugin.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const workspaces = ctx.workspaces
  const slots = ctx.slots

  registerConversationNodes(ctx)
  registerChatNodeRenderers(ctx)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries')

  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration; components read the standard `t` seat instead.
  const t = ctx.locale.bind(NS)

  // Apply-time construction keeps store identity bound to this fiber.
  const chatStore = createChatStore()
  const conversationSettings = ctx.settingsScope.bind<ConversationSettings>({
    namespace: CONVERSATION_SETTINGS_NAMESPACE,
    decode: (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
      const candidate = value as Partial<Record<keyof ConversationSettings, unknown>>
      if (!BUSY_ENTER_BEHAVIORS.some(behavior => behavior === candidate.busyEnter)
        || !CONVERSATION_RENDER_MODES.some(mode => mode === candidate.defaultRenderMode)) return undefined
      return candidate as ConversationSettings
    },
  })
  const submissionPolicy = new ComposerSubmissionPolicy(conversationSettings)
  const renderModePreference = new RenderModePreference(conversationSettings)

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'composer-enter',
    order: 20,
    locale: NS,
    inject: (): EnterBehaviorRowInjected => ({
      hooks: { busyEnter: submissionPolicy.busyEnter },
      setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))

  ctx.slots.inject('deepcreator.settings.preferences.item', () => ctx.slots.register({
    name: 'deepcreator.settings.preferences.item',
    id: 'default-render-mode',
    order: 0,
    locale: NS,
    inject: (): DefaultRenderModeRowInjected => ({
      hooks: { defaultRenderMode: renderModePreference.value },
      setDefaultRenderMode: (mode, currentSessionId) => {
        renderModePreference.set(mode, currentSessionId)
      },
    }),
  }, DefaultRenderModeRow))

  // Chat semantic reader positions by session, surviving view switches and
  // width reflow when the tab ring remounts the view. Deliberately not
  // persisted: a fresh page load keeps the open-jump-to-bottom default.
  const chatScrollPositions = new Map<string, ChatScrollPosition>()
  const chatScrollFaces = new Map<string, ReturnType<ChatViewInjected['chatScrollFor']>>()
  const surfaces = new ConversationSurfaceRegistry()

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- unreachable: list registration validates id at load. */
      if (entry.options.id === undefined) continue
      tabs.push({ id: entry.options.id, label: resolveSlotLabel(entry.options.label) ?? entry.options.id })
    }
    return tabs
  }
  const views = {
    list: viewTabs,
    subscribe: (fn: () => void) => slots.subscribe('conversation.view', fn),
    version: () => slots.getVersion('conversation.view'),
  }

  // The chat view's render-mode ledger: same projection shape as `views`,
  // over the mode ring the chat entry declares below. A mode plugin's
  // registration appears in the selector live, and a removed mode's id
  // falls back to the shipped `normal`.
  const modes = {
    list: (): ViewTab[] => {
      const tabs: ViewTab[] = []
      for (const entry of slots.entries('conversation.chat.render')) {
        /* v8 ignore next -- unreachable: list registration validates id at load. */
        if (entry.options.id === undefined) continue
        tabs.push({ id: entry.options.id, label: resolveSlotLabel(entry.options.label) ?? entry.options.id })
      }
      return tabs
    },
    subscribe: (fn: () => void) => slots.subscribe('conversation.chat.render', fn),
    version: () => slots.getVersion('conversation.chat.render'),
    defaultMode: renderModePreference.value,
    bindSession: (sessionId: SessionId, write: (mode: string) => void) => (
      renderModePreference.bindSession(sessionId, write)
    ),
    select: (sessionId: SessionId, mode: string, write: (mode: string) => void) => {
      renderModePreference.select(sessionId, mode, write)
    },
  }

  // The per-session input machine registry (SessionInputResolver face; published as
  // ctx.conversation.input by the service below sharing this one instance).
  const inputHub = new InputHub(ctx, t)

  // The composer-block registry: a plugin that knows a session cannot send —
  // ui-model-selection, when no adapter serves the session's route — raises a block
  // here, and the bar reads its own session's store. It cannot flow the other
  // way: this package must not import the plugins that would know.
  const composerBlocks = new ComposerBlockRegistry()

  // The input machine feeds every session-scope slot
  // component through the standard provide channel — the 'input' hook plus
  // the two public actions. Materialization is the shell creation trigger
  // (per-session lazy; scope disposer tears down).
  ctx.effect(() => sessions.provide({
    hooks: ['input'],
    props: ['inputActions'],
    resolve: (binding) => {
      const shell = inputHub.shellFor(binding)
      return {
        hooks: { input: shell.state },
        props: { inputActions: shell.actions },
      }
    },
  }), 'ui-conversation: input standard-kit provider')

  // Resident current-session-optional shell. It owns the stable Hero/composer
  // frame while strict session slots fill only their session-bound regions.
  slots.register({
    name: 'conversation',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      hooks: { composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId) },
      publishSessionRenderer: renderer => surfaces.register(renderer),
      selectWorkspace: async (workspaceId) => {
        const nextId = await workspaces.connectWorkspace(workspaceId)
        if (sessionId !== undefined && nextId !== sessionId) {
          const from = inputHub.shell(sessionId)
          const draft = from.snapshot.draft
          const imageIds = from.snapshot.imageIds
          const next = inputHub.shell(nextId)
          if (imageIds.length === 0 || next.addImages(imageIds)) {
            if (draft !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (imageIds.length > 0) {
              for (const id of imageIds) from.removeImage(id)
            }
          }
        }
        sessions.open(nextId)
      },
    }),
  }, ConversationRoot)

  // The strict session body fills the resident scrollport without owning it;
  // the Hero/composer path therefore stays fixed while the first blank
  // session appears after a Workspace pick.
  slots.register({
    name: 'conversation.session',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: chatStore,
    inject: (sessionId: SessionId, _actions: BoundActions<typeof chatStore>): ConversationSessionInjected => {
      const conversation = concreteConversation(ctx)
      return {
        views,
        retainSessionImages: (id) => conversation.retainSessionImages(id),
        bindDraftMirror: write => inputHub.shell(sessionId).bindMirror(write),
      }
    },
  }, ConversationSession)

  // Header chrome sits above the resident scrollport but shares the same
  // per-session chat store (active view) as its body and view entries.
  slots.register({
    name: 'conversation.session.header',
    locale: NS,
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
    store: chatStore,
    inject: (): ConversationSessionHeaderInjected => ({
      views,
      modes,
      open: (id) => { sessions.open(id) },
    }),
  }, ConversationSessionHeader)

  // The default composer body: its own single slot inside the composer
  // chain's fallback. Public machine surface arrives via the
  // provide channel above; the keyboard command face and the stop/retry
  // verbs ride this inject (package-internal — hub and bar are one plugin).
  // Session-maybe: with no current session the machine faces are absent and
  // the hooks compartment binds static empty sources (module constants, so
  // observableHook caching and hook order stay stable across transitions).
  slots.register({
    name: 'conversation.composer.bar',
    locale: NS,
    // The two named control seats in the bar's tool row (plan beside the
    // access control, model right); empty until their owning plugins
    // register.
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        return {
          keyboard: undefined,
          addImages: undefined,
          removeImage: undefined,
          draftImages: undefined,
          resolveSubmitMode: (running, gesture, steeringAvailable) =>
            submissionPolicy.resolve(running, gesture, steeringAvailable),
          toggleCommandMenu: undefined,
          stop: undefined,
          command: undefined,
          hooks: { notices: ABSENT_NOTICES, lexicon: ABSENT_LEXICON, menuLauncher: ABSENT_MENU_LAUNCHER },
        }
      }
      const conversation = concreteConversation(ctx)
      const shell = inputHub.shell(sessionId)
      const inputTriggers = inputHub.inputTriggers(sessionId)
      return {
        keyboard: shell,
        addImages: (files) => {
          try {
            const images = conversation.createDraftImages(files)
            if (!shell.addImages(images.map(image => image.id))) {
              conversation.releaseDraftImages(images)
            }
            return null
          } catch (error: unknown) {
            if (error instanceof UnsupportedImageMediaTypeError) {
              // Positive copy: the supported list is fixed in imageMediaType,
              // and naming it beats echoing the rejected MIME type back.
              return t('image.unsupportedType')
            }
            return error instanceof Error ? error.message : String(error)
          }
        },
        removeImage: (id) => {
          conversation.releaseDraftImage(id)
          shell.removeImage(id)
        },
        draftImages: ids => conversation.draftImages(ids),
        resolveSubmitMode: (running, gesture, steeringAvailable) =>
          submissionPolicy.resolve(running, gesture, steeringAvailable),
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            const snapshot = shell.snapshot
            inputTriggers.toggleSource('command', {
              trigger: '/',
              query: '',
              quoted: false,
              position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
              span: { ...selection, draftRev: snapshot.draftRev },
            })
          },
        stop: () => {
          scopedConversation(sessions, sessionId).cancel().catch(() => {
            // Stop failure surfaces via snapshot.promptError; nothing to restore.
          })
        },
        command: async (line) => {
          const session = sessions.binding(sessionId)?.session
          if (session === undefined) return false
          const result = await session.command(line)
          return result.ok && result.value.matched
        },
        hooks: {
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
        },
      }
    },
  }, InputBar)

  // The approval takeover: a selector-routed entry of the chain this package
  // just declared (the ui-user-questions registration pattern; the entry lives here
  // because approval answering is core conversation UX, not an optional tool).
  // Zero business face — data and verbs both ride the matched carrier.
  // priority 1: question takeovers (default 0) win when both kinds are
  // pending — a question is a conversation the model is waiting on, while an
  // approval only blocks one tool call; answering the question first cannot
  // strand the approval (it re-elects the moment the question resolves).
  slots.register({ name: 'conversation.composer', select: selectApproval, priority: 1, locale: NS }, ApprovalPanel)

  // The chat view: first entry of the ring this package just declared.
  // ChatView owns only the stable ordered Node list. Business renderers are
  // independently keyed behind its one Node seat.
  slots.register({
    name: 'conversation.view',
    id: 'chat',
    order: 0,
    label: () => t('view.chat'),
    locale: NS,
    children: {
      'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: CHAT_NODE_INJECT },
      'conversation.chat.render': { kind: 'list', scope: 'session' },
      'conversation.message.images': { kind: 'single', scope: 'session' },
    },
    store: chatStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof chatStore>): ChatViewInjected => {
      const conversation = concreteConversation(ctx)
      const scoped = scopedConversation(sessions, sessionId)
      return {
        openDetails: (target) => {
          actions.select(target)
        },
        fileMentions: owner => ctx.get('chatFileMentions')?.forClosing(owner),
        acknowledgeOutgoing: ids => { inputHub.shell(sessionId).acknowledgeOutgoing(ids) },
        openFile: (path) => {
          const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
          const resolved = resolveWorkspacePath(cwd, path)
          const workbench = ctx.get('workbench')
          if (workbench !== undefined && workbench.types.list().some(definition => definition.id === 'artifact')) {
            workbench.activate('artifact', resolved)
            return
          }
          void workspaces.openPath(resolved).catch(() => {
            // Host/OS open failures stay silent in the chat row; the native
            // app surfaces its own error dialog when the path is unusable.
          })
        },
        // The mutation rows' path link: focus the file's change in the review
        // panel when the Workbench and its review type are composed, and keep
        // the host open behavior otherwise (no silent dead link).
        revealChange: (path, turn) => {
          const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
          const resolved = resolveWorkspacePath(cwd, path)
          if (turn !== undefined && ctx.get('turnChangeNavigation')?.open(sessionId, turn, resolved) === true) return
          const workbench = ctx.get('workbench')
          if (workbench !== undefined && workbench.types.list().some(definition => definition.id === 'review')) {
            workbench.reveal('review', resolved)
            return
          }
          void workspaces.openPath(resolved).catch(() => { })
        },
        loadOlder: () => { void scoped.loadOlder() },
        loadImage: attachment => conversation.resolveImage(sessionId, attachment),
        // Unregistered 'trajectory' id is safe: the tab ring falls back to
        // the first view, and the untouched inspect target stays inert.
        inspectCall: (callId) => {
          actions.setInspect({ callId })
          actions.setView('trajectory')
        },
        chatScrollFor: (surfaceId) => {
          const key = `${sessionId}\u0000${surfaceId}`
          const existing = chatScrollFaces.get(key)
          if (existing !== undefined) return existing
          const face = {
            save: (position: ChatScrollPosition | null) => {
              if (position === null) chatScrollPositions.delete(key)
              else chatScrollPositions.set(key, position)
            },
            read: () => chatScrollPositions.get(key) ?? null,
          }
          chatScrollFaces.set(key, face)
          return face
        },
        forkAt: (seq) => {
          sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
            .then((childId) => { sessions.open(childId) })
            .catch(() => {
              // Fork or child-rename failure keeps the source view untouched.
            })
        },
        modes,
      }
    },
  }, ChatView)

  // The shipped chat render mode: the stock conversation flow. Alternative
  // modes register into the same ring with their own ids; ChatView's
  // selector dispatches the active one. The mode body renders through the
  // chat entry's delegated node seat (owner props), so it declares no
  // children of its own.
  slots.register({
    name: 'conversation.chat.render',
    id: 'normal',
    order: 0,
    label: () => t('chat.render.normal'),
    locale: NS,
    store: chatStore,
  }, ChatRenderStandard)

  // The execflow render modes share one body with a fixed think form:
  // classic hides reasoning (runs aggregate across steps), think shows it
  // expanded in the flow (runs stay step-scoped). Classic's live Think row
  // enters the sibling Think mode; inline mode needs no duplicate shortcut.
  const execflowMode = (id: 'classic' | 'think', thinkForm: 'compact' | 'inline', order: number) =>
    slots.register({
      name: 'conversation.chat.render',
      id,
      order,
      label: () => t(id === 'classic' ? 'chat.render.classic' : 'chat.render.think'),
      locale: NS,
      store: chatStore,
      inject: (): ExecFlowBodyInjected => ({
        thinkForm,
        siblingId: id === 'classic' ? 'think' : 'classic',
      }),
    }, ExecFlowBody)
  execflowMode('classic', 'compact', 10)
  execflowMode('think', 'inline', 20)

  // Activity's root adapter mounts an explicit non-navigating SessionProvider.
  // Its strict child surface then invokes the main conversation root's already
  // authorized session outlet, so data, pagination and every downstream
  // renderer are shared instead of mirrored.
  ctx.slots.inject('deepcreator.conversation.embed', () => {
    const disposeRoot = slots.register({
      name: 'deepcreator.conversation.embed',
      children: {
        'deepcreator.conversation.embed.surface': { kind: 'single', scope: 'session' },
      },
    }, ConversationEmbed)
    try {
      const disposeSurface = slots.register({
        name: 'deepcreator.conversation.embed.surface',
        inject: (): ConversationEmbedSurfaceInjected => ({ surfaces }),
      }, ConversationEmbedSurface)
      return () => {
        disposeSurface()
        disposeRoot()
      }
    } catch (error) {
      disposeRoot()
      throw error
    }
  })

  // Session stats stick with the composer (composer.dock = stats-line family).
  slots.register({ name: 'conversation.composer.dock', id: 'stats', order: 0, locale: NS }, StatsLine)

  // Class-plugin mount (packages/AGENTS.md service form): the service
  // registers itself as `conversation` and lives on its own child fiber.
  // Presentation registrants depend directly on their slot declarations;
  // this service remains only where conversation actions are required.
  ctx.plugin(ConversationController, { input: inputHub, blocks: composerBlocks })

  // The plan strip rides the input dock above the queue rows (same posture).
  ctx.plugin(todoDockEntry)

  // The read-only queue dock entry rides the same
  // registration path into the input dock declared above.
  ctx.plugin(queueDockEntry)

}
