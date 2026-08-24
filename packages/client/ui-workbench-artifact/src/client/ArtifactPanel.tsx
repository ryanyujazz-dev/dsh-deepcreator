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
  IconChevronRightOutline14, IconListPenOutline16, IconRefreshOutline14, MarkdownText, Tooltip, WorkbenchPanelIconButton,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { MarkdownImageResolver } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { EMPTY_ARTIFACTS_SNAPSHOT, EMPTY_PLANS_SNAPSHOT } from './artifact-contract.ts'
import type { PlanArtifactStatus } from './artifact-contract.ts'
import {
  artifactPathSegments, artifactTabFilePaths, artifactTabLabels, basename, formatAge, isMarkdownArtifactPath,
  planCallIdFromInstance, planInstanceId, planTabLabels, resolveMarkdownImageArtifactPath,
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
 * Workbench Artifact panel. Files are the official produced-files fact and
 * plans are exit-plan calls, both projected from this Session's events — no
 * project index or plugin-owned copy. Only file instance content goes through
 * the mounted `artifacts` remote namespace, keyed by path.
 */
export function ArtifactPanel({ artifacts, sessionId, route, tabs, activeInstanceId, openInstance, replaceInstanceId, openContainingFolder, workspaceRoot, useSession, contributeHeaderActions, contributePanelInfo, renderArtifact, reveal, t }: Props) {
  const snapshot = useSession(selector => selector.views.get('artifacts') ?? EMPTY_ARTIFACTS_SNAPSHOT)
  const plans = useSession(selector => selector.views.get('plans') ?? EMPTY_PLANS_SNAPSHOT)
  const [content, setContent] = useState<ArtifactReadOk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [markdownModes, setMarkdownModes] = useState<Readonly<Record<string, MarkdownRenderMode>>>({})
  const [now] = useState(() => Date.now())
  const normalizeInstanceId = useCallback((path: string) => planCallIdFromInstance(path) === null ? resolveWorkspacePath(workspaceRoot, path) : path, [workspaceRoot])
  const normalizedActiveInstanceId = activeInstanceId === undefined ? undefined : normalizeInstanceId(activeInstanceId)
  const active = snapshot.records.find(item => normalizeInstanceId(item.path) === normalizedActiveInstanceId)
  const activePlanCallId = normalizedActiveInstanceId === undefined ? null : planCallIdFromInstance(normalizedActiveInstanceId)
  const activePlan = activePlanCallId === null ? undefined : plans.records.find(item => item.callId === activePlanCallId)
  const activeFilePath = normalizedActiveInstanceId !== undefined && activePlanCallId === null
    ? normalizeInstanceId(active?.path ?? normalizedActiveInstanceId)
    : undefined

  const markdownImageResolver = useMemo<MarkdownImageResolver | undefined>(() => {
    if (activeFilePath === undefined || !isMarkdownArtifactPath(activeFilePath)) return undefined
    const requests = new Map<string, Promise<string | undefined>>()
    return (destination) => {
      const imagePath = resolveMarkdownImageArtifactPath(activeFilePath, destination)
      if (imagePath === undefined) return undefined
      const cached = requests.get(imagePath)
      if (cached !== undefined) return cached
      const request = artifacts.read(sessionId, imagePath).then((wire) => {
        if (!wire.ok || !wire.value.ok || wire.value.kind !== 'image') return undefined
        return wire.value.url
      }).catch(() => undefined)
      requests.set(imagePath, request)
      return request
    }
  }, [activeFilePath, artifacts, refreshTick, sessionId])

  useLayoutEffect(() => {
    for (const tab of tabs) {
      const normalized = normalizeInstanceId(tab)
      if (normalized !== tab) replaceInstanceId(tab, normalized)
    }
  }, [normalizeInstanceId, replaceInstanceId, tabs])

  const readContent = useCallback(() => {
    setContent(null)
    setError(null)
    if (normalizedActiveInstanceId === undefined || activePlanCallId !== null) return
    let live = true
    void artifacts.read(sessionId, normalizedActiveInstanceId).then((wire) => {
      if (!live) return
      if (!wire.ok) throw new Error(wire.error.message)
      if (!wire.value.ok) throw new Error(wire.value.message)
      setContent(wire.value)
      setError(null)
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [activePlanCallId, artifacts, normalizedActiveInstanceId, sessionId])
  useEffect(() => readContent(), [readContent, refreshTick])

  const panelInfo = useMemo(() => ({
    tabLabels: {
      ...artifactTabLabels(snapshot.records, tabs.filter(tab => planCallIdFromInstance(tab) === null), normalizeInstanceId),
      ...planTabLabels(plans.records, tabs),
    },
    tabFilePaths: artifactTabFilePaths(snapshot.records, tabs, normalizeInstanceId),
  }), [normalizeInstanceId, plans.records, snapshot.records, tabs])
  useEffect(() => contributePanelInfo(panelInfo), [contributePanelInfo, panelInfo])
  const headerActions = useMemo(() => ({
    right: activePlanCallId === null
      ? <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { setRefreshTick(tick => tick + 1) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>
      : null,
  }), [activePlanCallId, t])
  useEffect(() => contributeHeaderActions(headerActions), [contributeHeaderActions, headerActions])
  const markdownCodeLabels = useMemo(() => ({ copyLabel: t('copy'), copiedLabel: t('copied') }), [t])

  useEffect(() => {
    if (reveal?.parameters?.kind !== 'plan' || reveal.target === undefined) return
    if (!plans.records.some(plan => plan.callId === reveal.target)) return
    openInstance(planInstanceId(reveal.target))
  }, [openInstance, plans.records, reveal?.nonce, reveal?.parameters?.kind, reveal?.target])

  const planStatus = (status: PlanArtifactStatus): string => {
    if (status === 'pending') return t('plan.status.pending')
    if (status === 'approved') return t('plan.status.approved')
    return t('plan.status.rejected')
  }

  if (route === 'instance' && activePlanCallId !== null) {
    return (
      <div className={css.panel}>
        {activePlan === undefined
          ? <Empty title={t('plan.unavailable.title')} body={t('plan.unavailable.body')} />
          : <>
              <div className={css.planBar} data-plan-call-id={activePlan.callId}>
                <IconListPenOutline16 size={16} />
                <strong>{activePlan.title}</strong>
                <span data-status={activePlan.status}>{planStatus(activePlan.status)}</span>
              </div>
              <div className={`${css.content} ${css.markdownPreview}`}>
                <div className={css.markdownDocument} data-artifact-plan-document>
                  <MarkdownText text={activePlan.markdown} codeLabels={markdownCodeLabels} />
                </div>
              </div>
            </>}
      </div>
    )
  }

  if (route === 'instance' && normalizedActiveInstanceId !== undefined) {
    const activePath = activeFilePath ?? normalizedActiveInstanceId
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
            <div className={`${css.content}${content.kind === 'text' && markdown && markdownMode === 'preview' ? ` ${css.markdownPreview}` : ''}${content.kind === 'pdf' || (content.kind === 'document' && content.contentType === 'html') ? ` ${css.embeddedContent}` : ''}`}>
              {content.kind === 'text' && markdown && markdownMode === 'preview'
                ? (
                  <div className={css.markdownDocument} data-artifact-markdown-document>
                    <MarkdownText text={content.content} codeLabels={markdownCodeLabels} imageResolver={markdownImageResolver} />
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
      {snapshot.records.length === 0 && plans.records.length === 0
        ? <Empty title={t('empty.title')} body={t('empty.body')} />
        : <div className={css.list}>
            {plans.records.length > 0 && <section className={css.group} aria-labelledby="artifact-plans-heading">
              <h2 id="artifact-plans-heading"><span>{t('group.plans')}</span><span>{plans.records.length}</span></h2>
              {plans.records.map(plan => (
                <div className={css.row} key={plan.callId}>
                  <button type="button" className={css.rowMain} onClick={() => { openInstance(planInstanceId(plan.callId)) }}>
                    <span className={css.identity}>
                      <IconListPenOutline16 size={16} />
                      <span className={css.copy}>
                        <strong>{plan.title}</strong>
                        <span className={css.meta}>{t('plan.turn', { turn: plan.turn })} · {planStatus(plan.status)}</span>
                      </span>
                    </span>
                    <time>{formatAge(plan.updatedAt, now)}</time>
                  </button>
                </div>
              ))}
            </section>}
            {snapshot.records.length > 0 && <section className={css.group} aria-labelledby="artifact-files-heading">
              <h2 id="artifact-files-heading"><span>{t('group.files')}</span><span>{snapshot.records.length}</span></h2>
              {snapshot.records.map(artifact => (
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
              ))}
            </section>}
          </div>}
    </div>
  )
}
