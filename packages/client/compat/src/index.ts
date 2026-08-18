/** DeepCreator's explicitly supported DeepSeek Harness client baseline. */
export const SUPPORTED_HARNESS = {
  version: '0.1.0-rc.7',
  gitSha: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
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
