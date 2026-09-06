# App Stage UI/UX 方案

Status: **设计提案 v1.0 — 未实现**（由工作坊草案晋升，主席终审 `output/app-stage-ui/02-ui-verdicts.md`）。依据 `docs/design/app-stage.md` v0.0.6 与 `docs/design/app-stage-presence.md` v0.0.3 整合；视觉权威 = `UI_STYLE_GUIDE.md`。D1–D6 全部裁定；design-kit 全套采纳；对话坞（B9）与"对话｜应用"分段入口（B6）为用户拍板定稿。**实现纪律（用户定）**：`output/app-stage-prototype/` 的 HTML 原型仅是方向指引，最终 UI 一律以实际项目的组件、Slot 与 token 为准，与 `UI_STYLE_GUIDE.md` 冲突时以后者为准。所有组件名、token 名、locale 键均为暂定。

## 0. 设计原则：连续性 × 场所感

- **骨架连续**（硬约束）：App Stage 消费同一语义 token、同一圆角家族（12px 卡片 / 10px 面板）、同一 `--dsh-icon-toolbar-*` 图标按钮规格、同三档字号行高、同一交互底色阶梯（hover → active）；Sidebar 永不移动；模式切换复用 details Focus 的几何与曲线。用户从对话切到桌面，操作语法（点按、菜单、悬停底色、Esc 层级）完全不变。
- **场所感来自排版密度反转**：对话是"行流"（垂直文本流、左对齐、阅读宽度 748px）；桌面是"面阵"（网格图标墙、居中、更大留白、无卡片框的开放底面）。同一语言，不同文法——这是 OS 隐喻的呈现面，但不引入任何新控件语法。
- presence 已定稿的视觉（粒子三级强度 / 合成光标 / ghost / 32px 横幅 / 摘要卡 / 时间线行级内容）只做容器几何、入口与并置整合，规格一律以 presence 文档为准。
- **对话坞是"人机共用界面"的结构性承载**（主文档 v0.0.5 用户拍板）：对话与应用同屏是原生形态——边聊边看、看着桌面批发布；本方案按核心画面而非附加项对待（B9）。**坞 = 现有对话区的完整停靠，不是新面板容器**（实现模型见 B9）。

## A. 信息架构

### A.1 两个世界与切换模型

```
┌ conversation 世界 ─────┐   ┌ apps 世界（Stage 接管，Sidebar 不动）──────┐
│ Conversation+Workbench │ ⇄ │ AppStageLayer（常驻挂载，模式可见）        │
│ · 对话流(审批卡/chip)   │   │ · desktop Launcher 桌面（默认入口）        │
│ · Sidebar 分段按钮      │   │ · container 容器（前台 1，后台 N 挂载）     │
└────────────────────────┘   │ · timeline 活动时间线 · dock 对话坞（B9）   │
  切换：Sidebar 分段/Esc/返回  │ · 详情名片/开发中菜单 = desktop 上的浮层   │
                             └───────────────────────────────────────────┘
```

### A.2 状态机（用户视角）

- `conversation → apps.desktop`：Sidebar 分段按钮「应用」段（B6）、resolver 打开 installed 应用前的模式切换、chip 点击（跳 container）。
- **入口语义分层**（三级）：① Sidebar 分段按钮「对话｜应用」= **舞台模式**一级切换（B6，互斥单显）；② 右上「对话」开关 = apps 模式内的**对话坞停靠**开关（B9）；③ 「活动」「开发中」= apps 模式的功能入口（B3/B4）。三级各居其位不混用：世界切换只在 Sidebar、停靠只在 apps 顶栏、功能入口随桌面。
- `apps.desktop → apps.container`：点击图标墙条目；`apps.container → apps.desktop`：来源条「◀ 桌面」/ Esc / 返回手势（历史条目）。
- `apps.desktop ⇄ apps.timeline`：顶栏「活动」按钮；Esc/◀ 返回桌面。
- **坞维度（叠加于 desktop/container/timeline 之上）**：`apps.* ⇄ apps.docked`，右上「对话」开关（`Cmd/Ctrl+D`）或坍缩条开合；开合是舞台内推挤，非模式切换。审批等待且坞关：开关与坍缩条呼吸提示（不自动弹出，锁定项），点击任一 = 坞开 + 滚动定位到确认卡。
- 退出 apps：坞投影随之卸载、对话自动还原常驻舞台；坞开合与宽度为 root-scope transient，再入 apps 恢复离开前状态。
- `apps.* → conversation`：Sidebar 分段「对话」段、Esc（在 desktop 层时）、返回手势消费模式历史条目（对账规则照 app-stage.md：栈顶为本模式标记则主动 back）。
- 不变量与互斥：切会话/工作区不退出 apps、不动容器、Launcher 聚合不变（全局桌面）；进入 apps 自动退出 details Focus（锁定项）；手机端 apps 层与 mobileDetailsOpen 投影互斥（H-D1）。

## B. 逐画面方案

