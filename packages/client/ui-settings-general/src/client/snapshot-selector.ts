/** Package-local React adapter for a runtime-owned observable snapshot. */

import { useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Bind a runtime source without importing renderer implementation values. */
export function bindSnapshotSelector<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return function useSnapshotSelector<S>(select: (snapshot: T) => S): S {
    const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
    return select(snapshot)
  }
}
