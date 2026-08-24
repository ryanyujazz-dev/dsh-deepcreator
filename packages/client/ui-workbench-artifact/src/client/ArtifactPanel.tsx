import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the `artifacts` remote namespace merge (TypertRemoteNamespaceMap)
// into this program so TypertClientRemote['artifacts'] resolves.
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import type { ArtifactReadOk } from '@ryanyujazz/dsh-artifacts/types'
import {
  DeepCreatorIconAnimatedFolder16, DeepCreatorIconMarkdownCode16, DeepCreatorIconMarkdownPreview16, FileIcon, FileLabel,
  IconChevronRightOutline14, IconRefreshOutline14, MarkdownText, Tooltip, WorkbenchPanelIconButton,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { EMPTY_ARTIFACTS_SNAPSHOT } from './artifact-contract.ts'
import {
  artifactPathSegments, artifactTabFilePaths, artifactTabLabels, basename, formatAge, isMarkdownArtifactPath,
} from './artifact-view-model.ts'
import type { MarkdownRenderMode } from './artifact-view-model.ts'
import css from './ArtifactPanel.module.css'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-artifact'> & {
  artifacts: TypertClientRemote['artifacts']
  openContainingFolder?: ((path: string) => void) | undefined
  workspaceRoot?: string | undefined
}

function Empty({ title, body, filePath }: { title: string; body: string; filePath?: string | undefined }) {
  return <div className={css.empty}><strong>{filePath === undefined ? title : <FileLabel path={filePath} label={title} iconSize={16} />}</strong><span>{body}</span></div>
}

