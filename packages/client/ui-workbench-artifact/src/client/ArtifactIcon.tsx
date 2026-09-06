import { useEffect } from 'react'
import { DeepCreatorIconArtifact16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelIconProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { markArtifactsSeen, useArtifactsSeen } from './artifact-badge-store.ts'
import css from './ArtifactIcon.module.css'

/**
 * Artifact type entry icon. A blue dot in the top-right corner signals new
 * produced files or submitted plans since the user last looked at the panel; the panel group
 * stays mounted while hidden, so the seen watermark advances only while the
 * icon is rendered visible (the group is on screen).
 */
export function ArtifactIcon({ size, visible, sessionId, useArtifacts, usePlans }: WorkbenchPanelIconProps) {
  const snapshot = useArtifacts(selector => selector)
  const plans = usePlans(selector => selector)
  const latest = Math.max(snapshot.records[0]?.updatedAt ?? 0, plans.records[0]?.updatedAt ?? 0)
  const seen = useArtifactsSeen(sessionId)
  useEffect(() => {
    if (visible && latest > seen) markArtifactsSeen(sessionId, latest)
  }, [visible, latest, seen, sessionId])
  const unread = latest > seen
  return (
    <span className={css.frame}>
      <DeepCreatorIconArtifact16 size={size} />
      {unread && <span className={css.dot} data-artifact-badge="unread" aria-hidden="true" />}
    </span>
  )
}
