# Workbench 工具面板

注册「产物」「审查」「终端」与「预览」四种面板；预览面板内部仍使用稳定的 `browser` type id。Browser Web 只允许 sandboxed loopback HTTP(S) 预览；Artifact、Review 与 Terminal 只读取已组合的 Host Remote，不伪造业务状态，也不暗示不存在的 Diff 变更能力。

Provider 视图只渲染 Body 内容。刷新、Terminal 控制和新建 Tab 操作都贡献到公共 Workbench Panel Header；Artifact 元信息、Review 状态与 Preview URL 输入属于内容，不得形成第二层副标题工具栏。

Terminal Body 使用内嵌 xterm emulator，并连接到受 Agent fence 保护的 `system` PTY Remote。键盘数据按顺序作为 raw input 发送；ANSI 输出通过单调 cursor 增量消费；`ResizeObserver` 与 Fit addon 让 PTY 行列数跟随 Panel。隐藏 Group 只改变可见性，不终止 PTY。旧的逐行终端仍可列出和关闭，但界面会提示新建交互式终端。
