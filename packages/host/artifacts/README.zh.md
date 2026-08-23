# DeepCreator Artifact Reader

Workbench 产物面板的 Host 侧只读工作区文件读取服务。面板列表是官方 deliverables 机制的客户端会话事件投影（模型写入或编辑的文件），因此本 Host 面只拥有一个 Typert Remote `read`：解析绝对或相对工作区路径、规范化并限制在 Session 工作区内、返回 utf8 内容。逃逸路径、缺失文件与无工作区会话以显式错误码失败；此处不持有业务状态。

Host 同时贡献一段稳定的 Agent 系统提示，以及 `open_in_deepcreator` 使用的 `artifact` 资源描述。创建并验证主要的用户可消费产物后，根 Agent 应主动呈现一次该主产物；普通源码、测试、配置、依赖元数据、临时文件与次要实现文件只保留在产物列表中，不自动打开面板。用户的明确要求和本轮 dismissal 始终优先。
