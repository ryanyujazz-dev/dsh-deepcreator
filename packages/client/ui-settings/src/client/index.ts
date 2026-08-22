/**
 * DeepCreator's settings extension contract. The official ui-settings plugin
 * owns settingsScope, settingsSchema, the describe mirror, and every official
 * settings slot; this package adds only the product-specific Preferences seat.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import './contract/slots.ts'

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

/** Module-loader ordering is declared in package.json; no Cordis service is shadowed here. */
export const inject = []

/** Keep the extension as a loadable module without replacing the official base. */
export function apply(_ctx: ClientContext): void {}
