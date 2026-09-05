import type { Context } from '@deepseek-ai/cordis'

/** The DSH client Context face. The old runtime re-exported it as ClientContext. */
export type ClientContext = Context

export type { SessionId } from '@deepseek-ai/dsh-session/types'

export type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
