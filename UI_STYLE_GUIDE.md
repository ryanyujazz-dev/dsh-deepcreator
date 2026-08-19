# DeepCreator UI 样式规范

本规范约束本仓库中的自定义桌面 UI。DeepSeek Harness 仅提供 Host、协议、slot、基础组件和主题变量；视觉与交互问题默认在本仓库解决。只有现有插件接口或主题变量无法表达需求时，才修改 Harness，并继续通过 Cordis 注册、slot 或主题变量向插件开放能力。

## 字体

- 界面只通过真实字号和行高排版，不使用 `transform: scale()`、页面缩放或位图缩放模拟字号。
- 正文文字大小由外观设置统一选择，并与侧边栏字号同步：小为 13px／20px，标准为 14px／22px，大为 15px／24px。三种渲染模式只消费正文 token，不各自硬编码字号。执行流卡片内的代码表面（Diff、Read、Terminal、路径与 `+N -N`）同样跟随该设置缩放：小 11px／16px，标准 12px／18px，大 13px／20px，由 ui-theme 的 transcript tokens 统一下发 `--dsw-font-markdown-code-block-small` 族，标准档与独立代码块的静态默认保持一致。
- 侧边栏使用与同一外观选项对应、但独立于正文行高的角色：小为 13px／20px、28px 容器；标准为 14px／22px、30px 容器；大为 15px／24px、32px 容器。侧边栏字重固定为与正文一致的 400；品牌名不受该文字角色约束。
- 对话标题栏文字跟随侧边栏的 13px、14px、15px 三档，但 48px 框架高度保持不变。设置页正文及其菜单保留 12px／18px 的固定界面角色；菜单项、触发按钮和对应设置项不得各自硬编码不同字号。
- 通用设置中的顶层 block 之间使用 24px 垂直间距；分隔线只存在于所属 block 内。「偏好」分组拥有标题、组内行几何与分隔线，功能插件通过 `deepcreator.settings.preferences.item` 贡献自己的设置行。
- 「默认渲染模式」属于 `ui-conversation`，在「偏好」中使用「原生／经典／思考」分段选择，初始值为「经典」。设置页与当前会话标题栏是同一个双向同步控件：任一处切换都会立即更新当前会话、另一处的选中态以及后续新会话的默认值。插件额外注册但未进入偏好选项的模式只写入当前会话；首选模式不可用时回退到「原生」。
- 会话正文、Think、上下文注入、折叠工具行、执行聚合行、运行中工具草稿、压缩和错误状态统一使用 `--dsh-conversation-flow-font`。会话框架将它映射到 Harness 的 `--dsw-font-markdown-base`，因此外观设置中的小、标准、大会同步作用于三种渲染模式。
- 模型输出中的 Markdown 表格、列表、引用和普通段落使用同一正文字号与行高。表头只能通过字重表达层级，不得另设字号；表格单元格随小、标准、大同步变化。
- 行内代码使用正文对应的代码 token，始终比正文小 2px：小为 12px，标准为 13px，大为 14px；表格内行内代码不得再覆盖为固定字号。
- 展开后的工具输入、输出、终端、代码、Diff 与结构化上下文属于紧凑详情，使用 `--dsw-font-markdown-code-block-small`。紧凑详情不得反向影响折叠标题和摘要。
- 对话输入框的用户输入、placeholder、装饰 backdrop 与高度 mirror 必须共同消费 `--dsw-font-markdown-base`，随小、标准、大同步改变字号、行高和 400 字重；输入区的模型、权限、发送等控件仍使用界面角色。
- 普通界面、对话正文、执行流、侧边栏、对话标题栏和代码使用 CSS 400 字重；当前标题、表头和其他明确强调保留 500 或 600。
- 字体平滑由应用根节点统一配置；组件不得单独覆盖抗锯齿，也不得通过不透明度或滤镜制造“更细”的字体。

## 代码外观与 Diff

