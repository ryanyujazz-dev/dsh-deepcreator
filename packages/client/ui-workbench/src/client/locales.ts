export const NS = 'workbench' as const

export const zh = {
  'panels': '面板',
  'open': '打开{type}面板',
  'hide': '隐藏{type}面板',
  'back': '返回{type}管理页',
  'focus': '展开面板',
  'restore': '收起面板',
  'closeGroup': '隐藏{type}面板',
  'closeTab': '关闭{tab}',
  'switchParked': '切换到{type}面板',
  'disconnected': '该面板 Provider 当前未连接',
  'empty': '选择一个面板类型开始',
} as const

export type WorkbenchKey = keyof typeof zh

export const en: Record<WorkbenchKey, string> = {
  'panels': 'Panels',
  'open': 'Open {type} panel',
  'hide': 'Hide {type} panel',
  'back': 'Back to {type} home',
  'focus': 'Focus panel',
  'restore': 'Collapse panel',
  'closeGroup': 'Hide {type} panel',
  'closeTab': 'Close {tab}',
  'switchParked': 'Switch to {type} panel',
  'disconnected': 'This panel provider is disconnected',
  'empty': 'Choose a panel type to begin',
}
