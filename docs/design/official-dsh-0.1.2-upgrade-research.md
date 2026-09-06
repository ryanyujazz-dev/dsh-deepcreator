# 官方 DSH 0.1.2 线升级调研（0.1.1-rc.2 → 0.1.2-rc.1）

> 调研日期：2026-09-06。结论：**0.1.2-rc.1 是破坏性重构，不可常规升级**；本文记录变更全貌、patch 命运、可回植的性能技术与后续迁移路径。当前项目保持 0.1.1-rc.2。
>
> **【状态更新 · 迁移已完成】** 本文的迁移建议已按 §6 中期路径执行完毕：分支 `feat/upgrade-dsh-0.1.2-rc.1` 全量升级到 `0.1.2-rc.1`（compatibility.json 锁定 SHA `a66e4702`），Phase 1–5 全部落地 —— 版本面重 pin、5 个官方 patch 重建（含 session-controller 新增 retainNavigationAddress + scope-binding 接缝两个 hunk）、378 处 import 重映射、provideInfoFor 以自有租约服务（compat `createSessionLeaseHub`）+ renderer scope 绑定覆盖重实现、Activity 面板子代理嵌入五项语义桌面端实测通过。调研时未预见的一项补充工作：0.1.2 删除了 wire 视图（改为主机侧工具 presenter），而官方客户端尚无消费者，为保住终端/diff/搜索/读取/网页富卡片，compat 新增 presenter 复刻层（`presenters.ts`）并在会话组装器挂回 `callView`/`resultView`。验证基线：`pnpm install` / `verify:harness` / `typecheck`（46 包）/ `pnpm test`（2676）/ desktop 构建全绿。§4 的性能回植**不在本次迁移范围**，留作后续独立提交。

## 1. 版本事实

- 官方仓库 `deepseek-ai/deepseek-harness`，本调研对比 tag `dsh-v0.1.1-rc.2`（b150a551）与 `dsh-v0.1.2-rc.1`（a66e4702）。
- 两版之间 **1735 个提交**。npm dist-tag：`latest` = `0.1.2-rc.1`；master 已进入 `0.1.3-alpha.1`。
- 我们依赖的 192 个 `@deepseek-ai/*` 包中 189 个已发布 0.1.2-rc.1。未发布的 3 个：
  - `@deepseek-ai/dsh-client-runtime` —— **本项目地基，已随源码删除**（唯一阻断项）。
  - `@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-tool-subagent-report` —— 已删除，但**本项目未引用**，无影响。

## 2. 架构变化（升级阻断点）

`packages/client/runtime` 整体删除，client 包净变化：+store、+ui-approval、+ui-chat、+ui-schedule、+ui-session、−runtime。

| 旧（0.1.1-rc.2） | 新（0.1.2-rc.1） |
| --- | --- |
| `dsh-client-runtime`（SessionRuntime、SessionProvideChannel、ISessions、createScope、createSnapshotStore、SlotRegistry…） | 会话客户端逻辑并入 `dsh-api-session-controller`（client/sessions/{service,manager,session,projection-store}.ts）；observable/store 原语拆到新包 `dsh-client-store`；`createScope/scopeOf` 在 session-controller；SessionProvider 座位挪到新包 `ui-session` |
| `provideInfoFor(id)` 显式非导航会话投影（本项目 patch 加入） | **无任何等价物**。`ui-session` 的 `renderSessionArea` 仅渲染当前选中会话；`ClientSessions` 仅有导航式 `open(id)` / `openSubagent(address)` |
| ui-conversation（会话外壳+聊天渲染一体） | 拆分：`ui-conversation` 保留目标无关的外壳/组装/composer/queue；聊天节点定义与渲染器拆到新包 `ui-chat` |

**我们的 import 面高度集中**：全部 378 处 import 都是同一子路径 `@deepseek-ai/dsh-client-runtime/client`，机械重映射可行；真正的工作量在 provideInfoFor 能力的架构级重实现。

## 3. 本项目 6 个官方包 patch 的命运