- 「Code appearance」分别保存浅色与深色代码主题，二者互不覆盖。可选主题为 DeepCreator、GitHub 与 One 的 Light／Dark 版本；设置页左右预览始终强制使用正在配置的明暗主题，不跟随当前应用外观。代码主题与代码字体选择器复用设置页公共选择器（见「控件和菜单」），不得改回原生 `<select>` 或胶囊形态。
- 代码字体只提供 System Mono、JetBrains Mono、Fira Code 与 Source Code Pro 四个预设。选中的字体同时作用于 Markdown 代码块、Read、Diff、行内代码和 xterm；终端响应字体变化后必须更新 xterm fontFamily 并重新 fit，不得闪烁或裁切。
- 命名代码主题拥有编辑器前景／背景，以及插入／删除的行级与词级半透明背景；Diff 背景不得完全不透明，以免遮蔽语法前景。行号、`+/-`、折叠按钮、路径和卡片 chrome 属于应用语义，不随代码主题换色。`prefers-contrast: more` 与 forced-colors 必须作为最后一层覆盖。
- 公共 Diff 行固定为「单行号 gutter／增删符号／代码内容」三列。删除行显示旧行号，新增行和 context 显示新行号；缺少官方起始行元数据的历史记录行号留空。内容使用软换行与安全断词；续行不得重复行号或符号，整条视觉行仍保留对应 Diff 背景。
- 删除块与新增块使用词级标记精化，但不得破坏 Shiki token 边界、粗体、斜体或下划线。长替换块可只保留行级 Diff。长 context 仅保留变更上下各 3 行，并在原位置插入「⋯ 展开 N 行」FoldRow；Review 必须利用完整文件快照把 unified patch 省略的文件头、hunk 间隔与文件尾同样还原为可展开 FoldRow。通用 head/tail 高度上限也必须使用位于截断位置的 FoldRow，不得在卡片底部另放展开按钮。点击只展开该 FoldRow 所代表的全部行，状态由当前 Diff 组件本地持有。
- 对话中的 Edit／Write 以独立圆角 hunk 卡片显示完整路径和真实 `+N -N`。Review 内容区不得使用文件栏／Diff 的左右布局，而是一个纵向滚动的可折叠文件列表；文件 Header 显示路径和 `+N -N`，使用 sticky 吸附到内容区顶部，并在下一个文件 Header 到达时由后者自然顶替。同一文件展开后可有多个 hunk；staged（HEAD → index）与 working tree（index → worktree）必须明确分层，rename/copy 显示旧新路径，二进制变化显示明确状态。Review 保持只读，不得出现 stage、discard 或 commit。
- 对话中变更行（Edit／Write，以及任何以 Diff 卡片为渲染意图的调用）摘要上的文件名链接是「查看该变更」的入口：优先聚焦右侧 Review 面板——未打开时先打开，刷新工作区状态后展开并滚动定位到对应文件（取代默认展开第一个文件）；文件不在当前变更中（如已提交）时保持列表，并在状态行下方显示一行携带目标路径的 miss 提示（10px／16px，tertiary 文字＋代码字体路径，随下次刷新清除）。未组合 Workbench 或 Review 类型时，同一链接回退为系统默认应用打开；Read 等其他工具行的文件名链接始终保持系统打开行为。
- Review 面板是会话级暖数据面而非冷列表：会话进入工作区即后台启动——先取状态，再依次（并发 1）预取每个变更文件的 Diff（设上限，超限文件按需加载），面板首次打开即全量就绪。预取与解析只做便宜的 hunk 合并与行对齐（毫秒级），任何重渲染不得重算 diff；整源语法高亮是原子长任务，必须渐进式——按快照（源文本＋语言）记忆化后在空闲期逐个执行（同一文件的全部 hunk 共享同一次高亮，展开时提升所属快照优先级），快照未就绪时该文件先渲染纯文本行、高亮完成后只重渲染该文件（不得广播整表）。状态刷新按文件合并而非整表重建——未变化的文件保留缓存与展开态，XY／rename 变化的文件携带缓存标记为待校验，离开列表的文件自然清除。打开面板即展开全部文件并聚焦列表顶部；从对话点击变更文件（reveal）驱动的打开保持聚焦目标文件、不重置为全部展开。就绪缓存超过安全上限按最久未展开淘汰，展开中的文件豁免。已落定的 Edit／Write／Bash 工具调用在后台防抖失效（单次编辑只定向校验对应文件，其余整表标记），受影响文件回到同一顺序队列后台刷新——会话后续改动只是后台增量刷新；用户手势（展开、reveal 聚焦）优先于队列立即取数。面板隐藏→可见沿触发一次静默刷新兜底；后台刷新静默失败并保留上次好数据，不得以错误横幅打断阅读。展开一个待校验文件时先立即显示缓存内容、后台校验替换。`git diff --check` 只在手动刷新与回合结束时运行，后台刷新与预取不得触发。Review 状态条在有变更时显示整体 +N／-N 计数（全部就绪条目按层累加），仅检查失败时才显示检查文案；每个层标题栏（「工作区／已暂存」行）尾部在该层用户展开过任意折叠行后出现「收起展开行」按钮（20px 命中框、仅重置该层的 hunk／gap 折叠态与行数上限），悬浮只提亮图标、不着色背景，标题栏改为两端对齐的 flex 行。吸顶文件标题的悬浮态必须保持不透明——由代码前景色 8% 混入代码底色计算（`--dsw-alias-fill-hover` token 未定义，任何使用它的悬浮规则都会失去背景）。Review Header 的刷新按钮左侧提供一个「全部展开／全部收起」单按钮：图标与动作语义随状态切换（向心双箭头＝全部收起、离心双箭头＝全部展开），两条横线等长，使用 16px 图形、28×28 命中框与 4px 间距，Tooltip 与 aria 使用动作文案，无变更文件时禁用；展开全部不得冻结主线程——滚动中接近视口只挂载轻量骨架（估算高度，滚动保持在合成器上），真实 diff 体在滚动停顿后逐帧填充（每帧一个，单文件手势直接填充），展开过的文件内容常驻 DOM、折叠只是隐藏（再展开零重建），未就绪／待校验文件只排入同一顺序队列逐个取数、不得并发请求，队列每处理完一个文件让出主线程。

