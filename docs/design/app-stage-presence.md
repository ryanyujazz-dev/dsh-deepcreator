# App Stage Presence（AI 在场层）设计提案

Status: **提案 v0.0.3 — 未实现**。本文定义 App Stage 的 Presence 子系统：把 AI 在 App Stage 内的一切操作**实时可视化、事后可追溯**——接管粒子边框、合成 AI 光标、逐字键入 ghost、接管摘要与时间线。来源：三镜头头脑风暴（UX/架构/信任，42 点子）+ 交叉授粉 + 主席终审裁决（11 项冲突全部裁定，裁决记录见 `output/app-stage-presence/91-presence-verdicts.md`）。v0.0.2 联动 app-stage.md v0.0.4 工作方式修订（微租约动作集含 `app_publish`、waiting-approve 呈现态、摘要计数含 publish、时间线全局水位且仅聚合 installed origin 动作）；v0.0.3 联动 app-stage.md v0.0.5 五视角评审修订：conversation 模式后台活动信号（§3.5 扩）、invoke 返回携版本进摘要素材。与 `docs/design/app-stage.md`（v0.0.5）配套；实现时同步架构文档与包 README。

## 1. 定位与原则

Presence 是 App Stage 的"AI 在场层"。五条铁律：

1. **AI 操作全透明**（产品级要求）：AI 的一切操作对用户可见、可感知、事后可追溯。
2. **Presentation-only 投影**：presence 不成为第二事实源；权威记录 = 官方 session 日志工具调用事件 + AppData key 级变更。删掉全部 presence 状态，事实与可追溯性分毫未损。
3. **看见的必须为真**：presence 视觉只从权威命令流派生，绝不采信应用自报；素材不足时降级而非编造。
4. **透明不等于背书**：可见性不得被挪用为信任背书——"看见 AI 在操作"≠"AI 验证过内容"，措辞与视觉均禁背书语义。
5. **用户键击永不录**：presence 捕获的是 AI 侧命令流，用户的键盘/指针内容永不进入 presence 通道（中断检测只允许无内容的事实信号）。

**统一术语（正交矩阵）**：任何 presence 信号 = **渲染层** × **认知标签**，两维独立：

| | 权威 authoritative | 尽力而为 best-effort | 可复算 recomputable |
|---|---|---|---|
| **壳层**（Shell 自有渲染，iframe/IAB 视口之外，应用物理不可达） | 接管横幅、粒子边框、租约状态 | — | 结束摘要卡、时间线 |
| **应用层**（渲染进应用视口：注入 runtime / Desktop 进程级 overlay） | —（应用层永远无权威标签） | 合成光标、键入 ghost、点击涟漪、冲突 chip | — |

文案与 a11y 措辞必须携带标签语义：实时状态用"正在"，重演用"基于日志重演"；"回放录像/如实重现"禁用（回放永远是从事实新合成，解释可更新、事实不变）。Desktop 进程级 overlay 是唯一例外通道：脱离应用文档渲染的应用层视觉可升准权威标签（见 §3.2）。

presence 可信性的架构三角：**只从权威命令流派生 + causeId 关联 + 零持久化**。视觉分层（壳层权威/应用层尽力而为）是该三角的空间投影——任何新视觉必须先声明渲染层×认知标签。

## 2. 接管状态机与触发模型

### 2.1 双层租约

- **微租约（micro）**：任一命令流动作（`app_invoke`/`app_data_write`/`app_asset_write`/`app_publish`/`app_open`/browser_act 命中 app origin）**立即**进入 active（首动作必须快亮，无进入滞回）；纯读（`app_data_read`/`app_manifest`/`app_asset_list`）不触发。无固定时长上限，仅活跃度超时——静默 60s → `suspended-idle`（视觉退化+倒计时释放）。对应粗粒度横幅（"AI 正在操作 kanban"/发布时"AI 正在发布应用 kanban"），**不点亮粒子全边框**。退出滞回 2s（命令静默 2s 内来新命令不灭横幅——只管防闪烁边沿，与 60s 不同边沿不同职责）。
- **宏租约（macro）**：显式接管才点亮完整粒子态与计时横幅。触发：root-Agent 工具 `app_takeover(appId)`（命名对齐 `create_image` 先例）或用户委托"让 AI 来"。时限上限（显式常数，实现期可调）：AI 自主默认 5 分钟、用户委托默认 15 分钟；续租须新命令且横幅重打开始时间（防静默无限续）；到期自动释放并出摘要卡。
- 先例锚定：remote-access two-minute fragment tickets（限时能力票据）；BrowserRuntime 已有 `controlState: 'ready'|'interrupted'|'user-control'` 与 `interruptBySurface()`——DOM 自动化路径的中断投影直接订阅它，不另造通道；invoke 路径由 PresenceCoordinator 自管。

