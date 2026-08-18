# DeepCreator Session Admin

官方 Harness 未提供的 Host 侧会话生命周期管理。一个 Typert Remote `delete` 永久销毁已持久化的会话：校验会话 id（UUID）、在共享 sessions 根下定位会话目录（官方 jsonl 后端以原始 id 命名每个会话目录）、拒绝跨工作区的歧义匹配、拒绝 live 会话（`ctx.sessions` 中存在条目——官方 write-behind 会重建日志）、然后删除目录。调用方之后负责关闭会话并刷新会话列表。
