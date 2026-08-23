# Workbench 工具面板

注册「审查」与「终端」面板。Browser 呈现由独立的 `@ryanyujazz/dsh-client-ui-browser` 负责，产物面板由 `@ryanyujazz/dsh-client-ui-workbench-artifact` 负责；Review 与 Terminal 只使用已组合的 Host Remote。

Provider 视图只渲染 Body 内容。刷新与 Terminal 新建 Tab 操作贡献到公共 Workbench Panel Header。

Review 标题旁的范围菜单在 Git 工作区提供「未暂存」「已暂存」「未提交」，随后按需显示「当前轮次」与「历史轮次」两个小标题；非 Git 工作区只显示这两个 Turn 分组，并缺省选择最新的当前／历史轮次。轮次按新到旧排列，中文选择器值只显示「第 N 轮」，英文只显示「TURN N」。内容区是单一纵向滚动、可折叠文件列表；文件头不显示 `M` 等 Git 状态字母。范围与文件定位通过 Workbench presentation 的 `{ scope, turn, path, repository }` 参数传递。Git 范围中的嵌套仓库与 submodule 保持原子文件行；点击后在同一个 Review 面板下钻，显示可返回面包屑，返回时恢复上层范围、展开态、缓存与滚动位置。根层 Turn 显示完整工作区文件，子仓库层的 Turn 菜单只保留该仓库涉及的轮次。Review 的基础表面始终跟随 Workbench shell；第三方代码主题只贡献语法色与 Diff 高亮，不改变画布底色。

每会话一个 `ReviewCacheController` 同时服务 Review 与对话尾部变更卡。变更卡注册到 `deepcreator.conversation.chat.turnChanges`，固定排在官方产物 selector chain 之后；它与产物卡共用 `ConversationFileCard` chrome，但不合并文件或导航。图片、PDF、DOC 与 DOCX 输出不再出现在对话变更卡中（Host 分类尚未稳定时使用扩展名兜底），因为它们已经属于产物卡；Review 仍保留这些文件作为提交核对与撤销所需的仓库事实。Review 的任何打开、reveal 或范围切换入口都必须全量展开当前范围的全部文件；仍有待处理文件的 Turn 卡片显示总 `+N -N`，点击主区在对话内展开带逐文件计数的清单，「审查」打开所属 Turn，具体 mutation／清单文件会在全量展开所属 Turn 后立即挂载并滚动聚焦目标文件。缺失或仍在落盘的轮次元数据不能作为“文件已解决”的依据。只有 Host 标记 `lineStatsState=available` 才显示行数；二进制、空文件、纯重命名、权限变化、嵌套仓库与 submodule 使用明确本地化说明，绝不显示 `+0 -0`。真实 summary 失败显示非阻塞警告，文件清单与逐文件 Diff 仍可用；只有明确的旧 Host 缺方法错误静默兼容。跨仓库 Turn 保留完整卡片和逐仓库提交核对，但撤销按钮置灰并说明原因。外部提交核对完成后，该历史轮次和卡片一起消失，若正在查看该轮则同步清空 Diff/源码缓存并返回「未提交」。

「未暂存」与「历史轮次」是不同 Diff 基线：前者为 Index → Worktree，后者为 Turn start → end；同一文件在两个范围中的增删内容和计数可以不同，这不是渲染缓存复用。隐藏面板重新打开时，可见性兜底刷新必须先于显式 presentation 执行，确保入口指定的范围刷新最终胜出并驱动全量展开。

Controller 优先使用 `manifest/patches/source/probe`，连接旧 Host 时自动回退。官方 mutation 与 Turn 事件驱动刷新；精确 write/edit 即使在 Review 隐藏时也会刷新并预热受影响路径。面板可见时每两秒只调用纯内存 probe，隐藏时零周期 RPC。generation、请求所有权与本地 sequence 会丢弃范围／仓库／视口快速切换后的晚到结果。焦点、真实视口和滚动方向 overscan 使用独立 patch 优先级；路径离开 resident 集合后会取消排队任务并释放未决请求所有权，因此滚动条跳转不再等待旧屏。初始响应与 raw cache 不包含完整新旧源码，点击省略上下文 FoldRow 时才懒读当前文件的一侧源码。文件列表使用 `@tanstack/react-virtual`，以“仓库／范围／路径”联合 key、保守折叠估高、动态测量、overscan 和滚动锚定只挂载视口附近 section；「全部展开」仅代表逻辑展开。展开态或仓库／范围变化时，会在绘制前重置离屏估算并同步复测有界的已挂载窗口。Review Adapter 另行持有可释放的行 border-box observer，覆盖滚动容器与首批行同 commit 挂载时 TanStack 在 `targetWindow` 建立前先缓存节点、因而漏挂内部 observer 的竞态；异步 patch 长高后会把真实高度写回 `resizeItem`，不再让后续行停在 108px 加载估算上重叠。unified patch 在 controller 私有 Worker 中解析；已挂载 hunk 先显示纯文本，再按预算在 idle 队列补语法色。500／2000 文件夹具会同时约束挂载 section 数与 patch RPC 规模只随视口增长。

Terminal Body 使用内嵌 xterm emulator，并连接到受 Agent fence 保护的 `system` PTY Remote。键盘数据按顺序作为 raw input 发送；ANSI 输出通过单调 cursor 增量消费；`ResizeObserver` 与 Fit addon 让 PTY 行列数跟随 Panel。隐藏 Group 只改变可见性，不终止 PTY。旧的逐行终端仍可列出和关闭，但界面会提示新建交互式终端。

Terminal Group 首次初始化时会自动打开一个标签：优先恢复当前 Session 仍在运行的终端，否则创建一个 `system` PTY。初始化按 Session 防重，因此用户明确关闭最后一个标签后不会立刻生成替代终端；Header 加号只用于创建额外终端。Terminal 不提供管理 Home、返回、SIGINT 或独立终止按钮；没有标签时正文只显示空态。关闭 Terminal 标签会直接终止对应 PTY，不显示确认弹窗；隐藏 Terminal Group 会保留所有标签和进程。Tab 标签以每个 PTY 工作目录的项目文件夹命名（重名追加序号；无 cwd 的会话回退到 shell 名称、再到会话 id），Group 的可访问标题携带活动 PTY 的 shell 程序名后缀，均通过 `contributePanelInfo()` 提交。
