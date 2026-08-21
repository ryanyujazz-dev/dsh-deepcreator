# Workbench 工具面板

注册「审查」「终端」与「预览」三种面板；预览面板内部仍使用稳定的 `browser` type id。Browser Web 只允许 sandboxed loopback HTTP(S) 预览；Review 与 Terminal 只使用已组合的 Host Remote，不伪造业务状态。Review 唯一写操作是 Host 保护的最新 Turn 撤销，不提供暂存或提交能力。产物面板类型已迁移到 `@ryanyujazz/dsh-client-ui-workbench-artifact`。

Provider 视图只渲染 Body 内容。刷新、Terminal 控制和新建 Tab 操作都贡献到公共 Workbench Panel Header；Review 状态与 Preview URL 输入属于内容，不得形成第二层副标题工具栏。

Review 标题旁的范围菜单在 Git 工作区提供「未暂存」「已暂存」「未提交」，随后按需显示「当前轮次」与「历史轮次」两个小标题；非 Git 工作区只显示这两个 Turn 分组，并缺省选择最新的当前／历史轮次。轮次按新到旧排列，中文选择器值只显示「第 N 轮」，英文只显示「TURN N」。内容区是单一纵向滚动、可折叠文件列表；文件头不显示 `M` 等 Git 状态字母。范围与文件定位通过 Workbench presentation 的 `{ scope, turn, path }` 参数传递，工具变更文件可直接切入所属轮次、全量展开并滚动聚焦。Review 的基础表面始终跟随 Workbench shell；第三方代码主题只贡献语法色与 Diff 高亮，不改变画布底色。

每会话一个 `ReviewCacheController` 同时服务 Review 与对话尾部变更卡。变更卡注册到 `deepcreator.conversation.chat.turnChanges`，固定排在官方产物 selector chain 之后；它与产物卡共用 `ConversationFileCard` chrome，但不合并文件或导航。Review 的任何打开、reveal 或范围切换入口都必须全量展开当前范围的全部文件；仍有待处理文件的 Turn 卡片显示总 `+N -N`，点击主区在对话内展开带逐文件计数的清单，「审查」打开所属 Turn，具体 mutation／清单文件会在全量展开所属 Turn 后立即挂载并滚动聚焦目标文件。缺失或仍在落盘的轮次元数据不能作为“文件已解决”的依据：这类点击仍进入 Review，非 Git 工作区也一样；只有明确提交／撤销的文件才打开 Artifact。Git 工作区的对话 Header Review 入口固定打开「未暂存」。旧 Host 返回的活跃历史若缺少计数，Controller 会通过对应 Turn Diff 后台补算并缓存，不把未知值显示成 `0/0`。当轮内已全部提交时不生成卡片；外部提交核对完成后，该历史轮次和卡片一起消失，若正在查看该轮则同步清空 Diff/源码缓存并返回「未提交」。只有最新未解决的 Git Turn 可撤销；撤销先经确认 Modal，失败使用公共 Toast。页面可见时约两秒轻量刷新历史与外部 HEAD 状态。

「未暂存」与「历史轮次」是不同 Diff 基线：前者为 Index → Worktree，后者为 Turn start → end；同一文件在两个范围中的增删内容和计数可以不同，这不是渲染缓存复用。隐藏面板重新打开时，可见性兜底刷新必须先于显式 presentation 执行，确保入口指定的范围刷新最终胜出并驱动全量展开。

Review 使用带“已准备滚动边界”的视口驱动连续列表。面板隐藏时 Controller 只刷新元信息与历史；显示后独立请求范围 `summary`，空闲预热顶部 6 个正文，并让文件定位、近视口、空闲预热共用并发为 1 的三级队列。初始滚动范围只包含这 6 个文件；接近边界的“正在加载”行后，先在 DOM 外顺序获取约 2 屏数据，再逐帧隐形挂载对应重型正文，只有数据和正文都就绪才一次性延长滚动范围，因此滚动条不会进入半加载区域。从特定文件定位时以该文件建立单文件窗口，上下两个边界分别沿用相同的约 2 屏解锁逻辑。文件仍保持逻辑全展开；驻留正文离开约 3 屏后延迟 500ms 卸载，并保留宽度档位实测高度、受控折叠状态和滚动补偿。驻留／聚焦／交互中的正文不受 16 个正文软上限强制移除。原始 patch／源码与 Shiki token 分别受约 32 MiB 加权 LRU 约束；单文件完成只通知该路径与总计，结构未变的两秒历史轮询不发布快照。

Terminal Body 使用内嵌 xterm emulator，并连接到受 Agent fence 保护的 `system` PTY Remote。键盘数据按顺序作为 raw input 发送；ANSI 输出通过单调 cursor 增量消费；`ResizeObserver` 与 Fit addon 让 PTY 行列数跟随 Panel。隐藏 Group 只改变可见性，不终止 PTY。旧的逐行终端仍可列出和关闭，但界面会提示新建交互式终端。

Terminal Group 首次初始化时会自动打开一个标签：优先恢复当前 Session 仍在运行的终端，否则创建一个 `system` PTY。初始化按 Session 防重，因此用户明确关闭最后一个标签后不会立刻生成替代终端；Header 加号只用于创建额外终端。Terminal 不提供管理 Home、返回、SIGINT 或独立终止按钮；没有标签时正文只显示空态。关闭 Terminal 标签会直接终止对应 PTY，不显示确认弹窗；隐藏 Terminal Group 会保留所有标签和进程。Tab 标签以每个 PTY 工作目录的项目文件夹命名（重名追加序号；无 cwd 的会话回退到 shell 名称、再到会话 id），Group 的可访问标题携带活动 PTY 的 shell 程序名后缀，均通过 `contributePanelInfo()` 提交。
