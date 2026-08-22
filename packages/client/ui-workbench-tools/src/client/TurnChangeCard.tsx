import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@ryanyujazz/dsh-client-ui-conversation/client'
import {
  Button, ConversationFileCard, ConversationFileCardAction, ConversationFileCardFile,
  ConversationFileCardList, DeepCreatorIconReview16, IconWarningOutline16, Modal, Toast,
} from '@ryanyujazz/dsh-client-ui-primitives'
import { useCallback, useState, useSyncExternalStore, type HTMLAttributes } from 'react'
import type { WorkbenchService } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { ReviewCacheController } from './review-cache.ts'
import type { ToolsKey } from './locales.ts'
import css from './TurnChangeCard.module.css'

type Props = PropsRuntime<'deepcreator.conversation.chat.turnChanges'>
  & TurnTailOwnerProps
  & PropsLocale<'workbench-tools'>
  & { controller: ReviewCacheController; workbench: WorkbenchService }

export function TurnChangeCard({ turn, controller, workbench, openFile, t }: Props) {
  const history = useSyncExternalStore(controller.subscribeHistory, controller.getHistorySnapshot, controller.getHistorySnapshot)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const record = history?.turns.find(item => item.turn === turn.turn)
  const openReview = useCallback((path?: string) => {
    if (record === undefined || record.remainingFiles === 0) return
    workbench.present({
      typeId: 'review',
      ...(path === undefined ? {} : { target: path }),
      parameters: { scope: 'turn', turn: String(record.turn), expand: 'all' },
      reveal: true,
      reason: 'user',
    })
  }, [record, workbench])
  const undo = useCallback(async () => {
    if (record === undefined) return
    setUndoing(true)
    try {
      const result = await controller.undoTurn(record.turn)
      if (!result.ok) {
        setToast(result.message)
        return
      }
      setConfirming(false)
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUndoing(false)
    }
  }, [controller, record])

  // The provider mounts for every closed turn because history arrives
  // asynchronously. A zero-change turn has no host record and renders no tail.
  if (record === undefined) return null
  const active = record.remainingFiles > 0
  const stateKey = `turnCard.state.${record.state}` as ToolsKey
  const additions = record.additions ?? record.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = record.deletions ?? record.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  const showTotals = record.additions !== undefined && record.deletions !== undefined && (additions > 0 || deletions > 0)
  return (
    <>
      <ConversationFileCard
          active={active}
          expanded={expanded}
          onToggle={() => { setExpanded(value => !value) }}
          icon={<DeepCreatorIconReview16 size={16} />}
          label={t('turnCard.files', { count: record.totalFiles })}
          sectionProps={{ 'data-turn-change-card': record.turn } as HTMLAttributes<HTMLElement>}
          meta={(
            <>
            {showTotals && <span className={css.diffCounts}><b>{`+${additions}`}</b><i>{`-${deletions}`}</i></span>}
            {record.remainingFiles < record.totalFiles && record.remainingFiles > 0 && (
              <span className={css.remaining}>{t('turnCard.remaining', { count: record.remainingFiles })}</span>
            )}
            {!active && <span className={css.remaining}>{t(stateKey)}</span>}
            </>
          )}
          actions={(
            <>
            <ConversationFileCardAction
              disabled={!record.undoable || undoing}
              title={record.undoable ? t('turnCard.undo') : record.undoDisabledReason === 'cross-repository'
                ? t('turnCard.undoCrossRepository') : t('turnCard.undoUnavailable')}
              onClick={() => { setConfirming(true) }}
            >
              {t('turnCard.undo')}
            </ConversationFileCardAction>
            <ConversationFileCardAction disabled={!active} onClick={() => { openReview() }}>
              {t('turnCard.review')}
            </ConversationFileCardAction>
            </>
          )}
        >
          <ConversationFileCardList>
            {record.files.map(file => (
              <ConversationFileCardFile
                key={`${file.oldPath ?? ''}\0${file.path}`}
                path={file.path}
                onClick={() => {
                  if (file.state === 'pending') openReview(file.path)
                  else openFile(file.path)
                }}
                trailing={(file.lineStatsState === 'available' || file.lineStatsState === undefined)
                  && file.additions !== undefined && file.deletions !== undefined && (file.additions > 0 || file.deletions > 0) && (
                    <span className={css.diffCounts}><b>{`+${file.additions}`}</b><i>{`-${file.deletions}`}</i></span>
                )}
              />
            ))}
          </ConversationFileCardList>
      </ConversationFileCard>
      <Modal
        open={confirming}
        onClose={() => { if (!undoing) setConfirming(false) }}
        title={t('turnCard.undoTitle')}
        description={t('turnCard.undoDescription', { count: record.remainingFiles })}
        closeLabel={t('turnCard.cancel')}
        footer={(
          <>
            <Button size="sm" variant="ghost" disabled={undoing} onClick={() => { setConfirming(false) }}>{t('turnCard.cancel')}</Button>
            <Button size="sm" variant="primary" disabled={undoing} onClick={() => { void undo() }}>
              {undoing ? t('turnCard.undoing') : t('turnCard.confirmUndo')}
            </Button>
          </>
        )}
      />
      {toast !== null && (
        <Toast text={toast} icon={<IconWarningOutline16 size={16} />} onDone={() => { setToast(null) }} />
      )}
    </>
  )
}
