/** `subagent` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'subagent'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'readonly.oneShot.title': '一次性子代理记录',
  'readonly.title': '此子代理暂时只读',
  'readonly.oneShot.body': '一次性任务不支持后续消息，可在这里查看完整执行记录。',
  'readonly.body': '父会话当前不在线，重新打开父会话后即可继续发送消息。',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SubagentKey, string> = {
  'readonly.oneShot.title': 'One-shot subagent record',
  'readonly.title': 'This subagent is read-only for now',
  'readonly.oneShot.body': 'One-shot tasks do not accept follow-ups; review the full execution record here.',
  'readonly.body': 'The parent session is offline; reopen it to continue sending messages.',
}

/** Key domain of the `subagent` namespace (zh is the source of truth). */
export type SubagentKey = keyof typeof zh
