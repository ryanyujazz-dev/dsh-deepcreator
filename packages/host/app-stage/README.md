# @ryanyujazz/dsh-app-stage

App Stage 的 host 常驻行：应用发现登记处（记录全集 + 完整性闸）、双供源沙箱静态服务、安装存储骨架、AppData 持久层、会话绑定 watcher、app-stage agent preset 物化器。人机共用的"AI 操作系统"数据面都在这一行后面；禁用本行即整个舞台退场（插件完整性不变量）。

## 组成

- `src/manifest.ts` — manifest v1 纯函数校验：`platform: app-stage-v1` 唯一合法平台值、id=目录名（kebab）、entry/icon/agentGuide 目录内相对路径（拒绝绝对与 `..`）、actions ≤32（camelCase 唯一、description ≤120、params ≤16 键限 `string|number|boolean|json?`、persist ≤8 合法点路径）、manifest ≤64KiB、icon 限 `.svg/.png`、agentGuide ≤32KiB、permissions 恒空。非法平台返回 `platform.unsupported`，其余拒绝 `manifest.invalid`。
- `src/registry.ts` — dev 目录扫描（`<workspace>/.deepcreator/apps/<id>/`，目录排序、跳过点目录）与 `gateDevEntry` 完整性闸：缺/坏 manifest = rejected；manifest 声明的 entry/icon/agentGuide 文件缺失 = incomplete（带 manifest 与 reason）；全部就绪 = ready。与已安装 id 冲突以 `conflictsWithInstalled` 标注。
- `src/serve.ts` — 官方 `ctx.webServer` 的 `/deepcreator-app-stage` prefix 双供源：`/dev/<token>/<file>`（token = sha256(应用目录绝对路径) 前 24 hex，URL 不暴露工作区路径，`ensure` 时惰性注册）与 `/installed/<appId>/<version>/<file>`。realpath 后双重围栏；响应头 CSP（`default-src 'self'; form-action 'none'; frame-ancestors 'self'`）+ nosniff + no-store。不自起 HTTP 服务。**CSP 后果：内联 `<script>` 被静默阻断——应用逻辑必须放目录内外链 `.js`。**
- `src/store.ts` — 安装存储骨架：`$DSH_HOME/deepcreator/apps/installed/<appId>/<version>/` 快照目录 + 指针文件（appId/version/digest/installedAt/来源三锚点）。`DSH_HOME` 环境变量优先，回落 `~/.dsh`。
- `src/appdata.ts` — AppData 持久层：`$DSH_HOME/deepcreator/apps/data/[dev/<wsToken>/<appId>|<appId>/]` 下 `doc.json`（schemaVersion/rev/data，原子写）+ `journal.jsonl`（append-only `{rev,path,value,causeId,ts}`，超 2×1000 条压实；torn 行容忍跳过）。键路径 `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`；单值 ≤256KiB、文档 ≤4MiB，超限抛 `VALUE_TOO_LARGE`/`DOC_TOO_LARGE` 机器码后缀 Error；非法路径抛 `PATH_INVALID`。`workspaceToken` = sha256(cwd) 前 24 hex（dev 域不暴露工作区路径）。注意 `home` 参数是 `$DSH_HOME` 根（`~/.dsh`），目录内部自拼 `deepcreator/apps/data`。
- `src/publish.ts` — 发布闸机械半程（M3）：版本策略三分支（first / update-same-source 免确认 / update-cross-source 轻确认；同版本 VERSION_NOT_BUMPED、降级 VERSION_DOWNGRADED 拒绝）、目录快照进私有 staging（16MiB 上限 PACKAGE_TOO_LARGE）、零外联扫描（absolute-url 与 navigation-api 两模式，文本扩展名集内扫描）、快照 sha256 digest 链、`commitSnapshot` rename 落 installed（跨设备 cp 回退）、`uninstallApp` 三目录净卸（installed/assets/data）、`gateForPublish` 复用 dev 闸。
- `src/probe.ts` — staging 浏览器探针（M3）：直依 playwright-core 私起 headless chromium（可执行文件解析 env → bundled → 系统候选），验证 entry fetch（status 200 + MIME 前缀）与 `data.subscribe` ≥1 键（通道二机器验证），首屏截图存 `apps/staging-shots/`（best-effort 降级为 icon+名称）。订阅未达即 PROBE_FAILED。
- `src/builtin.ts` — 出厂预装（M3）：`notes-sample` 便签示例随常驻行首启装入 installed 域（`publishedVia: 'builtin'`、真实快照 digest、UI 标注「来自 DeepCreator」、可卸载；卸载后不回装，同 id 真实发布不受影响）。
- `src/control.ts` — 路由中枢 `AppRouterHub`（M4）：宿主侧操作请求队列 + parked 长轮询。`waitRouterRequests(afterCursor, routerId)` 无新请求时挂起（`ROUTER_POLL_MS` 25s 节奏空返回），`routerResult(requestId, outcome)` 结算对应 pending 请求；一条队列、一个单调 cursor、presence 宽限 3s / seen 窗口 40s，路由器掉线由超时兜底（INVOKE 30s / OPEN 15s）。**投递是单消费者语义**：每个 GUI 面在自己的 router 实例 mint 一个 `routerId`，队列条目被认领（claim）给恰好一个 router——认领归最新 poll 的面，`push` 只唤醒该面的 parked poll，异 router 从旧 cursor 恢复时跳过已认领条目（cursor 照常推进），同 router 崩溃后自 cursor 重置重试自己的认领不受阻。没有认领制时一次 `push` 唤醒所有 parked poll，两个同时连接的面（用户浏览器 + 自动化浏览器）会各自执行同一请求（实测一次 createTask 双写两张卡）；死认领由请求自身超时回收，E1 纪律本就要求超时后先 `app_data_read` 验证再重试。
- `src/params.ts` — `validateInvokeParams`（M4）：invoke 入队前按 manifest action 的 params 声明校验入参（类型与必选），失败返回 PARAMS_MISMATCH 的完整消息。
- `src/assets.ts` — 资产通道存储面（M4）：`$DSH_HOME/deepcreator/apps/assets/<appId>/` 下被动媒体文件。白名单扩展名 png/jpg/jpeg/webp/gif/mp4/webm 且魔数嗅探一致（永不含 SVG），content-type 取自白名单；单资产 ≤64MiB（ASSET_TOO_LARGE）、单应用 ≤256MiB 配额（ASSET_QUOTA_EXCEEDED）；同名写 = 幂等 upsert，回收靠同名覆盖或卸载。供给走 serve 的 `/deepcreator-app-stage/assets/<appId>/<name>`（同源，CSP 'self' 内成立）；卸载清空整个资产目录，资产不进发布快照。
- `src/index.ts` 服务端点（M3 增）：`preparePublish`（闸+staging+探针，草稿以 draftToken 存宿主内存）→ 审批（agent 侧走 `ctx.userQuestions` 缝）→ `commitPublish` / `abortPublish`；`uninstall`；`list` 带 `updatedSinceOpen` 蓝点（`opened.json` 水位：`ensure` 已安装分支记录打开版本）。
- `src/watcher.ts` — 会话绑定 watcher 集：`bind/unbind` 引用计数（首个 bind 起 watcher、归零拆除），首个 bind 起 60ms 去抖聚合发 `app-stage/dev-changed(cwd)`。平台策略：构造 recursive `fs.watch` 前先 probe handle（Linux 构造不抛错、首个 callback 才报错）；目标目录缺失时 fallback 定时签名扫描（目录名+mtime 递归深度 3），目录出现后 tick 内升级 recursive 并对比新旧 signature 补发漏掉的事件。
- `src/preset.ts` — app-stage agent preset 物化器（generator 3）：`$DSH_HOME/.agent-presets/app-stage/` 下生成 `agent.cordis.yml`（`- id: app-stage-agent` / `name: '<agent 包 file: URL>'` + 完整工具/skills 组合）、`preset.yml`、`skills/`（app-dev 与 workstage-use 全文）与 stamp（generator + agent entry + 三 digest）。三态返回 materialized/verified/healed。
- `src/preset-skills.ts` — 内联技能全文：app-dev（manifest v1 契约、目录布局、数据桥接入、交付清单，含 CSP 外链脚本纪律）与 workstage-use（七操作表、节奏、纪律）。
- `src/index.ts` — `AppStageService extends TypertRemoteService`（`ctx.appStage`，namespace `appStage`）：`@Remote list` 返回 installed 全集 + 当前会话工作区的 dev 条目；`@Remote ensure` 按引用（`dev:<appId>` / 裸 installed id）重过闸并铸造沙箱 URL；`@Remote dataGet/dataSet/dataChanges` 数据端点（见下）。构造期挂静态路由、watcher 会话绑定（adopt live → `session/created` bind → `session/disposed` unbind）与 preset 物化，全部经 `ctx.effect` 可逆。

