export const NS = 'workbench-activity' as const
export const zh = {
  'type': '活动', 'empty.title': '暂无后台任务', 'empty.body': 'Agent 启动的任务会实时显示在这里。',
  'running': '运行中', 'stopping': '正在停止', 'completed': '已完成', 'killed': '已取消', 'failed': '失败',
  'finished': '已完成 {count}', 'live': '进行中 {count}',
} as const
export type ActivityKey = keyof typeof zh
export const en: Record<ActivityKey, string> = {
  'type': 'Activity', 'empty.title': 'No background tasks', 'empty.body': 'Tasks started by the agent will appear here in real time.',
  'running': 'Running', 'stopping': 'Stopping', 'completed': 'Completed', 'killed': 'Cancelled', 'failed': 'Failed',
  'finished': 'Finished {count}', 'live': 'Running {count}',
}
