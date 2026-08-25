# @ryanyujazz/dsh-app-stage-agent

App Stage 的 agent 会话行（preset 行，**绝不进 bundle**）：`app_*` 工具面只在这一行内注册，普通会话永远看不到它（工具可得性即权限）。app-stage preset 的 composition 以 file: URL 指向本包构建产物，loader 与包名行走同一动态 import 路径（S5 已验证）。

## 工具面（M2 已实装）

`inject: ['appStage']`；`agent/session-start` 事件里经 `agent.ctx.tools.register`（单参数 ToolDefinition）挂工具、`agent.ctx.effect` 收拢 disposer（label `app-stage-agent: tool face`），随会话 fiber 可逆。

- `app_list` — scope=`installed`|`dev`|`all`（默认 all）。DevEntry：appId/name/version/status（ready/rejected/incomplete）+ reason（code/detail/fix，仅非 ready）+ conflictsWithInstalled + originURL（仅 ready）。InstalledEntry：appId/name/version/actionsSummary/sourceWorkspace/updatedAt。会话无 cwd → B0 错误信封 `NO_WORKSPACE`。
- `app_manifest` — 入参 appId（kebab-case，description 注明约束 + execute 内手动正则校验 → `APP_ID_INVALID`）；返回 manifest 原文 + agentGuide 内联（≤32KiB 截断）+ actions 表。未安装 → `APP_NOT_INSTALLED`；存储不可读 → `RUNTIME_BROKEN`。

工具 schema 用 dsh-tools DSL：不支持 `pattern`/`maxLength`（`unsupported JSON schema` 拒载），约束写进 description 并在 execute 内手动校验。

后续里程碑在此行追加 `app_publish`（M3）、`app_invoke`/`app_data_read`/`app_data_write` 等（M4）。