## 远程面

tsdown 的 typert 生成 `./typert`（host 面）与 `./remote`（client 投影）。Client 侧经 workbench-remotes `$mount` 后 `ctx.remote['appStage']` 捕获一次命名空间。数据端点的 value 类型是 `AppJsonValue`（递归 lossless JSON 类型）——Remote 边界禁裸 `unknown`/`any`，Typert 分析器会拒绝。

## AppData 数据端点（M2）

- `dataGet(session, {scope?, path?})` — 读整树或键路径，返回 `{ok, value, rev}`；ref 形如 `dev:<appId>`（本会话工作区）或裸 installed id。
- `dataSet(session, {ref, path, value, causeId?})` — 键路径写：校验 → structuredClone 树 → 原子写 doc.json → 追加 journal，返回 `{ok, rev}`；错误带机器码（`PATH_INVALID`/`VALUE_TOO_LARGE`/`DOC_TOO_LARGE`/`APP_NOT_INSTALLED`/`RUNTIME_BROKEN`）。
- `dataChanges(session, {ref, sinceRev})` — journal 增量 `{ok, changes: [{rev, path, value, causeId, ts}], rev}`，client 桥的订阅轮询数据源。

## 操作面端点（M4）

- `invoke(session, {appId, action, params})` — 只寻址 installed 应用：resolveInstalled（dev 对 invoke 不可寻址）→ manifest 声明核对（`ACTION_NOT_DECLARED`）→ `validateInvokeParams`（`PARAMS_MISMATCH`）→ 请求入 AppRouterHub 队列，等 Stage 路由器结算（30s）。成功返回带 version + handler result + `persistedKeys`（以 revBefore 为基线的 journal diff 去重键集——本次 action 实际落盘的证据）；handler 失败回 `HANDLER_FAILED`（app 文本不可信）；无路由器在线回 `CONTAINER_UNAVAILABLE`。超时回 `INVOKE_TIMEOUT` 且 `actionApplied: true` 表示文档 rev 已前进——命令可能已执行，重试前必须先读验证。
- `open(session, {appId, focus})` — 展示意途：`focus=true` 让路由器把 GUI 切到 apps 模式并前置容器；15s 为容器冷启动预算；返回 opened（本次是否新挂载）/focused。
- `dataProbe(session, {ref, path?})` — found 位读取：`found:false` 精确区分键路径缺失与存 null（`dataGet` 按边界纪律把缺失读作 null，二义）。
- `assetWrite` / `assetList` — 资产通道端点：写走 `assets.ts` 的白名单+魔数+配额三闸，读返回单应用资产清点与配额占用。