## 插件边界

- UI 按功能域划分插件，不按 Model、ViewModel、View 建立三个全局插件集合。
- 功能插件内部允许使用 model-adapter、view-model 与 view 分层；官方 Runtime 始终拥有业务状态，DeepCreator Store 只拥有呈现状态。
- React 组件不得读取 Cordis context、直接调用 RPC 或自行订阅 Session；数据和操作通过 Slot 派生 Props 到达组件。
- 共用官方 Slot 的界面保留官方 Slot 名称；仅 DeepCreator 拥有的子界面使用 `deepcreator.*` 命名空间。

## 会话流

- normal、classic、think 三种渲染模式共享同一套正文语义变量，不按模式复制字号。
- 同一行的图标、标题、分隔点和摘要使用一致的基准行几何；字号与行高通过 `--dsw-font-markdown-base-font-size` 和 `--dsw-font-markdown-base-line-height` 跟随外观偏好，不固定为某个模式自己的像素值。
- 颜色只表达层级和状态，不以更小字号表达次要内容。标题、摘要可以使用不同 label token，但字号必须一致。
- 可展开行在折叠和展开状态保持同一标题字号；只有展开内容区允许使用紧凑详情字号。
- 执行流中展开的 Code、Bash、Skill 与其他工具共用同一条 1px 引导线：中心必须锚定标题行 16px leading glyph 的 x=8 轴，内容从 22px 标题列开始。`run_code` 的子调用由父 Code 节点持有引导线，子调用的 leading 图标必须从父级「Code」标题的左边界（22px 标题列）开始，且不得把父级引导线向右推移；圆角卡片不得自行绘制位于其裁剪边界之外的引导线。

## 控件和菜单