### B1. Launcher 桌面

```
┌ Stage(apps) ──────────────────────────────────────────────┐
│ ┌ 顶栏 48px ────────────────────────────────────────┐     │
│ │ 应用                     [对话◉] [开发中 ▾2]    │     │
│ └───────────────────────────────────────────────────┘     │
│   图标墙（auto-fill 96px 格 · 最近使用优先 · 不分区）        │
│   ┌──────┐ ●┌──────┐   ┌──────┐   icon 40px+名称(14/22)      │
│   │ icon │ │ icon │   │ icon │   ●=蓝点 8px 业务蓝右上内嵌   │
│   │ 看板 │ │ 追踪 │   │ 示例 │   版本 caption(12/18)        │
│   │v0.2.0│ │v0.1.0│   │v1.0 │   来源标注(12/18 tertiary,   │
│   │工作区A│ │工作区B│   │预装 │   工作区·相对时间,常驻单行)    │
│   └──────┘ └──────┘   └──────┘                            │
└────────────────────────────────────────────────────────────┘
```

- **状态**：空态（无任何已安装）＝一键冷启动为视觉主体；首用（预装示例在场）＝图标墙 + 「示例」来源标注 + **冷启动入口降级为图标墙上方的次级引导条**（F4 已裁：空态主按钮仅属"用户卸载全部"场景）；常态；损坏条目（图标降透明 45% + 状态角标，点击给错误条而非空白）；隐藏条目不占格。加载态：图标墙骨架（静态占位，不用 spinner）。
- **空态文案**：标题「你的应用桌面」；主按钮「让 AI 做一个应用」（创建 app-stage preset 会话并注入示例提示词）；次引导「正在开发的应用会出现在右上“开发中”菜单」。禁黑话：不说"app-stage 预设会话"。
- **交互**：单击图标 = 打开容器并置顶最近使用；Enter/Space 同；方向键 roving tabindex 移动；Menu/F10 或「⋯」行尾键 = 打开详情名片；双击无特殊语义。悬停 = 通用交互底色 + Tooltip 全名。蓝点点击后消水位。坞开时图标墙 auto-fill 自适配收窄重排（无专门窄态版式），来源标注保留单行渐消。
- **条目详情（人话名片，浮层 Sheet）**：description（纯文本）、最近版本首屏截图（16:9，生产线内环素材）、最近一次 AI 更新摘要（动作计数 + 变更清单来自摘要卡折叠）、首发来源（工作区+会话+时间）、开关「暂停自动更新」「从桌面隐藏」、按钮「卸载」（danger，确认对话明示删除应用与数据、dev 源码不受影响）。
- locale：`launcher.empty.*`、`tile.source`=`{workspace} · {time}`、`tile.badge.sample`=`示例`、`detail.*`。

### B2. 应用容器视图

```
┌ Stage(apps) ──────────────────────────────────────────────┐
│ ┌ 合并条 32px（来源条 = presence 横幅宿主，双层合一）─────┐ │
│ │ ◀桌面 │ 任务看板 v0.2.0 │ 来自 工作区A · 昨天 │ 有新版v0.3 ▸更新 │ ⋯ │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ [dev 态常驻角标: 开发预览 · 数据独立于正式版]        │ │
│ │ [提示条: 已更新至 v0.2.1 · 查看变化]  (自动消退)    │ │
│ │                sandbox iframe（铺满）               │ │
│ │  (粒子/光标/ghost=presence 层,本方案只给几何不重造)  │ │
│ └───────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

- **状态**：正常；dev 预览（常驻角标常显不灭，锁定项）；已更新提示（重载发生时一次，非静默换界面）；损坏错误条（「此应用文件已改动，无法打开」+「查看详情」「重新安装」）；路径不可达（仅 dev：可行动错误 + 关闭即逝退出）；协议失配（「此应用与当前版本不兼容」，损坏条目路径）；版本更新待确认（合并条尾部内联「更新」按钮，非模态不抢焦点）；加载（静态骨架）。
- **交互**：「◀ 桌面」/ Esc 返回；合并条右端「⋯」= 容器菜单（隐藏/卸载/暂停更新直达名片对应项）。用户在 iframe 内交互 = 租约级中断（presence X1，视觉由 presence 承担）。坞开时容器随 apps 区收窄（iframe resize，应用自响应宽度）。
- locale：`container.back`=`桌面`、`container.devBadge`=`开发预览 · 数据独立于正式版`、`container.updated`=`已更新至 v{version}`、`error.broken/runtime.unreachable/platform.unsupported` 全部给用户语言一句话 + 动作。

### B3. 开发中菜单

```
        ┌ 下拉（Menu 原语 · 贴右上按钮 · 320px）─────────┐
        │ 开发中 · 2 个工作区                [刷新图标]  │
        │ ▾ 工作区A                                      │
        │   ┌────────────────────────────────────────┐  │
        │   │ 看板  v0.2.0      可更新 ▮   [预览]      │  │
        │   │ 笔记  v0.1.0                   [预览]    │  │
        │ │ ▸ 工作区B（与已安装同名条目加对比标注）      │  │
        │ └────────────────────────────────────────┘  │
        │ 空态：还没有开发中的应用——让 AI 写一个      │
        └───────────────────────────────────────────────┘
