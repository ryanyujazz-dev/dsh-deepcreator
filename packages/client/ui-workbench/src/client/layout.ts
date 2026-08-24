/** Width floor shared by every Workbench panel type. */
export const MIN_PANEL_COLUMN_WIDTH = 150
/** Conversation floor inside the Stage (Conversation + Workbench). */
export const MIN_CONVERSATION_WIDTH = 360

export function fitWorkbenchWidth(target: number, stageWidth: number): number {
  const maximum = Math.max(MIN_PANEL_COLUMN_WIDTH, stageWidth - MIN_CONVERSATION_WIDTH)
  return Math.max(MIN_PANEL_COLUMN_WIDTH, Math.min(target, maximum))
}

/** First visible panel receives half of the Conversation width that existed before it opened. */
export function initialWorkbenchWidth(conversationWidth: number): number {
  return Math.round(fitWorkbenchWidth(conversationWidth / 2, conversationWidth))
}

/** New odd type creates an equal column: two columns use 1/2 Stage, three use 2/3 Stage. */
export function oddTrackWorkbenchWidth(stageWidth: number, trackCount: number): number {
  const ratio = trackCount <= 1 ? 1 / 3 : trackCount === 2 ? 1 / 2 : 2 / 3
  return Math.round(fitWorkbenchWidth(stageWidth * ratio, stageWidth))
}

/** Responsive projection removes whole panel columns from right to left at their 150px floor. */
export function visibleTrackCount(trackCount: number, renderedWidth: number): number {
  if (trackCount <= 0 || renderedWidth <= 0) return 0
  for (let count = trackCount; count >= 1; count -= 1) {
    const required = count * MIN_PANEL_COLUMN_WIDTH
    if (required <= renderedWidth) return count
  }
  return 0
}
