# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：三栏 AppFrame（拖动手柄与让步链）加 `ctx.layout` 面板几何服务；它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`details`、`deepcreator.shell.sidebar-toggle` 和 `shell.overlay`。侧边栏和详情栏的缩放边界都是不可见命中条带，详情栏不再显示浮动胶囊；让步期间只有详情栏会收缩并随后自动关闭。关闭后的侧边栏宽度为零，不再保留控制轨道；AppFrame 改为在对话 Header 最左侧安置独立恢复按钮，因此 New Session hero 与活动对话中的位置完全一致。macOS 红灯从 x=20 开始，与下方「新会话」图标左边界共线；字标从 x=89 开始，与绿灯保持和三颗原生按钮之间一致的 9px 可见间距。恢复按钮的 28px 命中框从 x=82 开始，使居中的面板图标同样以 x=89 为可见左边界。对话 Header 无论侧栏开关都固定使用 12px 水平内边距；只有标题簇获得平台安全位（macOS 为 98px，其他平台为 32px），居中的视图切换器不移动。所有控件严格共用 48px Header 的 y=24 中轴。窗口最大化或全屏后 macOS 隐藏红绿灯，框架会把上述 macOS 偏移（字标行距、恢复按钮座位、标题簇安全位）全部回落为通用几何。只有 macOS Electron 渲染器会获得平台标记：框架保留顶部窄兜底拖拽带，侧栏、对话与详情各自把完整的可见 Header 空白设为拖窗区域，并排除真实交互控件；Windows Electron 渲染器获得自己的平台标记，由框架在三栏之上绘制自有的 32px 标题条——底色调色板背景、镜像窗口标题（`DeepSeek Harness` 后缀替换为 `DeepCreator`，空标题回退产品名）、整条拖窗区域——因为该平台的系统标题栏隐藏在 Window Controls Overlay 之后；Linux 只使用系统标题栏。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，依据解析后的浅色／深色代码外观设置 `body[data-code-theme]`，把主题别名与代码字体 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在 Windows Electron 渲染器中，呈现器还通过离屏探针解析底色背景与主文字 token，并在每次应用后经 `deepcreatorWindow.setTitleBarTheme` preload 桥推送两个颜色，使原生窗口按钮跟随应用内主题；尚未解析为具体颜色的值会被跳过。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点与探针，并一并清除其写入的其他全局状态。

AppFrame 始终挂载会话栏和详情栏；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，详情栏则保持关闭，且该 store 从不读写 `localStorage`。hero 和其他未选中状态也会将详情栏的渲染宽度派生为零，但不会改变存储的宽度偏好。AppFrame 会跨越这些状态保留最后一个非 blank 会话 id：首个会话保持关闭；显式打开详情栏的操作会使用约定默认宽度；返回同一会话时恢复其未改变的宽度；选择不同会话时，详情栏会在绘制前关闭。会话 owner share 为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

在不大于 640px 的手机宽度下，AppFrame 只响应式投影这些既有 occupant：Sidebar 变为覆盖式抽屉，Conversation 填满中间 Stage，打开的 details occupant 以全宽覆盖 Stage。三者继续显式绑定第一、第二、第三 grid track，因此 Sidebar 脱离普通布局成为抽屉后，不会把 Conversation 挤进零宽的侧栏轨道；在抽屉里选择另一个会话会自动收起抽屉并回到 Conversation。这里不增加手机专用业务组件或路由。

现在 `details` 由 ui-workbench 独占。ui-layout 仍只保存瞬时渲染几何；Workbench 按 Session 持久化外宽并通过 `ctx.layout.setWorkbenchWidth()` 恢复。details owner props 会提供真实宽度、排除 Sidebar 的 Stage 宽度（Conversation + Workbench）和 pointer resize 手势元数据。Conversation 的让步下限为 360px，一个 Workbench 列仍为 150px；更高阶拓扑由 Workbench occupant 解析。Focus 会解除普通第三列 grid 区域的约束、先跨越完整根框架，再只覆盖 Stage 而不覆盖 Sidebar。Focus 期间开关 Sidebar 时，details 的左边界与 sidebar grid track 共用慢速缓动，避免两条边界错位时短暂露出仍挂载的 Conversation；拖拽与减少动态效果模式不应用该缓动。

details 列本身不再绘制外框。可见面板的边框与内缩完全归 occupant 所有；AppFrame 只提供透明的外侧 resize 命中条，Focus 模式也遵守同一所有权。完整 8px 条带从 Workbench 根容器左边缘开始向内延伸，正好填满根容器 4px padding 与 panel shell 4px margin，不覆盖卡片，也不向对话区借用命中宽度。静息时条带不绘制内容；悬停或拖拽时，仅在真实栏边界淡入一条使用 `--dsw-alias-border-l1` 的通栏 1px 竖线。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController` 和 owner-share 接口。AppFrame、面板 store 与让步求解器仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，并忘记拖动后的宽度，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的详情宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
