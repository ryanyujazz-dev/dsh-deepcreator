# @ryanyujazz/dsh-client-ui-app-stage

App Stage 的 Client 侧：`deepcreator.stage.apps` 席位的占用者（Stage Shell）。一个 UI 特性一个包；React 视图只吃 props，跨插件只经公开 Slot/Service。

## 结构

- `src/client/contract.ts` — 组合 props 契约：`PropsRuntime<'deepcreator.stage.apps'>`（frame 的 owner props：phone/stageWidth/dockOpen）+ `PropsLocale<'app-stage'>` + 本包注入面（layout 写回、捕获的 appStage 远程命名空间、当前会话外部 store、scanTick 刷新提示、bridge）。远程面含 `list`/`ensure`/`dataGet`/`dataSet`/`dataChanges` 与 M4 操作面（`invoke`/`open`/`dataProbe`/`assetWrite`/`assetList`/`waitRouterRequests`/`routerResult`）；`OpenContainer` 携带 `ref`（`dev:<appId>` 或裸 installed id）。
- `src/client/StageShell.tsx` — 桌面壳：48px 顶栏（标题 + 坞开关 + 开发中菜单）、Launcher 卡网格、`sandbox="allow-scripts"` 沙箱容器。开发中菜单展开即现扫（probe-at-open，effect 依赖含 menuOpen）；仅 ready 条目可开，未过闸条目显示 reason 徽章。容器打开时对 iframe attach 桥、关闭/切换时 detach（`frameRef` + containerRef effect）。M3：已安装卡可点击打开（`ensure` 裸 appId，同时清蓝点水位）；卡片带来源标注（`launcher.source`）与更新蓝点（`updatedSinceOpen` → `updated`，`ensure` 记录 opened.json）；悬停露出两步卸载（× → 确认态 ! → 执行 `uninstall` 后重扫并显示移除通知行）。M6b：卡行右侧「历史」按钮（⌛）展开安装历史面板（probe-at-open 读 `installedHistory`，最新在前：版本 + via 徽标 + digest 前 8 位 +「当前」/「回退到此版」；回退走 `rollbackInstalled`，结果行内提示，完成后重扫卡面）。M6c：顶栏「导入」菜单——目录/Git 双页签来源表单 → `importPrepare` 事实卡（**digest 优先防钓鱼**：appId 与 digest 前缀常显，名称仅次要）→ 分档文案（first/cross-source 轻确认/below-watermark 硬确认/already-installed 空转）→ `importCommit`/`importAbort`；外点关闭即弃 draft。
- `src/client/bridge.ts` — 数据桥（协议 v2）：`createAppStageBridge({remote, session})` → `attach(frame, ref) → detach`。入站消息校验 `__appStage`/字段形状，回复只认 `event.source === frame.contentWindow` 且 id 在 pending 表；`__appStage`≠1 回一条 `PROTOCOL_UNSUPPORTED`（版本握手）。v2 在 v1 请求面上增 `action.register`（应用注册 action handler）与 `action.invoke` 下行：派发携带 `proto: 2` 与新铸 id，frame 回执须带同 id（`result`/`error.message` 是不可信应用文本），同 id 结算 handler 结果/异常。订阅 = 1500ms 轮询 `dataChanges(sinceRev)` 把 journal 增量以 `data.event` 推进 frame；应用侧 `data.set` 成功后立即从 journal tail 精确回推（`broadcastSince(rev-1)`），不等下一轮询。
- `src/client/router.ts` — StageRouter（M4）：宿主队列的客户端执行器。持有容器 store（单实例换载语义：AppData 是唯一事实源，换应用即重载不迁移），执行循环 `ensure → mount → waitForAction → dispatch → routerResult`——`ensureContainer` 经 `ensure` 重过闸并清蓝点水位（与用户打开同路），handler 未注册回 `ACTION_NOT_REGISTERED`，结算上报失败静默（宿主超时兜底）。长轮询循环每轮经 `window.setTimeout(0)` 宏任务让步再续：瞬时解析的 transport 不得饿死 timer 与绘制。每个 router 实例 mint 一个 `routerId`（`crypto.randomUUID`）随 `waitRouterRequests` 上送——宿主投递是单消费者认领制，多个 GUI 面并存时一次请求只归一个面执行（否则一次 invoke 会被两个面各执行一次）。活动信号：invoke 请求进入时 `onActivity({appId, name})`、结算后 `onActivity(undefined)`，由 index 接线 `ctx.layout.setStageActivity`——分段器活动点与 AppFrame 活动 chip 的唯一数据源。
- `src/client/index.ts` — apply：字典注册 + `ctx.slots.inject` 等待席位声明（S3 语义：未声明静默等待）+ 注册。远程命名空间在 apply 捕获一次（渲染期 Proxy 读会失效每个 effect）；当前会话以 `ctx.sessions.list` 的 subscribe/getSnapshot 外部 store 注入，组件经 `useSyncExternalStore` 消费 —— 注册期 inject props 是静态快照，活状态必须走订阅。M4 在 apply 内建 StageRouter 并起轮询循环（`ctx.effect` 可逆）：`onActivity → ctx.layout.setStageActivity`、`onPresent(focus) → setStageMode('apps')`。

## 数据流

所有 host 数据经捕获的 `remote['appStage']`；应用内容经 `ensure` 铸造的沙箱 URL（`/deepcreator-app-stage/dev|installed/...`）；应用自身的读写经 bridge 的 postMessage 协议（opaque origin，只能 `'*'` targetOrigin，信任边界 = source 检查 + id 关联）。所有布局写经 `ctx.layout`，永不经 owner props 回写。跨插件组合只经 ui-layout 的公开席位与 workbench-remotes 挂载的远程面。

## 沙箱 iframe 注意

语义 browser 工具（browser_act fill 等）进不去 `sandbox="allow-scripts"` 的 opaque origin iframe（getByRole 超时）；容器内验证走截图 + 视觉模型，或宿主侧 `appDataSet` 直写数据域（与 agent 写路径等价）靠订阅回推观测。静态供源 CSP 禁内联 `<script>`——应用必须用目录内外链 `.js`（详见 host 包 README）。
