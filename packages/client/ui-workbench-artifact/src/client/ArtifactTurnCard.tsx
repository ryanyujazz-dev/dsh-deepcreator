import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@ryanyujazz/dsh-client-ui-conversation/client'
import {
  ConversationFileCard, ConversationFileCardAction, ConversationFileCardFile,
  ConversationFileCardList, DeepCreatorIconArtifact16,
} from '@ryanyujazz/dsh-client-ui-primitives'
import { useState, type HTMLAttributes } from 'react'

type Props = PropsRuntime<'conversation.chat.turnTail'>
  & TurnTailOwnerProps
  & PropsLocale<'workbench-artifact'>
  & { matched: readonly string[]; openArtifacts: () => void }

/** Official per-Turn produced-files fact in DeepCreator's shared file-card chrome. */
export function ArtifactTurnCard({ turn, matched: paths, openFile, openArtifacts, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ConversationFileCard
      expanded={expanded}
      onToggle={() => { setExpanded(value => !value) }}
      icon={<DeepCreatorIconArtifact16 size={16} />}
      label={t('turnCard.files', { count: paths.length })}
      sectionProps={{ 'data-turn-artifact-card': turn.turn } as HTMLAttributes<HTMLElement>}
      actions={(
        <ConversationFileCardAction onClick={openArtifacts}>
          {t('turnCard.view')}
        </ConversationFileCardAction>
      )}
    >
      <ConversationFileCardList>
        {paths.map(path => (
          <ConversationFileCardFile key={path} path={path} onClick={() => { openFile(path) }} />
        ))}
      </ConversationFileCardList>
    </ConversationFileCard>
  )
}