- 同级纯图标横排统一采用工作区标题右侧操作组的规格，并由全局 `--dsh-icon-toolbar-*` 度量约束：图形 14px、圆形命中框 28×28、相邻按钮间距 4px；默认使用 `--dsw-alias-label-secondary`，hover 只增加通用交互背景，显式选中态才提升为 primary，focus-visible 使用 business primary 轮廓。标题栏、Panel Header、消息操作条、队列操作条均遵循此规则；Review Header 的「全部展开／全部收起」自绘双箭头按钮使用 16px 图形作为唯一例外；树节点内嵌小操作、带文字按钮与表单主按钮不属于该规格。
- 分段按钮只表达同层级互斥选项；容器使用侧边栏背景色，选中项使用浮层表面且不绘制边框，不额外增加标题栏高度。
- 设置页选择器（Agent 预设、权限、语言、回车行为、代码主题、代码字体、界面字体）统一为同一公共 UI：无边框触发按钮＋Menu 原语＋14px 折角，36px 高、`--dsw-alias-bg-module-platform` 底、0 14px 内边距、折角与文字间距 12px、12px／18px 文字，hover 使用通用交互背景。形态统一为 10px 圆角矩形（Figma 'Selector' 的胶囊 r18 已废弃），不使用原生 `<select>`，也不得绘制边框。暂无真实选项的设置（如界面字体）同样复用该选择器，未实现选项以禁用占位项呈现。
- 菜单、Popover、Select 和 Tooltip 必须复用公共原语和主题 token。菜单项文字与对应页面正文处于同一基础字号，辅助说明只允许使用统一的 caption token。
- Composer 底行按自身可用宽度而非桌面 viewport 响应：空间足够时显示权限名称、模型名称和推理等级；宽度不足时，Access 只保留当前权限图标，Model 只保留 14px 大脑图标，两者仍为 28×28 命中框，完整状态继续由 `aria-label`、`title` 与原菜单提供。会话标题簇不足时，Agent preset（包括「创造模式」）同样只保留预设图标；容器恢复空间后必须自动恢复文字。
- 会话标题行的更多菜单严格按「置顶会话／取消置顶、分叉会话、归档会话、删除会话、分割线、在系统文件管理器中打开」排序。分割线左侧与带图标菜单项的文字起点对齐、右侧与文字尾部留白对齐，不得顶满卡片；Workspace／项目文件夹菜单不得提供置顶。删除会话是破坏性动作，菜单项使用 danger 样式（error 色文字/图标），点击后必须弹确认对话框（勾选「我了解此操作无法撤销」后按钮才可用），确认后永久删除该会话的日志与附件。macOS 使用“在 Finder 中打开”，Windows 使用“在资源管理器中打开”，其他或远程 Host 使用通用文件管理器文案。

## Workbench 右侧面板