| patch | 内容 | 迁移难度 |
| --- | --- | --- |
| `dsh-tool-fs` | 导出 `computeHunkDiffs`；write/edit 的 presentationMeta 附带绝对行号 oldStart/newStart | **低**。上游仅小改（write/edit 各 4 行、删 invariant.ts、read-image 增强），锚点基本稳定 |
| `dsh-tools` | `FileDiff` 类型补 oldStart/newStart | **低**。类型文件稳定 |
| `dsh-client-ui-slots` | `SessionAreaProps.sessionId`、`SlotRendererHost.sessions.provideInfoFor` 类型 | **低**（类型层），但引用的运行时能力不复存在 |
| `dsh-client-ui-renderer` | `SessionProvider` 支持 `sessionId` prop；client bundle 导出 bindSnapshotSelector/createSlotRenderer | **中**。包仍在、bind.ts/scoped-slots.tsx 路径未变，但官方重写了 scoped-slots/keyed sources，需对照新实现重打 |
| `dsh-client-runtime` | provideInfoFor、deactivate() 冷却、retainNavigationAddress、显式 provider MRU、installWindow unchanged-skip | **作废**。包已删除，整套能力需在新 projection-store 架构上重实现 —— 迁移的最大工程量 |
| `dsh-client-test-runtime` | TestSessions 双打的 provideInfoFor；renderer import 收敛 | **作废/重建**，跟随 runtime 重实现 |

注意：官方**没有**采纳上述任何思路（新 tool-fs 不导出 computeHunkDiffs、新 FileDiff 无 oldStart/newStart、新 SessionAreaProps 无 sessionId）。这些扩展仍是本项目独有的差异化能力。

## 4. 可立即回植到现有 0.1.1-rc.2 架构的技术（无需升级）

以下性能技术落在官方 **ui-chat / ui-conversation 源码层**，与我们自有 fork（packages/client/ui-conversation 等）同类，可直接借鉴移植：

1. **流式发布按帧节流**（c809098b06、5934201109）：高频流式更新用 `requestAnimationFrame` 链批处理，跨 2 个绘制机会才 publish 一次。→ 移植点：我们 ui-conversation 的 stores/service 流式发布路径。
2. **滚动几何采样节流**（e32437d18b）：原生 scroll 事件只置 pending 标志，几何采样至多每 500ms 一次，`scrollend` 补终采样。→ 移植点：我们 `chat/scroll-anchor.ts`。
3. **节点状态增量维护**（81431381d6）：把每个流式事件都重算的聚合值（如 controlAnchorSeq、messageCount）缓存进节点 state 增量更新，避免 O(n) 重算。→ 移植点：conversation-nodes 各定义。
4. **CSS 化渲染细节**（f808112ec8、203e2440ac、ebe9f50b44）：reasoning tail 对齐、user action reveal、折叠布局从 JS 移到 CSS containment。→ 低风险。
5. installWindow 的 unchanged-window skip：**我们的 client-runtime patch 已先行实现等价逻辑**，无需动作。

不可直接移植：`bind keyed chat sources`（577f0cf7d9）依赖 0.1.2 新 ui-slots API（+37 行接口面），回植需给旧 ui-renderer 打 patch，不建议。

## 5. 存储兼容层（只随升级获得的收益）

本项目依赖 `dsh-storage / dsh-storage-domain / dsh-storage-json / dsh-session-projection / dsh-session-projection-cache`（均已发布 0.1.2-rc.1）。官方在此线加入：
- 存储域版本化读兼容 + 逐记录单元 backup-and-skip 抢救（fcd109d29a）；
- 升级后旧投影缓存可读、boot 安全，并建立 schema 变更 fixture 规则（49df707c86、bef26396e5）。

意义：用户跨大版本升级 DeepCreator 桌面端时，旧缓存不再导致 boot 失败。**只有完成 0.1.2 迁移才能获得**，是未来升级的主要理由之一。

## 6. 建议路径

> 【已执行】以下中期路径即本次迁移的实际分解（1↔Phase 3、2↔Phase 4、3/4↔Phase 2、5↔Phase 5），见文首状态更新。

- **短期（现在）**：保持 0.1.1-rc.2。将 §4 的 1–3 项性能技术移植进自有 ui-conversation fork，独立提交（不与功能分支混淆）。
- **中期**：等 0.1.2 线稳定（0.1.3-alpha 已开线）后启动迁移专项，工程分解：
  1. 378 处 import 重映射（机械，sed 级）；
  2. provideInfoFor / 非导航会话投影在 `dsh-api-session-controller` projection-store 架构上重实现（核心工程，需设计评审）；
  3. tool-fs / tools / ui-slots / ui-renderer 四个 patch 对照新源码重打（低-中难度）；
  4. test-runtime 双打重建；
  5. 存储缓存迁移策略验证（§5）。
