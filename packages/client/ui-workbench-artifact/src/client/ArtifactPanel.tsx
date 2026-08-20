import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the `artifacts` remote namespace merge (TypertRemoteNamespaceMap)
// into this program so TypertClientRemote['artifacts'] resolves.
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import {
  FileIcon, FileLabel, IconChevronRightOutline14, IconFolderOpen16, IconRefreshOutline14, WorkbenchPanelIconButton,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { EMPTY_ARTIFACTS_SNAPSHOT } from './artifact-contract.ts'
import {
  artifactPathSegments, artifactTabFilePaths, artifactTabLabels, basename, formatAge,
} from './artifact-view-model.ts'
import css from './ArtifactPanel.module.css'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-artifact'> & {
  artifacts: TypertClientRemote['artifacts']
  openContainingFolder(path: string): void
}

function Empty({ title, body, filePath }: { title: string; body: string; filePath?: string | undefined }) {
  return <div className={css.empty}><strong>{filePath === undefined ? title : <FileLabel path={filePath} label={title} iconSize={16} />}</strong><span>{body}</span></div>
}

function ArtifactPath({ path, openContainingFolder, openFolderLabel }: {
  path: string
  openContainingFolder(path: string): void
  openFolderLabel: string
}) {
  const segments = artifactPathSegments(path)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)
  const [truncated, setTruncated] = useState(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const trail = trailRef.current
    if (viewport === null || trail === null) return
    const measure = () => { setTruncated(trail.scrollWidth > viewport.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(trail)
    return () => { observer.disconnect() }
  }, [path])

  return (
    <div className={css.pathBar} data-artifact-path={path} aria-label={path} title={path}>
      <div ref={viewportRef} className={css.pathViewport} data-truncated={truncated || undefined}>
        <div ref={trailRef} className={css.pathTrail} aria-hidden="true">
          {segments.map((segment, index) => (
            <span className={css.pathCrumb} data-artifact-path-segment key={`${index}:${segment}`}>
              {index > 0 && <IconChevronRightOutline14 size={12} className={css.pathSeparator} />}
              {index === segments.length - 1 && <FileIcon path={path} size={14} />}
              <span className={index === segments.length - 1 ? css.pathFile : undefined}>{segment}</span>
            </span>
          ))}
        </div>
      </div>
      <WorkbenchPanelIconButton
        className={css.pathAction}
        label={openFolderLabel}
        onClick={() => { openContainingFolder(path) }}
      >
        <IconFolderOpen16 />
      </WorkbenchPanelIconButton>
    </div>
  )
}

/**
 * Workbench Artifact panel. The list is the official produced-files fact
 * projected from session events (`views.get('artifacts')`) — no pull, no
 * plugin-owned copy. Only instance content goes through the mounted
 * `artifacts` remote namespace, keyed by path.
 */
export function ArtifactPanel({ artifacts, sessionId, route, tabs, activeInstanceId, openInstance, openContainingFolder, useSession, contributeHeaderActions, contributePanelInfo, renderArtifact, t }: Props) {
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

  const panelInfo = useMemo(() => ({
    tabLabels: artifactTabLabels(snapshot.records, tabs),
    tabFilePaths: artifactTabFilePaths(snapshot.records, tabs),
  }), [snapshot.records, tabs])
  useEffect(() => contributePanelInfo(panelInfo), [contributePanelInfo, panelInfo])
  const headerActions = useMemo(() => ({
    right: <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { setRefreshTick(tick => tick + 1) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>,
  }), [t])
  useEffect(() => contributeHeaderActions(headerActions), [contributeHeaderActions, headerActions])

  if (route === 'instance' && activeInstanceId !== undefined) {
    const activePath = active?.path ?? activeInstanceId
    return (
      <div className={css.panel}>
        <ArtifactPath path={activePath} openContainingFolder={openContainingFolder} openFolderLabel={t('openFolder')} />
        {error !== null && <div className={css.error}>{error}</div>}
        {content !== null
          ? <div className={css.content}>{renderArtifact({ artifactId: activePath, content })}</div>
          : error === null && <Empty title={basename(activePath)} body={t('loading')} filePath={activePath} />}
      </div>
    )
  }
  return (
    <div className={css.panel}>
      {snapshot.records.length === 0
        ? <Empty title={t('empty.title')} body={t('empty.body')} />
        : <div className={css.list}>{snapshot.records.map(artifact => (
          <button type="button" key={artifact.path} onClick={() => { openInstance(artifact.path) }}>
            <span className={css.identity}>
              <FileIcon path={artifact.path} size={16} />
              <span className={css.copy}>
                <strong>{basename(artifact.path)}</strong>
                <span className={css.meta}>{artifact.path}</span>
              </span>
            </span>
            <time>{formatAge(artifact.updatedAt, now)}</time>
          </button>
        ))}</div>}
    </div>
  )
}