- Workbench Mosaic／details 只负责几何和缩放，本身不绘制外框；Workbench 根容器四边统一保留 4px 内边距，底色保持 `--dsw-alias-bg-base`。每个 cell 必须使用公共 `WorkbenchPanelShell`：相对 cell 四边各留 4px，使用 10px 圆角与 1px semantic border，并由这个子容器统一裁切 Header 和 Body；卡片之间的缝隙因此为 4px＋4px 共 8px，与卡片到 Workbench 边缘的 4px 内边距形成有意的边缘／卡间区分。shell 卡片底色按主题分流：浅色主题与对话区底色一致（`--dsw-alias-bg-base`，纯白），使 workbench 与聊天读作同一表面；深色主题保持侧边栏表面 `--dsw-specific-sidebar-fill`（比对话区底色浅一阶）。审查面板吸顶的文件名栏与 diff 折叠行（「展开 x 行」）共用同一配方并形成三级层次：卡片／代码底色为基准，吸顶栏为代码前景色 5% 混入代码底色（不透明，遮住滚过的内容），折叠行为 2.5% 混入——恰为卡片底色与吸顶栏底色的中间值，两种主题下都随代码主题联动；DeepCreator Light 的代码底色为纯白 `#fff`；Terminal 画布、Diff 等全尺寸正文表面不得再自涂底色，必须透出 shell 表面，地址栏等真实输入控件仍可用 `--dsw-alias-bg-base` 形成内嵌层次。
- Workbench Panel Header 固定为 32px，内容垂直居中，保留 macOS 空白拖拽语义；Header 内的按钮、tabs 与输入框一律 `no-drag`。Header 下方必须直接进入内容区，Provider 不得再绘制副标题栏、元信息栏、地址栏或 Terminal 工具栏；需要保留的信息应进入正文，需要保留的操作应挂到公共 Header。
- 无 tabs 时 Header 标题与「新建 Tab」加号位于左侧；存在 tabs 时不重复显示类型标题，所有类型必须复用公共 `WorkbenchPanelTabs`。Tab 使用 26px 高、6px 圆角的轻量交互底色（比会话标题栏 24px 分段按钮高 2px），活动态以更强一阶的交互表面和 primary 文字表达，不再绘制底线；关闭按钮常显，hover 只把图标提亮为 primary，不绘制圆形底色。首个 Tab 的 6px 圆角与卡片 10px 圆角圆心在两轴上完全重合：横向 1px 边框＋3px Header 内边距＋6px，纵向 1px 边框＋3px 居中（26px tab 居中于 32px Header）＋6px；无 tabs 时的类型标题通过 `.leading` 自身 7px 内边距保持同样的 10px 视觉缩进。Home 路由（无「返回」按钮）下首个 Tab 保持这一同心对齐；instance 路由时「返回」按钮位于 Header 最左侧——3px 内边距＋28px 圆形命中框，14px glyph 的左缘恰好落在 10px 视觉缩进上——其后的 tabs 随按钮整体右移，不再追求与卡片圆角同心。Tab 内部按内容自适应：宽度贴合标签（上限 160px 截断、下限 56px 点击区），文字距 pill 左缘 9px，关闭图标保持约 7px 光学右缩进（4px margin＋图标居中 3px），不留下大片标签与图标之间的死区；标签文字通过 `-1px` 相对位移做垂直光学补正——居中的行盒内字体墨迹比 em 框中心低约 1px，行高无法移动它，补正后文字与关闭图标共用中轴。Tabs 占据左侧可滚动空间，「新建 Tab」加号紧跟最新标签的右侧；tab 显示名默认为实例 id，可由 Provider 通过 `contributePanelInfo()` 提供（终端使用 cwd 项目名、重名加序号），Group 标题／可访问名可携带 Provider 后缀（如「终端 · PowerShell」），但交互身份恒为实例 id；Provider 的其他操作以及展开／收起和关闭均在右侧，「返回」按钮例外——它固定在 Header 最左侧、位于 tabs 与类型标题之前。所有 Header 图标继续遵守 14px glyph、28×28 命中框和 4px 间距。
- Panel Header 的展开与收起按钮分别直接使用产品提供的 `arrow_up_left_and_arrow_down_right.svg` 与 `arrow_down_right_and_arrow_up_left.svg` 原始方向，不做镜像，并统一使用 `currentColor`；展开后的按钮 Tooltip 为“收起面板”。
- 类型入口位于 `conversation.session.header.utilities`，固定优先级为 Terminal、Artifact、Activity、Review、Preview（由各类型定义的 `order` 声明，入口条按其稳定排序；未声明 `order` 的类型按注册顺序排在有序类型之后），末尾固定保留 28×28 的「更多」按钮。入口使用 28×28 圆形命中框；关闭态透明且为 tertiary 图标。hover 的通用交互背景在开、关两态都保持显示（开启态规则不得声明 background，否则会以后序同特异度压制 hover）。开启态背景保持透明、仅将图标着色为对话框发送按钮同款业务蓝 `--dsw-alias-button-info-fill`（浅色 #3964FE、深色 #679EFE）；命中框本身不得以业务蓝或白色填充。
- 五类产品图标保持极简语义：Activity 为两行且每行都是「小圆圈＋横线」，Artifact 为折角文档页（右上折角＋两条文字横线），Review 为圆角方框内的上下 2:1 分区——加号占上方约 2/3、减号占底部约 1/3，Terminal 为无外框的折角提示符与一条横线，Preview 使用产品提供的 `play_fill.svg` 原始轮廓，转换为空心 `currentColor` 描边后在 16px 画布内居中缩放至 82%。合并态「面板」按钮继续使用项目内统一的 Workbench 面板图标。
- 五个类型入口是不可拆分的整组：空间足够时全部内联；整组无法容纳时全部收为一个独立的 28×28「面板」按钮。点击「面板」弹出完整类型菜单，当前可见类型显示勾选；空间恢复后自动还原五个入口。两种形态只投影同一可见性状态，不改变 Workbench 拓扑。
- 「更多」使用省略号图标，Tooltip 与 `aria-label` 均为「更多」。菜单仅分为「渲染模式」「会话」两组：渲染模式始终在首组，Session log 下载只出现在「会话」组；Workbench 类型不得进入「更多」。
- `aria-pressed` 只表示该类型 Group 此刻是否实际显示；Tooltip 必须使用“打开…面板／隐藏…面板”语义。多个类型同时显示时允许多个按钮同时点亮。因 Stage 变窄而落到右侧不可见列的类型与用户隐藏的类型都显示关闭态；点击前者会把它与真实拓扑左上角交换，点击后者会重新加入拓扑。
- 同类型实例进入同一 Group Header 的公共 pill tabs，不新建分屏格。活动 tab 使用 `--dsw-alias-interactive-bg-active` 与 primary 文字，普通 tab 使用 `--dsw-alias-interactive-bg-hover`；关闭按钮常显并保持键盘可达。
- 分割线使用透明的 8px 可命中区域，从零宽 grid 轨道居中叠加在相邻 `WorkbenchPanelShell` 的 4px＋4px margin 缝隙之上，正好覆盖整条缝隙且不占用布局宽度；视觉分隔由 margin 与圆角边框形成；支持 pointer resize 与方向对应的方向键 resize，focus-visible 使用 business primary outline。拖拽换算必须基于实时几何（列分割按可见列宽比例、上下分割按实测列高）把指针位移换算为布局增量，保证面板边缘 1:1 跟随鼠标，不得使用固定比例步进。布局固定为每列最多上下两个 Group：1／2 个类型为一列，3／4 个类型为两列，5 个类型为三列，不为数量变化制造独立卡片阴影。
- 第一列宽由首个类型决定：Activity／Artifact／Terminal 为 Stage 的 1/3，Review／Preview（内部 `browser` type）为 Stage 的 1/2；第二种类型沿用该列宽。新增第三种类型时两列等宽且 Workbench 为 Stage 的 1/2，新增第五种类型时三列等宽且 Workbench 为 Stage 的 2/3。每个 Panel 列的宽度下限为 150px，Conversation 的宽度下限为 360px。
- 删除一个 Group 时同列 sibling 填满高度；整列为空时仅移除该列，其他列保持实际像素宽度并整体贴住 Stage 右侧。Stage 变窄时从右至左隐藏整列，重新变宽后按当前真实拓扑恢复。点击响应式隐藏类型会与左上角类型交换真实位置；新增奇数列不足 150px 时，新类型原子覆盖左上角类型。
- 手动 Focus Layer 仍覆盖 Conversation Header、正文与 Workbench，但不覆盖 Sidebar；Escape 恢复 Mosaic。隐藏与响应式不可见 Group 均保持 Provider mounted，不得把可见性切换误当成资源关闭。
- Panel Body 的空态、disconnected 与 unavailable 必须明确区分。没有 Host Remote 时不得伪造 Artifact、Git、PTY 或 Browser 状态，也不得展示实际不支持的 stage/discard/commit 动作。
- Terminal Group 首次初始化且没有已打开 tabs 时必须自动进入一个终端 Tab：优先恢复当前 Session 下仍在运行的终端，没有可恢复实例才自动 spawn；用户不需要先点加号。该初始化每个 Session 只执行一次，之后关闭最后一个 Tab 不得立即强制重建，加号只用于创建额外终端。Terminal 不提供会话管理 Home／返回按钮，也不在 Header 提供 SIGINT 或终止按钮；所有 tabs 关闭后只显示简洁空态。关闭 Terminal Tab 直接终止并销毁对应 PTY，不显示确认弹窗；关闭 Terminal Group／面板只切换为隐藏，不终止任何 PTY 或清除 tabs。Terminal Body 使用全尺寸内嵌终端画布，不再出现独立命令输入框、发送按钮或逐行输出 `<pre>`。画布消费紧凑代码字体，获得焦点后直接接收 raw-key，保留 ANSI、光标、选择、滚动与全屏 TUI；Panel resize 必须同步 PTY cols/rows。
- Artifact 面板只读展示官方产物事实的投影列表（模型实际写入或编辑的文件，与对话 turn 尾部列出的完全一致），列表本身没有手动拉取或加载态（Header 刷新只重读当前实例内容）。行顺序固定为产出时间倒序，不依赖注册或到达顺序。行是整行按钮：最小高度 52px、8px 圆角、padding 8px 10px，标题为文件名 12px／500 单行省略；元信息行显示完整路径，10px／14px tertiary caption 层级、单行省略，相对时间右对齐使用同一 caption token；hover 只加通用交互背景，focus-visible 使用 business primary outline。空态必须区分「无产物（说明模型如何声明）」「读取失败」，全部走 locale 文案。实例内容区为全尺寸滚动表面，内置 `<pre>` 回退使用 12px／1.65 等宽紧凑排版；内容读取按路径键控，路径不变不得重读。
- Activity 面板 Home 路由是单页纵排：小写分区头（11px／500 tertiary、0.04em 字距、右缀计数）下辖「正在运行」「已结束」「子代理」三个分区，分区之间 14px 节奏。任务行沿用 Workbench 卡片文法（1px l1 边框、8px 圆角、fill-l1 底、运行中升为 fill-l2）：StateDot + 13px／500 单行省略 label + 11px tertiary 元信息行（kind · detail/状态词），右列为 mono tabular-nums 的两档单位时长（时分｜分秒｜秒，官方格式），运行行右下角为无边框「停止」文字按钮（hover 通用交互底色；乐观 stopping 态显示「停止中」并禁用，失败回退并在分区上方显示一行 alert 提示）。子代理行是整行按钮（32px 最小高）：StateDot（运行中 ongoing／空闲 done）+ 13px label + 右侧 11px 模式·状态 meta；hover 只加 4% 前景混入的通用交互底色，已开标签的行以 l2 边框标记。点击子代理经 `openInstance` 进入公共 WorkbenchPanelTabs（实例 id = 子会话 id，显示名走 `contributePanelInfo`）；标签页头部为 StateDot + 标题/状态行 + 右侧描边「在对话区打开」按钮，正文是 host 折叠的只读执行尾巴：用户提示为 fill-l1 圆角气泡、助手输出为 primary 12px pre-wrap 正文（streaming 态脉动）、工具行为 StateDot + mono 工具名 + 右对齐状态词，尾部流式时贴底跟随、省略历史以 caption 行提示。面板内不做输入——子代理的交互与完整执行流仍在对话区（官方 openSubagent）。标签页正文即主对话区经典模式（ExecFlowBody/compact）同款渲染：消息气泡、聚合工具运行槽（ExecutionSlot 单头多行、可展开）、markdown 助手输出；经典形态锁定，不出现 Think 切换芯片与渲染模式选择；父级追加的排队消息在流尾悬浮一张圆角排队卡片（复用 QueueDock 面板视觉：队列图标 +「排队中 N」计数头 + preview 列表），只读无编辑/删除/steer 按钮。首页子代理卡片运行中时，标题文字使用与标签页流式行相同的呼吸脉动（opacity 1→0.45，1.6s）表示执行中，不额外加动画色或进度条。
- 产物类型入口图标右上角的小蓝点是新产物提示：会话出现用户尚未查看的产物时点亮（8px 圆点、对话框发送按钮同款业务蓝 `--dsw-alias-button-info-fill`、以侧边栏表面色描边内嵌于 28px 命中框内）；已见水位仅在面板组可见时推进——隐藏的组保持 mounted，蓝点持续直到用户打开面板。

