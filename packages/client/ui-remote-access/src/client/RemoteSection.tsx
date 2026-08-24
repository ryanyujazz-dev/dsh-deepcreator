import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@ryanyujazz/dsh-client-ui-primitives'
import type { RemoteAccessStatus, RemoteCapabilities, RemoteDevice, RemotePairingRequest, RemotePairingTicket } from '@ryanyujazz/dsh-remote-access/types'
import css from './RemoteSection.module.css'

export interface RemoteSectionInjected {
  remote: boolean
  loadStatus(): Promise<RemoteAccessStatus>
  setEnabled(enabled: boolean): Promise<RemoteAccessStatus>
  createTicket(): Promise<RemotePairingTicket>
  loadPending(): Promise<RemotePairingRequest[]>
  approve(requestId: string): Promise<void>
  reject(requestId: string): Promise<void>
  loadDevices(): Promise<RemoteDevice[]>
  revoke(deviceId: string): Promise<void>
  revokeAll(): Promise<void>
  loadCapabilities(): Promise<RemoteCapabilities>
  disconnect(): Promise<void>
}

export type RemoteSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'remote-access'> & InjectFace<RemoteSectionInjected>

function formatTime(value: number): string { return new Date(value).toLocaleString() }

export function RemoteSection(props: RemoteSectionProps) {
  const { t } = props
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [ticket, setTicket] = useState<RemotePairingTicket | null>(null)
  const [pending, setPending] = useState<RemotePairingRequest[]>([])
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [capabilities, setCapabilities] = useState<RemoteCapabilities | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      if (props.remote) { setCapabilities(await props.loadCapabilities()); return }
      const [nextStatus, nextDevices, nextPending] = await Promise.all([props.loadStatus(), props.loadDevices(), props.loadPending()])
      setStatus(nextStatus); setDevices(nextDevices); setPending(nextPending)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [props])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (props.remote || status?.running !== true) return
    const timer = window.setInterval(() => { void Promise.all([props.loadPending(), props.loadDevices()]).then(([requests, paired]) => { setPending(requests); setDevices(paired) }) }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [props, status?.running])

  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null)
    try { await operation(); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  if (props.remote) {
    return <section className={css.section}>
      <header><h2>{t('remoteTitle')}</h2><p>{t('remoteIntro')}</p></header>
      <p className={css.warning}>{t('trustedNetworkWarning')}</p>
      {error !== null ? <p className={css.error}>{error}</p> : null}
      {capabilities !== null ? <dl className={css.facts}><div><dt>{t('host')}</dt><dd>{capabilities.hostName}</dd></div><div><dt>{t('device')}</dt><dd>{capabilities.deviceName}</dd></div><div><dt>{t('transport')}</dt><dd>{t('httpTransport')}</dd></div></dl> : null}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { void act(async () => { await props.disconnect(); location.replace('/deepcreator/remote/pair') }) }}>{t('disconnect')}</Button>
    </section>
  }

  return <section className={css.section}>
    <header><h2>{t('title')}</h2><p>{t('intro')}</p></header>
    {error !== null ? <p className={css.error}>{error}</p> : null}
    {status === null ? <p className={css.muted}>{t('loadError')}</p> : <>
      <div className={css.statusRow}><span className={css.dot} data-on={status.running || undefined} /><span>{status.running ? t('enabled') : t('disabled')}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => { void act(async () => { setStatus(await props.setEnabled(!status.enabled)); setTicket(null) }) }}>{busy ? t('starting') : status.enabled ? t('disable') : t('enable')}</Button></div>
      {status.error !== undefined ? <p className={css.error}>{status.error}</p> : null}
      {status.running ? <>
        <p className={css.warning}>{t('trustedNetworkWarning')}</p>
        <div className={css.block}><h3>{t('connection')}</h3><p>{t('scan')}</p>{ticket === null ? <Button size="sm" onClick={() => { void act(async () => { setTicket(await props.createTicket()) }) }}>{t('connection')}</Button> : <div className={css.qr}><img src={ticket.qrDataUrl} alt={t('connection')} /><p>{t('expires')}</p></div>}</div>
        <div className={css.block}><h3>{t('addresses')}</h3><ul>{status.addresses.map(address => <li key={address}><code>{address}</code></li>)}</ul></div>
        {pending.length > 0 ? <div className={css.block}><h3>{t('requests')}</h3><ul className={css.rows}>{pending.map(request => <li key={request.requestId}><span><strong>{request.deviceName}</strong><code className={css.code}>{request.code}</code></span><span><Button size="sm" onClick={() => { void act(async () => { await props.approve(request.requestId) }) }}>{t('approve')}</Button><Button size="sm" variant="outline" onClick={() => { void act(async () => { await props.reject(request.requestId) }) }}>{t('reject')}</Button></span></li>)}</ul></div> : null}
        <div className={css.block}><div className={css.blockTitle}><h3>{t('devices')}</h3>{devices.length > 0 ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void act(props.revokeAll) }}>{t('revokeAll')}</Button> : null}</div>{devices.length === 0 ? <p>{t('noDevices')}</p> : <ul className={css.rows}>{devices.map(device => <li key={device.id}><span><strong>{device.name}</strong><small>{t('firstConnected')}: {formatTime(device.firstConnectedAt)} · {t('lastConnected')}: {formatTime(device.lastConnectedAt)}</small></span><Button size="sm" variant="outline" onClick={() => { void act(async () => { await props.revoke(device.id) }) }}>{t('revoke')}</Button></li>)}</ul>}</div>
      </> : null}
    </>}
  </section>
}