### 2.2 权威态与呈现态分离

- **权威租约态（Host PresenceCoordinator，与 invoke 路由同处）**：`inactive → active → suspended-user | suspended-idle → releasing → inactive`。Host 不存呈现态。
- **派生呈现态（Client Shell 投影）**：taking-over（进入过渡，滞回窗口内只播一次滑入）= 进入宏租约 active；acting = active（微/宏通用）；**waiting-approve（v0.0.4 新增独立呈现态）= 首发审批挂起**——`app_publish` 首发等待用户确认时：横幅转"等待你确认首次发布：\<app\> · \<version\>"，粒子冻结、主行动作脉冲一次（复用 waiting-user 视觉语法但语义独立：等待的是工具确认而非中断恢复；locale 键独立）；aria-live 播 assertive；approve → 回 acting，decline → 发布终止且摘要卡如实记 USER_DECLINED；waiting-user = suspended-user（粒子冻结、主行动作脉冲一次）；挂起倒计时（60s 静默或租约临期最后 30s 轻量显示）；handing-back = releasing（光标淡出→摘要卡上滑→粒子向内收拢，≤600ms）；到期摘要 = releasing 完成态；switching = active 的多应用子焦点（应用 chips、当前项高亮）。

### 2.3 触发授权来源的视觉区分

两种来源必须可视化区分。**编码通道（主席裁决）**：几何/强度区分 + 主语措辞——自主 = 细边框脉动 + 前导"自主"字形 + 可点开"暂停 AI"面板；委托 = 全边框粒子 + 前导"交出"字形 + 常驻"收回"按钮（一键 handback）。**色相只表达状态（active/idle/expiring），永不表达授权来源**——防"另一种颜色=更安全"的信任迁移。主语措辞必有（共识）："AI 自主操作" vs "你委托 AI 操作"。

**词汇分级（主席裁决）**：微租约横幅用"AI 正在操作 <app>"（acting）；宏租约才用"AI 接管中"（taking-over）——防高严重性词汇被高频动作稀释（狼来了效应）。

## 3. 视觉语言

### 3.1 四边粒子（壳层×权威）

- 触发=宏租约 active；事件流静默 >3s 自动休眠为静态细边框。三级强度在总预算内分档：ambient（1×，等待/思考）、active（2×，执行中）、burst（3×，瞬时爆发 ≤2s）。方向语义：粒子沿四边向"当前被操作应用的容器"方位汇流，多应用时给空间线索。
- 颜色只用主题语义 token（浅/深主题各取 accent 与 surface 对比度经校准的两档）；粒子属**信息态**，色相与 error/warning 语义分离（UI_STYLE_GUIDE 登记注册性节奏签名——固定色相+节奏，应用无法同帧复刻视口外几何）。
- 渲染为单合成层 CSS 粒子场（transform/opacity only），无逐帧 JS。
- `prefers-reduced-motion: reduce` 或低性能（deviceMemory 低档/帧率持续掉线）：整体替换为 2px 静态内边框+随状态即时换色——照 `AnimatedFolderIcon.tsx` 跳帧先例；降级是显式状态而非静默失败，且降级不改变认知标签。

### 3.2 合成光标（应用层×尽力而为；Desktop 进程级可升准权威）

