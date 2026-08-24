# DeepCreator Review Service

Workbench 的范围化审查与按 Turn 变更服务。Git 工作区缺省 `uncommitted` 为 `HEAD → worktree`，并提供 `unstaged`（index → worktree）、`staged`（HEAD → index）以及 `{ turn }`（Turn start → 实时／结束快照）范围；非 Git 工作区只提供当前轮次和历史轮次。generation 协议先返回不含完整源码的 unified patch，仅在用户展开省略上下文时读取某一侧源码；旧客户端仍可通过兼容 `diff` RPC 获得完整快照。

`status(session, scope, location?)` 只返回文件清单，不读取源码快照。Git 范围严格停止在所选仓库边界：普通未跟踪目录展开为文件，嵌套仓库与 submodule 保持为可下钻原子项；`location.repository` 在 Windows 上也统一使用工作区相对 POSIX 路径。向后兼容的 `summary(session, scope, location?)` 以一次范围级 `--numstat` 返回明确的条目类型、展示类型与行统计状态，因此二进制、空文件、纯重命名、权限变化和仓库项都不会伪装成 `+0 -0`；旧 Client／Host 仍可只使用 `diff`。

`manifest(session, scope, location?)` 建立 opaque generation，并在 porcelain seed 就绪后立即返回分支与文件身份；历史和行统计可以先标记为 pending，共享权威快照保持懒启动。`patches(session, generation, paths[])` 的前台路径只计算视口请求的文件并按 generation 缓存；只有连续跨过多个 batch 的持续需求才会在空闲防抖后补齐剩余聚合 patch map。当前 Turn 的精确 edit 直接使用 tracker 的最新 `after` 文本，只读取基线对象，不等待 worktree 快照。`source(...)` 通过共享 `git cat-file --batch` 懒读某一文件侧；面板可见时用纯内存 `probe(session, knownEpoch)` 发现外部编辑，不触发 Git。兼容 `history/status/summary/diff` 暂时保留，并尽可能适配到同一数据面。

generation 在把 patch 关联回 manifest 文件身份前会解码 Git 的 C 风格引号路径，包括非 ASCII 文件名使用的 UTF-8 八进制转义。中文目录因此与 ASCII 文件走同一批量 patch 路径，不再退化为空 layer。

成功的公开 `tools/result` 中，`write`／`edit` 会写入可丢弃的 Turn tracker。它通过 `rootCallId` 把 Code Mode 嵌套调用归入根调用轮次，同一路径折叠为首次 `before` 与最新 `after`，恢复初始内容后自动移除。连续性无法证明、未知写入、shell 命令以及 Host 重启后的开放 Turn 会标记为 dirty，并合并成一次权威快照。Turn 结束仍写入现有私有 Git ref；历史、提交核对和 Undo 始终以该持久结果为准，tracker 不构成第二份业务状态。

Turn 边界使用 v2 工作区快照，而不是当前 Git 边界。每个仓库分别枚举 tracked 与未忽略 untracked 文件，递归合并嵌套仓库、排除所有 `.git` 元数据；符号链接只保存链接目标字符串。manifest 的每个文件记录所属仓库和仓库内路径，v1 manifest 继续按根仓库记录读取。提交核对按所属仓库独立执行，根仓库提交不会清掉子仓库文件，反之亦然。

服务在官方 Turn 边界采集工作树：第一个 `agent/pre-step` 前写 start，`agent/turn-stopping` 写 end，`turn/end` 兜底。进行中的轮次直接比较保留的 start tree 与实时工作区，因此工具变更文件无需等待轮次结束即可打开 Diff。快照通过临时 index 生成 tree，不修改真实分支、index 或工作区；Git 工作区使用 `refs/deepcreator/turns/{sessionId}/{turn}`，非 Git 工作区使用 DSH Home 下按会话隔离的私有 bare object database。若工作区包含 DSH Home，快照会主动排除这块私有状态，且绝不在项目中创建 `.git`。提交核对仅适用于 Git，全部提交后立即删除该轮 ref；非 Git 的已结束轮次继续作为历史保留。

唯一写操作是 `undoTurn`：仅允许最新一个仍有待处理文件的 Turn。实现先在临时 Git tree 上计算 start/end/current 三方反向合并，同时计算 index 与 worktree 的候选树；确认 HEAD、index 和 worktree 未发生竞态后才落盘。只涉及一个仓库时，即使该仓库位于工作区内部，仍可安全撤销；涉及多个仓库时保留历史与逐仓库提交识别，但本期禁用撤销。冲突或过期会整次拒绝，不覆盖后续手工编辑，也不会留下半完成撤销。本服务不提供暂存、取消暂存或提交 UI。
