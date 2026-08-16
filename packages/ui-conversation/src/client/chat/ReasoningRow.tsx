/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ExecDisclosureRow } from './ExecDisclosureRow.tsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.defaultExpanded - initial open state (Think form opens rows).
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, defaultExpanded = false, t }: {
  text: string
  running: boolean
  defaultExpanded?: boolean
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [full, setFull] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  // Clamped body bookkeeping: detect overflow past the 15-line window and
  // which edges still hide content, and, while streaming, keep the window
  // pinned to the newest text. The same probe runs on reader scrolls, so the
  // edge masks track the window instead of the content.
  const probeWindow = (): void => {
    const element = bodyRef.current
    if (element === null) return
    setOverflowing(element.scrollHeight > element.clientHeight + 1)
    setCanScrollUp(element.scrollTop > 1)
    setCanScrollDown(element.scrollTop + element.clientHeight < element.scrollHeight - 1)
  }
  useLayoutEffect(() => {
    if (bodyRef.current === null || full) return
    if (running) {
      const element = bodyRef.current
      element.scrollTop = element.scrollHeight
    }
    probeWindow()
  }, [text, running, full, expanded])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <ExecDisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody} data-clamped={!full || undefined}>
          <div className={css.rail} aria-hidden />
          <div className={css.thinkScroll} ref={bodyRef} onScroll={probeWindow}>{text}</div>
          {!full && overflowing && canScrollUp && <div className={css.maskTop} aria-hidden />}
          {!full && overflowing && canScrollDown && <div className={css.maskBottom} aria-hidden />}
          {overflowing && (
            <button
              type="button"
              className={css.thinkMore}
              onClick={() => { setFull(value => !value) }}
            >
              {full ? t('execflow.think.less') : t('execflow.think.more')}
            </button>
          )}
        </div>
      </ExecDisclosureRow>
    </div>
  )
}
