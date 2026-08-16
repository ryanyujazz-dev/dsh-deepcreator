/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '偏好',
  'appearance.color.title': '颜色模式',
  'appearance.color.description': '控制应用界面的明暗外观。',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.interfaceFont.title': '界面字体',
  'appearance.interfaceFont.description': '用于菜单、侧边栏和操作界面。',
  'appearance.interfaceFont.system': '系统字体',
  'appearance.transcript.title': '文字大小',
  'appearance.transcript.description': '调整对话正文、思考内容、代码和侧边栏文字。',
  'appearance.transcript.small': '小',
  'appearance.transcript.standard': '标准',
  'appearance.transcript.large': '大',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Preferences',
  'appearance.color.title': 'Color mode',
  'appearance.color.description': 'Control the light or dark appearance of the interface.',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.interfaceFont.title': 'Interface font',
  'appearance.interfaceFont.description': 'Font for menus, the sidebar, and interface controls.',
  'appearance.interfaceFont.system': 'System font',
  'appearance.transcript.title': 'Text size',
  'appearance.transcript.description': 'Adjust conversation, reasoning, code, and sidebar text.',
  'appearance.transcript.small': 'Small',
  'appearance.transcript.standard': 'Standard',
  'appearance.transcript.large': 'Large',
} satisfies Record<ThemeKey, string>
