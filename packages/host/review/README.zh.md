# DeepCreator Review Service

Workbench 的只读 Git 仓库服务：状态、单文件 working-tree diff 与 `git diff --check`。每次调用都会重新解析 workspace/repository 的真实路径，并把文件限制在仓库内；不提供 stage、discard、commit 等写操作。
