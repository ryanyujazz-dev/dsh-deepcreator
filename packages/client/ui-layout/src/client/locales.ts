/** Layout-owned copy: the stage-mode segmented control. */
export const en = {
  'stage-mode.switcher': 'Stage mode',
  'stage-mode.conversation': 'Chat',
  'stage-mode.apps': 'Apps',
} as const

export const zh = {
  'stage-mode.switcher': '舞台模式',
  'stage-mode.conversation': '对话',
  'stage-mode.apps': '应用',
} as const

export type LayoutKey = keyof typeof en
