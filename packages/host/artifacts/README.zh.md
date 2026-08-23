# DeepCreator Artifact Reader

Workbench 产物面板的 Host 侧工作区文件读取与 HTML 预览物化服务。面板列表是官方 deliverables 机制的客户端会话事件投影（模型写入或编辑的文件）。Typert Remote `read` 解析绝对或相对工作区路径、规范化并限制在 Session 工作区内，并返回带类型的载荷：UTF-8 文本、受围栏保护的图片／PDF loopback URL、Mammoth 转换的 DOCX HTML，或由 `word-extractor` 提取的旧 DOC 正文；独立的 `preview` Remote 只接受 `.html`／`.htm` 入口并返回可交给 Browser Runtime 的 loopback HTTP URL。每个预览 Origin 只服务入口文件所在目录，拒绝隐藏路径、符号链接逃逸及非 Web 资源类型，只绑定 `127.0.0.1` 并随 Host 插件销毁。逃逸路径、缺失文件与无工作区会话以显式错误码失败；此处不持有产物业务状态。

Host 同时贡献一段稳定的 Agent 系统提示，以及 `open_in_deepcreator` 使用的 `artifact` 资源描述。创建并验证主要的用户可消费产物后，根 Agent 应主动呈现一次该主产物；普通源码、测试、配置、依赖元数据、临时文件与次要实现文件只保留在产物列表中，不自动打开面板。用户的明确要求和本轮 dismissal 始终优先。
