/** Conversation slot declarations and their composed component props. */
import type { ReactNode } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ObservableSnapshot,
} from '@deepseek-ai/dsh-client-store'
import type {
  PendingWait,
} from '@ryanyujazz/dsh-client-compat'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  ChatNodeKind, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MarkdownFileMentions } from '@ryanyujazz/dsh-client-ui-primitives'
import type { SettingsGeneralItemOwnerProps } from '@ryanyujazz/dsh-client-ui-settings/client'
import type {} from '@ryanyujazz/dsh-client-ui-layout/client'
import type { ComposerBlock } from '../input/blocks.ts'
import type {
  ComposerKeyboard, DraftAttachmentId, EditSelection, InputNotice,
} from '../input/contract.ts'
import type { createChatStore } from '../stores.ts'
import type { ComposerSubmitGesture, InputSubmitMode } from './composer-submission.ts'
import type { CallId, ViewTab } from './views.ts'
import type { ConversationRenderMode } from '../../submission-settings.ts'

/**
 * Slot names owned by the official 0.1.2 packages (`dsh-client-ui-conversation`
 * and `dsh-client-ui-chat`) are deliberately NOT redeclared here — duplicate
 * SlotMap merges with different shapes are a compile error, and this package
 * renders INTO those official entries. The official owner types are reused,
 * extended where noted with the fork-only members below.
 */

/** Browser-owned image that has not crossed the durable host boundary. */
export type ComposerAttachment =
  import('@deepseek-ai/dsh-client-ui-conversation/client').ComposerAttachment

/** Draft-image state handed to the retained official attachment presenter. */
export type ComposerAttachmentsOwnerProps =
  import('@deepseek-ai/dsh-client-ui-conversation/client').ComposerAttachmentsOwnerProps

/** Durable message images handed to the retained official attachment presenter. */
export type MessageImagesOwnerProps =
  import('@deepseek-ai/dsh-client-ui-conversation/client').MessageImagesOwnerProps

/** Slot-backed image renderer; conversation owns data, attachment owns React. */
export type RenderMessageImages =
  import('@deepseek-ai/dsh-client-ui-conversation/client').RenderMessageImages

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Feature-owned rows inside the shared Preferences settings group. The
     * group owns layout and separators; each entry owns its durable setting.
     */
    'deepcreator.settings.preferences.item': {
      kind: 'list'
      scope: 'root'
      owner: SettingsGeneralItemOwnerProps
    }
    /**
     * Per-session activity chips directly under the session header — the
     * visibility outlet for background agent work on installed apps (the
     * App Stage's invoke-activity signal lives here in conversation mode).
     * Entries render by ascending `order`; the owner passes nothing because
     * every chip is self-sufficient through the framework session kit and its
     * own inject face. An empty seat is invisible.
     */
    'conversation.activity.chip': { kind: 'list'; scope: 'session' }
    /**
     * Root adapter for an explicitly addressed, non-navigating child Session.
     * It declares one strict-session surface so the framework supplies the
     * same SessionProvider and standard kit as the main conversation.
     */
    'deepcreator.conversation.embed': {
      kind: 'single'
      scope: 'root'
      owner: ConversationEmbedOwnerProps
    }
    /** Strict child-session surface mounted under the explicit provider. */
    'deepcreator.conversation.embed.surface': {
      kind: 'single'
      scope: 'session'
      owner: ConversationEmbedSurfaceOwnerProps
    }
    /**
     * Fork-private replacement for the official owner-less
     * `conversation.session` seat: the entire body of one session, with the
     * render-occurrence owner share the official entry cannot carry. The
     * occupant also owns the per-session draft mirror and the active view
     * ring, so a replacement inherits both duties.
     */
    'deepcreator.conversation.session': {
      kind: 'single'
      scope: 'session'
      owner: ConversationSessionOwnerProps
    }
    /** Generated media rendered independently before the produced-files card. */
    'deepcreator.conversation.chat.turnMedia': {
      kind: 'list'
      scope: 'session'
      owner: TurnMediaOwnerProps
    }
    /**
     * DeepCreator-owned additive rows immediately after the official Turn
     * tail and before the finalized message's IconActions. The official
     * `conversation.chat.turnTail` remains a selector chain (one winning
     * provider); this separate list lets Review keep its independent change
     * card below the official per-Turn produced-files row.
     */
    'deepcreator.conversation.chat.turnChanges': {
      kind: 'list'
      scope: 'session'
      owner: TurnTailOwnerProps
    }
    /**
     * The chat view's render-mode ring: one list entry per rendering mode
     * (this package ships `normal`; a plugin adds an alternative mode with a
     * fresh id, and reusing the shipped id puts it in THAT cell and replaces
     * it). Declared by the chat view entry (declaring is claiming); ChatView
     * dispatches the active mode via `only: <active id>`. Mode bodies render
     * the conversation nodes through the delegated
     * {@link ChatRenderOwnerProps.renderSlot} binding — the node slot stays
     * declared by the chat entry (one declarer per slot), so a mode entry
     * declares no children of its own.
     */
    'conversation.chat.render': {
      kind: 'list'
      scope: 'session'
      owner: ChatRenderOwnerProps
    }
  }
}

