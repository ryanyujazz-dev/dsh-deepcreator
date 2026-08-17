import { describe, expect, it } from 'vitest'
import {
  MIN_CONVERSATION_WIDTH, MIN_PANEL_COLUMN_WIDTH, SPLITTER_SIZE,
  initialWorkbenchWidth, oddTrackWorkbenchWidth, visibleTrackCount,
} from '../src/client/layout.ts'

describe('Workbench deterministic width rules', () => {
  it('uses one third or one half of Stage for the first type', () => {
    expect(initialWorkbenchWidth(1200, 1 / 3)).toBe(400)
    expect(initialWorkbenchWidth(1200, 1 / 2)).toBe(600)
  })

  it('uses one half for two columns and two thirds for three columns', () => {
    expect(oddTrackWorkbenchWidth(1200, 2)).toBe(600)
    expect(oddTrackWorkbenchWidth(1200, 3)).toBe(800)
  })

  it('protects the 360px Conversation floor', () => {
    expect(MIN_CONVERSATION_WIDTH).toBe(360)
    expect(oddTrackWorkbenchWidth(500, 3)).toBe(MIN_PANEL_COLUMN_WIDTH)
  })
})

describe('Workbench responsive columns', () => {
  it('removes whole columns from right to left at the 150px floor', () => {
    const three = 3 * MIN_PANEL_COLUMN_WIDTH + 2 * SPLITTER_SIZE
    const two = 2 * MIN_PANEL_COLUMN_WIDTH + SPLITTER_SIZE
    expect(visibleTrackCount(3, three)).toBe(3)
    expect(visibleTrackCount(3, three - 1)).toBe(2)
    expect(visibleTrackCount(3, two)).toBe(2)
    expect(visibleTrackCount(3, two - 1)).toBe(1)
    expect(visibleTrackCount(3, MIN_PANEL_COLUMN_WIDTH - 1)).toBe(0)
  })
})
