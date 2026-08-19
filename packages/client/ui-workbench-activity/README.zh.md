# Workbench 活动面板

注册 `activity` Workbench 类型,拥有两条路由:

- **Home** —— 锚定对话宿主会话的单页纵排视图(子代理经「在对话区打开」
  成为当前会话时,按 `currentAddress.parentSessionId` 回锚到父会话,首页
  不随 session 作用域切走)。分区依次为:子代理目录、运行中/已结束后台任务
  (`jobsBySession`,官方两档单位的实时计时,经 `jobs-admin` Host remote
  可停止)。子代理按参与度分组:**本轮参与**(最近活跃晚于父会话最近一条
  用户消息的子代理,运行中在前、最近活跃在前——可延续子代理被再次调用后
  随新活动冒回顶部)与**更早**,数据来自 `jobs-admin` 的 `subagentOverview`
  时近投影;无数据时退化为单列表(运行中在前)。子代理卡片为无边框内容
  卡片(静息/hover/已开以背景色分层),运行中标题呼吸。正在对话区打开的
  子代理卡片置灰,模式·状态 meta 替换为「从对话区关闭」控件(官方面包屑
  路径 `sessions.open(parent)`);点击卡片仍进入其标签页。
- **Instance** —— 每个子代理一个标签页(复用 Workbench 公共
  `WorkbenchPanelTabs`;实例 id 即子会话 id,显示名走
  `contributePanelInfo`)。标签页主体是**经典模式执行流**,经
  `deepcreator.conversation.embed` 槽渲染:子代理原始事件
  (`jobs-admin` → `subagentEvents`,先整窗后按 `afterSeq` 增量,子代理
  运行中且分组可见时 120–400ms 自适应追逐轮询)由官方
  `ConversationNodeAssembler` 折叠,以同一套节点/工具渲染器只读呈现
  (经典形态固定——无模式环、无输入框、无 Think 切换)。起草指示
  ("Deep diving…" 状态行与 "Creating" 等草稿行)按目录活动位、会话摘要
  running 位与事件流动三者的并集点亮(仅增量算流动,初始历史窗口不算)。
  子代理生命周期内标签内容持久保留:嵌入引擎按 seq 去重,重挂载的全量
  窗口退化为增量。父级追加的挂起消息在流尾悬浮一张只读排队卡片——
  独立四角圆角卡片(完整描边、轻投影),卡片实时高度在流下方退让出安全区
  (滚动底部可完全越过卡片);干预走官方 `sessions.openSubagent` 跳转,跳转
  后面板路由回到首页。关闭标签仅是查看态——子代理继续运行。

插件只持有可丢弃的渲染状态(计时时钟、乐观停止集、轮询结果、overview
快照);Job 与 Session 生命周期始终归官方 Runtime store 所有。
