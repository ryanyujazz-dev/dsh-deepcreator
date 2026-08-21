# DeepCreator Jobs Admin

官方 Harness 未向 Client 暴露的后台活动管理。两个 Typert Remote:

- `stop` 终止某个会话名下的一个存活任务:校验会话 id(UUID)与任务 id
  (`<kind>-N` 形状),解析该会话的存活 Agent(`ctx.agents`),再经由该
  owner 自己的 `ctx.jobs.list` 集合查找任务——owner 作用域查找即授权
  栅栏,任何跨会话 id 都无法被寻址;已结算任务直接拒绝,存活任务则调用
  官方注册表的同步幂等 `ctx.jobs.kill(id, agent, 'user-stop')`。任务快照
  仍会自行经历 `stopping` 到终态,本服务不伪造任何状态。
- `subagentOverview` 为活动面板首页分组供数:官方 subagent 运行时
  (`ctx.subagents.listChildren`,与 Client 目录同源的持久语料)枚举父会话
  直接子代理,本 remote 补充该语料没有的时近事实——每个存活子代理的
  最新日志事件时间(`lastActiveAt`,冷子代理保留行但无时间),以及父会话
  最近一条用户消息时间 `turnStartedAt` 作为「本轮参与」分组的边界。父会
  话必须存活(否则 `PARENT_GONE`);枚举失败折叠为 `READ_FAILED`。
