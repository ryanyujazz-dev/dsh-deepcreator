export const NS = 'workbench-activity' as const
export const zh = {
  'type': '活动',
  'empty.title': '暂无活动', 'empty.body': 'Agent 启动的后台任务与子代理会实时显示在这里。',
  'running': '运行中', 'stopping': '正在停止', 'completed': '已完成', 'killed': '已取消', 'failed': '失败',
  'section.live': '正在运行', 'section.finished': '已结束', 'section.subagents': '子代理',
  'subagent.idle': '空闲', 'subagent.running': '运行中',
  'subagent.mode.continuable': '可延续', 'subagent.mode.one-shot': '一次性',
  'subagent.open': '在对话区打开',
  'subagent.turn': '本轮参与', 'subagent.earlier': '更早',
  'subagent.closeConversation': '从对话区关闭',
  'subagent.empty': '本会话还没有子代理。',
  'subagent.gone': '该子代理不在当前目录中,可能已被移除。',
  'events.error': '读取执行流失败:{code}',
  'stop': '停止', 'stop.stopping': '停止中', 'stop.failed': '停止失败:{code}',
  'duration.hours': '{hours}时{minutes}分', 'duration.minutes': '{minutes}分{seconds}秒', 'duration.seconds': '{seconds}秒',
} as const
export type ActivityKey = keyof typeof zh
export const en: Record<ActivityKey, string> = {
  'type': 'Activity',
  'empty.title': 'Nothing running', 'empty.body': 'Background tasks and subagents started by the agent appear here in real time.',
  'running': 'Running', 'stopping': 'Stopping', 'completed': 'Completed', 'killed': 'Cancelled', 'failed': 'Failed',
  'section.live': 'Running', 'section.finished': 'Finished', 'section.subagents': 'Subagents',
  'subagent.idle': 'Idle', 'subagent.running': 'Running',
  'subagent.mode.continuable': 'Continuable', 'subagent.mode.one-shot': 'One-shot',
  'subagent.open': 'Open in conversation',
  'subagent.turn': 'This turn', 'subagent.earlier': 'Earlier',
  'subagent.closeConversation': 'Close from conversation',
  'subagent.empty': 'No subagents for this session yet.',
  'subagent.gone': 'This subagent is no longer in the catalog; it may have been removed.',
  'events.error': 'Failed to read the execution stream: {code}',
  'stop': 'Stop', 'stop.stopping': 'Stopping', 'stop.failed': 'Stop failed: {code}',
  'duration.hours': '{hours}h {minutes}m', 'duration.minutes': '{minutes}m {seconds}s', 'duration.seconds': '{seconds}s',
}