```

- **并置（锁定项 + 本方案优先级设计）**：顶栏右上按钮簇 = **[对话 ◉] [活动 ◉] [开发中 ▾]**，同一簇、同一 `--dsh-icon-toolbar-*` 规格。空间序为本方案建议（主文档为枚举序）：**对话开关居首**——它承载最高频动作与审批等待呼吸态，是"人机共用界面"的锚点；活动入口次之（视图切换 + 未读蓝点）；开发中菜单为下拉工具收居最右角落（沿用原位，下拉锚定屏幕角落稳定）。对话开关开启态 = 图标业务蓝 + 透明底（Workbench 类型入口先例）+ `aria-pressed`；呼吸提示态见 B9。开发中按钮右上角标 = ready 条目数；可更新条目在行内以小角标「可更新」表达。仅列 ready；被闸拒绝条目不进菜单（诊断走会话内 `app_list`）。
- **交互**：默认点击条目 = 聚焦 Sidebar 对应工作区（不切 Stage）；行尾「预览」= Stage 临时容器（普通会话首次弹轻确认，preset 会话免确认）；工作区分组头可折叠；同名工作区附路径尾段消歧；「无监听」工作区组头加 tertiary 标注。
- locale：`devmenu.title`=`开发中`、`devmenu.updateBadge`=`可更新`、`devmenu.noWatch`=`无监听`、`devmenu.empty.*`。

### B4. 活动时间线

```
┌ Stage(apps)·活动 ──────────────────────────────────────────┐
│ ◀ 桌面    活动记录                       [全部标为已读]     │
│ ┌ 列表（行级内容与回放语义 = presence §3.6 已定）──────────┐│
│ │ 14:32 任务看板 · 新建卡片 createTask   ✓ 0.8s   [回放 ▶] ││
│ │ 14:30 任务看板 · 数据写入 board.tasks ✓ 0.2s             ││
│ │ 13:05 任务看板 · 发布 v0.2.0 ✓ 来自 工作区A    [回放 ▶]  ││
│ └───────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
（行级内容与回放语义 = presence §3.6 已定；聚合仅 installed origin，全局单水位）
```

- **状态**：空（「AI 还没有操作过应用。安装的应用被 AI 使用后会在这里留下记录。」）；加载；尾部「加载更早」。
- **交互**：行 = 时间/应用/动作/结果状态/耗时（presence 定义的行结构）；「回放」进入 replay 模式（2–4× 重演，角标「回放·基于日志重演」，Px-δ）；未读活动在顶栏「活动」按钮给蓝点，打开即推进水位。
- locale：`timeline.title`=`活动`、`timeline.empty.*`、`timeline.markRead`=`全部标为已读`。

### B5. 对话内审批卡（conversation node，keyed 注册）

```
┌ 对话流内卡片（ConversationFileCard 同族 chrome）───────────┐
│ ✦ 应用发布确认                                   [▸ 折叠]  │
│ ┌ 首屏截图 16:9（app-dev 内环自测产物）─────────────────┐  │
│ └─────────────────────────────────────────────────────┘  │
│ 任务看板 v0.1.0 · 来自 工作区A · 会话「周报整理」           │
│ 将获得的能力（3）：新建卡片 / 移动卡片 / 关闭卡片           │
│ 零外联扫描：未发现外联模式                    │
│ 首次发布将安装到你的全局桌面，可随时移除。                    │
│                         [暂不安装]   [安装到桌面]           │
└──────────────────────────────────────────────────────────┘
```

- **形态族**：富卡（首发）如上；轻确认卡（来源漂移）＝同族窄卡，无截图无能力清单，正文「此更新来自不同工作区（原安装来自 {workspace}）。仍要更新吗？」+ [取消][更新]；预览确认卡（普通会话首次 dev 预览）＝「此应用未经发布检查，确认预览？」+ [取消][预览]。三卡共用一套 chrome 与按钮语法，只差信息密度。
- **状态**：挂起等待（主按钮 loading，卡片不可关闭）；已批准（转普通摘要行）；已拒绝（如实记 USER_DECLINED，灰化留痕）。
- **渲染位**：conversation keyed node——常驻对话舞台与**对话坞内与消息同流渲染**（B9），一处状态两处呈现（挂起/批准/拒绝即时同步）；用户看着桌面批发布是坞的核心场景。
- **交互**：Enter = 主操作；按钮 disabled 直到卡片可见；manifest 字段纯文本渲染（锁定注入纪律）；扫描摘要措辞 = 中性陈述机器扫描结果，禁「安全」判断词与 ✓/勾选符号（presence 铁律 4 禁背书，主席已裁）。
- locale：`approval.rich.*`、`approval.drift.*`、`approval.preview.*`；「可随时移除」= `approval.reversible`。

### B6. 舞台模式分段按钮与活动 chip（对话模式后台信号）

```
┌ Sidebar（展开）──────────┐    ┌ Conversation ──────────────┐
│ [品牌行]                 │    │ ┌ chip: ◉ AI 正在操作 任务看板 ›┐
│ ┌ 分段（Shell 级）──────┐ │    │ └────────────────────────────┘
│ │ [对话]│[应用 ◉]       │ │    │ （chip 吸附 Header 下方不遮挡） │
│ └──────────────────────┘ │    └──────────────────────────────┘
│ ＋ 新会话 / [定时任务](禁用)│    窄栏（collapsed）：收成单图标切换器
└──────────────────────────┘    [💬/▤ ◉] 28px——当前模式图标+另一模式
                                 活动点在位；点击切换；Tooltip 两模式名
