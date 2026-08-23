/** Tool UI slot declarations and their composed component props. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import type { RenderMessageImages } from '@ryanyujazz/dsh-client-ui-conversation/client'
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
  /** Render durable result images through the conversation's attachment owner. */
  renderMessageImages: RenderMessageImages
}

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/**
 * Toolview dispatch seats owned by this package.
 */
export const TOOLVIEW_SEATS = ['tool.call.toolview'] as const
export type ToolviewSeat = typeof TOOLVIEW_SEATS[number]

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview'>
  & PropsLocale<'conversation'>
