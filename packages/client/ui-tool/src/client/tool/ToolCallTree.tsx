/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, revealChange, selected, cwd, inspectCall, thinkMode, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'revealChange' | 'cwd' | 'inspectCall' | 'thinkMode' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    revealChange,
    cwd,
    inspect: () => { inspectCall(callId) },
    // The execflow render modes pass a think form to every node owner; its
    // presence selects the execflow row chrome (rail + title-column align).
    execflow: thinkMode !== undefined,
  }), [callId, toolName, block, openFile, revealChange, cwd, inspectCall, thinkMode])
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
      data-execflow={thinkMode !== undefined || undefined}
    >
      {renderSlot('tool.call.toolview', owner, {
        entryKey: toolName,
        fallback: <GenericToolCard {...owner} t={t} />,
      })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, openFile, revealChange, inspectCall, thinkMode, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'revealChange' | 'inspectCall' | 'thinkMode' | 't'> & {
  block: ToolCallBlock
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      revealChange={revealChange}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      inspectCall={inspectCall}
      thinkMode={thinkMode}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={openFile}
              revealChange={revealChange}
              inspectCall={inspectCall}
              thinkMode={thinkMode}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, revealChange, inspectCall, thinkMode, t,
}: ToolTreeProps) {
  const block = node.data.root
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={block}
      selectedCallId={selectedCallId}
      cwd={cwd}
      openFile={openFile}
      revealChange={revealChange}
      inspectCall={inspectCall}
      thinkMode={thinkMode}
      t={t}
    />
  )
}