```
- **形态**：分段按钮"对话｜应用"＝对话 Header"对话｜轨迹"视图切换同族（`.viewSwitcher` 先例：`role="tablist"` + 8px 圆角容器 sidebar 底色 + 分段 `role="tab"`/`aria-selected`；选中段浮层表面无边框——UI_STYLE_GUIDE 分段按钮条款）；**Shell 级 chrome**，位于 Brand 行与新会话行之间、primary 列表之外（原 `sidebar.primary.action` 席位方案废弃，主文档已改；归属 ui-sidebar Shell 持有或顶部 Slot 注入，实现期定）。选中段 = 当前舞台模式。
- **活动点**："应用"段右上 8px 业务蓝点（NoticeDot），与 conversation 侧 chip **同源同灭**（presence §3.5）；conversation 模式下点"应用"段 = 切 apps 模式（有活动时直接进该容器）。
- **窄栏态（collapsed）**：收成**单图标切换器**（28px 命中框：当前模式图标 + 另一模式活动点在位；点击切换；hover Tooltip 两模式名）——窄栏 48px 容不下双段文字，单图标保持"一处一义"且活动点可见性不降级。
- **规则**（chip）：chip 是信号不是投影——不渲染应用画面、不播粒子；亮 = 有活跃后台动作，静默即退；点击 = 切 apps 并前置该容器。apps 模式下"边聊边看"由对话坞原生承载（跟随视图像保留给"AI 操作用户未在看的应用"场景）。
- **状态**：无活动（chip 不占位、点不亮）；多应用并发（chip 最近一个 + 计数「等 2 个应用」）；窄栏有活动（图标右上活动点常亮）。
- locale：`seg.conversation`=`对话`、`seg.apps`=`应用`（与开发中菜单「开发中」词汇区分：段=世界，菜单=生产线状态）；`chip.acting`=`AI 正在操作 {app}`、`chip.more`=`等 {count} 个应用`、`seg.rail.toggle`=`切换到{mode}`。

### B7. 模式切换动效（conversation ⇄ apps）

```
进入：conversation 内容冻结宽度+原位淡出(150ms) ─┐
  AppStageLayer 以 inset:0 0 0 var(--dsh-stage-left)   │ 同一曲线
  从右侧推入 + 淡入；Sidebar 轨道不动              │ --ds-transition-
  grid-template-columns 亦走 slow 曲线（AppFrame 先例）│ duration-slow
退出：镜像；若栈顶为模式历史条目则 history.back() 消费  ┘ --ds-ease-in-out
```

- 几何与 details Focus 完全一致（锁定项）；进入/退出互斥 details Focus；手机端为全 Stage 覆盖投影（先例 `mobileDetailsOpen`），进入压 `pushState({deepcreatorStageApps:true})`，返回手势消费。
- 焦点：进入 apps → 焦点移至顶栏或图标墙首项；退出 → 归还切换前焦点元素；aria-live 播「已切换到应用桌面 / 已返回对话」（polite）。

### B8. 系统级错误（用户语言翻译）

```
┌ Stage(apps) ──────────────────────────────────┐
│ [容器A] [容器B 已收起] [容器C]                  │
│   ┌ 非模态横幅（ConnectionBanner 同族）─────────┐ │
│   │ 同时打开的应用较多，已关闭最早打开的「看板」。 │ │
│   │ 查看桌面上的应用 →                          │ │
│   └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

- 原则（锁定）：工程错误码只进日志与 agent 诊断面；用户看到的是一句可行动中文 + 一个动作。护栏关闭容器 = 容器回桌面收起态（非删除），横幅给出恢复入口；不使用警告红/感叹号制造焦虑（presence 措辞纪律同源）。
- locale：`system.guard.limit`、`system.generic`=`出了点问题，{action}`。

### B9. 对话坞（apps 模式的结构性画面，Phase 1a）

- **实现模型**：坞 = 现有对话区的**完整停靠**，不是新面板容器——ui-layout 三列网格的 apps+坞开态变体：apps 收窄 + 对话子树（Conversation+Workbench）以停靠几何整体渲染于舞台右带；消息流/输入框/确认卡/Workbench **行为原样**，不设计"坞内对话"新形态（mobileDetails"同子树投影、不复制组件"先例的推广）。B5 三卡形态不变只换宿主，一处状态两处同步。

