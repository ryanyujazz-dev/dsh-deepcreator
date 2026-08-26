# @ryanyujazz/dsh-app-stage-agent

App Stage 的 agent 会话行（preset 行，**绝不进 bundle**）：`app_*` 工具面只在这一行内注册，普通会话永远看不到它（工具可得性即权限）。app-stage preset 的 composition 以 file: URL 指向本包构建产物，loader 与包名行走同一动态 import 路径（S5 已验证）。

## 工具面（M2/M3 已实装）

`inject: ['appStage', 'userQuestions', 'tools']`；preset 行的 `apply` 直接运行在会话 fiber 里，因此**直接 `ctx.tools.register`**（tool-bash 模式——注册随 fiber 生灭，天然可逆；不要用 `agent/session-start` 事件，那是 browser-playwright 等宿主行的模式，preset 会话里不会触发到本行）。

- `app_list` — scope=`installed`|`dev`|`all`（默认 all）。DevEntry：appId/name/version/status（ready/rejected/incomplete）+ reason（code/detail/fix，仅非 ready）+ conflictsWithInstalled + originURL（仅 ready）。InstalledEntry：appId/name/version/actionsSummary/sourceWorkspace/updatedAt。会话无 cwd → B0 错误信封 `NO_WORKSPACE`。
- `app_manifest` — 入参 appId（kebab-case，description 注明约束 + execute 内手动正则校验 → `APP_ID_INVALID`）；返回 manifest 原文 + agentGuide 内联（≤32KiB 截断）+ actions 表。未安装 → `APP_NOT_INSTALLED`；存储不可读 → `RUNTIME_BROKEN`。

- `app_publish`（M3）— 参 appId。链路：`preparePublish`（定位+闸+版本策略+staging 快照+零外联扫描+浏览器探针；任一失败返回对应失败码，探针失败 = PROBE_FAILED 且 detail 说明未达通道）→ 审批策略：first 与 update-cross-source 挂官方 `ctx.userQuestions.ask`（无超时；显式取消 reject `ASK_CANCELLED` → USER_DECLINED + 拒绝计数；会话终 abort signal → 静默丢弃 staging 草稿后 rethrow）；update-same-source 免确认直装。拒绝计数达 2（PUBLISH_DECLINE_BAN）本会话封禁。审批卡正文含名称/版本/来源工作区/文件数与大小/digest 前缀/扫描摘要/订阅键/截图说明/可逆性声明。成功返回 plan/digest/subscribedKeys/scanViolations/screenshotTaken。

工具 schema 用 dsh-tools DSL：不支持 `pattern`/`maxLength`（`unsupported JSON schema` 拒载），约束写进 description 并在 execute 内手动校验。

`userQuestions` 服务是**宿主平面行**（组合第 36 行），preset 会话运行在宿主组合内故天然可得——preset composition 里**不要**再注册该行（服务名碰撞会让整行挂载失败）。

后续里程碑在此行追加 `app_invoke`/`app_data_read`/`app_data_write` 等（M4）。
