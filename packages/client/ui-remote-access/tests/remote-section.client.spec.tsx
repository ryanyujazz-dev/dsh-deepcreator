// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteSection, type RemoteSectionProps } from '../src/client/RemoteSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh) => zh[key]) as RemoteSectionProps['t']

function props(remote: boolean): RemoteSectionProps {
  return {
    remote,
    t,
    close: vi.fn(),
    loadStatus: vi.fn(async () => ({ enabled: true, running: true, port: 43127, addresses: ['http://deepcreator-test.local:43127'], transport: 'http', hostName: 'deepcreator-test.local' })),
    setEnabled: vi.fn(async () => ({ enabled: true, running: true, port: 43127, addresses: [], transport: 'http' })),
    createTicket: vi.fn(async () => ({ setupUrl: 'http://192.168.1.2:43127/deepcreator/remote/pair#ticket', qrDataUrl: 'data:image/png;base64,AA==', expiresAt: Date.now() + 120_000 })),
    loadPending: vi.fn(async () => []),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    loadDevices: vi.fn(async () => []),
    revoke: vi.fn(async () => {}),
    revokeAll: vi.fn(async () => {}),
    loadCapabilities: vi.fn(async () => ({ remote: true, deviceId: 'phone-1', deviceName: 'iPhone', hostName: 'deepcreator-test.local', transport: 'http', allowedFeatures: ['sessions', 'messages', 'approvals', 'questions', 'artifacts', 'review', 'activity'] })),
    disconnect: vi.fn(async () => {}),
  }
}

describe('RemoteSection', () => {
  it('shows only connection information and disconnect on a paired browser', async () => {
    render(<RemoteSection {...props(true)} />)
    expect(await screen.findByText('deepcreator-test.local')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.disconnect })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.disable })).toBeNull()
    expect(screen.queryByText(zh.devices)).toBeNull()
  })

  it('creates the single QR ticket from the desktop settings section', async () => {
    const injected = props(false)
    render(<RemoteSection {...injected} />)
    const connect = await screen.findByRole('button', { name: zh.connection })
    fireEvent.click(connect)
    await waitFor(() => { expect(injected.createTicket).toHaveBeenCalledOnce() })
    expect(await screen.findByAltText(zh.connection)).toBeTruthy()
  })

  it('warns both desktop and paired browsers that the HTTP transport is unencrypted', async () => {
    const desktop = render(<RemoteSection {...props(false)} />)
    expect(await desktop.findByText(zh.trustedNetworkWarning)).toBeTruthy()
    desktop.unmount()
    render(<RemoteSection {...props(true)} />)
    expect(await screen.findByText(zh.trustedNetworkWarning)).toBeTruthy()
    expect(await screen.findByText(zh.httpTransport)).toBeTruthy()
  })
})
