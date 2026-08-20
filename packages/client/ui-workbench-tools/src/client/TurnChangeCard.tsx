import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@ryanyujazz/dsh-client-ui-conversation/client'
import {
  Button, DeepCreatorIconReview16, IconWarningOutline16, Modal, Toast,
} from '@ryanyujazz/dsh-client-ui-primitives'
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { WorkbenchService } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { ReviewCacheController } from './review-cache.ts'
import type { ToolsKey } from './locales.ts'
import css from './TurnChangeCard.module.css'

type Props = PropsRuntime<'conversation.chat.turnTail'>
  & TurnTailOwnerProps
  & PropsLocale<'workbench-tools'>
  & { controller: ReviewCacheController; workbench: WorkbenchService }

export function TurnChangeCard({ turn, controller, workbench, t }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [confirming, setConfirming] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const record = snapshot.history?.turns.find(item => item.turn === turn.turn)
  const openReview = useCallback(() => {
    if (record === undefined || record.remainingFiles === 0) return
    const path = record.files.find(file => file.state === 'pending')?.path
    workbench.present({
      typeId: 'review',
      ...(path === undefined ? {} : { target: path }),
      parameters: { turn: String(record.turn) },
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
  return (
    <>
      <section className={css.card} data-active={active || undefined} data-turn-change-card={record.turn}>
        <button type="button" className={css.summary} disabled={!active} onClick={openReview}>
          <DeepCreatorIconReview16 size={16} />
          <span className={css.label}>{t('turnCard.files', { count: record.totalFiles })}</span>
          {record.remainingFiles < record.totalFiles && record.remainingFiles > 0 && (
            <span className={css.remaining}>{t('turnCard.remaining', { count: record.remainingFiles })}</span>
          )}
          {!active && <span className={css.remaining}>{t(stateKey)}</span>}
        </button>
        <div className={css.actions}>
          <button
            type="button"
            className={css.action}
            disabled={!record.undoable || undoing}
            title={record.undoable ? t('turnCard.undo') : t('turnCard.undoUnavailable')}
            onClick={() => { setConfirming(true) }}
          >
            {t('turnCard.undo')}
          </button>
          <button type="button" className={css.action} disabled={!active} onClick={openReview}>
            {t('turnCard.review')}
          </button>
        </div>
      </section>
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
