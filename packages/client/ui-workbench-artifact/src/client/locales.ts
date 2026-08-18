export const NS = 'workbench-artifact' as const
export const zh = {
  'type': '产物',
  'empty.title': '暂无产物',
  'empty.body': '模型写入或编辑的文件会实时出现在这里。',
  'loading': '正在加载…',
  'refresh': '刷新',
} as const
export type ArtifactKey = keyof typeof zh
export const en: Record<ArtifactKey, string> = {
  'type': 'Artifacts',
  'empty.title': 'No artifacts yet',
  'empty.body': 'Files the model writes or edits appear here in real time.',
  'loading': 'Loading…',
  'refresh': 'Refresh',
}
