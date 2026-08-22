/** DeepCreator's explicitly supported DeepSeek Harness client baseline. */
export const SUPPORTED_HARNESS = {
  version: '0.1.1-rc.2',
  gitSha: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
} as const

export type {
  ClientContext,
  SessionId,
  SettingsScope,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

export type {
  BoundActions,
  InjectFace,
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
  PropsStore,
  SlotMap,
} from '@deepseek-ai/dsh-client-ui-slots'
