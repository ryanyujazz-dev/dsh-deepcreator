/**
 * DeepCreator's settings extension contract. The official ui-settings plugin
 * owns settingsScope, settingsSchema, the describe mirror, and every official
 * settings slot; this package adds only the product-specific Preferences seat.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import './contract/slots.ts'
import { SettingsNavigationController } from './navigation.ts'

export {
  SettingsNavigationController,
  type SettingsNavigation,
  type SettingsNavigationRequest,
  type SettingsNavigationSnapshot,
} from './navigation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Presentation-only command edge for opening a Settings section. */
    settingsNavigation: import('./navigation.ts').SettingsNavigation
  }
}

export type {
  SchemaNode,
  SettingsGeneralItemOwnerProps,
  SettingsHeaderOwnerProps,
  SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps,
  SettingsSchemaService,
  SettingsScopeBinder,
  SettingsScopeController,
  SettingsSectionOwnerProps,
  SettingsTriggerOwnerProps,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Module-loader ordering is declared in package.json. */
export const inject = []

/** Publish only DeepCreator's navigation seam; official Settings state stays authoritative. */
export function apply(ctx: ClientContext): void {
  const navigation = new SettingsNavigationController()
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('settingsNavigation', navigation)
    return () => { void dispose() }
  }, 'ui-settings: navigation service')
}
