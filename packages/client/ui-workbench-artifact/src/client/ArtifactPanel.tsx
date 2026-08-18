import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the `artifacts` remote namespace merge (TypertRemoteNamespaceMap)
// into this program so TypertClientRemote['artifacts'] resolves.
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import { IconRefreshOutline14, WorkbenchPanelIconButton } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { EMPTY_ARTIFACTS_SNAPSHOT } from './artifact-contract.ts'
import { artifactTabLabels, basename, formatAge } from './artifact-view-model.ts'
import css from './ArtifactPanel.module.css'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-artifact'> & { artifacts: TypertClientRemote['artifacts'] }

function Empty({ title, body }: { title: string; body: string }) {
  return <div className={css.empty}><strong>{title}</strong><span>{body}</span></div>
}

/**
 * Workbench Artifact panel. The list is the official produced-files fact
 * projected from session events (`views.get('artifacts')`) — no pull, no
 * plugin-owned copy. Only instance content goes through the mounted
 * `artifacts` remote namespace, keyed by path.
 */
export function ArtifactPanel({ artifacts, sessionId, route, activeInstanceId, openInstance, useSession, contributeHeaderActions, contributePanelInfo, renderArtifact, t }: Props) {
  const snapshot = useSession(selector => selector.views.get('artifacts') ?? EMPTY_ARTIFACTS_SNAPSHOT)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [now] = useState(() => Date.now())
  const active = snapshot.records.find(item => item.path === activeInstanceId)

  const readContent = useCallback(() => {
    setContent(null)
    if (activeInstanceId === undefined) return
    let live = true
    void artifacts.read(sessionId, activeInstanceId).then((wire) => {
      if (!live) return
      if (!wire.ok) throw new Error(wire.error.message)
      if (!wire.value.ok) throw new Error(wire.value.message)
      setContent(wire.value.content)
      setError(null)
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [artifacts, activeInstanceId, sessionId])
  useEffect(() => readContent(), [readContent, refreshTick])

  const panelInfo = useMemo(() => ({ tabLabels: artifactTabLabels(snapshot.records) }), [snapshot.records])
  useEffect(() => contributePanelInfo(panelInfo), [contributePanelInfo, panelInfo])
  const headerActions = useMemo(() => ({
    right: <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { setRefreshTick(tick => tick + 1) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>,
  }), [t])
  useEffect(() => contributeHeaderActions(headerActions), [contributeHeaderActions, headerActions])

  if (route === 'instance' && activeInstanceId !== undefined) {
    return (
      <div className={css.panel}>
        {error !== null && <div className={css.error}>{error}</div>}
        {active !== undefined && content !== null
          ? <div className={css.content}>{renderArtifact({ artifactId: active.path, content })}</div>
          : error === null && <Empty title={active === undefined ? activeInstanceId : basename(active.path)} body={t('loading')} />}
      </div>
    )
  }
  return (
    <div className={css.panel}>
      {snapshot.records.length === 0
        ? <Empty title={t('empty.title')} body={t('empty.body')} />
        : <div className={css.list}>{snapshot.records.map(artifact => (
          <button type="button" key={artifact.path} onClick={() => { openInstance(artifact.path) }}>
            <span className={css.copy}>
              <strong>{basename(artifact.path)}</strong>
              <span className={css.meta}>{artifact.path}</span>
            </span>
            <time>{formatAge(artifact.updatedAt, now)}</time>
          </button>
        ))}</div>}
    </div>
  )
}
