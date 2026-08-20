# Workbench 工具面板

注册「审查」「终端」与「预览」三种面板；预览面板内部仍使用稳定的 `browser` type id。Browser Web 只允许 sandboxed loopback HTTP(S) 预览；Review 与 Terminal 只读取已组合的 Host Remote，不伪造业务状态，也不暗示不存在的 Diff 变更能力。产物面板类型已迁移到 `@ryanyujazz/dsh-client-ui-workbench-artifact`，由其持有 `artifact` type id 与会话事件投影。

Provider 视图只渲染 Body 内容。刷新、Terminal 控制和新建 Tab 操作都贡献到公共 Workbench Panel Header；Review 状态与 Preview URL 输入属于内容，不得形成第二层副标题工具栏。

Review 内容区是单一纵向滚动、可折叠的文件列表，不再使用文件导航／Diff 左右分栏。首个文件初始展开；其余文件只有在用户展开时才读取 Diff，已读取结果在面板生命周期内保留。每个文件 Header 包含 rename 路径与准确计数，在同一个滚动容器顶部吸附，并由到达顶部的下一个文件 Header 自然顶替。展开内容继续明确区分 staged 与 working-tree，多个上下文 hunk 复用带语法高亮的公共 Diff 原语；二进制变更使用明确的非代码状态。Review 的基础表面始终跟随 Workbench 应用自身的浅色／深色 shell；第三方代码主题只贡献语法色与 Diff 高亮，不得改变 Review 画布底色。Review 始终只读。

Terminal Body 使用内嵌 xterm emulator，并连接到受 Agent fence 保护的 `system` PTY Remote。键盘数据按顺序作为 raw input 发送；ANSI 输出通过单调 cursor 增量消费；`ResizeObserver` 与 Fit addon 让 PTY 行列数跟随 Panel。隐藏 Group 只改变可见性，不终止 PTY。旧的逐行终端仍可列出和关闭，但界面会提示新建交互式终端。

Terminal Group 首次初始化时会自动打开一个标签：优先恢复当前 Session 仍在运行的终端，否则创建一个 `system` PTY。初始化按 Session 防重，因此用户明确关闭最后一个标签后不会立刻生成替代终端；Header 加号只用于创建额外终端。Terminal 不提供管理 Home、返回、SIGINT 或独立终止按钮；没有标签时正文只显示空态。关闭 Terminal 标签会直接终止对应 PTY，不显示确认弹窗；隐藏 Terminal Group 会保留所有标签和进程。Tab 标签以每个 PTY 工作目录的项目文件夹命名（重名追加序号；无 cwd 的会话回退到 shell 名称、再到会话 id），Group 的可访问标题携带活动 PTY 的 shell 程序名后缀，均通过 `contributePanelInfo()` 提交。