```
子态① 坞开·纯对话（Launcher 同理收窄重排）
┌ apps 区（右缘让出坞宽）──────────┐▎┌ 坞 ──────────┐
│ 顶栏 应用  [对话◉][开发中▾]        │▎│ (消息流)      │
│ ┌ 合并条 ◀桌面│看板 v0.2.0 ────┐ │▎│ ┌发布确认───┐ │
│ │     sandbox iframe          │ │▎│ │截图·能力清单│ │
│ │ （看着看板，坞内直接批准）      │ │▎│ │[暂不][安装] │ │
│ └─────────────────────────────┘ │▎│ [输入框 ▤发送]│
└──────────────────────────────────┘▎└──────────────┘
子态② 坞开·Workbench 单面板铺满坞带
┌ apps 区（同①收窄，内容不变）─────┐▎┌ 坞 ──────────┐
│                                 │▎│ 对话Header+类型入口│
│      （apps 区不受面板影响）      │▎│ ┌面板铺满坞带┐│
│                                 │▎│ │ Workbench  ││
│                                 │▎│ │ 单块·行为原样│
└──────────────────────────────────┘▎└──────────────┘
 ▎=坞左缘 8px 拖拽条（hover 显 1px 线）；坞关时同位留 ▐ 坍缩条（对话图标·恢复记忆档位）
```

- **子态清单**：① 坞开·纯对话；② 坞开·Workbench 单面板**铺满坞带**（不浮于应用上；同一时刻仅一块，打开下一块隐藏上一块——类型入口/Esc 收回到对话流，details 既有开合语义；窄坞 ≤560px 容不下三列 Mosaic（150px×3 下限），单面板铺满是几何必然而非新规则，见 H-F9）；③ 坞收起（坍缩条；审批等待时承载呼吸态）；④ 审批等待且坞关（开关+坍缩条双呼吸，不自动弹出，锁定项）。
- **宽度三档** 320/400/560px：拖拽连续跟手、松手吸附最近档（4px 内不跳档），记忆档位；560 档仅 Stage ≥1200px 可选，窄 Stage 自动落 400（主席建议值）。呼吸参数：opacity 1→0.45 · 1.6s 循环（Activity 呼吸先例，无新色）；Tooltip「有发布等待确认」；presence waiting-approve 横幅在容器合并条同步承载。
- **交互**：开关/`Cmd/Ctrl+D` 开合（键位实现期核平台惯例）；拖拽条调宽（pointer capture+rAF、拖拽中无过渡；方向键逐档——splitter 先例）；退出 apps 自动还原常驻对话舞台；开合与档位 root transient（再入恢复）；切会话/工作区不收起；开坞不抢焦点；Esc 链不因坞改变。
- locale：`dock.toggle.open/close`=`打开对话坞／收起对话坞`、`dock.tab.expand`（坍缩条）、`dock.waiting`=`有发布等待确认`、`dock.width.narrow/medium/wide`（Tooltip 档位名，可选）。

## C. 组件清单（新建；能映射现有基件的不新造）

| # | 组件 | 职责 | 所用基件 | Phase |
|---|---|---|---|---|
| 1 | AppStageLayer | 席位 occupant 根：模式投影几何、三重暂停门控、历史对账 | —（布局壳） | 1a |
| 2 | AppStageTopBar | 顶栏 48px：标题 + 三键簇宿主 [对话(DockToggle)/活动/开发中]（icon-toolbar 规格） | Button/Tooltip | 1a |
| 3 | LauncherView | 桌面：图标墙容器、空态/首用/骨架 | OnboardingSurface（参考） | 1a |
| 4 | AppTile | 图标墙条目：icon/名称/版本/来源/蓝点/损坏降透明 | Button/Tooltip/OverflowFadeText/NoticeDot | 1a |
| 5 | AppDetailSheet | 人话名片浮层：截图/AI 更新摘要/来源/三开关 | Modal/Button/StateDot | 1b |
| 6 | DevAppsMenu | 开发中下拉：工作区分组/可更新角标/预览 | Menu/SidebarRow（几何参考） | 1a |
| 7 | AppContainerView | 沙箱容器壳：iframe 铺满、加载/错误态 | — | 1a |
| 8 | AppSourceBar | 32px 合并条：来源/dev 角标/更新入口/presence 横幅宿主 | WorkbenchPanelShell（几何参考） | 1a |
| 9 | ContainerNotice | 已更新提示/损坏/不可达/待确认 非模态条 | ConnectionBanner/Toast（几何参考） | 1a |
| 10 | PublishApprovalCard | 首发富卡（conversation node keyed 注册） | ConversationFileCard 族/Button | 1b |
| 11 | LightConfirmCard | 轻确认卡（漂移/预览确认） | Button | 1b |
| 12 | ActivityTimeline | 时间线列表 + 回放入口 | DisclosureRow/StateDot/Button | 1b 骨架（回放 Px-δ） |
| 13 | ActivityChip | 对话侧活动 chip | Pill | 2 |
| 14 | StageModeSegmented | Sidebar 分段按钮「对话｜应用」（.viewSwitcher 同族 tablist）+「应用」段活动点 + 窄栏单图标切换；Shell 级 chrome（原 sidebar.primary.action 席位方案废弃，ui-sidebar Shell 持有或顶部 Slot 注入，实现期定） | —（自绘分段；NoticeDot） | 1a（点亮随 Px-α） |
| 15 | SummaryCard | 摘要卡（**规格 presence §3.6 已定，仅实现**） | Toast 几何变体 | Px-α |
| 16 | NoticeDot → ui-primitives | 8px 业务蓝未读点提取为共享原子（Artifact 入口/Launcher/时间线三处同形） | — | 1a |
| 17 | ConversationDock（**布局模式，非新容器**） | ui-layout 停靠几何变体：apps 收窄 + 对话子树右停靠 + 坞域面板投影；拖拽/方向键三档吸附、坍缩条、开合与档位 root transient | 映射 ui-layout 网格变更（DragHandle/splitter 几何参考 AppFrame），非新基件 | 1a |
| 18 | DockToggle | 顶栏对话开关：开合坞（含 Cmd/Ctrl+D）、开启态 `aria-pressed` + 业务蓝、审批等待呼吸态 | Button/Tooltip | 1a |