function MarkdownModeSwitch({ mode, onChange, label, previewLabel, codeLabel }: {
  mode: MarkdownRenderMode
  onChange(mode: MarkdownRenderMode): void
  label: string
  previewLabel: string
  codeLabel: string
}) {
  return (
    <div className={css.modeSwitch} role="group" aria-label={label} data-artifact-markdown-mode>
      {([
        ['preview', previewLabel, DeepCreatorIconMarkdownPreview16],
        ['code', codeLabel, DeepCreatorIconMarkdownCode16],
      ] as const).map(([value, optionLabel, Icon]) => (
        <Tooltip key={value} label={optionLabel} side="bottom">
          <button
            type="button"
            className={css.modeOption}
            aria-label={optionLabel}
            aria-pressed={mode === value}
            onClick={() => { onChange(value) }}
          >
            <Icon size={14} />
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

function ArtifactPath({ path, openContainingFolder, openFolderLabel, markdownMode, onMarkdownModeChange, renderModeLabel, previewLabel, codeLabel }: {
  path: string
  openContainingFolder?: ((path: string) => void) | undefined
  openFolderLabel: string
  markdownMode?: MarkdownRenderMode | undefined
  onMarkdownModeChange?(mode: MarkdownRenderMode): void
  renderModeLabel: string
  previewLabel: string
  codeLabel: string
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
      {markdownMode !== undefined && onMarkdownModeChange !== undefined && (
        <MarkdownModeSwitch
          mode={markdownMode}
          onChange={onMarkdownModeChange}
          label={renderModeLabel}
          previewLabel={previewLabel}
          codeLabel={codeLabel}
        />
      )}
      {openContainingFolder !== undefined && (
        <WorkbenchPanelIconButton
          className={css.pathAction}
          label={openFolderLabel}
          onClick={() => { openContainingFolder(path) }}
        >
          <DeepCreatorIconAnimatedFolder16 expanded opticalScale={false} />
        </WorkbenchPanelIconButton>
      )}
    </div>
  )
}

/**
 * Workbench Artifact panel. The list is the official produced-files fact
 * projected from session events (`views.get('artifacts')`) — no pull, no
 * plugin-owned copy. Only instance content goes through the mounted
 * `artifacts` remote namespace, keyed by path.
 */
export function ArtifactPanel({ artifacts, sessionId, route, tabs, activeInstanceId, openInstance, replaceInstanceId, openContainingFolder, workspaceRoot, useSession, contributeHeaderActions, contributePanelInfo, renderArtifact, t }: Props) {
  const snapshot = useSession(selector => selector.views.get('artifacts') ?? EMPTY_ARTIFACTS_SNAPSHOT)
  const [content, setContent] = useState<ArtifactReadOk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [markdownModes, setMarkdownModes] = useState<Readonly<Record<string, MarkdownRenderMode>>>({})
  const [now] = useState(() => Date.now())
  const normalizeInstanceId = useCallback((path: string) => resolveWorkspacePath(workspaceRoot, path), [workspaceRoot])
  const normalizedActiveInstanceId = activeInstanceId === undefined ? undefined : normalizeInstanceId(activeInstanceId)
  const active = snapshot.records.find(item => normalizeInstanceId(item.path) === normalizedActiveInstanceId)

  useLayoutEffect(() => {
    for (const tab of tabs) {
      const normalized = normalizeInstanceId(tab)
      if (normalized !== tab) replaceInstanceId(tab, normalized)
    }
  }, [normalizeInstanceId, replaceInstanceId, tabs])

  const readContent = useCallback(() => {
    setContent(null)
    setError(null)
    if (normalizedActiveInstanceId === undefined) return
    let live = true
    void artifacts.read(sessionId, normalizedActiveInstanceId).then((wire) => {
      if (!live) return
      if (!wire.ok) throw new Error(wire.error.message)
      if (!wire.value.ok) throw new Error(wire.value.message)
      setContent(wire.value)
      setError(null)
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [artifacts, normalizedActiveInstanceId, sessionId])
  useEffect(() => readContent(), [readContent, refreshTick])

  const panelInfo = useMemo(() => ({
    tabLabels: artifactTabLabels(snapshot.records, tabs, normalizeInstanceId),
    tabFilePaths: artifactTabFilePaths(snapshot.records, tabs, normalizeInstanceId),
  }), [normalizeInstanceId, snapshot.records, tabs])
  useEffect(() => contributePanelInfo(panelInfo), [contributePanelInfo, panelInfo])
  const headerActions = useMemo(() => ({
    right: <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { setRefreshTick(tick => tick + 1) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>,
  }), [t])
  useEffect(() => contributeHeaderActions(headerActions), [contributeHeaderActions, headerActions])
  const markdownCodeLabels = useMemo(() => ({ copyLabel: t('copy'), copiedLabel: t('copied') }), [t])

  if (route === 'instance' && normalizedActiveInstanceId !== undefined) {
    const activePath = normalizeInstanceId(active?.path ?? normalizedActiveInstanceId)
    const markdown = isMarkdownArtifactPath(activePath)
    const markdownMode = markdownModes[activePath] ?? 'preview'
    const changeMarkdownMode = (mode: MarkdownRenderMode) => {
      setMarkdownModes(current => ({ ...current, [activePath]: mode }))
    }
    return (
      <div className={css.panel}>
        <ArtifactPath
          path={activePath}
          openContainingFolder={openContainingFolder}
          openFolderLabel={t('openFolder')}
          renderModeLabel={t('renderMode')}
          previewLabel={t('renderMode.preview')}
          codeLabel={t('renderMode.code')}
          {...(markdown ? { markdownMode, onMarkdownModeChange: changeMarkdownMode } : {})}
        />
        {error !== null && <div className={css.error}>{error}</div>}
        {content !== null
          ? (
            <div className={`${css.content}${content.kind === 'text' && markdown && markdownMode === 'preview' ? ` ${css.markdownPreview}` : ''}`}>
              {content.kind === 'text' && markdown && markdownMode === 'preview'
                ? (
                  <div className={css.markdownDocument} data-artifact-markdown-document>
                    <MarkdownText text={content.content} codeLabels={markdownCodeLabels} />
                  </div>
                )
                : content.kind === 'text'
                  ? renderArtifact({ artifactId: activePath, kind: 'code', content: content.content })
                  : content.kind === 'document'
                    ? renderArtifact({ artifactId: activePath, kind: `document-${content.contentType}`, content: content.content })
                    : renderArtifact({ artifactId: activePath, kind: content.kind, mime: content.mediaType, content: content.url })}
            </div>
          )
          : error === null && <Empty title={basename(activePath)} body={t('loading')} filePath={activePath} />}
      </div>
    )
  }
  return (
    <div className={css.panel}>
      {snapshot.records.length === 0
        ? <Empty title={t('empty.title')} body={t('empty.body')} />
        : <div className={css.list}>{snapshot.records.map(artifact => (
          <div className={css.row} key={artifact.path}>
            <button type="button" className={css.rowMain} onClick={() => { openInstance(normalizeInstanceId(artifact.path)) }}>
              <span className={css.identity}>
                <FileIcon path={artifact.path} size={16} />
                <span className={css.copy}>
                  <strong>{basename(artifact.path)}</strong>
                  <span className={css.meta}>{artifact.path}</span>
                </span>
              </span>
              <time>{formatAge(artifact.updatedAt, now)}</time>
            </button>
          </div>
        ))}</div>}
    </div>
  )
}