## 刷新语义（M2 起）

`list` 每次调用现扫（probe-at-open），GUI 开发中菜单展开即重扫；watcher 随会话绑定起止提供目录变更事件（`app-stage/dev-changed`），发现永远走运行时数据路径，全程无 DeepCreator 重建/重启/刷新。手放/删除应用目录 → 菜单计数零刷新跟随（M2 真实 GUI 验证）。


## M6e — 迁移、资产回收与节流

- `migrateDevDataToInstalled(appId, cwd, home, {overwrite})`：dev→installed 整域原子拷（staging 目录 + rename；doc+journal 同拷保 rev 连续）。仅 installed 域为空时执行；`DEV_DATA_EMPTY`/`INSTALLED_DATA_PRESENT` 两码；卸载重装后的覆盖语义须用户显式接受。
- `deleteAsset(home, appId, name)`：单资产删除，basename 围栏（拒绝分隔符与 `..`），`ASSET_NOT_FOUND`/`ASSET_NAME_INVALID`。preset 工具 `app_asset_delete`（第 12 工具，agent-surface D16）。
- `scanOrphanAssets(home, appId, docText, windowMs=30d)`：孤儿资产候选（mtime 超 30 天窗口且 doc 无 url 文本引用）——纯 advisory，绝不自动删除；年龄钳零（APFS 亚毫秒 mtime 与整数毫秒时钟的舍入差不是负年龄）。
- 发布节流 advisory：agent 侧每 app 24h 滑窗计数，第 4 次起审批卡细节追加非阻断提示行。
