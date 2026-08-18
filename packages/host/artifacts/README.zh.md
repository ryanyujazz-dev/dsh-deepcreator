# DeepCreator Artifact Reader

Workbench 产物面板的 Host 侧只读工作区文件读取服务。面板列表是官方 deliverables 机制的客户端会话事件投影（模型写入或编辑的文件），因此本 Host 面只拥有一个 Typert Remote `read`：解析绝对或相对工作区路径、规范化并限制在 Session 工作区内、返回 utf8 内容。逃逸路径、缺失文件与无工作区会话以显式错误码失败；此处不持有业务状态。
