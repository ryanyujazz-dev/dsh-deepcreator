# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | 中文

侧边栏外壳插件：负责字标、无外边距的主要操作列表、关闭／恢复控件、可感知滚动的区域 seat，以及固定在底部的 Settings seat。主要操作列表与 Workspace／项目和 Session 标题复用同一个 `SidebarRow` 几何：外壳持有的 New Session 下方依次渲染功能插件通过可叠加 `sidebar.primary.action` Slot 贡献的行，以及禁用的「定时任务」占位，2px 行节奏由列表持有，列表没有上下外边距。[ui-skills](../ui-skills/README.md) 当前贡献「技能」；[ui-workspace](../ui-workspace/README.md) 持有渲染到 `sidebar.workspaces` 的 Workspace 与 Session 浏览器。本包既不派生这些功能行，也不持有其视图状态。关闭时会彻底移除侧边栏表面；本包把唯一的恢复按钮贡献到布局拥有的 `deepcreator.shell.sidebar-toggle` 框架 seat。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

外壳在无外边距的 48px 品牌行中渲染 DeepCreator 字标，并为主要操作列表之后的独立内容分区发布 `--dsh-sidebar-section-margin-top: 10px`。分区只消费这一个顶部外边距，不设置底部外边距；当前 WorkspaceBrowser 已使用它，未来置顶区也将复用相同节奏。标准侧边栏操作图标采用 ui-primitives 共享的 14px 规格；16px 鲸鱼仅作为展开态字标中的品牌视觉例外。在 macOS Electron 标记下，展开态字标从原生红黄绿按钮右侧开始；命中区只贴合可见字标，品牌行其余空白全部用于拖窗，而字标和面板按钮显式保持为不可拖拽的交互面。关闭时不再保留侧栏品牌元素，面板图标改在布局稳定的 28px 框架 seat 中出现。

New Session 会启动运行时的页面局部前端 Session Intent。运行时优先使用作用域操作明确指定的 Workspace，否则使用当前 Session 所属 Workspace，再否则使用最近活跃 Workspace；一个 Workspace 都没有时则清空选择，进入空白 New Session 页面。功能插件拥有的主要操作只接收 `wide` 呈现事实；「技能」通过设置导航服务打开对应设置分区。「定时任务」仍是禁用的视觉占位。Workspace 专属控件与共享选择器由 ui-workspace 持有。

`SidebarRootComponentProps` 组合布局 owner share、全局 `useSessions` 和 `useWorkspaces` 钩子、已声明的 `sidebar.workspaces` 与 `sidebar.settings` 子 slot，以及注入的 `startSession` 与侧边栏切换回调。这里没有插件 store。

实时关闭时，外壳会把展开内容固定在当前宽度，在收缩中的栏内用 150ms 淡出；退出期间整栏为 inert，动画结束后不再贡献任何 DOM。独立恢复按钮会立即出现在框架 seat 中，并且不随网格过渡移动。页面初始即为关闭状态时不渲染侧边栏 DOM；减少动态效果模式会禁用淡出。

栏内的滚动条是一种指针可供性：只要指针不在栏内，外壳就把 ui-theme 的[滚动条间接层](../ui-theme/README.md)重新绑定为 `transparent`；指针离开后滑块再保留 2 秒，因此没人指向的列表不会带着滚动条。避免行位移的空间预留属于滚动区域本身（[ui-workspace](../ui-workspace/README.md)），所以显示滑块不会引起重排。

页脚承载 `sidebar.settings`：侧边栏只渲染固定在底部的布局 slot，并共享其栏状态（`wide`）；ui-settings 在此注册触发行和设置面板。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；SidebarRoot、行组件和树派生仍由 slot 注册封装在包内。

## 模型体验

无。侧边栏渲染浏览器会话列表；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **Session 状态点渲染由 [ui-workspace](../ui-workspace/README.md) 持有**：没有可用的 done/error 通知数据源。
- **Workspace 浏览行为由组合持有**：分组、排序、搜索与行状态都属于 [ui-workspace](../ui-workspace/README.md)，不属于此外壳。
- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。
