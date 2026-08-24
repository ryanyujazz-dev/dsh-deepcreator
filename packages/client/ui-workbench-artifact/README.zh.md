# Workbench 产物面板

持有 `artifact` Workbench 类型与面板。列表是**官方产物事实**的投影——模型实际写入或编辑的文件——经 trajectory 同款会话事件机制从会话事件折叠而来,不是插件自有副本、也不是拉取。

`workbench-artifact` 节点完全遵循官方 `ui-deliverables` 的推导规则:`turn/start` 启动每轮上下文,`tool/call` 记录调用视图,append 表面的 `tool/result` 收集 diff 卡片(或 generic `edit` 卡片)产出的路径——读取、删除、失败结果与替换表面不产生产物。`artifacts` 快照 builder 把每轮节点折叠为每条路径一条记录(最新产出胜出),按产出时间倒序排列。官方 `ui-deliverables` row 保持组合并持有收尾正文 `chatFileMentions` 与模型提示；本包以更高优先级接管其 Turn-tail 展示，只把当前 Turn 的产物渲染为位于独立变更卡上方的可展开产物卡。两张卡共用 `ConversationFileCard` chrome；产物卡没有撤销，「查看」打开产物首页，每个文件打开完整 Artifact 标签。

首页在「文件」上方增加「计划」list group。它严格限定于当前 Session：独立的 `plans` 对话投影从持久化的 `exit_plan_mode` 原始参数及配对结果重建每次计划修订，并标记待审批、已批准或未通过；不扫描同项目其他 Session，也不写项目级索引。计划行打开非文件型 Artifact 标签，以同一只读 `MarkdownText` 管线展示正文，不触发 Host 文件读取。

实例内容经挂载的 `artifacts` remote 命名空间按活动路径键控读取:仅当活动路径变化或用户手动刷新时重读。每个实例在加载态、错误态与实际内容上方持续显示一条紧凑的完整路径面包屑；面板使用固定高度布局，路径栏不会随内容向上或横向滚走，仅其下方的内容表面拥有双轴滚动。视觉片段省略 Unix／UNC 开头的斜杠（可访问名称仍保留精确路径），窄栏优先保留文件侧的末尾路径，并在被裁切的左边缘渐消；最右侧固定保留原始比例且停在展开帧的共享 DeepCreator Lottie 文件夹操作，通过官方 Workspace 路径开启器打开当前文件的所在目录，不随面包屑滚动或被其挤压；tab 继续只承担短文件名身份。路径缺失或逃逸时展示 reader 的错误码;不存在墓碑状态,因为官方事实从不撤回。

读取边界返回带类型的展示载荷，不再把所有文件都按 UTF-8 解码。图片通过工作区围栏保护的 loopback URL 直接在 Artifact 实例中显示；PDF 也留在同一个实例内，由 Chromium 内嵌 PDF 渲染器消费该 URL。DOCX 由 Mammoth 转为结构化 HTML 后放进禁用脚本的 sandbox iframe；旧 DOC 由 `word-extractor` 提取正文，并在文档阅读表面中展示。这些路径都不会激活 Browser 面板。HTML／HTM 是下文所述的明确例外：只有轮尾产物卡行内“打开”操作会在 Browser 中运行页面，点击文件主体或产物面板首页行仍在 Artifact 查看源码。

产物文件行与实例加载态统一使用共享的 Material `FileIcon`／`FileLabel`。Provider 同时贡献去重后的 basename 标签和 `tabFilePaths`，因此 Artifact tabs 携带相同的文件身份，而非文件型 Workbench tabs 不受影响。从对话 Read 行直接打开、但从未进入产物列表的路径也会加入这份映射，并由同一个工作区 reader 渲染完整内容。

HTML／HTM 仍然是同一份官方产物列表中的普通文件，不引入第二套产物注册表或事件。它们在每轮产物卡中的文件行最右侧增加分裂式「打开」控件；主操作复用「查看」的 28px 透明按钮、11px 字体与 hover 处理，产物面板首页仍是普通整行源码入口：主按钮及菜单中的「在 DeepCreator 中打开」先从 `remote.artifacts.preview` 获取经过工作区围栏的 loopback 预览 URL，再通过公共 Presentation Client 显式指定 `browserId: "iab"`；Browser URL resolver 创建准确的内置浏览器 Tab，现有 Workbench Browser Presenter 负责可见性与挂载回执。「在系统浏览器中打开」则把真实 HTML 路径交给官方 Workspace／OS 路径开启器。点击分裂控件之外的文件行仍打开只读源码 Artifact 标签。

内容渲染走 `deepcreator.workbench.artifact.renderer` 槽(由 `ui-workbench` 声明,面板经 `renderArtifact` owner prop 消费)。本包注册 `code` 渲染器:文本产物使用共享 `CodeSurface` 渲染为与 Review 一致的完整文件行网格(行号 gutter＋内容列，不含 Diff 符号、增删底色与词级标记)。扩展名能映射到已注册文法时,Shiki token 继续走 `data-code-theme` 配色链;未知扩展名只退化为无语法着色的逐行纯文本,不再切换为另一套 `<pre>` 版式。内容按面板宽度软换行且不自涂底色。

Markdown 与 MDX 实例会在固定的“打开所在文件夹”动作左侧显示紧凑的纯图标“预览｜代码”分段按钮：预览使用产品提供的眼睛 SVG，代码使用产品绘制的 `</>` SVG；两项都提供本地化 hover／focus 提示与可访问名称。“预览”为默认值，直接使用已结算对话正文同款的共享 `MarkdownText` 管线，因此 GFM、数学公式、代码围栏与不受信任链接策略完全一致。无 scheme 的图片地址（如 `./images/chart.png`）及其引用式写法以当前 Markdown 文件所在目录为基准解析；面板经工作区围栏保护的 `artifacts.read` 边界对每条不同路径只读取一次，且仅把图片类型返回的 loopback HTTP URL 交给 `MarkdownText`。逃逸工作区的路径、绝对本地路径、`file:` URL 与非图片结果继续显示 alt 文本，原有 HTTP(S) 图片则仍直接渲染。面板全宽滚动表面继续负责溢出，预览文档以 `width: 100%` 在共享的 `--dsh-reading-content-width` 最大宽度内居中；窄面板会自然收缩，滚动条仍贴合面板边缘。“代码”切回已注册 renderer 的 `document` CodeSurface（无外部 margin，带竖向分隔线的行号 gutter，正文列内部保留 padding）。选择在面板本次挂载期间按文件独立记忆；非 Markdown 文件不显示该按钮。

类型入口图标在会话出现用户尚未查看的新文件产物或新计划时于右上角显示蓝点:已见水位仅在面板组可见时推进(隐藏的组保持 mounted,因此隐藏面板时蓝点持续,直到打开)。

二进制输出仍保留在 Review 的仓库事实中，供提交核对与撤销使用，但对话 Turn 的变更卡不再列出二进制行。因此同一图片、PDF 或 Office 文档只作为产物出现，不再同时重复成一条源码变更。

截断窗口语义:当一轮的 `turn/start` 位于未加载的旧页时,该轮在旧页加载前不可见——与其他会话投影语义一致;无 start 的更新事件是惰性的。
