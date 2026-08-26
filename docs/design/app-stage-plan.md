# App Stage 开发计划

Status: **执行中 — M5 Px-β 主体完成并 GUI 验收通过（含用户目击粒子边框；验收揪出两真缺陷已修复 08f565f），余 M5d 注入 runtime+SSE**（M4：桥 v2 路由 + 九工具 + 资产通道 + 通道一注册闸 + 活动信号；GUI 真实验收全通——preset 会话四步：createTask 落盘（created + persistedKeys + 版本回执）/ data_read 验证 / dev: 拒收 / app_open；活动 chip 由用户在自己的 GUI 面上亲眼确认（多面认领归最新 poller 的实测副产品：用户面常胜，chip 亮起即三层验证）；验收揪出三个真缺陷并修复：桥双绑 f444a28、宿主侧路由扇出双投递 22b8589（routerId 认领制，hub 四测含 poll-gap 边界）、demo 协议卫生 v0.2.1（已发布安装）；245 文件 / 2611 测试全绿；新宿主冒烟 rev11→12 恰好一写、多轮 8 连发全单写）。本文把 `docs/design/app-stage.md` v0.0.6 的阶段划分展开为可执行的开发计划：里程碑、包结构与行序、每步的产出与验收、验证纪律。设计依据四份文档：主提案（决策）、`app-stage-agent-surface.md` v1.0（工具/技能）、`app-stage-ui.md` v1.0（前端）、`app-stage-presence.md` v0.0.3（在场层）。计划执行中以实现事实为准回填，与设计冲突时先回设计文档裁决再改代码。

## 0. 总原则（继承自设计终审）

- **插件完整性**：四件套 = client 包 / 常驻 host 包 / agent host 包 / preset。全部是组合树中的行，零官方包改动（fork-free）——"插件完整性核对"节为权威判定表。
- **热上架不变量**：发现/发布/安装/卸载全走运行时数据路径，全程无 DeepCreator 重建/重启/刷新。每个里程碑的验收都包含这条。
- **一行一职责**：host 两包可独立于 client 先行；共享壳席位（ui-layout/ui-sidebar/ui-conversation 小改）先行或与 M1 并行。
- **顺序约束**：M1（壳席位+骨架）→ M2（dev 内环）→ M3（发布链）→ M4（操作面）→ M5（在场层补全+Desktop 投射）→ M6（生态）。M2/M3 依赖 M1；M4 依赖 M3；M5/M6 可与前者部分并行。
- **验证纪律**（每里程碑统一）：`pnpm run typecheck` → 受影响包 test → `pnpm run build` → `dump-config` 验行序 → 浏览器/桌面冒烟。迭代中跑最窄检查，交付前跑全量。UI 改动同变更更新 `UI_STYLE_GUIDE.md`；行为/包所有权/Slot 变更同更新所属 README 与 `docs/architecture/deepcreator.md`。
- **原型纪律（用户定）**：`output/app-stage-prototype/` 仅为方向指引，最终 UI 以项目组件/Slot/token 为准，冲突时以 `UI_STYLE_GUIDE.md` 为准。

## 1. 包与组合行序（物化顺序）

```
packages/
├─ host/app-stage/            常驻行（profile patch）：Registry/Runtime/静态服务/AppData/Presence 协调
├─ host/app-stage-agent/      preset 行（不经 bundle；dev link，生产随依赖闭包）
└─ client/ui-app-stage/       client 行（bundle patch + 包依赖 + 构建入口）

共享壳席位（前置小改，非新包）：
├─ ui-layout：deepcreator.stage.apps 席位 + 对话坞投影变体（F7/F9）
├─ ui-sidebar：舞台模式分段按钮席位（B6，viewSwitcher 同族）
└─ ui-conversation：utilities 入口随对话区（F8 修订）；活动 chip 席位
```

行序：常驻 host 行 →（agent 行由 preset 物化，非 profile）→ client 行。preset 物化器随常驻行启动确保 `<dshHome>/.agent-presets/app-stage/`（stamp 防投毒判定照主文档）。

## 2. 里程碑

### M0 — 共享壳席位（与 M1 并行或先行）✅ 已完成

