# Workbench 活动面板

注册 `activity` Workbench 类型,拥有两条路由:

- **Home** —— 锚定对话宿主会话的单页纵排视图(子代理经「在对话区打开」
  成为当前会话时,按 `currentAddress.parentSessionId` 回锚到父会话,首页
  不随 session 作用域切走)。分区依次为:子代理目录、运行中/已结束后台任务
  (`jobsBySession`,官方两档单位的实时计时,经 `jobs-admin` Host remote
  可停止)。每个任务行都可用指针或键盘进入 Workbench 标签页；实例直接从
  官方 `JobView` 显示未截断的完整命令、ID、类型、实时状态、时长与停止操作。
  它不会调用会推进共享游标的 `ctx.jobs.read()`；输出由 Agent 通过
  `job_output` 读取后显示在公共对话执行流中。子代理按参与度分组:
  **本轮参与**(最近活跃晚于父会话最近一条
  用户消息的子代理,运行中在前、最近活跃在前——可延续子代理被再次调用后
  随新活动冒回顶部)与**更早**,数据来自 `jobs-admin` 的 `subagentOverview`
  时近投影;无数据时退化为单列表(运行中在前)。子代理卡片为无边框内容
  卡片(静息/hover/已开以背景色分层),运行中标题呼吸。正在对话区打开的
  子代理卡片置灰,模式·状态 meta 替换为「从对话区关闭」控件(官方面包屑
  路径 `sessions.open(parent)`);点击卡片仍进入其标签页。
- **Instance** —— 每个子代理或后台任务一个标签页(复用 Workbench 公共
  `WorkbenchPanelTabs`;实例 id 即子会话 id,显示名走
  `contributePanelInfo`;任务 id 使用呈现命名空间 `job:`)。子代理主体挂载显式且不导航的 `SessionProvider`，再以
  `transcriptOnly` 形态调用主对话区已授权的 `conversation.session`
  renderer。因此它首次打开时与主对话区显示相同的完整驻留 Turn 窗口，随后直接共享官方 50 条消息
  `hasMore/loadOlder` 分页、assembler、实时流、Markdown、工具／文件／详情操作、排版变量和
  渲染模式偏好，但不挂载输入框，也不提供第二个模式切换入口。实例正文顶部的局部工具条
  承载状态与「在对话中打开」，Workbench 公共标题栏只保留标签与面板
  控件，正文不再重复子代理标题。只有标签激活、面板可见且
  页面可见时才持有子会话观察租约；隐藏标签不创建 Session、不组装消息，
  也不触发 transcript React commit。任务实例直接复用 Home 的官方会话快照，
  并在局部工具条保留停止操作。关闭任一种标签都只是查看态——子代理或任务继续运行。

插件只持有可丢弃的渲染状态(计时时钟、乐观停止集与 overview 快照)；
Job 与 Session 生命周期始终归官方 Runtime store 所有。
