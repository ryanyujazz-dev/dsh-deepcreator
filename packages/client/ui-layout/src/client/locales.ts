/** Layout-owned copy: the stage-mode segmented control. */
export const en = {
  'stage-mode.switcher': 'Stage mode',
  'stage-mode.conversation': 'Chat',
  'stage-mode.apps': 'Apps',
  'stage-mode.activity': 'AI is operating {name}',
} as const

export const zh = {
  'stage-mode.switcher': '舞台模式',
  'stage-mode.conversation': '对话',
  'stage-mode.apps': '应用',
  'stage-mode.activity': 'AI 正在操作 {name}',
} as const

export type LayoutKey = keyof typeof en