design-kit 的 5 个组件属 preset 资产（见 E），不计入本表。审批卡的挂起数据通道是基础设施问题（H-D3），卡片形态不依赖其结论。

## D. 设计语言增补

- **新语义 token（提议，登记入 UI_STYLE_GUIDE 同变更）**：
  - `--dsh-presence-info-strong / --dsh-presence-info-soft`：粒子信息态两档（presence §3.1 已定纪律：色相与 error/warning 分离、不编码授权来源；具体取值待 H-D2 裁决，方向＝浅/深主题各从 accent 与 surface 校准对比度）。
  - `--dsh-app-tile-size: 96px`、`--dsh-app-icon-size: 40px`：图标墙网格度量。
  - `--dsh-dock-width`：坞宽运行时变量（三档 320/400/560px 之一，presentation state，不入 guide 值表）；apps 层几何变为 `inset: 0 var(--dsh-dock-width, 0) 0 var(--dsh-stage-left)`。坞呼吸动效复用 Activity 呼吸先例（opacity 脉动），不新增 token。
- **复用不新增**：蓝点沿用 `--dsw-alias-button-info-fill`（Artifact 蓝点先例 8px 内嵌）；活动点同色；交互底色用 `--dsw-alias-interactive-bg-hover/active` 阶梯；桌面底 `--dsw-alias-bg-base`；顶栏与对话 Header 同 48px、同字号档；合并条 32px＝Workbench Panel Header 同族（`--dsw-font-xxs-12/xxs-strong-12`）。
- **排版与密度**：全部文字走 `UI_STYLE_GUIDE` 三档外观设置（正文/侧边栏/caption token），不自立字号；图标墙是唯一新增密度（96px 格），以 caption 承载版本与来源，不缩小到 10px 以下。
- **图标策略**：应用图标 = manifest 受控资源（`<img>` 加载，svg/png ≤256KiB）；缺省回退产品 glyph `DeepCreatorIconAppDefault`（新增自绘产品图标，独立模块命名守规矩）；顶栏/菜单图标全部走 14px glyph + 28px 命中框。

## E. 应用设计套件（design-kit）规格

定位：给 AI 手写应用的"引用即体面"基线——零外链红线下的视觉杠杆。**纯静态、零构建、零依赖**：两份 CSS + 一份 README + 每组件参考页，`cp -r` 进应用目录即可用。

### E.1 目录结构（preset `skills/assets/design-kit/`，stamp 防投毒覆盖）

```
design-kit/
├─ README.md         # 引用规则与组件索引（app-dev 技能互引）
├─ tokens.css        # 语义 token 子集（深浅双主题）
├─ kit.css           # 5 组件样式（类名 API）
└─ reference/        # button/input/card/list/tag 五个可直接打开的样例页
```

### E.2 token 清单（主产品 token 子集化，前缀 `dc-`）

- 色（10）：`bg-base / surface / border / label-1 / label-2 / label-3 / primary / accent / success / error`。取值来自当前浅/深主题校准值快照；`@media (prefers-color-scheme)` 自动切换 + `data-dc-theme` 手动覆盖。accent 复用业务蓝（浅 #3964FE / 深 #679EFE）。
- 字（4）：`--dc-font-body: 14px/22px`、`--dc-font-caption: 12px/18px`、`--dc-font-title: 16px/24px`、`--dc-font-mono: 13px/20px`（系统字体栈，禁任何字体下载）。
- 间距（5）：`--dc-space-1..5 = 4/8/12/16/24px`。圆角（3）：`--dc-radius-s/m/l = 6/8/12px`。阴影（1）：`--dc-shadow-card`（Workbench 浅色档柔和阴影）。

