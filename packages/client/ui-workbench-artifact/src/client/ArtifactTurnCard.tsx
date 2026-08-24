import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@ryanyujazz/dsh-client-ui-conversation/client'
import {
  ConversationFileCard, ConversationFileCardAction, ConversationFileCardFile,
  ConversationFileCardList, DeepCreatorIconArtifact16, IconWarningOutline16, Toast,
} from '@ryanyujazz/dsh-client-ui-primitives'
import { Fragment, useState, type HTMLAttributes } from 'react'
import { isHtmlArtifactPath } from './artifact-view-model.ts'
import { HtmlArtifactOpenControl } from './HtmlArtifactOpenControl.tsx'

type Props = PropsRuntime<'conversation.chat.turnTail'>
  & TurnTailOwnerProps
  & PropsLocale<'workbench-artifact'>
  & {
    matched: readonly string[]
    openArtifacts: () => void
    openInDeepCreator?: ((path: string) => Promise<void>) | undefined
    openInSystemBrowser?: ((path: string) => Promise<void>) | undefined
  }

/** Official per-Turn produced-files fact in DeepCreator's shared file-card chrome. */
export function ArtifactTurnCard({ turn, matched: paths, openFile, openArtifacts, openInDeepCreator, openInSystemBrowser, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  return (
    <Fragment>
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
            <ConversationFileCardFile
              key={path}
              path={path}
              onClick={() => { openFile(path) }}
              actions={isHtmlArtifactPath(path) && openInDeepCreator !== undefined && openInSystemBrowser !== undefined ? (
                <HtmlArtifactOpenControl
                  path={path}
                  openInDeepCreator={() => openInDeepCreator(path)}
                  openInSystemBrowser={() => openInSystemBrowser(path)}
                  onError={setActionError}
                  t={t}
                />
              ) : undefined}
            />
          ))}
        </ConversationFileCardList>
      </ConversationFileCard>
      {actionError !== null && (
        <Toast text={actionError} icon={<IconWarningOutline16 size={16} />} onDone={() => { setActionError(null) }} />
      )}
    </Fragment>
  )
}
