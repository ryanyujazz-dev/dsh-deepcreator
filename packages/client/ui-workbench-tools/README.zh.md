# Workbench 工具面板

注册「审查」「终端」与「预览」三种面板；预览面板内部仍使用稳定的 `browser` type id。Browser Web 只允许 sandboxed loopback HTTP(S) 预览；Review 与 Terminal 只使用已组合的 Host Remote，不伪造业务状态。Review 唯一写操作是 Host 保护的最新 Turn 撤销，不提供暂存或提交能力。产物面板类型已迁移到 `@ryanyujazz/dsh-client-ui-workbench-artifact`。

Provider 视图只渲染 Body 内容。刷新、Terminal 控制和新建 Tab 操作都贡献到公共 Workbench Panel Header；Review 状态与 Preview URL 输入属于内容，不得形成第二层副标题工具栏。

Review 标题旁的范围菜单固定提供「未暂存」「已暂存」「未提交」和仍有待处理文件的「历史轮次 · TURN N」，首次打开缺省为「未提交」。内容区是单一纵向滚动、可折叠文件列表；文件头不显示 `M` 等 Git 状态字母。范围与文件定位通过 Workbench presentation 的 `{ scope, turn, path }` 参数传递，历史文件可直接展开并滚动聚焦。Review 的基础表面始终跟随 Workbench shell；第三方代码主题只贡献语法色与 Diff 高亮，不改变画布底色。

每会话一个 `ReviewCacheController` 同时服务 Review 与对话尾部变更卡。非零变更 Turn 显示文件数、剩余数、撤销和审查；全部提交或撤销后卡片变灰，只有最新未解决 Turn 可撤销。撤销先经确认 Modal，失败使用公共 Toast。未解决 mutation 文件打开所属 Turn Diff，已解决文件打开 Artifact 完整文件。页面可见时约两秒轻量刷新历史与外部 HEAD 状态。

Terminal Body 使用内嵌 xterm emulator，并连接到受 Agent fence 保护的 `system` PTY Remote。键盘数据按顺序作为 raw input 发送；ANSI 输出通过单调 cursor 增量消费；`ResizeObserver` 与 Fit addon 让 PTY 行列数跟随 Panel。隐藏 Group 只改变可见性，不终止 PTY。旧的逐行终端仍可列出和关闭，但界面会提示新建交互式终端。

Terminal Group 首次初始化时会自动打开一个标签：优先恢复当前 Session 仍在运行的终端，否则创建一个 `system` PTY。初始化按 Session 防重，因此用户明确关闭最后一个标签后不会立刻生成替代终端；Header 加号只用于创建额外终端。Terminal 不提供管理 Home、返回、SIGINT 或独立终止按钮；没有标签时正文只显示空态。关闭 Terminal 标签会直接终止对应 PTY，不显示确认弹窗；隐藏 Terminal Group 会保留所有标签和进程。Tab 标签以每个 PTY 工作目录的项目文件夹命名（重名追加序号；无 cwd 的会话回退到 shell 名称、再到会话 id），Group 的可访问标题携带活动 PTY 的 shell 程序名后缀，均通过 `contributePanelInfo()` 提交。
