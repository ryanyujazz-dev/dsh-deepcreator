export const NS = 'workbench-tools' as const
export const zh = {
  'review': '审查', 'terminal': '终端', 'browser': '预览',
  'loading': '正在加载…', 'refresh': '刷新',
  'review.title': 'Working tree', 'review.unavailable': 'Review Remote 尚未连接。连接后这里会显示只读 status、文件 diff 与 checks。', 'review.files': '变更文件', 'review.select': '选择文件查看 diff', 'review.clean': 'Working tree 没有变更', 'review.checks.clean': '检查通过', 'review.checks.failed': '检查有问题', 'review.layer.staged': '已暂存 · HEAD → Index', 'review.layer.working': '工作区 · Index → Worktree', 'review.binary': '二进制文件已变更', 'review.missedFile': '该文件不在当前变更中：', 'review.expandAll': '全部展开', 'review.collapseAll': '全部收起',
  'terminal.unavailable': 'Terminal Remote 尚未连接，或当前会话不是可寻址的普通 Agent。',
  'terminal.new': '新建', 'terminal.legacy': '这是旧的逐行终端会话；请新建终端以使用完整交互模式。', 'terminal.noBackend': '没有可用的终端后端。', 'terminal.empty.title': '暂无打开的终端', 'terminal.empty.body': '使用标题栏的加号新建终端。',
  'browser.prompt': '输入本地开发地址', 'browser.open': '打开', 'browser.invalid': '只允许 localhost / loopback 的 HTTP(S) 地址。',
  'browser.external': '在外部浏览器打开', 'browser.frameError': '页面拒绝嵌入。可以改用外部浏览器打开。',
} as const
export type ToolsKey = keyof typeof zh
export const en: Record<ToolsKey, string> = {

  'review.title':'Working tree','review.unavailable':'The Review Remote is disconnected. Read-only status, file diffs and checks will appear here when connected.','review.files':'Changed files','review.select':'Select a file to inspect its diff','review.clean':'No working tree changes','review.checks.clean':'Checks clean','review.checks.failed':'Check issues','review.layer.staged':'Staged · HEAD → Index','review.layer.working':'Working tree · Index → Worktree','review.binary':'Binary file changed','review.missedFile':'This file is not in the current changes:','review.expandAll':'Expand all','review.collapseAll':'Collapse all',
  'review':'Review','terminal':'Terminal','browser':'Preview',
  'loading':'Loading…','refresh':'Refresh',

  'terminal.unavailable':'The Terminal Remote is disconnected, or this is not an addressable ordinary Agent.',
  'terminal.new':'New','terminal.legacy':'This is a legacy line terminal. Create a new terminal for full interaction.','terminal.noBackend':'No terminal backend is available.','terminal.empty.title':'No terminal open','terminal.empty.body':'Use the plus button in the Header to create one.',
  'browser.prompt':'Enter a local development URL','browser.open':'Open','browser.invalid':'Only HTTP(S) localhost / loopback URLs are allowed.','browser.external':'Open in external browser','browser.frameError':'The page refused to be embedded. Open it in an external browser instead.',
}