- 形态：24px chevron 指针 + 外圈 agent 身份环 + 右侧小标签"AI · <会话标题>"（多 agent 未来：身份环色相按会话稳定散列）；悬停=目标元素柔和描边；点击=24px 涟漪环 300ms；拖拽=最近 1.5s 渐隐点迹。与用户光标区分：略大、始终带标签、永不触发页面原生 hover/click（它只是投影）。a11y 标注"AI 操作指示器，非真实指针"。
- **诚实性协议（T2 正面回答）**：语义工具没有真实指针——AI 光标恒为**合成的解释性光标**，由动作元数据驱动。元数据缺失=不画（禁止编造轨迹）；移动为目标导向插值（先显示虚线目标框，光标 200–400ms 缓动过去），绝不声称逐像素路径；三态 moving/acting/thinking。文案统一"合成光标（动作元数据驱动）"。
- **诚实性梯度三档**（素材不足降级而非编造）：(a) hints 完全重演档——manifest action 可选扩展字段 `ui`（目标元素语义 locator、输入框映射，Phase δ）：把 `createTask(title)` 分解为"移到新增按钮→点击→聚焦标题框→逐字键入→提交"；(b) 参数重演档（默认）——见下方共见分型；(c) 纯摘要档——无语义素材（黑盒 handler、无参数动作）：只有壳层横幅与状态变化涟漪，**不出现光标**。
- **(b) 档共见分型（主席裁决 X7）**：参数重演档无条件可用（参数是权威事实，展示不造假），但呈现形态按**共见事实**分两型——
  - **共见应用**（注入 runtime 上报该应用已订阅目标 key 的 AppData 广播）：光标移至应用中心 + ghost 逐字显示参数值 + commit 闪动（广播到达且 causeId 匹配）——完整闭环可视；
  - **非共见应用**（未订阅）：横幅直接携带参数摘要（结构化展示参数名/值，透明不损），**不做光标移动与键入剧场**——演了不落地=误导。检测源=runtime 上报的订阅事实（上行白名单新增事实类型"AppData 订阅事实"）；检测未实现前默认按非共见处理（保守侧）。
- Desktop（IAB 分支）：光标由**壳进程级合成层**（透明、输入穿透的 WebContentsView 叠在应用 Surface 之上，`setBounds` 跟随）渲染——脱离应用文档、不可伪造，应用层信号升准权威标签；与注入 runtime 共用同一事件流与同一渲染描述（引擎不 fork）。Web 无此层，视口内视觉维持尽力而为标签。
- hints 信任边界：hints 是应用作者可撒谎的字段，但**只影响视觉不影响执行**（执行仍走 handler）；误导损失上限=视觉误导，计入威胁模型。

### 3.3 键入可视化（应用层×尽力而为）

- 目标框先获 AI 聚焦环（2px accent、150ms、上方浮标标注 action 名，名字来自 manifest actions 声明）；ghost 逐字：30–60ms/字限速（不镜像模型真实 token 突发速度）、60% 透明度+accent 下划线；退格=字符左滑消散；IME **不伪造组合态**——presence 事件只携带最终文本序列，仅当控制路径真的分段才渲染点线组合下划线。速率上限+用户减速偏好（动效可访问性）。
- **ghost 生命周期状态机**：`typing（限速呈现）→ typed（等待权威确认）→ committed | failed | diverged`。committed=AppData key 级广播到达且 causeId 匹配→整段闪一次"commit"；failed=命令流返回错误→红停顿+一句话错误（不静默重试掩盖）；diverged=广播值≠ghost 值→以广播为准重绘并标注差异（投影服从权威）；typed 后 ~3s 无确认→显式"等待生效"态。
- ghost 文本数据源**只**来自下行 params（invoke params / browser_act fill 值），永不来自上行 DOM 读。

### 3.4 滚动、悬停与导航过渡

AI 滚动=capped 平滑滚动（400–800px/s）+容器右缘 AI accent 细滚动位置指示条；合成 hover=overlay 描边一种（应用自身 hover 反应只能来自真实路由的 invoke 效果，即 AppData 驱动——presence 重演不二次执行）；应用内导航=粒子边框 300ms 方向性流光+横幅面包屑更新。全部遵守 reduced-motion 总开关。

