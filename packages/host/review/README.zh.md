# DeepCreator Review Service

Workbench 的只读 Git 仓库服务：状态、`git diff --check` 与单文件分层 patch。`staged` 表示 `HEAD → index`，`working-tree` 表示 `index → worktree`；每层同时返回 patch 与源快照，使客户端既能按 unified hunk 起始位置显示绝对行号，又能保留跨行语法状态。rename／copy 路径与二进制变更保持显式。每次调用都会重新解析 workspace／repository 的真实路径，并把 worktree 读取限制在仓库内；不提供 stage、discard、commit 等写操作。
