import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, DeepCreatorIconFolderOpenOutline16, DeepCreatorIconSkillOutline16,
  IconChevronLeftOutline14, IconChevronRightOutline14, IconDownloadOutline16,
  IconLinkOutline16, IconPlusOutline16, IconSearchOutline16, IconTrashOutline16,
  Input, Menu, Modal, RiskConfirmation, Tooltip,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillAdminDetail, SkillAdminItem, SkillInstallKind } from '@ryanyujazz/dsh-skill-admin/types'
import type { SkillsKey } from './locales.ts'
import css from './SkillsSection.module.css'

export interface SkillsSectionInjected {
  list: () => Promise<SkillAdminItem[]>
  detail: (name: string) => Promise<SkillAdminDetail>
  setEnabled: (name: string, enabled: boolean) => Promise<void>
  install: (kind: SkillInstallKind, value: string) => Promise<void>
  pickDirectory: () => Promise<string | null>
  remove: (name: string) => Promise<void>
  openLocation: (path: string) => Promise<void>
  openPlugins: () => void
  description: (item: SkillAdminItem) => string
}

export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skills'>
  & InjectFace<SkillsSectionInjected>

type CatalogState =
  | { status: 'loading'; items: SkillAdminItem[] }
  | { status: 'ready'; items: SkillAdminItem[] }
  | { status: 'error'; items: SkillAdminItem[]; message: string }

function sourceLabel(source: string, t: (key: SkillsKey) => string): string {
  if (source.startsWith('project-')) return t('sourceProject')
  if (source.startsWith('user-')) return t('sourcePersonal')
  if (source === 'bundled') return t('sourceBundled')
  if (source === 'runtime') return t('sourceRuntime')
  return t('sourceCustom')
}

function SkillSwitch({ item, pending, onChange, t }: {
  item: SkillAdminItem
  pending: boolean
  onChange: (enabled: boolean) => void
  t: (key: SkillsKey) => string
}) {
  const control = (
    <button
      type="button"
      className={css.switch}
      role="switch"
      aria-checked={item.enabled}
      aria-label={`${item.name}: ${t(item.enabled ? 'enabled' : 'disabled')}`}
      disabled={pending || !item.canToggle}
      data-on={item.enabled ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!item.enabled)
      }}
    >
      <span className={css.switchThumb} />
    </button>
  )
  return item.canToggle
    ? control
    : <Tooltip label={t('toggleUnavailable')} delayMs={350}>{control}</Tooltip>
}

function SkillCard({ item, pending, onOpen, onToggle, description, t }: {
  item: SkillAdminItem
  pending: boolean
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  description: string
  t: (key: SkillsKey) => string
}) {
  return (
    <li className={css.card} data-enabled={item.enabled ? 'true' : 'false'}>
      <button type="button" className={css.cardMain} onClick={onOpen}>
        <span className={css.skillIcon}><DeepCreatorIconSkillOutline16 size={16} /></span>
        <span className={css.cardText}>
          <span className={css.cardTitle}>{item.name}</span>
          <span className={css.cardDescription}>{description}</span>
          <span className={css.cardMeta}>{sourceLabel(item.source, t)}</span>
        </span>
        <IconChevronRightOutline14 className={css.chevron} size={14} />
      </button>
      <div className={css.cardSwitch}>
        <SkillSwitch item={item} pending={pending} onChange={onToggle} t={t} />
      </div>
    </li>
  )
}

