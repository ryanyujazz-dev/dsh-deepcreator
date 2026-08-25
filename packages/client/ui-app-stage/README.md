# @ryanyujazz/dsh-client-ui-app-stage

App Stage 的 Client 侧：`deepcreator.stage.apps` 席位的占用者（Stage Shell）。一个 UI 特性一个包；React 视图只吃 props，跨插件只经公开 Slot/Service。

## 结构

- `src/client/contract.ts` — 组合 props 契约：`PropsRuntime<'deepcreator.stage.apps'>`（frame 的 owner props：phone/stageWidth/dockOpen）+ `PropsLocale<'app-stage'>` + 本包注入面（layout 写回、捕获的 appStage 远程命名空间、当前会话外部 store、scanTick 刷新提示、bridge）。远程面含 `list`/`ensure`/`dataGet`/`dataSet`/`dataChanges`；`OpenContainer` 携带 `ref`（`dev:<appId>` 或裸 installed id）。
- `src/client/StageShell.tsx` — 桌面壳：48px 顶栏（标题 + 坞开关 + 开发中菜单）、Launcher 卡网格、`sandbox="allow-scripts"` 沙箱容器。开发中菜单展开即现扫（probe-at-open，effect 依赖含 menuOpen）；仅 ready 条目可开，未过闸条目显示 reason 徽章。容器打开时对 iframe attach 桥、关闭/切换时 detach（`frameRef` + containerRef effect）。
- `src/client/bridge.ts` — 数据桥（协议 v1）：`createAppStageBridge({remote, session})` → `attach(frame, ref) → detach`。入站消息校验 `__appStage`/字段形状，回复只认 `event.source === frame.contentWindow` 且 id 在 pending 表；协议号≠1 回 `PROTOCOL_UNSUPPORTED`（版本握手）。订阅 = 1500ms 轮询 `dataChanges(sinceRev)` 把 journal 增量以 `data.event` 推进 frame；应用侧 `data.set` 成功后立即从 journal tail 精确回推（`broadcastSince(rev-1)`），不等下一轮询。
- `src/client/index.ts` — apply：字典注册 + `ctx.slots.inject` 等待席位声明（S3 语义：未声明静默等待）+ 注册。远程命名空间在 apply 捕获一次（渲染期 Proxy 读会失效每个 effect）；当前会话以 `ctx.sessions.list` 的 subscribe/getSnapshot 外部 store 注入，组件经 `useSyncExternalStore` 消费 —— 注册期 inject props 是静态快照，活状态必须走订阅。

## 数据流

所有 host 数据经捕获的 `remote['appStage']`；应用内容经 `ensure` 铸造的沙箱 URL（`/deepcreator-app-stage/dev|installed/...`）；应用自身的读写经 bridge 的 postMessage 协议（opaque origin，只能 `'*'` targetOrigin，信任边界 = source 检查 + id 关联）。所有布局写经 `ctx.layout`，永不经 owner props 回写。跨插件组合只经 ui-layout 的公开席位与 workbench-remotes 挂载的远程面。

## 沙箱 iframe 注意

语义 browser 工具（browser_act fill 等）进不去 `sandbox="allow-scripts"` 的 opaque origin iframe（getByRole 超时）；容器内验证走截图 + 视觉模型，或宿主侧 `appDataSet` 直写数据域（与 agent 写路径等价）靠订阅回推观测。静态供源 CSP 禁内联 `<script>`——应用必须用目录内外链 `.js`（详见 host 包 README）。