产出：ui-layout `deepcreator.stage.apps` 子 Slot（常驻挂载默认隐藏，宽度归零保持挂载沿 details 不变量）；坞投影变体（apps 收窄 + 对话子树停靠几何，mobileDetails 同子树投影先例的推广）；ui-sidebar 分段按钮（Brand 下、primary 列表外，`.viewSwitcher` 同族 tablist，"应用"段活动点位）；ui-conversation utilities 归位修订（F8：apps 顶栏不放第二套）。

验收：席位空占位时 UI 零变化；分段按钮可切换舞台模式（空 apps 态）；既有三栏/手机投影回归不破；`dump-config` 行序正确；`UI_STYLE_GUIDE.md` 同步（F2/F7 落地条款）。

实现事实回填：stageMode/dockOpen/dockWidth 为布局 store 的 root 级瞬态（不持久化、跨断点不动）；两投影系列（手机全 Stage Workbench、apps 模式）共用一套 popstate 账本，apps 条目 effect 先于 mobile 条目声明；分段控件经 ui-sidebar 的 `sidebar.stage-mode` 席位注入（ui-layout 贡献组件，同一 shared store handle 保证两席位读写同一实例——store 实例轴按 handle × scope 键控，已有单测钉死该共享）；活动 chip 席位为 `conversation.activity.chip`（list、session 域，空席位零渲染）。验证：typecheck/build 全绿，605 项受影响测试通过（terminal-workbench 一项失败为干净基线上既有，与 M0 无关），dump-config 行序与迁移前逐行一致，真实浏览器冒烟（模式切换/舞台覆盖/返回手势对账/全程零刷新）通过。

### M1 — 骨架与静态运行（client + host 常驻行立起）✅ 已完成

产出：host：AppRegistry 记录全集枚举 + 完整性闸（manifest v1 校验：platform/version/actions/persist/dataVersion/agentGuide）+ 双供源根静态服务（`ctx.webServer` prefix 路由 + CSP 头 + 围栏）+ dev/installed 数据域存储骨架 + preset 物化器（file: URL 行 + stamp）。client：Stage Shell 接管席位 + Launcher 骨架 + 开发中菜单（仅 ready 条目）+ 沙箱容器（iframe 挂载，apps 模式外保持挂载）。

验收：手放一个 manifest 合规的 dev 目录 → 开发中菜单**无刷新**出现该条目；容器可打开 originURL；manifest 缺字段/越限时条目带 reason 显示；preset 目录物化正确且已知文件篡改触发损坏告警；全程无重建/重启/刷新。

实现事实回填（验收均通过）：四件套齐备 —— `packages/host/app-stage`（常驻行 `@ryanyujazz/dsh-app-stage`：manifest 校验/registry 闸/serve 双供源/store/preset 物化器/`appStage` Typert 服务 `list`+`ensure`）、`packages/host/app-stage-agent`（preset 行骨架，M2 落工具面）、`packages/client/ui-app-stage`（`deepcreator.stage.apps` 席位占用者 + Launcher/开发中菜单/沙箱容器）、preset 目录 `$DSH_HOME/.agent-presets/app-stage`。关键实现决定：① probe-at-open —— list 每次开发中菜单展开时现扫（effect 依赖含 menuOpen），GUI 零刷新看到手放目录；② dev 供源 URL 用 sha256(dir) 前 24 hex 令牌，不露工作区路径，`ensure` 时惰性注册；③ 远程面经生成的 `typert.remote-client` 声明合并键入 `TypertClientRemote`（`@ryanyujazz/dsh-app-stage/remote`），client 捕获一次命名空间；④ 当前会话以外部 store（`ctx.sessions.list` subscribe/getSnapshot）注入，组件经 `useSyncExternalStore` 读取 —— 注册期 inject props 是静态快照；⑤ 席位 owner props 增加 `dockOpen`（呈现事实，写路径仍走 `ctx.layout`）。bundle 三件套与受管 profile（OWNED_DEPENDENCIES 三包 + MANAGED_PROFILE_VERSION 4）已落。验证：host 单测 7 + client 单测 10 全绿；`dump-config` 行序干净（host 行在 artifacts 后、client 行在 conversation 后）；真实浏览器验收含热上架不变量（GUI 打开状态手放第三应用，仅重开菜单，计数 2→3 无任何页面操作）。

