/** DeepCreator-only settings slots layered over the official settings contract. */

import type { SettingsGeneralItemOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Feature-owned preference rows inside DeepCreator's shared Preferences group. */
    'deepcreator.settings.preferences.item': {
      kind: 'list'
      scope: 'root'
      owner: SettingsGeneralItemOwnerProps
    }
  }
}
