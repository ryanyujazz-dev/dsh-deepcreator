# DeepCreator Jobs Admin

官方 Harness 未向 Client 暴露的后台活动管理。三个 Typert Remote:

- `stop` 终止某个会话名下的一个存活任务:校验会话 id(UUID)与任务 id
  (`<kind>-N` 形状),解析该会话的存活 Agent(`ctx.agents`),再经由该
  owner 自己的 `ctx.jobs.list` 集合查找任务——owner 作用域查找即授权
  栅栏,任何跨会话 id 都无法被寻址;已结算任务直接拒绝,存活任务则调用
  官方注册表的同步幂等 `ctx.jobs.kill(id, agent, 'user-stop')`。任务快照
  仍会自行经历 `stopping` 到终态,本服务不伪造任何状态。
- `subagentEvents` 为活动面板的子代理内嵌执行流供数。官方 Client 只为
  「当前会话」打开对话窗口,本 remote 即非激活数据通道:存活子代理读
  内存日志(`ctx.sessions`)加挂起 Agent 收件箱
  (`agent.inbox.nextStep`/`nextTurn`,FIFO,steering 先于 queued);冷子代理
  走官方 `inspectApiRemoteSession` 读取器(无活 Agent,队列恒空)。会话头
  上的持久直接父级血缘是授权栅栏。首次调用返回尾部窗口(≤1200 条事件)
  与 `totalSeq`;后续以 `afterSeq` 传入做增量。事件与排队消息以闭合的
  无损 JSON 投影过线(`SubagentWireEvent`/`SubagentQueuedItem`)——官方
  联合类型可被合并扩展,而 `Session.append` 在运行时已验证全部载荷为
  精确 JSON,故闭合形状是忠实的。
- `subagentOverview` 为活动面板首页分组供数:官方 subagent 运行时
  (`ctx.subagents.listChildren`,与 Client 目录同源的持久语料)枚举父会话
  直接子代理,本 remote 补充该语料没有的时近事实——每个存活子代理的
  最新日志事件时间(`lastActiveAt`,冷子代理保留行但无时间),以及父会话
  最近一条用户消息时间 `turnStartedAt` 作为「本轮参与」分组的边界。父会
  话必须存活(否则 `PARENT_GONE`);枚举失败折叠为 `READ_FAILED`。