### M2 — dev 内环闭环（数据桥 + 诊断工具）✅

产出：数据桥 `data.get/set/subscribe`（postMessage 最小子集 + 版本握手）；AppData 单文档+journal 双域写入；workspace 会话绑定 watcher（随会话绑定起止）；`app_list`（scope dev/installed，条目含 reason 诊断）+ `app_manifest`（含 agentGuide 内联）两工具（agent host 包首批）；app-dev/workstage-use 技能树 + design-kit + reference/kanban。

验收（设计 Phase 1a 验收行全量）：preset 会话中 agent 写应用 → 过闸 → 开发中菜单无刷新出现 → 自开实例自测（双视角走查）→ 热重载复测；普通会话写 apps 目录 → 只进菜单永不上桌（零泄漏）；watcher 随会话绑定起止；热重载全程存活。

实现事实回填（验收均通过，真实 GUI 在宿主进程重启后全链路复验）：① 数据桥协议 v1 —— 消息 `{__appStage:1, id, op, path?, value?, sinceRev?}`、回复 `{__appStage:1, proto:1, id, ok, value?, rev?, changes?, error?}`；协议号≠1 回 `PROTOCOL_UNSUPPORTED`；订阅为 client 侧 1500ms 轮询 `dataChanges` journal 增量回推 `data.event`；写后立即从 journal tail 精确回推（`broadcastSince(rev-1)`）。② AppData —— `$DSH_HOME/deepcreator/apps/data/[dev/<wsToken>/<appId>|<appId>]/` 下 `doc.json`（原子写）+ `journal.jsonl`（append-only，2×1000 压实）；键路径 `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`；单值 ≤256KiB、文档 ≤4MiB（PATH_INVALID/VALUE_TOO_LARGE/DOC_TOO_LARGE 机器码）；`workspaceToken` = sha256(cwd) 前 24 hex，不暴露工作区路径。host 服务新增 `dataGet/dataSet/dataChanges` 三个 `@Remote` 端点（Remote 边界用自定义 `AppJsonValue` lossless 类型，裸 unknown 会被 Typert 拒绝）。③ watcher —— `AppStageWatcherSet` 引用计数 bind/unbind（首个 bind 起、归零拆），macOS recursive `fs.watch` 可用、Linux 构造不抛错需 probe handle 先测；watch 目标缺失时 fallback 定时签名扫描（目录名+mtime 深度 3），目录出现后 tick 内升级 recursive 并补发差异事件；60ms 去抖。④ agent 工具面 —— `app_list`（scope=installed/dev/all；DevEntry 含 version/status/reason{code,detail,fix}，无 cwd→NO_WORKSPACE B0 信封）+ `app_manifest`（appId 手动 kebab 校验→APP_ID_INVALID；agentGuide ≤32KiB 内联）经 `agent/session-start` 事件挂到 `agent.ctx.tools.register`，disposer 经 `agent.ctx.effect()` 可逆。⑤ preset v3（generator 3）—— 17 行组合含 persona + skills（app-dev/workstage-use 内联物化到 skills/ 目录）。⑥ **CSP 硬契约（M2 最大实测教训）**：静态供源 CSP `default-src 'self'` 禁内联 `<script>` —— 应用逻辑必须放目录内外链 `.js`（`<script src="app.js">`），内联脚本被静默阻断（症状：页面静态渲染但桥代码从不执行，连报错都没有）；app-dev 技能与 demo 已按此修正。⑦ 验收时离线直写 AppData 注意 `home` 参数是 `$DSH_HOME` 根（`~/.dsh`），不是 `~/.dsh/deepcreator`——`appDataDir` 内部自拼 `deepcreator/apps/data`。验证：host 15 + agent 5 + client 20 单测全绿；真实 GUI 热链路 —— 宿主侧 agent 写（rev 2→3）→ 订阅轮询 1.5s 内 `data.event` 回推 → 容器无刷新渲染第三张卡片（`dataVersion rev 3`）；watcher 探针目录手放→菜单计数 1→2、删除→回到 1，均零刷新；零泄漏 UI 证据 = dev 应用存在时桌面仍"桌面还是空的"。

