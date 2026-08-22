# DeepCreator Review Service

Workbench 的范围化审查与按 Turn 变更服务。Git 工作区缺省 `uncommitted` 为 `HEAD → worktree`，并提供 `unstaged`（index → worktree）、`staged`（HEAD → index）以及 `{ turn }`（Turn start → 实时／结束快照）范围；非 Git 工作区只提供当前轮次和历史轮次。单文件结果包含 unified patch 与完整源快照，支持 rename、删除、未跟踪、二进制和符号链接。

`status(session, scope, location?)` 只返回文件清单，不读取源码快照。Git 范围严格停止在所选仓库边界：普通未跟踪目录展开为文件，嵌套仓库与 submodule 保持为可下钻原子项；`location.repository` 在 Windows 上也统一使用工作区相对 POSIX 路径。向后兼容的 `summary(session, scope, location?)` 以一次范围级 `--numstat` 返回明确的条目类型、展示类型与行统计状态，因此二进制、空文件、纯重命名、权限变化和仓库项都不会伪装成 `+0 -0`；旧 Client／Host 仍可只使用 `diff`。

Turn 边界使用 v2 工作区快照，而不是当前 Git 边界。每个仓库分别枚举 tracked 与未忽略 untracked 文件，递归合并嵌套仓库、排除所有 `.git` 元数据；符号链接只保存链接目标字符串。manifest 的每个文件记录所属仓库和仓库内路径，v1 manifest 继续按根仓库记录读取。提交核对按所属仓库独立执行，根仓库提交不会清掉子仓库文件，反之亦然。

服务在官方 Turn 边界采集工作树：第一个 `agent/pre-step` 前写 start，`agent/turn-stopping` 写 end，`turn/end` 兜底。进行中的轮次直接比较保留的 start tree 与实时工作区，因此工具变更文件无需等待轮次结束即可打开 Diff。快照通过临时 index 生成 tree，不修改真实分支、index 或工作区；Git 工作区使用 `refs/deepcreator/turns/{sessionId}/{turn}`，非 Git 工作区使用 DSH Home 下按会话隔离的私有 bare object database。若工作区包含 DSH Home，快照会主动排除这块私有状态，且绝不在项目中创建 `.git`。提交核对仅适用于 Git，全部提交后立即删除该轮 ref；非 Git 的已结束轮次继续作为历史保留。

唯一写操作是 `undoTurn`：仅允许最新一个仍有待处理文件的 Turn。实现先在临时 Git tree 上计算 start/end/current 三方反向合并，同时计算 index 与 worktree 的候选树；确认 HEAD、index 和 worktree 未发生竞态后才落盘。只涉及一个仓库时，即使该仓库位于工作区内部，仍可安全撤销；涉及多个仓库时保留历史与逐仓库提交识别，但本期禁用撤销。冲突或过期会整次拒绝，不覆盖后续手工编辑，也不会留下半完成撤销。本服务不提供暂存、取消暂存或提交 UI。
