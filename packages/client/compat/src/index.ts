/** DeepCreator's explicitly supported DeepSeek Harness client baseline. */
export const SUPPORTED_HARNESS = {
  version: '0.1.0-rc.6',
  gitSha: '47f943859bef60e4160492346772ded9b24f765a',
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
