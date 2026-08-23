import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageGenerationSettings, ImageProviderProfile, ImageProviderProtocol } from '@ryanyujazz/dsh-image-generation/types'
import { IconChevronDownOutline14, IconPlusOutline16, IconTrashOutline16 } from '@ryanyujazz/dsh-client-ui-primitives'
import { isPresetProvider, newCustomProvider, newProvider, parseModels, protocolDefaults } from './settings-model.ts'
import type { ImageGenerationLocaleKey } from './locales.ts'
import css from './ImageGenerationSettingsCard.module.css'
import { SelectMenu } from './SelectMenu.tsx'

type Api = Pick<IApiClient, 'credentials'>
type Props = PropsLocale<'image-generation'> & { settings: SettingsScope<ImageGenerationSettings>; api: Api }
type EditorMode = 'create' | 'custom' | 'edit'
type ModelDraft = { key: number; id: string; name: string }

const protocolOptions = (t: Props['t']) => [
  { id: 'openai', label: t('protocolOpenAI') },
  { id: 'seedream', label: t('protocolSeedream') },
  { id: 'gemini', label: t('protocolGemini') },
]

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function modelDrafts(provider: ImageProviderProfile): ModelDraft[] {
  return provider.models.map((model, key) => ({ key, id: model.id, name: model.name ?? '' }))
}

