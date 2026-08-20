# Workbench 产物面板

持有 `artifact` Workbench 类型与面板。列表是**官方产物事实**的投影——模型实际写入或编辑的文件——经 trajectory 同款会话事件机制从会话事件折叠而来,不是插件自有副本、也不是拉取。

`workbench-artifact` 节点完全遵循官方 `ui-deliverables` 的推导规则:`turn/start` 启动每轮上下文,`tool/call` 记录调用视图,append 表面的 `tool/result` 收集 diff 卡片(或 generic `edit` 卡片)产出的路径——读取、删除、失败结果与替换表面不产生产物。`artifacts` 快照 builder 把每轮节点折叠为每条路径一条记录(最新产出胜出),按产出时间倒序排列。DeepCreator 禁用官方重复的产物尾行，由新的 Turn 变更卡接管可见尾部；本投影只发布 Turn location data，closing prose 的 `chatFileMentions` 仍由官方 `ui-deliverables` client 单独持有，避免组装后的浏览器重复注册同一服务。

实例内容经挂载的 `artifacts` remote 命名空间按活动路径键控读取:仅当活动路径变化或用户手动刷新时重读。每个实例在加载态、错误态与实际内容上方持续显示一条紧凑的完整路径面包屑；视觉片段省略 Unix／UNC 开头的斜杠（可访问名称仍保留精确路径），窄栏优先保留文件侧的末尾路径，并在被裁切的左边缘渐消；最右侧固定保留文件夹操作，通过官方 Workspace 路径开启器打开当前文件的所在目录，不随面包屑滚动或被其挤压；tab 继续只承担短文件名身份。路径缺失或逃逸时展示 reader 的错误码;不存在墓碑状态,因为官方事实从不撤回。

产物文件行与实例加载态统一使用共享的 Material `FileIcon`／`FileLabel`。Provider 同时贡献去重后的 basename 标签和 `tabFilePaths`，因此 Artifact tabs 携带相同的文件身份，而非文件型 Workbench tabs 不受影响。从对话 Read 行直接打开、但从未进入产物列表的路径也会加入这份映射，并由同一个工作区 reader 渲染完整内容。

内容渲染走 `deepcreator.workbench.artifact.renderer` 槽(由 `ui-workbench` 声明,面板经 `renderArtifact` owner prop 消费)。本包注册 `code` 渲染器:所有文本产物都用共享 `CodeSurface` 渲染为与 Review 一致的完整文件行网格(行号 gutter＋内容列，不含 Diff 符号、增删底色与词级标记)。扩展名能映射到已注册文法时(含 markdown——散文产物也是文件),Shiki token 继续走 `data-code-theme` 配色链;未知扩展名只退化为无语法着色的逐行纯文本,不再切换为另一套 `<pre>` 版式。内容按面板宽度软换行且不自涂底色。Markdown 与 MDX 使用 `document` 表面变体:不加外部 margin,行号 gutter 与正文之间绘制竖向分隔线,仅在正文列内部保留 padding。

类型入口图标在会话出现用户尚未查看的新产物时于右上角显示蓝点:已见水位仅在面板组可见时推进(隐藏的组保持 mounted,因此隐藏面板时蓝点持续,直到打开)。

截断窗口语义:当一轮的 `turn/start` 位于未加载的旧页时,该轮在旧页加载前不可见——与其他会话投影语义一致;无 start 的更新事件是惰性的。
