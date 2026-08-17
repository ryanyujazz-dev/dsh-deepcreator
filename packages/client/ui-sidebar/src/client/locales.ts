/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'skills': '技能',
  'skills.placeholder.label': '技能（即将推出）',
  'scheduledTasks': '定时任务',
  'scheduledTasks.placeholder.label': '定时任务（即将推出）',
  'primary.aria': '主要操作',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'skills': 'Skills',
  'skills.placeholder.label': 'Skills (coming soon)',
  'scheduledTasks': 'Scheduled Tasks',
  'scheduledTasks.placeholder.label': 'Scheduled tasks (coming soon)',
  'primary.aria': 'Primary actions',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