### M3 — 发布链（Phase 1b）

产出：`app_publish`（快照 + 零外联机器扫描 + 订阅/handler 双通道验证 + staging 机器截图经 browser-playwright + 来源判定 sourceFingerprint + 十一失败码）；审批挂起-应答（spike 二选一：复用 apiproxy pending 表 vs webServer 自建 respond 路由——**本里程碑第一件事**）；审批接管卡（QuestionComposer 同构：头-体-脚、可最小化、消息流只剩工具行 waiting→已安装）；安装存储 + 卸载/隐藏 + 出厂预装 + "暂停自动更新"；Launcher 完整态（蓝点/来源标注/人话名片/一键冷启动）。

验收：首发审批一次（接管卡）→ 桌面出现 → 任意工作区打开数据落全局域；同源更新免确认+蓝点；异源轻确认；降级拒绝；卸载净（含资产目录）；2 拒会话封禁；审批挂起无超时、显式取消→USER_DECLINED、会话终→静默丢弃+卡"未完成"。

**M3 实现事实（回填）**：
- 发布链 = `preparePublish`（定位+闸+版本策略+staging 快照+零外联扫描+浏览器探针）→ 审批（`ctx.userQuestions.ask`）→ `commitPublish`（rename 落 installed + 指针）。草稿以 draftToken 存宿主内存（宿主生命期）；abortPublish 供拒绝/丢弃路径清理 staging 目录。
- 版本策略三分支 first / update-same-source（免确认）/ update-cross-source（轻确认，卡片明示原安装来源）；同版本 VERSION_NOT_BUMPED、降级 VERSION_DOWNGRADED 均拒绝。2 次拒绝后本会话发布封禁（工具内闭包计数）。
- 出厂预装：`notes-sample`（便签示例）随常驻行首启装入 installed 域（`publishedVia: 'builtin'`、真实快照 digest、可卸载；卸载后不回装）。
- Launcher 完整态（本里程碑落的部分）：来源标注（sourceWorkspace 人话）、蓝点（opened.json 水位：安装版本 ≠ 上次打开版本）、两步卸载（悬停露出 × → 确认 !）+ 移除通知。人话名片详情与一键冷启动未做（随 M4/M5 UI 轮次）。
- agent 行注册模式修正（重要教训）：preset 行的 `apply` 直接运行在会话 fiber 里，工具应**直接 `ctx.tools.register`**（tool-bash 模式），不是监听 `agent/session-start`（那是宿主行模式，如 browser-playwright）。inject 需声明全部用到的服务：`['appStage', 'userQuestions', 'tools']`。
- 桥边界事实：typert 网关对 Remote 返回值做 JSON-safe 断言，`undefined` 会以 "business result failed boundary validation" 拒绝——缺失键路径读作 `null`（dataGet 已修）。
- 真实验收记录：preset 会话 → app_publish → 探针先拒（demo 未过桥订阅）→ agent 修源码 → 二次过闸 → 审批卡（名称/版本/来源/4 文件 4.5KiB/digest/零外联通过/订阅键 board/截图已生成）→ 安装 → 桌面出现卡片 → 容器内添加卡片 → `apps/data/kanban-demo/`（全局域）doc rev1 + journal → 两步卸载净（installed/data/assets 三目录消失，dev 源码完好）。

### M4 — 操作面（Phase 2）

产出：✅ `app_invoke`（只路由 Stage 容器，返回带版本，30s 超时 + actionApplied 语义）+ ✅ `app_open`/✅ `app_data_read`/✅ `app_data_write`/✅ `app_asset_write`/✅ `app_asset_list`/`app_takeover`（Px-β，移入 M5——依赖 PresenceCoordinator，见 surface B8/D1 裁决）；✅ handler 注册闸（通道一机器验证：声明 action 逐条须 action.register，探针不真调；无任何通道拒绝）；✅ conversation 活动 chip + 分段按钮活动点联动；✅ E 表兜底（熔断/护栏引导 app_list 诊断/调用上限；实现事实：ToolRunContext 无 turn 序号，turn 上限落为会话级预算 = E 表值 × 8 头寸——invoke 384 / write 256 / asset 128 / open 128，E4 防死循环意图由会话级达成）；✅ prompt section。

