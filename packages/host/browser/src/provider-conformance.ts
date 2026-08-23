import { BrowserRuntimeError } from './errors.ts'
import type { BrowserCapability, BrowserCommandResult, BrowserProvider, BrowserProviderContext, ProviderTab } from './types.ts'

export interface BrowserProviderConformanceOptions {
  provider: BrowserProvider
  context: BrowserProviderContext
  requiredCapabilities?: BrowserCapability[]
}

export interface BrowserProviderConformanceReport {
  browserId: string
  checks: Array<'descriptor' | 'create-tab' | 'list-agent-tabs' | 'snapshot' | 'close'>
}

/** Reusable fixture for managed, in-app, and extension Provider implementations. */
export async function runBrowserProviderConformance(options: BrowserProviderConformanceOptions): Promise<BrowserProviderConformanceReport> {
  const { provider, context } = options
  const descriptor = provider.descriptor()
  if (descriptor.browserId.trim() === '' || descriptor.name.trim() === '') throw new Error('Provider descriptor requires stable browserId and name.')
  const required = options.requiredCapabilities ?? ['core.tabs', 'core.navigation', 'core.snapshot', 'core.screenshot', 'core.semantic-actions', 'core.wait']
  for (const capability of required) if (!descriptor.capabilities.includes(capability)) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${descriptor.browserId} lacks required conformance capability ${capability}.`)
  if (descriptor.availability !== 'available') throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', descriptor.diagnostic ?? `${descriptor.browserId} is unavailable.`)
  const checks: BrowserProviderConformanceReport['checks'] = ['descriptor']
  let tab: ProviderTab | undefined
  try {
    tab = await provider.createTab(context, {})
    if (tab.providerTabId.trim() === '') throw new Error('Provider returned an empty providerTabId.')
    checks.push('create-tab')
    const listed = await provider.listAgentTabs(context)
    if (!listed.some(candidate => candidate.providerTabId === tab!.providerTabId)) throw new Error('Created Provider tab is absent from listAgentTabs().')
    checks.push('list-agent-tabs')
    const result: BrowserCommandResult = await provider.execute(context, tab, { kind: 'inspect', action: 'snapshot' })
    if (result.kind !== 'snapshot' || result.snapshot.snapshotId.trim() === '') throw new Error('snapshot capability did not return a versioned snapshot.')
    checks.push('snapshot')
  } finally {
    if (tab !== undefined) { await provider.close(context, tab); checks.push('close') }
  }
  return { browserId: descriptor.browserId, checks }
}