## 侧边栏

- 品牌名之外的所有侧边栏文字使用 `--dsw-font-sidebar-font-size` 与 `--dsw-font-sidebar-line-height`，共享行使用 `--dsw-sidebar-row-height`；不得在 Workspace、Session、新会话、搜索或设置行内另设字号。
- 「工作区」分区标题的左边界与上下行的首图标严格共线，统一使用 8px 行内左侧内边距。
- 侧边栏顶部主要操作必须放在无上下外边距、无内边距的列表容器中，并与项目／任务标题复用 `SidebarRow` 行几何；单行不得各自持有上下 margin，行间 2px 节奏统一由列表容器提供。当前顺序为「新会话」、「技能」占位、「定时任务」占位，两个占位均禁用。
- DeepCreator 自绘或产品专属图标必须放在独立产品图标模块并使用 `DeepCreatorIcon*` 命名，不得覆盖或混入复刻官方 `ic_ds_*` 与 Harness／Figma 资源的文件；产品界面显式引用产品图标，使两套资源可以独立升级。
- 48px 品牌行不持有底部外边距。主要操作列表之后的独立内容分区统一使用 `--dsh-sidebar-section-margin-top: 10px`，只设置 10px 顶部外边距、不设置底部外边距；当前 WorkspaceBrowser 与置顶区都必须消费这一节奏，分区内部标题不得再叠加顶部外边距。
- 会话置顶区是 WorkspaceBrowser 之前的独立侧边栏分区，顶部外边距同为 10px、无底部外边距，最多占侧边栏可用高度的 40% 并独立滚动。置顶会话不得在 Workspace 分组或单列表中重复出现；搜索时隐藏置顶分区但搜索结果仍可命中置顶会话。
- 侧边栏关闭后必须归零，不保留窄轨道、品牌图标或可聚焦控件。恢复按钮属于根框架：固定为 28px 圆形按钮，中心严格落在 48px 对话 Header 的 y=24；New Session hero 与活动对话必须使用同一位置。
- 对话 Header 无论侧边栏展开或关闭都固定使用 12px 左右内边距；关闭态窗口控件避让只能由标题簇内部安全位承担，不得改写 Header padding 或影响居中的视图切换器。
- macOS Desktop 隐藏系统标题栏但保留原生红黄绿窗口按钮。红灯可见左边界固定为 x=20，与下方「新会话」图标左边界共线；原生按钮与对话 Header 内容严格共用 y=24 中轴。绿灯与展开态品牌之间保留同红黄绿按钮一致的 9px 可见间距，字标使用 77px 行内安全间距并从 x=89 开始。关闭态恢复按钮的 28px 命中框从 x=82 开始，使其中 14px 面板图标的可见左边界同样落在 x=89；标题簇保留 98px 内部安全位，标题可见文字约从 x=118 开始。Windows／Linux 保留系统标题栏，渲染内容区内的恢复按钮固定在 x=16，关闭态标题簇保留 32px 内部安全位；Web 与其一致。
- 无标题栏窗口在 macOS Electron 根框架顶部保留 8px 兜底拖拽带，并将侧栏品牌 Header、对话 Header、无标题 Hero／加载态顶部 48px 与详情 Header 的所有视觉空白声明为原生拖窗区域；按钮、链接、输入、菜单触发器等真实交互元素必须显式 `no-drag`，不得被拖拽层覆盖，也不得通过伪造按钮替代 macOS 原生 traffic lights。Windows／Linux 保留系统标题栏，不在渲染内容区追加拖窗区域。

## 修改规则

任何后续 UI 调整都要同步检查本规范。新增渲染器必须消费语义变量和 slot，不得绕过插件注册直接修改宿主渲染分支。
