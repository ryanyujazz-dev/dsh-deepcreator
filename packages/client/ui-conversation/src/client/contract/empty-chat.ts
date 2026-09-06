/** Empty Chat target used before a view builder registers anything. */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

// Vendored from @deepseek-ai/dsh-client-ui-chat 0.1.2 (contract/snapshot.js):
// the session standard 'chat' hook must never hand components an absent
// snapshot, and this package cannot value-import the loader-format official
// /client entry (invisible to static bundling — see packages/AGENTS.md).

const EMPTY_LIST: readonly never[] = []

const EMPTY_NODE_SOURCE = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

const EMPTY_NODE_PROCESS_SOURCE = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

const EMPTY_TIMELINE = {
  turnOrder: EMPTY_LIST,
  turns: new Map(),
}

export const EMPTY_CHAT_SNAPSHOT: ChatSnapshot = {
  order: EMPTY_LIST,
  nodes: {
    get: () => undefined,
    source: () => EMPTY_NODE_SOURCE,
    processSource: () => EMPTY_NODE_PROCESS_SOURCE,
    values: () => EMPTY_LIST,
  },
  locations: {
    getTurn: () => EMPTY_LIST,
    getStep: () => EMPTY_LIST,
  },
  navigation: { items: () => EMPTY_LIST },
  timeline: EMPTY_TIMELINE,
  legacy: {
    nodes: EMPTY_LIST,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: EMPTY_LIST,
  },
} as unknown as ChatSnapshot
