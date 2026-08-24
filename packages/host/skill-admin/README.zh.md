# @ryanyujazz/dsh-skill-admin

[English](README.md) | 中文

DeepCreator 的 Host 侧技能管理边界。它以官方 `ctx.skills` 注册表为权威目录，通过官方 Settings 服务持久化逐项停用策略，并提供受约束的本地复制、本地链接、Git 安装和删除操作。删除目标只允许是标准个人技能根目录或当前项目技能根目录的直接子项。

Client 提供 live session id 时，本包通过官方 Agent 注册表解析对应 Agent，并对同一个“全局层 + Agent 作用域层”有效技能目录执行列表、详情和管理动作；没有 live Agent 的查询仍投影全局目录。

停用单个技能时，本包会注册一个 rank 为 0、同时关闭模型调用与用户调用的策略候选项。原提供者与原文件继续保持挂载且不会被修改；重新启用只移除该策略。具有 Host 本地定义的内置／插件来源可以停用，但只有个人／项目来源可以从磁盘移除。
策略 provider 同时注册在全局层和每个 live Agent 作用域层，因此 preset 内的本地 provider 不会覆盖已经持久化的停用选择。

提供者可通过 `metadata.localizedDescriptions.{zh,en}` 附带双语展示描述；本包会将其投影到 Client，并在技能停用期间继续保留。未提供双语元数据的来源回退到注册表中的原始描述。
提供者还可通过 `metadata.developer` 声明内容开发者；该字段与安装来源和运行时提供者身份分别展示。

## 模型体验

停用的技能会经官方注册表关闭模型和用户两种调用入口；除此之外，本包不会向模型请求添加额外说明。
