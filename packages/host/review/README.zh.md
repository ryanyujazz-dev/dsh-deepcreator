# DeepCreator Review Service

Workbench 的范围化审查与按 Turn 变更服务。Git 工作区缺省 `uncommitted` 为 `HEAD → worktree`，并提供 `unstaged`（index → worktree）、`staged`（HEAD → index）以及 `{ turn }`（Turn start → 实时／结束快照）范围；非 Git 工作区只提供当前轮次和历史轮次。单文件结果包含 unified patch 与完整源快照，支持 rename、删除、未跟踪、二进制和符号链接。

`status(session, scope)` 只返回文件清单，不读取源码快照。向后兼容的 `summary(session, scope)` 以一次范围级 `--numstat` 独立返回逐文件增删行数与二进制状态，使大规模 Review 能先完整绘制全部文件头，再按需请求重型正文；旧 Client／Host 仍可只使用 `diff`。

服务在官方 Turn 边界采集工作树：第一个 `agent/pre-step` 前写 start，`agent/turn-stopping` 写 end，`turn/end` 兜底。进行中的轮次直接比较保留的 start tree 与实时工作区，因此工具变更文件无需等待轮次结束即可打开 Diff。快照通过临时 index 生成 tree，不修改真实分支、index 或工作区；Git 工作区使用 `refs/deepcreator/turns/{sessionId}/{turn}`，非 Git 工作区使用 DSH Home 下按会话隔离的私有 bare object database，绝不在项目中创建 `.git`。提交核对仅适用于 Git，全部提交后立即删除该轮 ref；非 Git 的已结束轮次继续作为历史保留。

唯一写操作是 `undoTurn`：仅允许最新一个仍有待处理文件的 Turn。实现先在临时 Git tree 上计算 start/end/current 三方反向合并，同时计算 index 与 worktree 的候选树；确认 HEAD、index 和 worktree 未发生竞态后才落盘。冲突或过期会整次拒绝，不覆盖后续手工编辑，也不会留下半完成撤销。本服务不提供暂存、取消暂存或提交 UI。
