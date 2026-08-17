# DeepCreator Workbench

本 Client 插件是根 `details` 席位的唯一 occupant，只拥有会话级展示状态：面板类型 Group、同类型 tabs／路由、显式列 Track、列／格尺寸、外宽、隐藏 id 与手动 Focus。业务数据继续由各 Provider 或官方 Runtime 持有。

Provider 通过 `ctx.workbench.registerType()` 注册 `PanelTypeDefinition`，并向 `deepcreator.workbench.panel`、`deepcreator.workbench.panel-icon` 注册 keyed renderer；Artifact 内容 renderer 使用 `deepcreator.workbench.artifact.renderer`。这些注册必须成组撤销。`initialWidthRatio` 声明首开所占 Stage 比例：Activity／Artifact／Terminal 为 1/3，Review／Preview 为 1/2（Preview 保留内部 `browser` id）。

每个 Mosaic cell 都统一使用 ui-primitives 导出的 `WorkbenchPanelShell`。details 列与 Tracks 只负责几何，不绘制父级外框；公共 shell 提供四边各 3px 的留白、圆角 semantic border、42px Header、tabs 与 Body 边界。Provider 正文从 Header 下方直接开始，不再渲染第二层工具栏。Provider 通过普通的 `contributeHeaderActions()` owner callback 提交 Header 节点，并使用 `WorkbenchPanelIconButton`：新建 Tab 的加号进入左侧，其余操作与返回、Focus、隐藏统一进入右侧。

拓扑是确定性的：第二种类型上下分割第一列且不改变列宽；第三种类型创建两列等宽布局，Workbench 为 Stage 的 1/2；第四种类型分割第二列；第五种类型创建三列等宽布局，Workbench 为 Stage 的 2/3。删除一个格时同列 sibling 填满高度；整列为空时仅移除该列，其他列保持像素宽度并整体贴右。每个面板列的宽度下限为 150px，Conversation 的宽度下限为 360px。

响应式布局只从右向左隐藏整列，不改写拓扑。点击一个响应式隐藏类型，会把它的真实位置与真实左上角位置交换，因此重新变宽后恢复的是更新后的拓扑。若一个不在拓扑中的类型需要新增奇数列但空间不足，则原子覆盖左上角类型。同类型实例始终进入 tabs，不消耗新格；隐藏 Group 保持 mounted，可见性切换不等于资源关闭。

只有完整的一组能够容纳时，五个类型入口才以内联图标形式位于会话 Header 的固定「更多」按钮之前。空间不足时，整组会收成一个独立的「面板」按钮，菜单始终列出全部五种类型；重新变宽后，五个入口一起恢复。两种形态都读取同一个 Controller 可见性源，因此响应式切换不会打开、隐藏或重新挂载面板。

展示状态保存在 `dsh.deepcreator.workbench.session.v2.<sessionId>`。注册前会清理已退役的 v1 pair-axis／parked 快照。Agent 数据默认不会弹出面板，只有显式 `reveal: true` 才改变布局。
