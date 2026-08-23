export const NS = 'workbench-tools' as const
export const zh = {
  'review': '审查', 'terminal': '终端',
  'loading': '正在加载…', 'refresh': '刷新',
  'review.title': '工作区', 'review.unavailable': 'Review Remote 尚未连接。', 'review.files': '变更文件', 'review.select': '选择文件查看 diff', 'review.clean': '该范围没有变更', 'review.loadFailed': '无法加载该审查范围', 'review.checks.clean': '检查通过', 'review.checks.failed': '检查有问题', 'review.layer.staged': '已暂存 · HEAD → Index', 'review.layer.working': '未暂存 · Index → Worktree', 'review.layer.uncommitted': '未提交 · HEAD → Worktree', 'review.layer.turn': '历史轮次', 'review.binary': '二进制文件已变更', 'review.missedFile': '该文件不在当前变更中：', 'review.refold': '收起展开行', 'review.expandAll': '全部展开', 'review.collapseAll': '全部收起',
  'review.summaryWarning': '变更统计暂不可用', 'review.repository.breadcrumb': '仓库位置', 'review.repository.root': '工作区',
  'review.presentation.text': '文本文件已变更', 'review.presentation.binary': '二进制文件已变更', 'review.presentation.rename': '文件已重命名', 'review.presentation.mode': '文件模式已变更', 'review.presentation.empty': '空文件已变更', 'review.presentation.repository': '嵌套仓库，点击进入', 'review.presentation.submodule': 'Git 子模块，点击进入', 'review.presentation.unknown': '该文件包含非文本变更',
  'review.scope.choose': '选择审查范围', 'review.scope.unstaged': '未暂存', 'review.scope.staged': '已暂存', 'review.scope.uncommitted': '未提交', 'review.scope.current': '当前轮次', 'review.scope.history': '历史轮次', 'review.scope.turn': '第 {turn} 轮', 'review.scope.turn.current': '第 {turn} 轮 · 进行中',
  'turnCard.files': '变更 {count} 个文件', 'turnCard.remaining': '剩余 {count} 个', 'turnCard.undo': '撤销', 'turnCard.review': '审查', 'turnCard.undoUnavailable': '只能撤销最新一个仍有变更的轮次', 'turnCard.undoTitle': '撤销本轮变更？', 'turnCard.undoDescription': '将安全撤销本轮剩余的 {count} 个文件；有冲突时不会写入任何内容。', 'turnCard.cancel': '取消', 'turnCard.confirmUndo': '确认撤销', 'turnCard.undoing': '正在撤销…', 'turnCard.state.committed': '已提交', 'turnCard.state.reverted': '已撤销', 'turnCard.state.mixed': '已解决', 'turnCard.state.active': '待处理',
  'turnCard.undoCrossRepository': '跨仓库轮次暂不支持撤销',
  'terminal.unavailable': 'Terminal Remote 尚未连接，或当前会话不是可寻址的普通 Agent。',
  'terminal.new': '新建', 'terminal.legacy': '这是旧的逐行终端会话；请新建终端以使用完整交互模式。', 'terminal.noBackend': '没有可用的终端后端。', 'terminal.empty.title': '暂无打开的终端', 'terminal.empty.body': '使用标题栏的加号新建终端。',
} as const
export type ToolsKey = keyof typeof zh
export const en: Record<ToolsKey, string> = {

  'review.title':'Working tree','review.unavailable':'The Review Remote is disconnected.','review.files':'Changed files','review.select':'Select a file to inspect its diff','review.clean':'No changes in this scope','review.loadFailed':'Unable to load this review scope','review.checks.clean':'Checks clean','review.checks.failed':'Check issues','review.layer.staged':'Staged · HEAD → Index','review.layer.working':'Unstaged · Index → Worktree','review.layer.uncommitted':'Uncommitted · HEAD → Worktree','review.layer.turn':'Historical turn','review.binary':'Binary file changed','review.missedFile':'This file is not in the current changes:','review.refold':'Re-fold expanded lines','review.expandAll':'Expand all','review.collapseAll':'Collapse all',
  'review.summaryWarning':'Change statistics unavailable','review.repository.breadcrumb':'Repository location','review.repository.root':'Workspace','review.presentation.text':'Text file changed','review.presentation.binary':'Binary file changed','review.presentation.rename':'File renamed','review.presentation.mode':'File mode changed','review.presentation.empty':'Empty file changed','review.presentation.repository':'Nested repository; open to review','review.presentation.submodule':'Git submodule; open to review','review.presentation.unknown':'This file contains a non-text change',
  'review.scope.choose':'Choose review scope','review.scope.unstaged':'Unstaged','review.scope.staged':'Staged','review.scope.uncommitted':'Uncommitted','review.scope.current':'Current turn','review.scope.history':'Historical turns','review.scope.turn':'TURN {turn}','review.scope.turn.current':'TURN {turn} · In progress',
  'turnCard.files':'Changed {count} files','turnCard.remaining':'{count} remaining','turnCard.undo':'Undo','turnCard.review':'Review','turnCard.undoUnavailable':'Only the latest unresolved turn can be undone','turnCard.undoTitle':'Undo this turn?','turnCard.undoDescription':'Safely undo the {count} remaining files from this turn. Nothing is written if a conflict is found.','turnCard.cancel':'Cancel','turnCard.confirmUndo':'Undo changes','turnCard.undoing':'Undoing…','turnCard.state.committed':'Committed','turnCard.state.reverted':'Undone','turnCard.state.mixed':'Resolved','turnCard.state.active':'Pending',
  'turnCard.undoCrossRepository':'Cross-repository turns cannot be undone yet',
  'review':'Review','terminal':'Terminal',
  'loading':'Loading…','refresh':'Refresh',

  'terminal.unavailable':'The Terminal Remote is disconnected, or this is not an addressable ordinary Agent.',
  'terminal.new':'New','terminal.legacy':'This is a legacy line terminal. Create a new terminal for full interaction.','terminal.noBackend':'No terminal backend is available.','terminal.empty.title':'No terminal open','terminal.empty.body':'Use the plus button in the Header to create one.',
}
