/** Tool UI slot declarations and their composed component props. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed atomic Tool call view, dispatched by the wire Tool name. Register
     * with `key: '<tool name>'` to own how one tool's calls render inside a
     * turn — the key domain is open (any wire tool name, including a tool your
     * own package registered), so there is no compile-time key set to pick
     * from and a typo simply never renders.
     *
     * A key the shipped composition already covers is replaced, not shared;
     * an unclaimed key falls back to the generic tool row, so registering is
     * additive for your own tool and a takeover for a shipped one. The owner
     * passes the call's identity, its frozen running-or-settled node, and the
     * expansion state (see ToolCallOwnerProps), so the view stays a pure
     * function of what the turn already knows.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
    /**
     * Mirror of the toolview seat for the Activity embed's child flow: the
     * same keyed rows, double-registered by each toolview registrant. The
     * session-scope prop shape matches the original seat because the rows are
     * the SAME components; no row reads the session kit (owner share +
     * `useSessions` only), so the CURRENT-session values the framework
     * supplies here are inert.
     */
    'deepcreator.conversation.embed.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
  }
}

/** Standard owner currency supplied to every atomic Tool view. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Open a Tool argument path through the Host. */
  openFile: (path: string) => void
  /**
   * Focus this file's change in the review surface when available (the
   * file-mutation rows prefer it over `openFile`); absent = the path link
   * keeps the host open behavior.
   */
  revealChange?: ((path: string) => void) | undefined
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
  /**
   * ExecFlow row chrome: the expanded content aligns with the title column
   * (22px) and carries the icon-axis rail; absent renders the native
   * icon-aligned chrome. Set by the execflow render modes through the node
   * owner's think form.
   */
  execflow?: boolean | undefined
}

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/**
 * The two toolview dispatch seats: the conversation chat flow's original and
 * the Activity embed's mirror (this package declares both specs; the embed
 * registration injects its own seat key).
 */
export const TOOLVIEW_SEATS = ['tool.call.toolview', 'deepcreator.conversation.embed.toolview'] as const
export type ToolviewSeat = typeof TOOLVIEW_SEATS[number]

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node' | 'deepcreator.conversation.embed.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview'>
  & PropsLocale<'conversation'>
  & { toolviewSeat?: ToolviewSeat | undefined }

/** The embed-mirror registration's props: same share over the embed seats. */
export type EmbedToolTreeProps = PropsRuntime<'deepcreator.conversation.embed.node', 'tool-call'>
  & PropsRenderSlots<'deepcreator.conversation.embed.toolview'>
  & PropsLocale<'conversation'>