### E.3 组件（类名即 API；"props"= 变体/尺寸/状态）

| 组件 | API | 视觉规则 |
|---|---|---|
| dc-btn | `dc-btn --primary/--soft/--ghost/--danger` `--sm/--md` | 高 28/32px、圆角 6/8、字 caption/body；primary=accent 填充反白字，soft=交互底，ghost=透明+hover 底，danger=error 填充；focus-visible 恒 primary 轮廓；disabled 45% 透明 |
| dc-input | `dc-input` `--multiline` `--invalid` | 高 32px、圆角 8、1px border、placeholder=label-3；focus=primary 描边；invalid=error 描边 + `aria-invalid` 约定 |
| dc-card | `dc-card` `--pad-sm` + 可选 `__header/__footer` | surface 底、12px 圆角、1px border、内边 16（sm 12）；header 供标题与动作行 |
| dc-list | `dc-list` + `__row` + `__leading/__label/__trailing` | 行高 44（触控友好）、hover 交互底、行内分割线可选、leading 16px 图标槽对齐 |
| dc-tag | `dc-tag --neutral/--success/--error/--info` | 高 22px、6px 圆角、caption 字号、语义底色 10% 透明 + 同色文字 |

a11y 底线写入 kit：全部交互元素 focus-visible 可见、对比度 ≥AA、`dc-list__row` 作按钮时用真实 `<button>`。README 明令：改动 token 值视为脱离套件（升级时套件整体重物化）。

### E.4 app-dev 技能引用说明骨架（README 首节）

「默认要求：复制本目录进应用并在入口 `<link>` 两份 CSS；组件用参考页原样类名，不重写样式；图标用系统 emoji 或内联 SVG，禁止任何 CDN/外部字体/外部图片；深浅主题交给 tokens.css，不要自配色。」+ 五个组件的"何时用哪一个"一行指引。

## F. 动效与可访问性

- **模式切换**：见 B7 参数（slow 曲线、150ms 淡出、与 Focus 同几何）；`prefers-reduced-motion` 下全部 transition:none（AppFrame 先例），淡出改即时。
- **两层动效语言（模式切换 × 坞开合，主席已定方向）**：模式切换 = **舞台级过渡**（B7：整体滑入淡出、Sidebar 轨道参与）；坞开合 = **舞台内推挤**——`--dsh-dock-width` 走 slow 曲线（`--ds-transition-duration-slow` + `--ds-ease-in-out`）收窄 apps 层，坞带 `transform: translateX` 同启滑入，apps 内容（图标墙重排/iframe 宽度）随动画帧自然重排**不淡出**；坍缩条 150ms 淡入淡出。两层可叠加：经模式切换进入 apps 时，坞按 transient 记忆直接到位、不播第二次开合动画（进入即到位）；reduced-motion 下两层均即时，拖拽/方向键调宽恒即时（先例）。
- **presence 集成点**：粒子边框挂 AppContainerView 外圈与 Launcher 顶栏方位；32px 横幅宿主＝AppSourceBar 合并条；摘要卡＝Toast 几何常驻至关闭；光标/ghost 在 iframe 内（presence 自有引擎）；三重暂停门控（席位隐藏/document.hidden/3s 静默）由 AppStageLayer 承担。reduced-motion 降级路径全部照 presence §3.1（2px 静态内边框 + 即时换色，显式状态不改认知标签）。
- **focus 管理**：模式切换移动焦点并在退出时归还；开坞不抢焦点（用户主动操作，B9）；审批卡出现时 `aria-live=assertive` 播「需要你的确认」（presence §3.8），坞关闭时该播报不依赖坞可见；流式内容不进 live region（guide 硬规矩）。
- **键盘总则**：图标墙 roving tabindex（方向键/Enter/Menu 键）；分段按钮走 tablist 键序（Tab 进组、方向键换段）；容器 Esc 层级＝容器→桌面→对话（坞开合不改变 Esc 链）；开发中菜单与所有下拉走 Menu 原语自带键导航；所有 28px 图标按钮（含坞开关与窄栏单图标切换）可 Tab 到达且 focus-visible 用 business primary 轮廓；坞拖拽条方向键调宽（splitter 先例）。

## G. 响应式（≤640px）

