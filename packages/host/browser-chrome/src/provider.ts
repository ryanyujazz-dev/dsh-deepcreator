import type {
  BrowserCommand, BrowserCommandResult, BrowserDescriptor, BrowserProvider, BrowserProviderContext, BrowserTabRequest, ProviderTab, UserTabCandidate,
} from '@ryanyujazz/dsh-browser'
import { resolveWorkspaceUpload } from '@ryanyujazz/dsh-browser'
import { ChromeBridgeServer } from './bridge.ts'
import { installChromeIntegration, uninstallChromeIntegration } from './install.ts'

export class ChromeExtensionProvider implements BrowserProvider {
  constructor(readonly bridge: ChromeBridgeServer, readonly desktopEnabled = true) {}
  descriptor(): BrowserDescriptor {
    const connected = this.desktopEnabled && this.bridge.connected
    return { browserId: 'chrome', name: 'System Chrome', providerKind: 'extension', family: 'chrome', profile: 'user', capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.screenshot', 'core.semantic-actions', 'core.wait', 'io.upload', 'profile.user', 'profile.user-tabs', 'interaction.manual-handoff', 'interaction.interruptible', 'interaction.secret-input-shielded', 'presentation.live', 'presentation.snapshot', ...(this.desktopEnabled ? ['management.install'] : [])], presentation: { owner: 'provider', mode: 'live', requiredBeforeControl: false }, availability: connected ? 'available' : 'unavailable', ...(connected ? {} : { diagnostic: this.desktopEnabled ? 'Install/connect the DeepCreator Chrome extension and Native Messaging host, then explicitly share a tab.' : 'System Chrome control is available only in DeepCreator Desktop.' }) }
  }
  createTab(context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab> { return this.bridge.call('createTab', { automationSessionId: context.automationSessionId, request }, context.signal) }
  listAgentTabs(context: BrowserProviderContext): Promise<ProviderTab[]> { return this.bridge.call('listAgentTabs', { automationSessionId: context.automationSessionId }, context.signal) }
  listUserTabs(context: BrowserProviderContext): Promise<UserTabCandidate[]> { return this.bridge.call('listUserTabs', {}, context.signal) }
  claimUserTab(context: BrowserProviderContext, candidate: UserTabCandidate): Promise<ProviderTab> { return this.bridge.call('claimUserTab', { automationSessionId: context.automationSessionId, candidate }, context.signal) }
  async execute(context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult> {
    let safeCommand = command
    if (command.kind === 'act' && command.action === 'upload') safeCommand = { ...command, files: await Promise.all((command.files ?? []).map(file => resolveWorkspaceUpload(context.workspaceRoot, file))) }
    return this.bridge.call('execute', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId, command: safeCommand }, context.signal)
  }
  show(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return this.bridge.call('show', { providerTabId: tab.providerTabId }, context.signal) }
  handoffToUser(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return this.bridge.call('show', { providerTabId: tab.providerTabId }, context.signal) }
  resumeControl(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return this.bridge.call('resumeControl', { providerTabId: tab.providerTabId }, context.signal) }
  async release(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.bridge.call('release', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId }, context.signal) }
  async close(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.bridge.call('close', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId }, context.signal) }
  async manage(action: 'install' | 'repair' | 'uninstall'): Promise<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }> {
    if (!this.desktopEnabled) throw new Error('System Chrome integration can only be installed from DeepCreator Desktop.')
    if (action === 'uninstall') { await uninstallChromeIntegration(); return { status: 'removed', diagnostic: 'Native Messaging host removed. Remove the Chrome extension separately from chrome://extensions.' } }
    const installed = await installChromeIntegration()
    return { status: this.bridge.connected ? 'ready' : 'unavailable', diagnostic: this.bridge.connected ? 'Chrome extension and Native Host are connected.' : `Native Host installed at ${installed.manifestPath}. Install or reload the fixed-ID extension, explicitly share a tab, then retry.` }
  }
}
