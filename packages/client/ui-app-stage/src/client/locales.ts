/**
 * App Stage shell dictionaries. Copy follows the OS metaphor's plain tone:
 * the desktop is a place, entries speak in product names, and abnormal
 * entries always say what to do next.
 */
export const en = {
  'stage.title': 'Apps',
  'dock.toggle.open': 'Open conversation dock',
  'dock.toggle.close': 'Close conversation dock',
  'dev.menu': 'In development',
  'dev.menu.count': 'In development ({count})',
  'dev.empty': 'No apps in development in this workspace yet. Place an app directory under .deepcreator/apps/ to see it here.',
  'dev.no-session': 'Open a session in a workspace to see its in-development apps.',
  'dev.open': 'Open {name}',
  'dev.conflict': 'An installed app shares this id',
  'dev.reason': '{code}: {detail}',
  'launcher.empty': 'Your desktop is empty. Apps you publish from a session will land here.',
  'launcher.open': 'Open {name}',
  'launcher.updated': 'Updated',
  'launcher.source': 'from {workspace}',
  'launcher.remove': 'Remove {name}',
  'launcher.remove.confirm': 'Remove {name}? Its snapshot, assets, and data are deleted.',
  'launcher.removed': '{name} removed.',
  'container.back': 'Back to desktop',
  'container.dev-badge': 'dev v{version}',
  'container.loading': 'Opening {name}…',
  'container.failed': 'Could not open {name}: {message}',
} as const

export type AppStageKey = keyof typeof en

/** 中文文案与英文键一一对应。 */
export const zh: Record<AppStageKey, string> = {
  'stage.title': '应用',
  'dock.toggle.open': '打开对话坞',
  'dock.toggle.close': '收起对话坞',
  'dev.menu': '开发中',
  'dev.menu.count': '开发中（{count}）',
  'dev.empty': '当前工作区还没有开发中的应用。把应用目录放到 .deepcreator/apps/ 下即可在这里出现。',
  'dev.no-session': '先在工作区打开一个会话，才能看到该工作区开发中的应用。',
  'dev.open': '打开 {name}',
  'dev.conflict': '已安装应用中有同名 id',
  'dev.reason': '{code}：{detail}',
  'launcher.empty': '桌面还是空的。在会话中发布的应用会出现在这里。',
  'launcher.open': '打开 {name}',
  'launcher.updated': '已更新',
  'launcher.source': '来自 {workspace}',
  'launcher.remove': '移除 {name}',
  'launcher.remove.confirm': '移除 {name}？其快照、资产与数据将一并删除。',
  'launcher.removed': '已移除 {name}。',
  'container.back': '返回桌面',
  'container.dev-badge': '开发中 v{version}',
  'container.loading': '正在打开 {name}…',
  'container.failed': '无法打开 {name}：{message}',
}