function Detail({ detail, pending, onBack, onToggle, onOpenLocation, onOpenPlugins, onRemove, description, t }: {
  detail: SkillAdminDetail
  pending: boolean
  onBack: () => void
  onToggle: (enabled: boolean) => void
  onOpenLocation: () => void
  onOpenPlugins: () => void
  onRemove: () => void
  description: string
  t: (key: SkillsKey) => string
}) {
  const removableLabel = detail.managedKind === 'git' || detail.managedKind === 'link'
    ? t('uninstall')
    : t('remove')
  return (
    <div className={css.detail}>
      <button type="button" className={css.back} onClick={onBack}>
        <IconChevronLeftOutline14 size={14} />{t('back')}
      </button>
      <div className={css.detailHead}>
        <span className={css.detailIcon}><DeepCreatorIconSkillOutline16 size={18} /></span>
        <span className={css.detailTitles}>
          <h2>{detail.name}</h2>
          <p>{description}</p>
        </span>
        <SkillSwitch item={detail} pending={pending} onChange={onToggle} t={t} />
      </div>
      <dl className={css.facts}>
        <div><dt>{t('source')}</dt><dd>{sourceLabel(detail.source, t)}</dd></div>
        <div><dt>{t('developer')}</dt><dd>{detail.developer ?? t('undeclaredDeveloper')}</dd></div>
        <div><dt>{t('provider')}</dt><dd><code>{detail.provider}</code></dd></div>
        {detail.path === undefined ? null : <div><dt>{t('location')}</dt><dd><code>{detail.path}</code></dd></div>}
        <div><dt>{t('invocation')}</dt><dd>{`${t('modelInvocation')}: ${t(detail.invocation.modelInvocable ? 'allowed' : 'blocked')} · ${t('userInvocation')}: ${t(detail.invocation.userInvocable ? 'allowed' : 'blocked')}`}</dd></div>
      </dl>
      <div className={css.detailActions}>
        {detail.path === undefined ? null : (
          <Button size="sm" variant="outline" icon={<DeepCreatorIconFolderOpenOutline16 size={16} />} onClick={onOpenLocation}>
            {t('openLocation')}
          </Button>
        )}
        {detail.source === 'bundled' || detail.provider !== 'filesystem' ? (
          <Button size="sm" variant="outline" onClick={onOpenPlugins}>{t('viewPlugin')}</Button>
        ) : null}
        {detail.canRemove ? (
          <Button size="sm" variant="ghost" className={css.dangerButton} icon={<IconTrashOutline16 size={16} />} onClick={onRemove}>
            {removableLabel}
          </Button>
        ) : null}
      </div>
      <section className={css.block}>
        <h3>{t('instructions')}</h3>
        <pre>{detail.content}</pre>
      </section>
      {detail.files.length === 0 ? null : (
        <section className={css.block}>
          <h3>{t('files')}</h3>
          <ul className={css.files}>{detail.files.map(file => <li key={file}><code>{file}</code></li>)}</ul>
        </section>
      )}
    </div>
  )
}

