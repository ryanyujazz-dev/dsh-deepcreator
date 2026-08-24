# @ryanyujazz/dsh-client-ui-skills

[English](README.md) | 中文

DeepCreator 的技能功能插件。它注册一个 `settings.section`（`skills`）以及一个 `sidebar.primary.action` 快捷入口；快捷入口通过公共设置导航服务打开同一个设置分区，并由本插件挂载生成的 Skill Remote codec，不与 Workbench Remotes 耦合。React 视图只接收注入的回调与 Remote 投影，技能目录仍以官方 Host Skill 注册表为权威。

Client 会把当前 live session id 与工作区路径一起传给 Host，使设置页投影与 `skill` 工具相同的 Agent 作用域有效目录，而不是只显示全局 provider。

页面复用 ui-primitives 的 Button、Input、Menu、Modal、RiskConfirmation、Tooltip、SidebarRow 和产品技能图标。唯一的本地控件是技能领域专属的紧凑启停开关。

卡片和详情页会根据应用当前语言选择 Host 投影中的 `localizedDescriptions.zh` 或 `.en`。缺少翻译时回退技能原始描述；搜索同时覆盖中英文。
详情页将开发者／内容作者与安装来源、技术提供者分开显示；没有声明时明确显示“未声明”。

## 模型体验

无。本包只在浏览器中呈现 Host 投影的技能事实与操作；模型是否可见由 Host 注册表策略执行。
