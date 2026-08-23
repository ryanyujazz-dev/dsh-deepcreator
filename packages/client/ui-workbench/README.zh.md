# DeepCreator Workbench

本 Client 插件是根 `details` 席位的唯一 occupant，只拥有会话级展示状态：面板类型 Group、同类型 tabs／路由、显式列 Track、列／格尺寸、外宽、隐藏 id 与手动 Focus。业务数据继续由各 Provider 或官方 Runtime 持有。

Provider 通过 `ctx.workbench.registerType()` 注册 `PanelTypeDefinition`，并向 `deepcreator.workbench.panel`、`deepcreator.workbench.panel-icon` 注册 keyed renderer；Artifact 内容 renderer 使用 `deepcreator.workbench.artifact.renderer`。这些注册必须成组撤销。`order` 声明入口条优先级（Terminal、Artifact、Activity、Review、Browser；未声明的类型按注册顺序排在有序类型之后）。`initialWidthRatio` 声明首开所占 Stage 比例：Activity／Artifact／Terminal 为 1/3，Review／Browser 为 1/2（Browser 保留内部 `browser` id）。

每个 Mosaic cell 都统一使用 ui-primitives 导出的 `WorkbenchPanelShell`。details 列与 Tracks 只负责几何，不绘制父级外框；Workbench 根容器在对话区底色上提供四边 4px 内边距，公共 shell 再提供相对 cell 四边各 4px 的留白、圆角 semantic border、32px Header 与 Body 边界，浅色主题下以对话区底色 `--dsw-alias-bg-base` 填充卡片（workbench 与聊天读作同一表面），深色主题保持侧边栏表面 `--dsw-specific-sidebar-fill`（比对话区底色浅一阶）；Provider 的全尺寸正文表面继承该填充，不再自行重涂底色。列与上下格的分割条保持 8px 透明命中区，从零宽 grid 轨道居中叠加、完整覆盖 4px＋4px margin 形成的缝隙且不占用布局宽度；拖拽换算基于实时几何（跨列按列宽比例、上下格按实测列高），面板边缘 1:1 跟随鼠标。同类型实例统一使用公共 `WorkbenchPanelTabs` pill 标签——26px 高、6px 圆角，圆心与卡片 10px 圆角在两轴上完全重合，关闭按钮 hover 只提亮图标、不显示底色；存在标签时不再重复显示类型标题，新建 Tab 的加号紧跟最新标签。Provider 正文从 Header 下方直接开始，不再渲染第二层工具栏。Provider 通过普通的 `contributeHeaderActions()` owner callback 提交 Header 节点，并使用 `WorkbenchPanelIconButton`：新建 Tab 的加号进入 tabs 尾部，其余操作与返回、Focus、隐藏统一进入右侧。Provider 还可以调用 `contributePanelInfo()` 重命名 tab 显示名——实例 id 仍是激活、关闭与持久化的唯一身份——通过 `tabFilePaths` 为文件型 tab 传入真实路径，并向 Group 的可访问标题追加后缀（例如 shell 程序名）。

Workbench 聚焦覆盖 Stage 且侧边栏关闭时，公共 Header 的左侧 tabs／标题消费 AppFrame 的平台安全位，避开 macOS 红黄绿与恢复侧边栏按钮；最大化、全屏及其他平台自动回落为只避开恢复按钮，普通右栏面板保持紧凑内缩。

拓扑是确定性的：第二种类型上下分割第一列且不改变列宽；第三种类型创建两列等宽布局，Workbench 为 Stage 的 1/2；第四种类型分割第二列；第五种类型创建三列等宽布局，Workbench 为 Stage 的 2/3。删除一个格时同列 sibling 填满高度；整列为空时仅移除该列，其他列保持像素宽度并整体贴右。每个面板列的宽度下限为 150px，Conversation 的宽度下限为 360px。

响应式布局只从右向左隐藏整列，不改写拓扑。点击一个响应式隐藏类型，会把它的真实位置与真实左上角位置交换，因此重新变宽后恢复的是更新后的拓扑。若一个不在拓扑中的类型需要新增奇数列但空间不足，则原子覆盖左上角类型。同类型实例始终进入 tabs，不消耗新格；隐藏 Group 保持 mounted，可见性切换不等于资源关闭。

只有完整的一组能够容纳时，五个类型入口才以内联图标形式位于会话 Header 的固定「更多」按钮之前。空间不足时，整组会收成一个独立的「面板」按钮，菜单始终列出全部五种类型；重新变宽后，五个入口一起恢复。两种形态都读取同一个 Controller 可见性源，因此响应式切换不会打开、隐藏或重新挂载面板。

展示状态保存在 `dsh.deepcreator.workbench.session.v2.<sessionId>`。注册前会清理已退役的 v1 pair-axis／parked 快照。Workbench 命令是边沿事件：每个新的会话级 Root 挂载时以 Controller 当前命令序号作为初始水位，只处理挂载之后发布的命令，不得在新项目首次发送或会话作用域切换时重放上一会话的最后一次面板操作。Agent 数据默认不会弹出面板，只有显式 `reveal: true` 才改变布局。
