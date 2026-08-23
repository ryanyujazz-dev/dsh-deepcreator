import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@ryanyujazz/dsh-client-ui-tool/client'
import { DeepCreatorIconInspectOutline12, DeepCreatorIconSparkle16, DisclosureRow, Tooltip } from '@ryanyujazz/dsh-client-ui-primitives'
import css from './ImageToolRow.module.css'

type Props = ToolCallViewProps & PropsLocale<'conversation'>

function argsRaw(block: Props['block']): string { return 'kind' in block ? block.call?.argsRaw ?? '' : block.argsRaw }

function promptSummary(block: Props['block']): string {
  try {
    const value = JSON.parse(argsRaw(block)) as { prompt?: unknown; output_path?: unknown }
    if ('kind' in block && !block.isError && typeof value.output_path === 'string') return value.output_path
    if (typeof value.prompt === 'string') return value.prompt
  } catch { /* a streaming call can contain incomplete JSON */ }
  return ''
}

function errorText(block: Props['block']): string | null {
  if (!('kind' in block) || !block.isError) return null
  const text = block.content.filter(content => content.type === 'text').map(content => content.text).join('\n')
  return text || (block.error === undefined ? 'Image generation failed.' : `${block.error.name}: ${block.error.code}`)
}

export function ImageToolRow({ toolName, block, inspect, execflow, renderMessageImages, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  const running = !('kind' in block)
  const failed = 'kind' in block && block.isError
  const images = 'kind' in block ? block.content.flatMap(content => content.type === 'image' ? [{ attachment: content.attachment }] : []) : []
  const diagnostic = errorText(block)
  const expandable = images.length > 0 || diagnostic !== null
  const open = expanded && expandable
  return (
    <div className={css.root} data-tool={toolName} data-state={running ? 'running' : failed ? 'error' : 'ok'} data-execflow={execflow || undefined}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<DeepCreatorIconSparkle16 size={14} />}
        title={running ? 'Creating image' : failed ? 'Create image failed' : 'Created image'}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={<><span className={css.sep} aria-hidden /><span className={css.summary}>{promptSummary(block)}</span></>}
      >
        <div className={css.bodyWrap} data-image-tool-body-wrap>
          <div className={css.body}>
            {images.length > 0 ? renderMessageImages({ images, align: 'start' }) : diagnostic !== null ? <pre>{diagnostic}</pre> : null}
            {inspect !== undefined && <Tooltip label={t('execflow.inspect')} side="bottom"><button type="button" className={css.inspect} aria-label={t('execflow.inspect')} onClick={inspect}><DeepCreatorIconInspectOutline12 /></button></Tooltip>}
          </div>
        </div>
      </DisclosureRow>
    </div>
  )
}
