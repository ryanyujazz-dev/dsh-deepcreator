import type { ClientContext } from '@ryanyujazz/dsh-client-compat'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import type {} from '@ryanyujazz/dsh-client-ui-tool/client'
import type { ImageGenerationSettings } from '@ryanyujazz/dsh-image-generation/types'
import { ImageGenerationSettingsCard } from './ImageGenerationSettingsCard.tsx'
import { ImageToolRow } from './ImageToolRow.tsx'
import { GeneratedTurnImages } from './GeneratedTurnImages.tsx'
import { decodeSettings } from './settings-model.ts'
import { en, NS, zh, type ImageGenerationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'image-generation': ImageGenerationLocaleKey } }

export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const settings = ctx.settingsScope.bind<ImageGenerationSettings>({ namespace: 'image-generation', decode: decodeSettings })
  const credentials = ctx.remote.credentials
  ctx.effect(() => {
    const disposers = [
      ctx.locale.register(NS, { zh, en }),
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'image-generation', locale: NS, inject: () => ({ settings, api: credentials }) }, ImageGenerationSettingsCard)),
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'create_image', locale: NS }, ImageToolRow)),
      ctx.slots.inject('deepcreator.conversation.chat.turnMedia', () => ctx.slots.register({ name: 'deepcreator.conversation.chat.turnMedia', id: 'generated-images', order: 0 }, GeneratedTurnImages)),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-image-generation: settings and conversation registrations')
}

export { ImageGenerationSettingsCard, ImageToolRow, GeneratedTurnImages }
