# @deepseek-ai/dsh-client-ui-tool

[English](README.md) | 中文

每个 toolview 注册体现在同时在两个分发座位注册——`tool.call.toolview`(对话流)与 `deepcreator.conversation.embed.toolview`(活动面板的内嵌子代理流)——工具树经 `EmbedToolCallTree` 适配器在镜像节点座渲染,内嵌经典模式流因此呈现与对话区一致的工具行。


Client 工具展示插件。`ui-conversation` 通过 `conversation.chat.node` 的匹配 key 分发每个已排序的 `tool-call` Conversation Node；本包渲染其中的 root 及其 Code Dispatch 子调用，并把每个原子调用通过 keyed slot `tool.call.toolview` 分发。没有注册的工具名称使用通用卡片。

业务 UI 包只注册 wire 工具名称和原子视图，不配对会话事件、不重建 transcript（文本记录），也不拥有 root/subcall 拓扑。运行时仍对 call/result 配对、生命周期和递归 `subCalls` 投影拥有最终决定权；conversation view 仍对 ChatFlow 位置拥有最终决定权。

## 渲染约定

`ToolCallTree` 接收一个已经包含递归 `subCalls` 的 root `ToolCallBlock`、selection 状态、会话 `cwd`，以及用于打开文件和检查调用的 Host 回调。它递归遍历标准调用块，让 root 与任意深度的 child 经过同一条原子分发路径，不订阅独立的 parent-to-children map。

每个 root 和 child 包装层都保留 `data-chat-anchor-key="call:<id>"` 与 `data-chat-call-id` DOM 约定，供分页和 selection 使用。

旧 `conversation.details.tool` 注册连同其 `ToolDetails` renderer 已随 `ui-conversation` 退役的 DetailsPanel 一并移除；该 slot 已从契约中删除。工具审查后续必须作为 keyed Workbench Inspector Provider 重做。聊天行 renderer 仍复用 `terminal`、`read`、`diff`、`search` 和 `web` 的纯 card model。

通用行把已知工具名称归类为 search、read、shell、write、edit、code 或 generic 变体。运行中、成功、失败和中断状态只来自冻结的 call/result slice。Write／Edit 结果会保留官方可选的 `oldStart`／`newStart` 元数据；展开卡片使用 ui-primitives 的公共行级／词级 Diff 模型、真实 Shiki 语法 token、单行号 gutter、软换行，并把同一文件的 hunk 合成为一张卡片。Write／Edit 的标题行已经显示本次 applied `+N -N`，因此展开卡都不再显示 DiffBlock 汇总尾行。两者的 42px 文件头保持在代码区上方，代码区最大高度为 420px；Read 正文区使用相同的 420px 高度预算，超出后均在各自内容区内部纵向滚动。没有起始行元数据的历史结果仍可渲染，只是行号留空。只有用户调用 Host 打开文件回调时，文件路径才相对会话 `cwd` 解析；展示代码不读取会话服务。

在执行流渲染模式中，展开后的工具内容从 22px 标题列开始，并共用一条位于 16px leading glyph 的 x=8 中轴上的 1px 引导线。Code Dispatch 分支始终由父 Code 行持有这条引导线，而每个子调用的 leading 图标从父级「Code」标题左边界开始。由于当前锁定版本的官方 `ui-skill` keyed row 尚未消费 owner 的 `execflow` 标记，Tool 树也会在这一稳定边界补齐相同几何。

## 原子工具视图

拥有该视图的业务包将其 wire 工具名称注册进 `tool.call.toolview`：

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

owner 载荷为 `ToolCallOwnerProps`：`callId`、`toolName`、冻结的 `block`、可选 `cwd`，以及普通的 `openFile`、`revealChange`、`inspect` 回调。注册项会收到常规的会话 slot 运行时共享数据，但不会收到 React node、运行时服务或 root/subcall 知识。Read 等普通文件行沿用 owner 定义的 `openFile`；DeepCreator 对话将它路由为 Artifact 标签优先、官方 Host 路径开启器兜底。Write／Edit 等变更行则优先使用 `revealChange` 进入 Review。

本包当前拥有 generic fallback，以及 shell/pwsh、read、write/edit、grep/glob、web、todo、question 和 Code Dispatch 的内置展示。`ui-skill` 展示了业务包自行拥有的 `skill` 注册项。

各类卡片的上限与 fallback 规则仍由对应的 [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md)、[diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md)、[read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md)、[search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md) 和 [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) Agent Note 负责。

## 模型体验

无，因为本包只渲染已经记录的工具调用和结果，不改变模型请求、工具执行或会话事件。

#### KV Cache 影响

无。本包只负责 Client 展示。

## 已知限制与后续工作

- Host 不把 `run_code` 暴露为 Code Mode 程序 binding，因此生产事件只产生一层分发；递归的运行时/UI 约定支持嵌套。
- 第一方工具视图集中在本包，可以通过 keyed slot 独立迁移到各自所属的业务包。
- 工具文案复用 `ui-conversation` locale namespace。