/** Owner share of the hero agent-preset chip: the shell supplies nothing. */
export type { HeroAgentPresetOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Header actions derive their state from the standard session/global kit.
 * The fork's Session-header utilities read the optional `panelControls`
 * placement hint; merged into the official owner share so the render site
 * (this package's header) can pass it.
 */
export type { ConversationHeaderActionOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Placement contract for right-aligned Session Header utility entries. */
export interface ConversationHeaderUtilityOwnerProps {
  /** Workbench renders every type button, or one independent Panel menu. */
  panelControls: 'expanded' | 'compact'
}

/**
 * Fork-only members merged into the official header-action owner share:
 * the Session header's utilities renderer passes the placement hint through.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationHeaderActionOwnerProps {
    /** Workbench utilities placement: every type button, or one Panel menu. */
    panelControls?: 'expanded' | 'compact'
  }
}

/**
 * The input-region slot currency: dock/left/right entries read
 * the session snapshot and the live input state as owner props (both
 * are point-in-time snapshots — the dispatching skeleton re-renders on
 * either store's change, so entries stay current without subscribing).
 * The official entry now keys `session` on the Session Controller snapshot
 * (the queue projection included).
 */
export type { InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Fork-only members merged into the official Conversation-view owner share:
 * the cross-view inspect handoff and the render-occurrence id used to
 * isolate scroll memory across simultaneous surfaces.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConvViewOwnerProps {
    /** Render occurrence used to isolate scroll memory across simultaneous surfaces. */
    surfaceId?: string
    /** One-shot inspect request from another view (chat's Inspect button); null when idle. */
    inspect?: { callId: CallId } | null
    /** Acknowledge the inspect request once applied (clears the store field). */
    onInspectDone?: () => void
  }
}

/**
 * Fork-only members merged into the official Chat-node owner share: the
 * review-surface handoff, the session-authorized image loader, and the
 * think display form consumed by the fork's render modes.
 */
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeOwnerProps {
    /**
     * Focus a tool-arg path's change in the review surface when one is
     * composed (relative paths resolve against the session cwd); absent = the
     * mutation link keeps its Host fallback. Other file rows use the
     * Artifact-first `openFile` path.
     */
    revealChange?: ((path: string, turn?: number) => void) | undefined
    /** Resolve a session-authorized historical image for inline display. */
    loadImage: (attachment: ImageAttachmentRef) => Promise<string>
    /** Active think display form: 'compact' hides reasoning blocks downstream
     * (the execflow render modes); absent renders the native collapsed rows. */
    thinkMode?: ThinkMode | undefined
  }
}