验收：agent 经 invoke 可靠驱动已安装应用（用户在对话模式有活动信号）；发布闸拒绝无双通道应用并给可行动原因（✅ 探针负例干跑：去 action.register 后拒绝并给"register every declared action"指引）；dev 对 invoke 不可寻址（✅ 单测钉死：invoke/open/data/asset 全工具只认 installed，dev: 前缀拒收）；INVOKE_TIMEOUT 先 read 验证再重试的行为在测试中成立（✅ actionApplied 信封 + fix 文案）；熔断 5 次→CIRCUIT_OPEN（✅ 单测）；GUI 真实验收（✅ preset 会话真实发布链：审批卡→安装→manifest 渐进披露→E1 纪律（连续 2 败停试转根因）全走通；发现并修复 wire 级缺陷 f238283：glm-5.3 经 openai-completions 的工具调用把 json 类型参数双重序列化成字符串——wire 日志实锤 `"params":"{\"title\"...}"`，工具层 coerceJsonArg 解包一层（invoke params + data_write value），属宿主序列化层系统性事实、影响所有 json 参数工具；✅ invoke 成功路径四步全通：createTask 落盘（created + persistedKeys + 版本回执）、data_read 验证、dev: 前缀拒收（APP_ID_INVALID）、app_open(focus:false)）。

M4 GUI 验收揪出并修复的三个缺陷（均以回归测试钉死）：
1. **桥双绑**（f444a28）：React 19 忽略 callback ref 返回的 cleanup，容器 remount 后同一 iframe 上叠加第二条 dispatch 路径。修复：frame 记 ref、经 useEffect 绑定/解绑。
2. **路由扇出双投递**（22b8589，根因）：`waitRequests` 是 cursor 寻址日志且 `push` 唤醒**所有** parked poll——两个同时连接的 GUI 面（用户浏览器 + 自动化浏览器）各自收到并各自执行同一请求，一次 createTask 出两张卡（81ms 差），且穿越一切客户端修复（扇出在宿主侧）。修复：每 poll 携带 routerId（每 GUI 面一个），请求认领制——认领归最新面，其他面 poll 照旧 park，异 router 从旧 cursor 恢复时跳过已认领条目；死认领由请求自身超时回收（E1 本就配对 read 验证）。hub 三测：双 parked 单投递 / 异 router 不重投 / 同 router 自身 cursor 重置可重试。
3. demo 应用协议卫生（v0.2.1）：invoke 回执错误形状对齐桥期望（`error: {message}` 而非裸 string，否则错误文本丢失成 "replied without an error message"）；同 id 重复派发幂等护栏（deduped 回执）。

M4 GUI 验收操作事实（复验时照抄）：GUI 页面刷新会重置 preset 选择器，新建会话前必须重选"App Stage 开发会话"（chip 文本核验）；`workbench-remotes` 是 client 侧 remote 方法表面的装配点——host 端点变更后它也要重建，否则 GUI remote 面缺新方法且无任何报错。

活动 chip 验收（✅ 用户目击，M4 最后一项闭环）：多 GUI 面并存时投递归最新 poller（实测用户浏览器常胜）——chip 在用户自己的面上亮起即同时验证活动信号、认领路由与"人看得见 AI 操作"三层。位置=窗口最右下角浮层胶囊（`.frame` 全窗锚定 right/bottom 20px；对话模式 + stageActivity 非空时渲染；点击切 apps 模式），亮约 1–2 秒（命令执行窗口）。单 invoke 冒烟在加载 22b8589 的新宿主复验：基线 rev11/10 卡 → 投递后 rev12/11 卡，恰好一写、createdAt 与回执逐毫秒一致；此后多轮冒烟（含 8 连发）全部单写。

### M5 — 在场层补全 + Desktop 投射（Phase 2.5 并行）

产出：presence 壳层（粒子边框/宏微租约/摘要卡/时间线/键入 ghost 按 presence 文档 Px-β 集）；Px-γ Desktop 投射（B1 投射 + B2 进程级 overlay，桥协议层共享）随 IAB 分支。

