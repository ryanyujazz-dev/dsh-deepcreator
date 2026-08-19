# Workbench 活动面板

注册 `activity` Workbench 类型,拥有两条路由:

- **Home** —— 当前会话官方数据面上的单页纵排视图:运行中/已结束后台任务
  (`jobsBySession`,官方两档单位的实时计时,经 `jobs-admin` Host remote
  可停止)与子代理目录(`subagentsByParent`,运行中置顶;头部目录树退役后
  此处是子代理唯一入口)。
- **Instance** —— 每个子代理一个标签页(复用 Workbench 公共
  `WorkbenchPanelTabs`;实例 id 即子会话 id,显示名走
  `contributePanelInfo`)。标签页主体是**经典模式执行流**,经
  `deepcreator.conversation.embed` 槽渲染:子代理原始事件
  (`jobs-admin` → `subagentEvents`,先整窗后按 `afterSeq` 增量,子代理
  运行中且分组可见时 2.5s 轮询)由官方 `ConversationNodeAssembler` 折叠,
  以同一套节点/工具渲染器只读呈现(经典形态固定——无模式环、无输入框、
  无 Think 切换)。父级追加的挂起消息在流尾悬浮一张只读排队卡片
  (QueueDock 视觉、去掉全部操作按钮);干预走官方
  `sessions.openSubagent` 跳转。关闭标签仅是查看态——子代理继续运行。

插件只持有可丢弃的渲染状态(计时时钟、乐观停止集、轮询结果);Job 与
Session 生命周期始终归官方 Runtime store 所有。