/**
 * Fork-only members merged into the official composer-bar owner share: the
 * region contents the fork's ConversationRoot renders as chrome around the
 * bar (the official bar entry stays the declarer).
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ComposerBarOwnerProps {
    /** Floating overlay anchor content (menu / popup shell entries), rendered inside the card. */
    overlay?: ReactNode
    /** input.left slot entries (tool row, beside the resident chrome). */
    leftItems?: ReactNode
    /** input.right slot entries (tool row, before the primary button). */
    rightItems?: ReactNode
    /** composer.dock entries (stats line), rendered under the card inside the bar's width column. */
    footer?: ReactNode
  }
}

/**
 * Optional prose file-mention provider, consumed via `ctx.get('chatFileMentions')`
 * (optional-service convention): the chat view asks it for a closing message's
 * inline-code vocabulary and threads the result into MarkdownText. Absent
 * service — the providing plugin composed out of cordis.yml — turns the
 * surface off; the prose renders inert code.
 */
export type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Optional bridge owned by the Review integration for turn-aware file links. */
export interface TurnChangeNavigation {
  /** Return true when the Review/Artifact Workbench handled the request. */
  open(sessionId: SessionId, turn: number, path: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Turn-aware Review navigation; absent when the Review plugin is not composed. */
    turnChangeNavigation: TurnChangeNavigation
  }
}

/**
 * Owner currency of the chat view's turn-tail hole: the engine-owned Turn and
 * the closing assistant's anchor. Registrants read their own typed Turn data
 * and open files through the same Artifact-first opener the tool rows use.
 */
export type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Additive generated-media currency, retaining the official attachment presenter. */
export interface TurnMediaOwnerProps extends TurnTailOwnerProps {
  renderMessageImages: RenderMessageImages
}