实现进度（Px-β 主体，三次提交）：

- **M5a 权威租约状态机**（`packages/host/app-stage/src/presence.ts` + 服务接线）：PresenceCoordinator 双层租约——微租约任一命令流动作即亮（60s 静默挂起释放），宏租约显式接管（AI 自主 5min / 委托 15min 平台常数，租约内新命令才续期，静默永不续）；X1 租约级用户中断（AI 永不自动抢回，resume/handback 用户专属）；摘要卡确定性折叠（动作分类计数/涉及应用/**全部 AppData key 变更清单**/用户中断事实/unfulfilled persist 标注——反"视觉掩护下的静默篡改"）；时间线只聚合 installed origin（dev 内环自测不进全局水位，§3.6）。服务命令路径全部接线：invoke/open/assetWrite 起止、dataSet 按 causeId 前缀分流（agent- 命令流 vs ui- 应用效果）、首发审批 waiting-approve 投影（decline 如实记 USER_DECLINED）。13 个状态机单测全过。
- **M5b app_takeover 工具**（B7 规格，preset 行）：无状态门面调常驻包 PresenceCoordinator；时长不开放参数（防 agent 自授长租）；需可见容器（粒子框是给用户看的，无 GUI 面拒绝 CONTAINER_UNAVAILABLE）；预算 16 次/会话。persona 补接管纪律段（generator 8）。
- **M5c 壳层投影**（`packages/client/ui-app-stage/src/client/presence.ts` + `PresenceBanner.tsx`）：外部 store feed——router 活动信号 poke 驱动轮询，租约存活才跑 2s keepalive，其余全部本地推导（acting/taking-over/waiting-approve/waiting-user、60s idle 降级、最后 30s 剩余读数、2s 退出滞回防闪）；32px 壳层横幅（词汇分级：微租约"AI 正在操作"、宏租约才"AI 接管中"+四边粒子框；色相只表达状态永不表达授权来源）；16 颗 CSS 粒子（transform/opacity 单合成层、固定色相节奏签名、reduced-motion 降级 2px 静态内边框）；宏租约用户控件（暂停 AI/收回；waiting-user 只显继续）；租约消失即取摘要卡（常驻至关闭）；aria-live 双通道常驻 DOM（polite 开始/结束/暂停 + assertive 只播"需要你的确认"，播报只用结构化字段）。UI_STYLE_GUIDE 已登记。客户端 17 个新测全过。

待办：**M5d** HTML 注入中间件（`text/html` 在 `</head>` 前插 `/__dsh_presence__.js`，同源 CSP 零放宽）+ SSE 通道 + 注入 runtime（冻结预置、零可调用 API、单向数据流）；时间线活动视图（Launcher 右上入口+蓝点水位）与键入 ghost（共见分型）随后续轮次；Px-γ Desktop 投射随 IAB 分支。

验收：presence 文档矩阵逐项过（已完成项：§2.1 双层租约、§2.2 权威/呈现分离、§2.3 词汇分级+色相纪律、§3.1 四边粒子+降级、§3.6 摘要卡+时间线数据源、§3.7 横幅三要素、§3.8 aria-live+结构化播报、§6 X1 租约级中断）；Desktop 投射下 invoke/呈现行为与 Web 一致（桥共享验证）。

