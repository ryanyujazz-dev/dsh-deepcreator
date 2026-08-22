import Schema from '@deepseek-ai/schemastery'
import type { SettingsSchemaService } from '@ryanyujazz/dsh-client-ui-settings/client'

/** Narrow test double for the official settingsSchema service face this package consumes. */
export const SETTINGS_SCHEMA = {
  rehydrate: (serialized: unknown) => new Schema(serialized as never),
  nodeAtPath: (root: Schema, path: readonly string[]) => {
    let node: Schema | undefined = root
    for (const key of path) {
      if (node === undefined) return undefined
      if (node.type === 'object') node = node.dict?.[key]
      else if (node.type === 'dict' || node.type === 'array') node = node.inner
      else return undefined
    }
    return node
  },
} satisfies Pick<SettingsSchemaService, 'rehydrate' | 'nodeAtPath'>