/** Owner currency of the assistant-message action strip (durable message id). */
export type { AssistantActionOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Hook constrained to business data published on the current Chat Node's Turn. */
export type { UseChatNodeTurnData } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Think display form: inline rows in the flow vs hidden (content-anchored runs). */
export type ThinkMode = 'inline' | 'compact'

/** Slot-level Hook factory used by renderers reading their Node's Turn data. */
export type { ChatNodeTurnDataInjected } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Owner share of the embeddable child execution flow. */
export interface ConversationEmbedOwnerProps {
  childSessionId: SessionId
}

/** Owner currency of the strict explicit-session surface. */
export interface ConversationEmbedSurfaceOwnerProps {
  /** Distinguishes scroll memory from the main conversation occurrence. */
  surfaceId: string
}

/** Owner currency of the reusable main Session body outlet. */
export interface ConversationSessionOwnerProps {
  /** Stable render occurrence id (`main` or an Activity surface id). */
  surfaceId: string
  /** Suppress composer/input bridge effects while retaining the exact view tree. */
  transcriptOnly?: boolean
}

/** Stable owner currency delivered to one keyed Chat business renderer. */
export type { ChatNodeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Full props of one registered keyed Chat business renderer. */
export type ChatNodeViewProps<Kind extends ChatNodeKind = ChatNodeKind> =
  PropsRuntime<'conversation.chat.node', Kind> & PropsLocale<'conversation'>

/** Renderer kinds contributed by the currently installed Chat business modules. */
export type { ChatNodeKind } from './chat-nodes.ts'

/**
 * Owner share of the per-command row slot: the frozen {@link CommandNode}
 * slice off the snapshot (cache-stable reference — memo premise). The node
 * carries the whole lifecycle (structured name/args, pairing id, and
 * outcome-or-executing). A successful domain command may also carry the
 * explicitly linked projection node needed to fold two log records into one
 * presentation row.
 */
export type { CommandRowOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Full props of a registered command-row component. */
export type CommandRowProps = PropsRuntime<'conversation.chat.commandview'>

/**
 * Base props of a conversation view entry: the framework standard kit for the
 * session-scope 'conversation.view' slot (useSession narrowed to the
 * conversation snapshot by the runtime merge, sessionId, useSessions).
 * Entries declaring the shared store or an inject face compose their shares
 * on top (the chat entry's {@link ChatViewSlotProps}); store-less pure
 * readers (ui-trajectory) take this base alone.
 */
export type ConvViewProps = PropsRuntime<'conversation.view'>

/** The shared chat store handle type declared by the Session header/body and chat-view registrations. */
export type ChatStore = ReturnType<typeof createChatStore>

/** Business callbacks injected into the conversation slot. */
export interface ConversationInjected {
  /**
   * Connect the selected Workspace and open its reusable/new blank session.
   * When a blank session is already current, carry its draft to the target.
   */
  selectWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /**
   * Framework-bound sources. `composerBlock` is this session's block when a
   * plugin raised one; the reason is the blocker's own localized copy, which
   * the root renders as the inert composer's placeholder.
   */
  hooks: { composerBlock: ObservableSnapshot<ComposerBlock | undefined> }
  /** Publish the root entry's authorized session-body outlet. */
  publishSessionRenderer: (renderer: (owner: ConversationSessionOwnerProps) => ReactNode) => () => void
}

/** Business callbacks injected into the strict Session body seat. */
export interface ConversationSessionInjected {
  /** Views projected from the `conversation.view` slot ledger. */
  views: {
    list: () => readonly ViewTab[]
    subscribe: (fn: () => void) => () => void
    version: () => number
  }
  /** Retain historical image URLs until every rendered surface releases them. */
  retainSessionImages: (sessionId: SessionId) => () => void
  /** Bind the input machine's draft persistence mirror to the session store. */
  bindDraftMirror: (write: (text: string) => void) => () => void
}

/** Business callbacks injected into the strict session header seat. */
export interface ConversationSessionHeaderInjected {
  /** Views projected from the `conversation.view` slot ledger. */
  views: {
    list: () => readonly ViewTab[]
    subscribe: (fn: () => void) => () => void
    version: () => number
  }
  /** Render modes projected from the 'conversation.chat.render' slot ledger
   * (the header's tab-bar picker; same ledger shape as `views`). */
  modes: {
    list: () => readonly ViewTab[]
    subscribe: (fn: () => void) => () => void
    version: () => number
    /** User-level fallback used while the session store holds no override. */
    defaultMode: ObservableSnapshot<ConversationRenderMode>
    /** Bind the mounted session writer used by the global preference's immediate apply path. */
    bindSession: (sessionId: SessionId, write: (mode: string) => void) => () => void
    /** Select one mode for the session and mirror it to the user preference. */
    select: (
      sessionId: SessionId,
      mode: string,
      write: (mode: string) => void,
    ) => void
  }
  /** Select a real Session through the runtime navigation owner. */
  open: (sessionId: SessionId) => void
}

/**
 * Owner share of the composer-bar slot: ConversationRoot's layout-phase
 * inputs plus the input-region child-slot content it renders (the region
 * slots stay declared/rendered by the conversation entry; the bar hosts the
 * results as chrome). The official share is extended with the fork's region
 * members above.
 */
export type ComposerBarOwnerProps =
  import('@deepseek-ai/dsh-client-ui-conversation/client').ComposerBarOwnerProps

/** Injected share of the composer-bar entry (package-internal faces). */
export interface ComposerBarInjected {
  /** The InputBar-exclusive keyboard/DOM command face (private plane); absent with the session. */
  keyboard: ComposerKeyboard | undefined
  /** Create previews and append image ids to the session input. */
  addImages: ((files: readonly File[]) => string | null) | undefined
  /** Release one preview and remove its id from session input. */
  removeImage: ((id: DraftAttachmentId) => void) | undefined
  /** Resolve ordered input ids to browser-owned draft images. */
  draftImages: ((ids: readonly DraftAttachmentId[]) => readonly ComposerAttachment[]) | undefined
  /** Resolve one keyboard submission gesture against the current running state and persisted preference. */
  resolveSubmitMode: (
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ) => InputSubmitMode
  /** Toggle the shared slash menu with only its command source; absent without ui-input-trigger or a session. */
  toggleCommandMenu: ((selection: EditSelection) => void) | undefined
  /** Cancel the in-flight turn; absent with the session. */
  stop: (() => void) | undefined
  /**
   * Submit one slash-command line against this session's agent (the chrome
   * controls' write path — the permission chip submits `/permission <preset>`);
   * absent with the session.
   * Resolves admission: false = rejected/unmatched/transport failure.
   */
  command: ((line: string) => Promise<boolean>) | undefined
  /**
   * Registrant hooks compartment: the renderer binds these to
   * useNotices/useLexicon (static absent sources without a session — hook
   * order stays constant).
   */
  hooks: {
    /** Latest surfaced notice (null after none; seq keys re-render of repeats). */
    notices: ObservableSnapshot<InputNotice | null>
    /** Hot plain-text reference lexicon for the decoration scan (plain-text-reference decision;
     *  see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md). */
    lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>>
    /** Source name opened by the programmatic menu launcher, or null. */
    menuLauncher: ObservableSnapshot<string | null>
  }
}

/**
 * Owner share of the two named composer control seats (plan / model): the
 * bar passes its disable state; the filling entry owns everything else.
 */
export type { InputControlOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Full composer-bar props: standard kit & owner share & control-seat render share & injected share (hooks bound) & locale seat. */
export type ComposerBarProps =
  PropsRuntime<'conversation.composer.bar'>
  & PropsRenderSlots<'conversation.input.attachments' | 'conversation.input.plan' | 'conversation.input.model'>
  & InjectFace<ComposerBarInjected>
  & PropsLocale<'conversation'>

/**
 * Composer chain currency: what ConversationRoot dispatches at its
 * renderSlotChain site. The official share keys the Session lifecycle
 * snapshot and the framework Session-pending-interaction carrier; takeover
 * packages narrow it in their own selectors.
 */
export type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Full conversation-slot component props: runtime & child-render (view ring
 * + composer chain/bar + input-region + hero picker slots) & store & injected
 * shares & the locale seat.
 */
export type ConversationSlotProps =
  PropsRuntime<'conversation'> & PropsRenderSlots<
    | 'deepcreator.conversation.session' | 'conversation.session.header'
    | 'conversation.activity.chip'
    | 'conversation.composer' | 'conversation.composer.bar'
    | 'conversation.input.overlay'
    | 'conversation.input.dock' | 'conversation.composer.dock'
    | 'conversation.input.left' | 'conversation.input.right'
    | 'conversation.hero.workspace'
    | 'conversation.hero.agentPreset'
  >
  & InjectFace<ConversationInjected>
  & PropsLocale<'conversation'>

/** Full strict-session body props: per-session store, view ring, and draft mirror. */
export type ConversationSessionSlotProps =
  PropsRuntime<'deepcreator.conversation.session'>
  & PropsRenderSlots<'conversation.view'>
  & PropsStore<ChatStore>
  & ConversationSessionInjected

/** Full strict-session header props: shared store, tabs/actions render shares, navigation, and locale. */
export type ConversationSessionHeaderSlotProps =
  PropsRuntime<'conversation.session.header'>
  & PropsRenderSlots<'conversation.session.header.actions' | 'conversation.session.header.utilities'>
  & PropsStore<ChatStore>
  & ConversationSessionHeaderInjected
  & PropsLocale<'conversation'>

/** The pending approval carrier the owner dispatches into the composer chain. */
export type ApprovalWait = PendingWait<'approval'>

/**
 * Approval domain face over the carrier (the ui-user-questions PendingQuestion
 * pattern): render identity and question material forwarded transparently;
 * answer owns the wire encoding — the ApprovalResponsePayload value shape
 * with the audit correlation the host reconciles — and turns a rejected
 * carrier receipt into a thrown error. Minted per carrier via useMemo.
 */
export class PendingApproval {
  /**
   * @param wait - the runtime carrier for one pending approval question.
   */
  constructor(private readonly wait: ApprovalWait) {}

  /** Opaque render identity (React key / one-shot latch remount axis), forwarded from the carrier. */
  get key(): string {
    return this.wait.key
  }

  /** The tool the question is about (headline fallback), forwarded from the carrier payload. */
  get toolName(): string {
    return this.wait.payload.toolName
  }

  /** The asker's human-readable WHY (headline when present), forwarded from the carrier payload. */
  get reason(): string | undefined {
    return this.wait.payload.reason
  }

  /** The paired tool call's id when the ask names one (command-line lookup key), forwarded from the carrier payload. */
  get callId(): string | undefined {
    return this.wait.payload.callId
  }

  /**
   * Deliver the user's decision; a rejected carrier receipt throws. Panel
   * removal stays frame-driven: the broadcast `approval/resolved` settles the
   * wait and drops it from the pending list.
   * @param outcome - the only two client-answerable outcomes.
   */
  async answer(outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const receipt = await this.wait.respond({
      ok: true,
      value: { sessionId: this.wait.sessionId, approvalId: this.wait.payload.approvalId, outcome },
    })
    if (!receipt.accepted) {
      throw new Error(`approval response rejected: ${receipt.reason}`)
    }
  }
}

/**
 * Full approval-composer props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the approval carrier — plus the
 * standard locale seat. No injected share: the carrier plus the domain face
 * above carry the whole behavior surface; the paired command line derives
 * from useSession in-component.
 */
export type ApprovalComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: ApprovalWait } & PropsLocale<'conversation'>

/** In-memory reader position resilient to transcript width reflow. */
export interface ChatScrollPosition {
  /** Stable rendered node/call identity nearest the visible reading edge. */
  readonly anchorKey: string
  /** Anchor top relative to the transcript scrollport when saved. */
  readonly anchorTop: number
  /** Approximate offset used before the semantic anchor is measured. */
  readonly scrollTop: number
}

/** The chat entry's node render binding, as delegated to render-mode bodies. */
export type ChatNodeRenderSlot = PropsRenderSlots<'conversation.chat.node'>['renderSlot']

/**
 * Owner share of the chat view's render-mode ring: the chat entry delegates
 * its node render seat and business verbs to every mode body. Modes are
 * self-sufficient renderers of the same session snapshot — the framework
 * standard kit (sessionId, useSession) arrives automatically, and everything
 * else comes from this share.
 */
export interface ChatRenderOwnerProps {
  /** Occurrence identity; isolates scroll memory between main and Activity surfaces. */
  surfaceId?: string
  /** The chat entry's node render binding, delegated for the mode body's rows. */
  renderSlot: ChatNodeRenderSlot
  /**
   * Activate a filesystem path as an Artifact tab when that Workbench type is
   * composed, otherwise use the Host opener; relative paths resolve via cwd.
   */
  openFile: (path: string) => void
  /**
   * Focus a tool-arg path's change in the review surface when one is
   * composed (relative paths resolve against the session cwd); absent = the
   * mutation link keeps its Host fallback.
   */
  revealChange?: ((path: string, turn?: number) => void) | undefined
  loadOlder: () => void
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Render historical images through the attachment slot implementation. */
  renderMessageImages: RenderMessageImages
  /** Hand a call off to the trajectory view: write the one-shot inspect target and switch tabs. */
  inspectCall: (callId: CallId) => void
  /**
   * Per-session scroll memory surviving view and mode switches (in-memory,
   * never persisted): the mode body saves on every scroll and restores on
   * remount; a fresh page load starts empty.
   */
  chatScroll: {
    /** Record a semantic reader position; null clears it when pinned. */
    save: (position: ChatScrollPosition | null) => void
    /** Last reader position, or null when pinned or never recorded. */
    read: () => ChatScrollPosition | null
  }
  /** Fork through the completed turn ending at the eligible message `seq`, then open the child. */
  forkAt: (seq: number) => void
  /**
   * Prose file-mention vocabulary for one closing message, from the optional
   * {@link ChatFileMentions} service. Undefined when the service is absent
   * or the turn produced nothing worth linking.
   */
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
  /** Select one render mode for this session and mirror it to the user preference. */
  selectRenderMode: (
    sessionId: SessionId,
    mode: string,
    write: (mode: string) => void,
  ) => void
  /** Retire local echoes whose authoritative Chat rows committed in this surface. */
  acknowledgeOutgoing: (ids: readonly number[]) => void
}

/** Full props of one registered chat render-mode body: standard kit, owner verbs, shared store, and locale. */
export type ChatRenderSlotProps =
  PropsRuntime<'conversation.chat.render'> & PropsStore<ChatStore> & PropsLocale<'conversation'>

/**
 * Injected share of the chat view entry: the two callbacks whose targets live
 * outside the view (layout orchestration; the session object layer).
 */
export interface ChatViewInjected {
  /**
   * Activate a filesystem path as an Artifact tab when that Workbench type is
   * composed, otherwise use the Host opener; relative paths resolve via cwd.
   */
  openFile: (path: string) => void
  /**
   * Focus a tool-arg path's change in the review surface when one is
   * composed (relative paths resolve against the session cwd); absent = the
   * mutation link keeps its Host fallback.
   */
  revealChange?: ((path: string, turn?: number) => void) | undefined
  loadOlder: () => void
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Hand a call off to the trajectory view: write the one-shot inspect target and switch tabs. */
  inspectCall: (callId: CallId) => void
  /** Occurrence-addressed scroll memory; simultaneous surfaces never fight. */
  chatScrollFor: (surfaceId: string) => {
    save: (position: ChatScrollPosition | null) => void
    read: () => ChatScrollPosition | null
  }
  /**
   * Render modes projected from the 'conversation.chat.render' slot ledger
   * (same ledger shape as `views`): the selector reads entries, subscribe
   * reacts to registrations, version pairs uSES.
   */
  modes: {
    list: () => readonly ViewTab[]
    subscribe: (fn: () => void) => () => void
    version: () => number
    /** User-level fallback used while the session store holds no override. */
    defaultMode: ObservableSnapshot<ConversationRenderMode>
    /** Bind the mounted session writer used by the global preference's immediate apply path. */
    bindSession: (sessionId: SessionId, write: (mode: string) => void) => () => void
    /** Select one mode for the session and mirror it to the user preference. */
    select: (
      sessionId: SessionId,
      mode: string,
      write: (mode: string) => void,
    ) => void
  }
  /** Fork through the completed turn ending at the eligible message `seq`, then open the child. */
  forkAt: (seq: number) => void
  /**
   * Prose file-mention vocabulary for one closing message, from the optional
   * {@link ChatFileMentions} service (resolved lazily per call, so composing
   * the provider in or out takes effect live). Undefined when the service is
   * absent or the turn produced nothing worth linking.
   */
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
  /** Retire local echoes after the delegated render surface confirms handoff. */
  acknowledgeOutgoing: (ids: readonly number[]) => void
}

/** Full chat-view component props: runtime & its render-mode/Tool render shares & store & injected & locale seat. */
export type ChatViewSlotProps =
  PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'conversation.chat.node' | 'conversation.chat.render' | 'conversation.message.images'>
  & PropsStore<ChatStore> & ChatViewInjected & PropsLocale<'conversation'>

/** View-slot owner share (official share plus the fork's inspect handoff above). */
export type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Owner share common to the hero / New-Session Workspace pickers. */
export type EmptyWorkspaceOwnerProps =
  import('@deepseek-ai/dsh-client-ui-conversation/client').EmptyWorkspaceOwnerProps
