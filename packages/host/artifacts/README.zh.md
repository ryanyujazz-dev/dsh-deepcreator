# DeepCreator Artifact Registry

Workbench 的 Host 侧 Artifact 元数据服务。元数据从所属 Session 日志回放，大内容保留在 workspace path 或其他 locator 中。`list`、`read` 通过 Typert 生成 Remote；workspace-path 读取会做真实路径规范化并限制在 Session 工作区内。
