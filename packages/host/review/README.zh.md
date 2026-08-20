# DeepCreator Review Service

Workbench 的范围化 Git 审查与按 Turn 变更服务。缺省 `uncommitted` 为 `HEAD → worktree`，并提供 `unstaged`（index → worktree）、`staged`（HEAD → index）以及 `{ turn }`（Turn start → end）范围；单文件结果包含 unified patch 与完整源快照，支持 rename、删除、未跟踪、二进制和符号链接。

服务在官方 Turn 边界采集工作树：第一个 `agent/pre-step` 前写 start，`agent/turn-stopping` 写 end，`turn/end` 兜底。快照通过临时 index 生成 tree，不修改真实分支、index 或工作区，并由 `refs/deepcreator/turns/{sessionId}/{turn}` 下的 synthetic commit 持久化。提交核对按文件保守进行；全部解决后 ref 改写为无父提交的轻量 tombstone，会话删除时同步清理私有 refs。

唯一写操作是 `undoTurn`：仅允许最新一个仍有待处理文件的 Turn。实现先在临时 Git tree 上计算 start/end/current 三方反向合并，同时计算 index 与 worktree 的候选树；确认 HEAD、index 和 worktree 未发生竞态后才落盘。冲突或过期会整次拒绝，不覆盖后续手工编辑，也不会留下半完成撤销。本服务不提供暂存、取消暂存或提交 UI。