**GUI 真实验收记录（2026-08-26，preset 会话四轮）**：①宿主全链路——app_takeover 回执 `{leaseId, mode:autonomous, budgetMs:300000, expiresAt}`，createTask 卡片 journal 落盘（M5验收A/B/C/D/E 各轮）；②宏租约投影——横幅“AI 接管中 · 看板演示” + **16 颗四边粒子**（用户在自己的 GUI 面亲眼目击确认）+ mm:ss 计时 + 暂停 AI/收回控件；③X1 中断——“暂停 AI”→“已暂停 · AI 让位”（只显“继续”），“继续”→恢复 acting；④handback——“收回”→摘要卡如实折叠（接管时长/动作计数 invoke × N/涉及应用/**数据变更清单**/**“你于第 N 步接管”中断事实**）；⑤aria-live——常驻 region 播出“AI 操作结束”（a11y 树核验 status+alert 双通道）；⑥**验收揪出两真缺陷并修复提交（08f565f，均带回归测试）**：跨面租约盲区（非认领面无 router 活动信号→永不知租约存在；修复=10s 发现轮询，租约已知后 2s keepalive 接管）、宏租约孤儿定时器（idle 回调直写 expiryTimer 不清旧臂→续租后旧死线照样释放，实测 8 秒天折摘要 00:08；修复=armExpiry 独占期限所有权，idle 只降级视觉）；测试基线 247 文件/2645 绿。操作事实：GUI 端口随重启漂移（60619→51650→52238，重启后须重探）；playwright-chromium provider 随宿主重启死锁须换观测面；菜单点击 browser_act 仍被拒，ego 触发 + DOM 读取组合稳定。

### M6 — 生态（Phase 3，按需启动）

导入（本地包/目录/git）+ 回退/发布历史 + 受控能力权限模型 + 无人值守 + 声明式渲染器扩展位。本计划不展开，届时另立计划。

## 3. 实现期 spike 清单（进入对应里程碑时第一件事）

| # | spike | 归属 | 判定问题 |
|---|---|---|---|
| S1 | 审批挂起-应答通路 | M3 | 复用 apiproxy pending 表 vs webServer 自建 respond；D10 语义（不超时/取消/会话终丢弃）在所选通路上的表达 |
| S2 | staging 机器截图 | M3 | ✅ 已完成：app-stage 直依 playwright-core 私起 headless chromium（env → bundled → 系统候选三级解析），探针验 entry fetch + data.subscribe 双通道，截图存 `apps/staging-shots/` best-effort 降级；实测冷启动 ~2s 在闸内可接受 |
| S3 | 席位等待与可行动错误 | M1 | ✅ 已完成（M0 期）：`reconcile()` 对未声明席位静默等待，行卸载经 ctx.effect 干净取消；补充事实（M1 测试钉死）：inject 数组中的服务缺失时 cordis 让插件静默休眠（apply 不跑、不报错）——`remote.appStage` 这类命名空间服务必须在宿主先行挂载 |
| S4 | fs watcher 平台行为 | M2 | ✅ 已完成：macOS `fs.watch({recursive:true})` 可用（rename=create/delete、change=内容编辑）；Linux 构造不抛错但首个 callback 才报错 → 需 probe handle 先测再升级；watch 目标目录不存在时构造抛错 → fallback 定时签名扫描（目录名+mtime 递归深度 3），目录出现后 tick 内升级 recursive 并对比新旧 signature 补发漏掉的事件；60ms 去抖聚合。已落 `watcher.ts` 引用计数 bind/unbind + 3 个真 timer 单测 |
| S5 | file: URL preset 行 | M1 | ✅ 已完成：loader 对 `file:///abs/path` specifier 与包名行走同一动态 import 路径，要求 agent 包先 build；preset 物化器已按此落地并在真实 `$DSH_HOME` 验证 |
| S6 | iframe 常驻挂载内存 | M1 | 部分完成：M1/M2 容器为单实例 + 返回桌面即卸载（DOM 层不保活，桥 attach/detach 随容器生命周期）；"apps 模式外保持挂载"的常驻语义与内存护栏常数未做，随 M3 Launcher 完整态再落 |

## 4. 风险跟踪（开发期滚动）

继承主文档风险表，开发期新增实现风险记入里程碑验收备注。当前最高三项：S1 审批通路（已从"无先例"降级为二选一）、S6 常驻容器内存、共享壳席位改动与既有布局回归（M0 验收覆盖）。

## 5. 里程碑与设计的回填关系

- 每里程碑合入时：主文档对应 Phase 条目标注"已实现至 <里程碑>"；`docs/architecture/deepcreator.md` 与包 README 同步；本文状态行更新。
- 设计变更（实现推翻设计时）：先改设计文档（含裁决记录），再落代码——保持"文档是提案、代码是实现"的可追溯纪律。
- 常数冻结：E 表兜底常数与 manifest 校验细则在 M4 合入时冻结（此前为建议值）。