### 3.5 跟随 AI（跨应用）

三档：关 / 画中画 / 自动切换（opt-in、≥8s 一次防眩晕）。AI 操作用户未在看的应用时：**Web = 240px 合成画中画**播放 live 模式投影，角标"AI 的实例视图 · 合成投影"（主席裁决：低保真合成投影值得做，必须标注合成）；**Desktop = 投射面临时替换**——跟随开启时，容器 surface 临时换为 agent 实例的真实投射（B1，画面即现场），常驻标签区分"AI 的实例视图"，跟随关闭即换回用户实例 surface（主席裁决 X5：不并存双 live surface——同屏两个"同一应用"画面造成身份混淆+双 WebContentsView 资源）。invoke 路由到可见实例时退化为原地高亮。

**conversation 模式的环境信号（v0.0.3，覆盖面补全）**：以上三档只在 apps 模式可见；用户处于对话模式时，agent 后台驱动应用的环境级可见性由 **conversation 侧活动 chip（"AI 正在操作 \<app\>"，点击切 apps 模式）+ Sidebar App Stage 开关活动点**承载（定义见 app-stage.md"控制面"）——"共用界面"不退化为"轮流且不知情"。chip 是信号不是投影：不渲染应用画面、不播粒子，仅保证后台活动始终可感知。

### 3.6 摘要卡与时间线（壳层×可复算）

