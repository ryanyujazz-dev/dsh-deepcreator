/**
 * DraftingToolRow: the pre-call phase of one long-drafting tool, rendered
 * inside the streaming assistant partial at the tool-call block's position.
 * The model is still composing the tool's arguments (block-start → the
 * eventual durable tool/call event), so this row carries the live-text
 * treatment (content color + the running sweep) and hands its visual slot to
 * the real tool-call row when the call lands at the same flow position.
 *
 * The leading icon matches the settled row the tool later renders (write/edit
 * take the edit glyph the file-mutation row uses, run_code the code glyph,
 * todo_write the checklist glyph), so the drafting → running swap changes the
 * text only. exit_plan_mode has no dedicated settled row (it renders the
 * generic sparkle), so its drafting glyph is the list-pen: the plan authoring
 * act, not the generic tool fallback.
 *
 * Short-drafting tools (read/bash/search families) deliberately have no
 * entry: their drafting window is token-level and a row would only flicker.
 */

import type { ReactNode } from 'react'
import {
  FileIcon, IconChecklistOutline14, IconCodeOutline16, IconEditOutline16, IconListPenOutline16,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './DraftingToolRow.module.css'

type ConversationKey = Parameters<ChatViewSlotProps['t']>[0]

/** One drafting mapping: locale key + the settled row's glyph. */
export interface DraftingEntry {
  readonly key: ConversationKey
  readonly icon: ReactNode
}

/** Wire name → drafting presentation (locale key + the settled glyph). */
const DRAFTING: Record<string, DraftingEntry> = {
  edit: { key: 'execflow.draft.editing', icon: <IconEditOutline16 size={14} /> },
  write: { key: 'execflow.draft.creating', icon: <IconEditOutline16 size={14} /> },
  exit_plan_mode: { key: 'execflow.draft.planning', icon: <IconListPenOutline16 size={14} /> },
  run_code: { key: 'execflow.draft.coding', icon: <IconCodeOutline16 size={14} /> },
  todo_write: { key: 'execflow.draft.todos', icon: <IconChecklistOutline14 /> },
}

/**
 * Resolve one tool's drafting presentation.
 * @param name - wire tool name from the streaming tool-call block.
 * @returns the entry to show while arguments are being drafted, or undefined
 * for short-drafting tools that render no row.
 */
export function draftingEntry(name: string): DraftingEntry | undefined {
  return DRAFTING[name]
}

/** One drafting row: icon + verb (+ best-effort target path), ToolRow geometry. */
export function DraftingToolRow({ label, icon, target }: {
  /** Stable drafting verb phrase (no mid-draft evolution by design). */
  label: string
  /** Leading glyph matching the settled row's icon. */
  icon: ReactNode
  /** Best-effort target path (file tools), streamed in with the args. */
  target?: string | null
}): React.JSX.Element {
  return (
    <div className={css.row}>
      <span className={css.leading} aria-hidden>{icon}</span>
      <span className={css.label}>{label}</span>
      {target !== undefined && target !== null && target !== '' && (
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.target}><FileIcon path={target} /><span>{target}</span></span>
        </>
      )}
    </div>
  )
}
