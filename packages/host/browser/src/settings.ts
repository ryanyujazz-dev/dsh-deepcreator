import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const BROWSER_SETTINGS_NAMESPACE = 'browser'
export const BROWSER_SETTINGS_KEY = settingsNamespace(BROWSER_SETTINGS_NAMESPACE)
export const DEFAULT_VISIBLE_PROVIDER_ORDER = ['iab', 'chrome', 'playwright-chromium'] as const
export interface BrowserSettings {
  defaultAutomation: 'semantic' | 'playwright'
  playwrightDefaultEngine: 'chromium' | 'firefox' | 'webkit'
  visibleProviderOrder: string[]
}
export const BrowserSettingsSchema: z<BrowserSettings> = z.object({
  defaultAutomation: z.union(['semantic', 'playwright']).default('playwright'),
  playwrightDefaultEngine: z.union(['chromium', 'firefox', 'webkit']).default('chromium'),
  visibleProviderOrder: z.array(z.string()).default([...DEFAULT_VISIBLE_PROVIDER_ORDER]),
})