export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { t } = props
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', items: [] })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SkillAdminDetail | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [addMenu, setAddMenu] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeAck, setRemoveAck] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setCatalog(current => ({ status: 'loading', items: current.items }))
    try { setCatalog({ status: 'ready', items: await props.list() }) }
    catch (reason) { setCatalog(current => ({ status: 'error', items: current.items, message: String(reason) })) }
  }

  useEffect(() => { void refresh() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle === '' ? catalog.items : catalog.items.filter(item =>
      [item.name, item.description, ...Object.values(item.localizedDescriptions ?? {}), item.developer ?? '', item.source, item.provider]
        .some(value => value.toLocaleLowerCase().includes(needle)))
  }, [catalog.items, query])

  const toggle = async (item: SkillAdminItem, enabled: boolean): Promise<void> => {
    setPending(current => new Set([...current, item.name]))
    setError(null)
    try {
      await props.setEnabled(item.name, enabled)
      await refresh()
      if (selected?.name === item.name) setSelected(await props.detail(item.name))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPending(current => new Set([...current].filter(name => name !== item.name))) }
  }

  const openDetail = async (name: string): Promise<void> => {
    setError(null)
    try { setSelected(await props.detail(name)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const installDirectory = async (kind: 'copy' | 'link'): Promise<void> => {
    setAddMenu(false)
    const path = await props.pickDirectory()
    if (path === null) return
    setInstalling(true); setError(null)
    try { await props.install(kind, path); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setInstalling(false) }
  }

  const installGit = async (): Promise<void> => {
    setInstalling(true); setError(null)
    try {
      await props.install('git', gitUrl)
      setGitOpen(false); setGitUrl('')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setInstalling(false) }
  }

  const confirmRemove = async (): Promise<void> => {
    if (selected === null) return
    setRemoving(true); setError(null)
    try {
      await props.remove(selected.name)
      setSelected(null); setRemoveOpen(false); setRemoveAck(false)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRemoving(false) }
  }

  return (
    <div className={css.section}>
      {selected === null ? (
        <>
          <div className={css.heading}>
            <div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
            <Menu
              open={addMenu}
              onClose={() => { setAddMenu(false) }}
              align="end"
              portal
              items={[
                { id: 'copy', label: t('importCopy'), icon: <IconDownloadOutline16 size={16} /> },
                { id: 'link', label: t('importLink'), icon: <IconLinkOutline16 size={16} /> },
                { id: 'git', label: t('installGit'), icon: <IconDownloadOutline16 size={16} /> },
              ]}
              onSelect={(id) => {
                if (id === 'git') { setAddMenu(false); setGitOpen(true); return }
                void installDirectory(id as 'copy' | 'link')
              }}
              anchor={<Button size="sm" icon={<IconPlusOutline16 size={16} />} disabled={installing} onClick={() => { setAddMenu(value => !value) }}>{t('add')}</Button>}
            />
          </div>
          <Input icon={<IconSearchOutline16 size={16} />} type="search" value={query} placeholder={t('search')} aria-label={t('search')} onChange={event => { setQuery(event.currentTarget.value) }} />
          {error === null ? null : <p className={css.error} role="alert">{`${t('actionError')}: ${error}`}</p>}
          {catalog.status === 'loading' && catalog.items.length === 0 ? <p className={css.status}>{t('loading')}</p> : null}
          {catalog.status === 'error' && catalog.items.length === 0 ? (
            <div className={css.failure}><p role="alert">{`${t('loadError')} ${catalog.message}`}</p><Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button></div>
          ) : null}
          {catalog.status !== 'error' || catalog.items.length > 0 ? (
            filtered.length === 0
              ? <p className={css.status}>{catalog.items.length === 0 ? t('empty') : t('noMatch')}</p>
              : <ul className={css.cards}>{filtered.map(item => (
                <SkillCard key={item.name} item={item} pending={pending.has(item.name)} onOpen={() => { void openDetail(item.name) }} onToggle={enabled => { void toggle(item, enabled) }} description={props.description(item)} t={t} />
              ))}</ul>
          ) : null}
        </>
      ) : (
        <>
          {error === null ? null : <p className={css.error} role="alert">{`${t('actionError')}: ${error}`}</p>}
          <Detail
            detail={selected}
            pending={pending.has(selected.name)}
            onBack={() => { setSelected(null); setError(null) }}
            onToggle={enabled => { void toggle(selected, enabled) }}
            onOpenLocation={() => {
              const location = selected.resourceBase?.kind === 'directory'
                ? selected.resourceBase.path
                : selected.path
              if (location !== undefined) void props.openLocation(location)
            }}
            onOpenPlugins={props.openPlugins}
            onRemove={() => { setRemoveAck(false); setRemoveOpen(true) }}
            description={props.description(selected)}
            t={t}
          />
        </>
      )}
      <Modal
        open={gitOpen}
        onClose={() => { if (!installing) setGitOpen(false) }}
        title={t('gitTitle')}
        description={t('gitDescription')}
        closeLabel={t('close')}
        footer={<><Button variant="outline" onClick={() => { setGitOpen(false) }}>{t('cancel')}</Button><Button disabled={installing || gitUrl.trim() === ''} onClick={() => { void installGit() }}>{t(installing ? 'installing' : 'install')}</Button></>}
      >
        <Input autoFocus type="url" value={gitUrl} placeholder={t('gitPlaceholder')} onChange={event => { setGitUrl(event.currentTarget.value) }} />
      </Modal>
      <RiskConfirmation
        open={selected !== null && removeOpen}
        title={t('removeTitle')}
        description={t('removeDescription')}
        acknowledgeLabel={t('removeAcknowledge')}
        cancelLabel={t('cancel')}
        confirmLabel={t(removing ? 'removing' : 'confirmRemove')}
        acknowledged={removeAck}
        disabled={removing}
        onAcknowledgedChange={setRemoveAck}
        onCancel={() => { if (!removing) { setRemoveOpen(false); setRemoveAck(false) } }}
        onConfirm={() => { void confirmRemove() }}
      />
    </div>
  )
}