- **摘要卡**（handing-back / 微租约结束时，Toast 几何但常驻至用户关闭）：接管时长、动作分类计数（invoke/data.write/browser_act/**publish**）、涉及应用、**本租约全部 AppData key 级变更清单**（反"视觉掩护下的静默篡改"）、用户中断事实（"用户于第 N 步接管"）、应用版本与来源会话（判断材料可见而非替用户判断；invoke 返回携 {appId, version}——版本素材直接可得，v0.0.3）；消费"声明持久效果但无变更"告警（依据 manifest `persist` 声明，v0.0.3 对齐）→标注"未产生预期变更"。数据=官方日志工具调用+AppData 操作的确定性折叠（Artifact snapshot builder 确定性折叠哲学），处理截断窗口沿 truncated-window 语义。
- **时间线**（App Stage 壳层"活动"视图）：行=（时间、应用、动作、目标、结果状态、耗时），来源同摘要卡；行可"回放"——replay 模式 2–4× 速重演 ghost（角标"回放·基于日志重演"，纯投影不调 invoke）。入口在 Launcher 右上（与开发中菜单同按钮簇），未读 AI 活动给蓝点（watermark 机制照 app-stage.md：**全局单一水位** `deepcreator.app-stage.activity.seen`——时间线聚合的是已安装应用的全局活动，v0.0.4 起 workspaceId 维度取消）。**聚合过滤（v0.0.4）**：时间线与活动水位仅聚合 installed origin 的动作；dev origin 动作（agent 内环自测的 browser_act）不进时间线、不推全局水位——自测刷屏会淹没正式活动并使蓝点失真；dev 自测活动仅在 preset 会话自己的摘要卡内可见。

### 3.7 接管横幅（壳层×权威）

32px 壳层横幅（Workbench Header 同族几何），与"应用容器来源条"合并为一层避免双横幅。**三要素下限**：主语（AI/会话标题）+动作范围（应用 · action 可读句子如"正在新建卡片：任务看板"，诊断详情折叠二级）+计时（已进行为主、剩余为辅，倒计时只在最后 30s 轻量出现）。禁焦虑修辞（不用警告色/感叹/压迫倒计时）、禁背书（"AI 已确认此页面安全"永远非法）、禁人格化（不用"我想/我来帮你搞定"）。词汇分级见 §2.3。

### 3.8 aria-live 与本地化

- 壳层挂 visually-hidden live region（先例 `TrajectoryTable.tsx` visuallyHidden+role=status+aria-live=polite）：接管开始/结束、应用切换、等待用户播 polite；"需要你的确认"播 assertive。节流聚合 ≤1 条/2s，键入类聚合为"AI 正在填写 <action>"（硬规矩：流式摘要不进 live region——UI_STYLE_GUIDE）。
- **播报骨架只用结构化字段（主席裁决 X3）**：应用 id、action 名（经校验非自由文本）；manifest `description` **默认不进 live region**（不可信自由文本进入用户警觉性最低的通道是注入向量）——带归属框架的"应用自述"播报留 Phase δ 评估。a11y 文案与视觉同守禁背书/禁人格化词典。
- locale（主席裁决 X6）：归属 `app-stage` 命名空间 `presence.*` 子键（少一个 compatibility obligation；词典规模失控时再评估拆分）；AI 身份标签中的会话标题是运行时数据不进词典。

## 4. Presence 事件协议与数据流

### 4.1 事件模型

统一事件流 `PresenceEvent { seq, appId, instanceId, causeId, source: 'invoke'|'runner'|'dom', kind: 'takeover'|'cursor'|'gesture'|'type'|'state'|'summary'|'end', payload, ts }`。`seq` 在 per-(appId, instanceId) 域严格单调；`causeId` 指向权威源（官方 session 日志 tool/call id 或 AppData 写入 id）；`instanceId` 必须区分可见实例与隐藏 runner。节流三类：cursor ≤20Hz 控制点（接收端 Catmull-Rom 插值 60fps）；type 按 chunk 聚合（~50ms 或提交边界，payload 含字符序列）；takeover/summary 低频全量。seq 间隙超阈值请求关键帧重同步（跳变不等待，可丢帧不可倒流）。presence 事件永不写 AppData、永不落权威日志；replay 排序键=`(seq, causeId)`，本地时钟不作回放依据；burst 检测在投影层（Shell 侧窗口速率计数器）不入协议。

### 4.2 双向白名单（对称协议表，一次评审）

| 方向 | 允许 | 永禁 |
|---|---|---|
| **下行**（Host→runtime，AI 侧内容） | 动作元数据（kind/action 名/params 值/目标 hints/causeId/seq）、AppData key 级变更广播（含可选 causeId）、租约状态、replay 时间轴控制 | —（下行全部派生自权威命令流，展示=透明本体） |
| **上行**（runtime→Host，应用侧事实） | 目标元素 rect/role/aria-label、目标可见性事实、focusin 事实信号（无内容）、**AppData 订阅事实**（应用经桥订阅的 key 集合，X7 检测源）、结构化错误码 | 输入框当前值、DOM 文本、截图、任何用户生成内容、用户键击内容 |

下行内容派生自权威命令流，无新增隐私面；上行 Host 不落库、不进模型上下文（presentation-only）。白名单从协议规范第一天写入。

### 4.3 注入机制与通道

- **HTML 注入中间件**：per-app 静态服务响应管道加可开关中间件——仅 MIME `text/html` 时在 `</head>` 前插 `<script src="/__dsh_presence__.js" defer>` 并重算 content-length，其他资源原文下发。脚本同 origin 加载，天然满足 CSP `default-src 'self'` 零放宽。先例论证：响应头由同一服务下发是已验证行为（`packages/host/artifacts/src/preview-server.ts` respond()）——注入只是"响应头附加"推广为"响应体附加"，同一所有权同一围栏。可逆性：per-workspace/per-app 可关，dispose 后原文下发，remount 无残留（验证点）。
- **通道**：下行=同源 SSE（`/__dsh_presence__/events`，浏览器内置断线重连+seq 重同步）；上行=同源 fetch POST（限白名单载荷）；bootstrap=注入时在文档写入 leaseId+一次性随机 nonce+SSE token，服务端绑定该次文档加载。**单向数据流**：runtime 对应用页面零可调用 API；runtime 全局对象注入先于应用脚本+Object.freeze；每租约随机 nonce+命令序列号防重放；runtime 代码 Host 拥有、随插件版本升级（应用无法 pin 旧版）。不采 shell postMessage 分支（SSE 方案不依赖 shell↔iframe 关系，Desktop/Web 一致）。
- **runtime 加固**：closed shadow root + MutationObserver 自愈；自愈对抗是尽力而为（应用可循环对抗致 DoS 视觉，权威信号不受影响，接受）。

### 4.4 双层渲染归属

壳层（粒子/横幅/摘要/时间线）由 Stage Shell 自有 React 树渲染在 iframe/IAB 之外——**权威信号**；应用层（光标/ghost/涟漪/chip）渲染进应用视口——**永远只承载解释性细节**。两层由同一事件流驱动、同一 causeId 关联；删掉应用层不损失事实只损失细节；冲突时以壳层为准。

### 4.5 一个合成引擎，双模式

**live 模式**（消费在途事件流，允许丢帧跳变）驱动实时投影与跟随视口；**replay 模式**（消费官方日志+AppData 确定性折叠）驱动时间线回放。诚实性梯度两模式共用；回放保真度受历史素材档位限制（无 hints 的历史只有摘要档）。

## 5. 三条控制路径映射矩阵（T1 正面回答）

| 路径 | 动作元数据来源 | 投影形态 | 禁令 |
|---|---|---|---|
| **结构化 invoke**（路由到可见实例） | manifest action 声明+调用参数（全结构化） | (b) 档共见分型投影（§3.2）或摘要档 | — |
| **结构化 invoke**（路由到隐藏 runner） | 同上（同一 AppControl 通道） | 可见实例显示"后台执行中"摘要+AppData 变更涟漪 | **不伪造 runner 的 UI 细节**（隐藏容器无用户可辨认界面语义） |
| **DOM 自动化** | 官方 session 事件流 browser_act 的 tool/call 视图（steps 的 locator/action/value，Host 订阅过滤 app origin URL——与 Artifact 读 tool/call 投影先例同构，不与 dsh-browser 私有耦合） | Desktop=路线 B1 投射（画面即现场，跟随视图）；Web=降级档：摘要+明示"AI 在自己的副本上操作"标签 | 不冒称用户实例；**瞬态/持久二分（主席裁决 X2）**：操作效果会落入 AppData（持久）的 fill 值可在可见实例升 (b) 档共见型 ghost；瞬态值（不落 AppData，如 agent 实例内搜索框输入）**只在跟随视图/投射面呈现，不进可见实例视口**——否则开辟绕过"AppData 唯一事实源"的跨实例信息通道 |

**执行路线**：**路线 A（意图驱动可见实例，全平台）**——注入 runtime 把动作意图可视化为光标/ghost/涟漪，**重演不二次执行**（overlay `pointer-events:none` 纯渲染，ghost 是文本渲染而非 input 事件）；真实效果一律经 app-stage.md 共见规则由 AppData 变更广播呈现。规避 native setter+dispatched events 的 `isTrusted:false`、React 受控组件劫持、双实例双写分叉全部负担。**路线 B（Desktop IAB，两正交子机制）**：B1 投射——mountSurface 把 agent 正在操作的 Browser Provider tab surface 挂到 Stage 容器 bounds（`preload.cjs` 四方法先例），用户直接看见 agent 实例真实画面（最诚实）；B2 进程级 overlay——合成光标叠在 Surface 之上（§3.2），使应用层信号升准权威。B 的 surface bounds 须随 Stage 切换 unmount（可逆性测试点）。

## 6. 人机并发仲裁（T3）

- **默认语义（主席裁决 X1：v1 采用租约级）**：用户真实输入→**租约级中断**——先例 Desktop IAB"用户页面输入中断 agent 控制租约"。中断表现：粒子立即退场、横幅转"已暂停 · AI 让位"；正在执行的原子动作（一次 invoke/一次 browser_act 事务）允许完成当前原子步再挂起（BrowserRuntime 事务原子性先例）；队列后续命令挂起；恢复须用户显式"继续"或新委托——**AI 不得自动抢回**；中断事实计入摘要卡（用户干预也可见——透明对称）。
- **字段级协作模式（Phase δ opt-in，主席裁决）**：只让出用户正在输入的字段、AI 继续别处——作为 Phase δ "协作模式"候选落地，**前置条件=归因可靠性**（runtime 能可靠判定"用户焦点位于 AI 正在键入的字段"时用字段级；归因不可靠时自动降级租约级）。两条底线常在：用户在 AI 操作目标之外的指针/键盘活动仍触发全租约挂起；AI 不得自动抢回。完整字段级仲裁与 app-stage.md 开放问题 7 联动。
- **字段级 focusin 机制（已入协议）**：runtime 检测 ghost 目标元素 focusin → 上行"事实信号"（无内容）→ Host 暂停该动作键入投影。
- **冲突 chip（key 级，主席裁决 X8：Phase β 落 key 级容器级提示）**：agent `data.set` 落到用户持有未提交编辑的字段时，容器级提示"AI 更新了此字段（HH:mm:ss）"，绝不静默重置用户输入。field→key 精确映射**不做 DOM 启发式**（上行白名单保持窄）；随 Phase δ `ui` hints 契约一起定义（hints 携带字段映射）。chip 渲染在应用视口内可被仿冒——认知标签尽力而为，可信源是 AppData diff 与时间线，文案禁"确认/验证"。

## 7. 信任与威胁模型（T4；app-stage.md 风险表新增行的权威来源）

| 威胁 | 对策 |
|---|---|
| 应用内伪造 AI 光标/presence UI 钓鱼（假"AI 正在验证您的身份"） | 权威视觉只在壳层（几何不可达）；视口内光标定义为尽力而为；注册性节奏签名；挑战-应答：hover 粒子边框即暂停浮出"租约摘要卡"（来源会话/开始时间/动作计数——Shell 命令流供不了假数据）；视口内禁"AI 正在/已验证"类信任声明（壳层专属词汇） |
| presence 通道注入/重放（应用伪造"AI 在操作我"） | 单向数据流（runtime 零可调用 API）；冻结预置；nonce+序列号；runtime 随插件升级不可 pin |
| 视觉掩护下的静默篡改（看 A 改 B） | presence 只从权威命令流派生；摘要卡列全部 AppData key 变更清单；一致性告警（声称操作 X 无变更→标注） |
| "看得见=可信"谬误（信任转移） | 接管期间"不受信内容"来源条不撤（接管不改变内容信任级）；横幅只陈述"AI 正在操作"禁背书；摘要卡给版本与来源材料；色相不编码授权（§2.3） |
| 过度拟人化高估 AI | 去人格化动词（操作+范围）；失败如实展示；a11y 如实标注合成光标；键入速率上限+减速偏好 |
| hints 撒谎（应用作者侧） | hints 只影响视觉不影响执行；误导上限=视觉误导 |
| a11y 通道注入（不可信 description 进读屏） | 播报骨架只用结构化字段；description 默认不进 live region（§3.8）；a11y 文案同守禁令 |
| DOM 自动化瞬态 fill 值跨实例泄露 | 瞬态/持久二分（§5 矩阵）：瞬态值只在跟随视图/投射面，持久值才可升 (b) 档 |
| presence 反向 keylogging | 上行白名单永禁用户内容；中断检测只允许事实信号；AI 键入可见≠用户键击被录（文档显式声明） |

Desktop/Web 信任基线差异显式声明：Web 应用层视觉尽力而为（应用可干扰）；Desktop IAB 进程级合成不可伪造。若"视口内防伪"定为必须→Desktop 必须走 IAB 分支——**app-stage.md 开放问题 3 的第二硬性取舍条件**（与自导航防御并列）。

## 8. 性能与可访问性预算

- 单一 overlay 合成层承载全部应用层 presence（光标+ghost+涟漪+滚动条），单 rAF 循环、事件按帧合批、积压超限丢弃跳到最新；`pointer-events:none`+closed shadow root+`will-change:transform`，不触发应用文档 reflow。
- 硬预算（写进验证计划为可测断言）：presence 渲染 p95 ≤1.5ms/帧；粒子总数 ≤48（burst 3× 档上限，ambient ≈16）；光标通道 ~1KiB/s/app（20Hz 控制点+客户端插值）；仅 transform/opacity。
- 三重暂停门控：apps 席位隐藏（`deepcreator.stage.apps` 席位"隐藏仍挂载"不变量下按 visible 门控——Workbench owner props visible 先例）、document.hidden、事件流静默 >3s。三层时标不混淆：3s=粒子休眠（视觉）、60s=租约挂起（状态）、5/15min=宏租约总量。
- 爆发操作摘要化：动作频率 >5 事件/s 持续 >2s → 逐字/逐光标升级"路径预览"（光标收进横幅、目标框只闪聚焦环、计数器滚动），预算压力表现为摘要化而非掉帧；给临时"展开细节"开关。
- 可访问性：reduced-motion 全套降级（§3.1）；aria-live 节流聚合（§3.8）；全部降级是显式状态且不改变认知标签。

## 9. 包归属与组合

- Host 侧（PresenceCoordinator、session 事件流订阅、HTML 注入中间件、SSE/POST 通道）进 `packages/host/app-stage`；Client 侧（壳层粒子/横幅/摘要/时间线、租约投影）进 `packages/client/ui-app-stage`；**`app_takeover` 工具注册归 preset 行 `packages/host/app-stage-agent`**（v0.0.3 修正，D1 裁决：全部 `app_*` 工具属 preset 行、常驻行零 root-Agent 工具——工具是无状态门面，调用常驻包 PresenceCoordinator 公开服务）。理由：presence 与 AppControl/静态服务/桥是同一所有权的切面，拆包必跨包 import 内部组件（违反 AGENTS）。bundle **零新行**（两包已在 patch；agent 包不经 bundle）。
- 可复用视觉原语若他处需要，按规矩升 ui-primitives；若 ui-app-stage 包体超阈值，Phase δ 再评估拆 `ui-app-stage-presence`（届时评审）。
- 可逆性：注入开关、事件订阅 disposer、`ctx.effect()` 注册；卸载后 Stage 回退纯对话模式、应用原文下发（复用 app-stage.md"卸载后布局回退"验收）+ remount 无注入残留。
- 注入脚本属 Host 供应链——所有权单一写入包 README 义务。

## 10. Phase 化（主席裁决 X9：presence 子阶段，不动 app-stage.md 主编号）

- **Px-α 壳层最小 presence（挂 Phase 1 后段）**：壳层粗粒度横幅+静态边框雏形+aria-live 播报骨架+文案/词典规矩（全部纯文案项零新机制）。数据源=官方 session 日志过滤 browser_act/`app_list` 的动作流——无注入、无应用层视觉、最小攻击面。微租约自动 active 即可演示。
- **Px-β 应用层注入与矩阵（挂 Phase 2）**：注入 runtime（SSE/POST/nonce）+诚实性梯度 (b) 共见分型+(c) 档+ghost 生命周期+完整租约状态机+`app_takeover`+causeId+三路径矩阵（invoke/runner/DOM-Web 降级）+性能预算+key 级冲突 chip。
- **Px-γ Desktop 投射与进程级合成（挂 Phase 2.5，依赖 IAB 分支落地）**：路线 B1 投射+B2 进程级 overlay+跟随视图（投射替换形态）。
- **Px-δ hints 与回放（挂 Phase 3）**：manifest `ui` hints 契约（(a) 档）+field→key 映射+时间线回放 UI+字段级协作模式（归因可靠性前置）+带归属框架的"应用自述"播报评估。

## 11. 开放问题

1. 租约与官方 Turn 生命周期的对齐（turn 结束即释放宏租约？）。
2. manifest `ui` hints 契约细节（字段、校验、撒谎的缓解、field→key 映射）。
3. （联动 app-stage.md 开放问题 3）presence 视口内防伪若为必须 → Desktop 必须 IAB 分支（第二硬性取舍条件）。
4. （联动 app-stage.md 开放问题 7）字段级协作的完整仲裁：归因可靠性判定标准、写前读比较、冲突回报。
5. 无 hints 场景占比对产品预期的影响（诚实性梯度默认落在 (b) 共见型还是 (c) 档——取决于生态应用的 AppData 订阅率）。
6. 回放 UI 的历史素材档位提示措辞（locale 评审）。
7. 微租约摘要卡的轻量变体信息量下限（太轻=失去"刚发生了什么"的追溯价值）。