- 全 Stage 覆盖投影（锁定项，`mobileDetailsOpen` 先例几何 `inset:0`），Sidebar 变抽屉；apps 与 details 投影互斥（H-D1）；抽屉内分段按钮照常渲染（同一 SidebarRoot 投影），抽屉收起时的模式切换入口 = apps 顶栏按钮簇（含对话开关）。
- Launcher：图标墙 96px 格 → 72px 格（auto-fill 自适应，图标 40→32px），来源标注保留单行渐消；顶栏标题隐藏，仅按钮簇（28px 命中框不变，但触控热区 ≥44px 通过透明 padding 扩展）；空态冷启动按钮全宽。
- 容器：合并条 32px 保留（文字收缩为「◀ 应用名」），更新入口收进「⋯」；返回手势退出容器/模式（history 对账）。
- 对话坞 = **覆盖式抽屉**（锁定项）：右缘滑入 `min(86vw, 320px)` + 遮罩（sidebar 抽屉先例），返回手势关闭并走同一历史对账模式；呼吸提示态不变；坞内审批卡按 B5 手机规则按钮上下堆叠；composer 沿用手机输入区 8px 边距与虚拟键盘避让规则。
- 时间线/审批卡：单列全宽，审批卡截图全宽、按钮组改为上下堆叠主按钮全宽；dev 菜单贴右上、`min(86vw, 320px)`；chip 悬浮于 Header 下方全宽收窄。

## H. 一致性发现与需主席裁决项

**发现（标记上报，不改已定稿项）**：
- F1：【已裁认可】presence §3.7「横幅与来源条合并为一层」与 ui-layout 现有 32px Workbench Header 几何一致；本方案据此定合并条 32px，若 presence 后续改横幅高度需联动。
- F2：【已裁：落稿时执行】`UI_STYLE_GUIDE.md` 增补属实现首个 UI 变更（apps 模式/图标墙/粒子信息态色/对话坞投影），D 节 token 提议即为此准备。
- F3：【已裁：实现期核】apps 顶栏消费 macOS traffic-light 安全位（`--dsh-collapsed-title-leading` 先例），无需新机制；Windows 32px 标题条同样让位。
- F4：【已裁采纳，已落 B1】预装在场时空态主按钮降级为图标墙上方次级引导条。
- F5：【已裁采纳】时间线与 Launcher 蓝点复用 Artifact 蓝点先例，提取 NoticeDot 共享（C#16）。
- F6：【维持原代定】dev 菜单「预览」入口按"保留"设计，否决时删除行尾按钮即可，无结构影响。
- F7：对话坞的右带投影需 ui-layout 提供 frame 级支持（mobileDetails 同子树投影先例的推广，conversation 子树第二渲染位）——归属 ui-layout 变更还是 app-stage 层内实现属包边界问题，实现期定；涉及 AppFrame 几何，落地时须同变更更新 UI_STYLE_GUIDE（与 F2 合并处理）。
- F8：【用户拍板修订（原型轮）】Workbench 面板类型入口（终端/产物/活动/变更/浏览器）**跟随对话区**——法定位置是 `conversation.session.header.utilities`，对话头（主舞台模式）与坞头（apps 模式停靠投影）都在位；**apps 顶栏不放第二套**，右上簇收敛为 [对话坞][开发中]。活动时间线经对话头的"活动"入口进入（Workbench 单面板，apps 模式下铺满坞带=子态②）；窄坞放不下五入口时按既有"整组收拢为单面板按钮"规则收拢。原空间序建议随之作废。
- F9：坞内 Workbench"单面板铺满坞带"与桌面 Mosaic 多面板并列（UI_STYLE_GUIDE 三列布局）的关系：按**坞域投影变体**实现——mobileDetails 全 Stage 投影先例收缩至坞带、Focus 几何先例；窄坞（≤560px）容不下三列 Mosaic（150px×3 下限），单面板铺满是几何必然而非新规则，与用户语义一致；面板开合/切换复用对话 Header 类型入口与 details 既有语义，归属 ui-layout 变更（与 F7 同域）。

**需主席裁决（D1–D5 已裁，全部采纳建议，见 02-ui-verdicts；D6 待裁）**：
- D1：【已裁·采纳】手机端 apps 覆盖层与 mobileDetailsOpen 互斥 = 后开者胜（进入 apps 自动收起 details 投影，历史栈各自对账）——与"进入 apps 自动退出 details Focus"桌面规则同构。
- D2：【已裁·采纳】`--dsh-presence-info-strong/soft` 命名定稿；实现期 ui-theme 出浅/深各两档校准值入 guide；色相独立于 error/warning/accent。
- D3：【已裁·采纳】审批卡形态按 conversation node + 挂起协议设计（不依赖结论）；数据通道核实属开放问题 18，实现期 spike。
- D4：【已裁·采纳：不加】顶栏不加「返回对话」按钮——对话坞开关已就地承载该诉求，模式级退出保持单一出口语法。
- D5：【已裁·采纳】多容器模型 = 前台单容器 + 后台挂载，无 tab 条；chip/桌面即切换面；未来需要再扩展。
- D6：【待裁】呼吸提示的语义载量（主席已重申"不自动弹出"基线）：纯图标呼吸对从未开过坞的用户可能读不出"发布在等你"。建议：呼吸同时常显短 caption「1 条待确认」（顶栏空间允许时，不足回退纯呼吸）；保留实现期"首次审批一次性轻推滑开坞"开关作可选增强。