function ProviderEditor({ provider, mode, settings, api, t, onCancel, onSaved }: {
  provider: ImageProviderProfile
  mode: EditorMode
  settings: SettingsScope<ImageGenerationSettings>
  api: Api
  t: Props['t']
  onCancel: () => void
  onSaved: () => void
}) {
  const customIdentity = mode === 'custom' || (mode === 'edit' && !isPresetProvider(provider))
  const [draft, setDraft] = useState(provider)
  const [models, setModels] = useState<ModelDraft[]>(() => modelDrafts(provider))
  const [defaultModelKey, setDefaultModelKey] = useState<number | undefined>(() => {
    const drafts = modelDrafts(provider)
    return drafts.find(model => model.id === provider.defaultModel)?.key ?? drafts[0]?.key
  })
  const [customOpen, setCustomOpen] = useState(customIdentity)
  const [key, setKey] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const nextModelKey = useRef(provider.models.length)

  useEffect(() => {
    const nextModels = modelDrafts(provider)
    setDraft(provider)
    setModels(nextModels)
    setDefaultModelKey(nextModels.find(model => model.id === provider.defaultModel)?.key ?? nextModels[0]?.key)
    setCustomOpen(customIdentity)
    setKey('')
    setNotice(undefined)
    nextModelKey.current = nextModels.length
  }, [customIdentity, provider])
  useEffect(() => {
    let alive = true
    void api.credentials.describe({ refs: [draft.apiKeyEnv] }).then(response => {
      if (alive && response.result.ok) setKeyConfigured(response.result.value.credentials[draft.apiKeyEnv]?.configured ?? false)
    })
    return () => { alive = false }
  }, [api, draft.apiKeyEnv])

  const save = async () => {
    setBusy(true)
    setNotice(undefined)
    try {
      const current = settings.getSnapshot().value ?? { providers: [] }
      const modelRows = models.map(model => ({ ...model, id: model.id.trim(), name: model.name.trim() }))
      if (modelRows.length === 0 || modelRows.some(model => model.id === '')) throw new Error(t('requiredModels'))
      const parsedModels = parseModels(modelRows.map(model => model.name === '' ? model.id : `${model.id} | ${model.name}`).join('\n'), draft.protocol)
      const id = draft.id.trim()
      const baseURL = draft.baseURL.trim()
      const apiKeyEnv = draft.apiKeyEnv.trim()
      const name = draft.name?.trim()
      if (id === '' || baseURL === '' || apiKeyEnv === '') throw new Error(t('requiredFields'))
      if (customIdentity && (name === undefined || name === '')) throw new Error(t('providerNameRequired'))
      if (current.providers.some(item => item.id === id && (mode !== 'edit' || item.id !== provider.id))) throw new Error(t('duplicateProvider'))
      const selectedDefault = modelRows.find(model => model.key === defaultModelKey)?.id ?? modelRows[0]!.id
      const next: ImageProviderProfile = {
        id,
        ...(name === undefined || name === '' ? {} : { name }),
        protocol: draft.protocol,
        baseURL,
        apiKeyEnv,
        models: parsedModels,
        defaultModel: selectedDefault,
      }
      const providers = mode === 'edit'
        ? current.providers.map(item => item.id === provider.id ? next : item)
        : [...current.providers, next]
      if (key.trim() !== '') {
        const response = await api.credentials.set({ ref: next.apiKeyEnv, value: key.trim() })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      await settings.set('providers', providers)
      if (current.providers.length === 0 || (mode === 'edit' && current.defaultProvider === provider.id && next.id !== provider.id)) {
        await settings.set('defaultProvider', next.id)
      }
      onSaved()
    } catch (error) {
      setNotice(`${t('failed')} ${message(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const changeProtocol = (protocol: ImageProviderProtocol) => {
    if (!customIdentity) {
      const current = settings.getSnapshot().value ?? { providers: [] }
      const otherProviders = mode === 'edit' ? current.providers.filter(item => item.id !== provider.id) : current.providers
      const replacement = newProvider(protocol, otherProviders)
      const nextModels = modelDrafts(replacement)
      setDraft(replacement)
      setModels(nextModels)
      setDefaultModelKey(nextModels[0]?.key)
      setKey('')
      nextModelKey.current = nextModels.length
      return
    }
    const old = protocolDefaults(draft.protocol)
    const next = protocolDefaults(protocol)
    setDraft(value => ({
      ...value,
      protocol,
      baseURL: value.baseURL === old.baseURL ? next.baseURL : value.baseURL,
      apiKeyEnv: value.apiKeyEnv === old.apiKeyEnv ? next.apiKeyEnv : value.apiKeyEnv,
    }))
  }

  const updateModel = (key: number, field: 'id' | 'name', value: string) => {
    setModels(current => current.map(model => model.key === key ? { ...model, [field]: value } : model))
  }
  const removeModel = (key: number) => {
    setModels(current => {
      const next = current.filter(model => model.key !== key)
      if (defaultModelKey === key) setDefaultModelKey(next[0]?.key)
      return next
    })
  }
  const addModel = () => {
    const model = { key: nextModelKey.current, id: '', name: '' }
    nextModelKey.current += 1
    setModels(current => [...current, model])
    setDefaultModelKey(current => current ?? model.key)
  }

  const editorTitle = mode === 'edit' ? t('editProvider') : mode === 'custom' ? t('configureCustomProvider') : t('configureProvider')
  return (
    <section className={css.editor} aria-label={editorTitle}>
      <div className={css.editorHeader}>
        <strong>{editorTitle}</strong>
        <span className={css.keyStatus} data-ready={keyConfigured || undefined}>
          <i aria-hidden="true" />{keyConfigured ? t('configured') : t('missing')}
        </span>
      </div>
      <form className={css.editorForm} onSubmit={event => { event.preventDefault(); void save() }}>
        <div className={css.basicFields}>
          {customIdentity ? (
            <label className={css.field}><span>{t('providerName')}</span><input value={draft.name ?? ''} placeholder={t('providerNamePlaceholder')} onChange={event => { setDraft(value => ({ ...value, name: event.target.value })) }} /></label>
          ) : (
            <label className={`${css.field} ${css.compactField}`}><span>{t('provider')}</span><SelectMenu label={t('provider')} value={draft.protocol} options={protocolOptions(t)} onChange={value => { changeProtocol(value as ImageProviderProtocol) }} /></label>
          )}
          <label className={css.field}><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={key} placeholder={keyConfigured ? '••••••••' : t('apiKeyPlaceholder')} onChange={event => { setKey(event.target.value) }} /></label>
        </div>
        <div className={css.advanced}>
          <button type="button" className={css.advancedToggle} aria-expanded={customOpen} onClick={() => { setCustomOpen(value => !value) }}>
            <IconChevronDownOutline14 className={customOpen ? css.advancedChevronOpen : css.advancedChevron} />
            {t('customSettings')}
          </button>
          {customOpen && (
            <div className={css.advancedContent}>
              {customIdentity && (
                <label className={`${css.field} ${css.compactField}`}><span>{t('apiProtocol')}</span><SelectMenu label={t('apiProtocol')} value={draft.protocol} options={protocolOptions(t)} onChange={value => { changeProtocol(value as ImageProviderProtocol) }} /></label>
              )}
              <label className={css.field}><span>{t('apiUrl')}</span><input value={draft.baseURL} placeholder={t('providerDefault')} onChange={event => { setDraft(value => ({ ...value, baseURL: event.target.value })) }} /></label>
              <section className={css.modelCatalog} aria-labelledby={`model-catalog-${provider.id}`}>
                <div className={css.modelCatalogHeader}>
                  <div><strong id={`model-catalog-${provider.id}`}>{t('modelCatalog')}</strong><span>{t('modelCatalogHint')}</span></div>
                </div>
                {models.length === 0 ? <p className={css.emptyModels}>{t('emptyModels')}</p> : (
                  <div className={css.modelRows}>
                    {models.map(model => (
                      <div className={css.modelRow} key={model.key}>
                        <input aria-label={t('modelId')} placeholder={t('modelId')} value={model.id} onChange={event => { updateModel(model.key, 'id', event.target.value) }} />
                        <input aria-label={t('modelDisplayName')} placeholder={t('modelDisplayName')} value={model.name} onChange={event => { updateModel(model.key, 'name', event.target.value) }} />
                        <button type="button" className={css.defaultModelButton} data-active={defaultModelKey === model.key || undefined} aria-pressed={defaultModelKey === model.key} onClick={() => { setDefaultModelKey(model.key) }}>{t('defaultModel')}</button>
                        <button type="button" className={css.removeModelButton} aria-label={`${t('removeModel')}: ${model.id || t('unnamedModel')}`} onClick={() => { removeModel(model.key) }}><IconTrashOutline16 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" className={css.addModelButton} onClick={addModel}><IconPlusOutline16 size={13} />{t('addModel')}</button>
              </section>
            </div>
          )}
        </div>
        <div className={css.editorActions}>
          {notice !== undefined && <span className={css.notice} role="status">{notice}</span>}
          <button type="button" className={css.secondaryButton} disabled={busy} onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className={css.primaryButton} disabled={busy}>{busy ? t('saving') : t('save')}</button>
        </div>
      </form>
    </section>
  )
}

function ProviderRow({ provider, isDefault, writable, credentialRevision, api, t, onEdit, onRemove, onMakeDefault }: {
  provider: ImageProviderProfile
  isDefault: boolean
  writable: boolean
  credentialRevision: number
  api: Api
  t: Props['t']
  onEdit: () => void
  onRemove: () => void
  onMakeDefault: () => void
}) {
  const [configured, setConfigured] = useState<boolean>()
  useEffect(() => {
    let alive = true
    setConfigured(undefined)
    void api.credentials.describe({ refs: [provider.apiKeyEnv] }).then(response => {
      if (alive) setConfigured(response.result.ok ? response.result.value.credentials[provider.apiKeyEnv]?.configured ?? false : false)
    })
    return () => { alive = false }
  }, [api, credentialRevision, provider.apiKeyEnv])
  return (
    <div className={css.providerRow}>
      <div className={css.providerIdentity}>
        <span className={css.providerName}>{provider.name ?? provider.id}</span>
        <i className={css.credentialDot} data-ready={configured || undefined} aria-hidden="true" />
        <span className={css.srOnly}>{configured ? t('configured') : t('missing')}</span>
        {isDefault && <span className={css.defaultTag}>{t('defaultTag')}</span>}
      </div>
      <div className={css.rowActions}>
        {!isDefault && <button type="button" disabled={!writable} onClick={onMakeDefault}>{t('makeDefault')}</button>}
        <button type="button" disabled={!writable} onClick={onEdit}>{t('edit')}</button>
        <button type="button" className={css.deleteButton} disabled={!writable} onClick={onRemove}>{t('remove')}</button>
      </div>
    </div>
  )
}

export function ImageGenerationSettingsCard({ settings, api, t }: Props) {
  const snapshot = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
    () => settings.getSnapshot(),
  )
  const value = snapshot.value ?? { providers: [] }
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [creating, setCreating] = useState<{ mode: 'create' | 'custom'; provider: ImageProviderProfile }>()
  const [credentialRevision, setCredentialRevision] = useState(0)
  const [notice, setNotice] = useState<string>()
  const defaultId = value.defaultProvider ?? value.providers[0]?.id

  const beginCreate = (mode: 'create' | 'custom') => {
    setEditingId(undefined)
    setNotice(undefined)
    setCreating({ mode, provider: mode === 'custom' ? newCustomProvider(value.providers) : newProvider('openai', value.providers) })
  }
  const remove = async (provider: ImageProviderProfile) => {
    if (!window.confirm(`${t('remove')} ${provider.name ?? provider.id}?`)) return
    setNotice(undefined)
    try {
      const current = settings.getSnapshot().value ?? { providers: [] }
      const providers = current.providers.filter(item => item.id !== provider.id)
      await settings.set('providers', providers)
      if ((current.defaultProvider ?? current.providers[0]?.id) === provider.id) {
        if (providers[0] === undefined) await settings.unset('defaultProvider')
        else await settings.set('defaultProvider', providers[0].id)
      }
      if (!providers.some(item => item.apiKeyEnv === provider.apiKeyEnv)) await api.credentials.unset({ ref: provider.apiKeyEnv })
      if (editingId === provider.id) setEditingId(undefined)
    } catch (error) {
      setNotice(`${t('failed')} ${message(error)}`)
    }
  }

  return (
    <li className={`${css.card}${open ? ` ${css.cardOpen}` : ''}`}>
      <button type="button" className={css.disclosure} aria-expanded={open} aria-label={`${open ? t('collapse') : t('expand')}: ${t('title')}`} onClick={() => { setOpen(value => !value) }}>
        <span className={css.headText}><strong>{t('title')}</strong><span>{t('description')}</span></span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open && (
        <div className={css.body}>
          {value.providers.length > 0 && (
            <div className={css.providers}>
              {value.providers.map(provider => (
                <div className={css.providerCard} key={provider.id}>
                  <ProviderRow
                    provider={provider}
                    isDefault={provider.id === defaultId}
                    writable={snapshot.writable}
                    credentialRevision={credentialRevision}
                    api={api}
                    t={t}
                    onEdit={() => { setCreating(undefined); setEditingId(current => current === provider.id ? undefined : provider.id); setNotice(undefined) }}
                    onRemove={() => { void remove(provider) }}
                    onMakeDefault={() => { void settings.set('defaultProvider', provider.id) }}
                  />
                  {editingId === provider.id && (
                    <ProviderEditor
                      provider={provider}
                      mode="edit"
                      settings={settings}
                      api={api}
                      t={t}
                      onCancel={() => { setEditingId(undefined) }}
                      onSaved={() => { setEditingId(undefined); setCredentialRevision(value => value + 1) }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {creating !== undefined ? (
            <ProviderEditor
              provider={creating.provider}
              mode={creating.mode}
              settings={settings}
              api={api}
              t={t}
              onCancel={() => { setCreating(undefined) }}
              onSaved={() => { setCreating(undefined); setCredentialRevision(value => value + 1) }}
            />
          ) : (
            <div className={css.addActions}>
              <button type="button" className={css.addButton} disabled={!snapshot.writable} onClick={() => { beginCreate('create') }}><IconPlusOutline16 size={14} />{t('addProvider')}</button>
              <button type="button" className={css.addButton} disabled={!snapshot.writable} onClick={() => { beginCreate('custom') }}><IconPlusOutline16 size={14} />{t('addCustomProvider')}</button>
            </div>
          )}
          {notice !== undefined && <p className={css.notice} role="status">{notice}</p>}
        </div>
      )}
    </li>
  )
}

export type { ImageGenerationLocaleKey }
