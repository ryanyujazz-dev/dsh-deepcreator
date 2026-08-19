# @deepseek-ai/dsh-client-ui-subagent

[English](README.md) | 中文

Web subagent 功能 owner：向会话编辑器链贡献按原因区分的只读替代呈现，并保留注册到 `ctx.inputTriggers` 的既有 `@` 引用 source。

本 fork 过去注册在 `conversation.session.header.actions` 的会话头部子代理目录树已退役：子代理的可见性移入 Workbench 的活动面板（任务行、子代理分区、以及带官方对话区跳转的每子代理标签页），遵守「一个事实一个家」。

one-shot child 始终选用只读编辑器，并将 transcript（文本记录）说明为已完成的执行记录。可继续 child 仅在其确切 parent 不可用且 child 未在运行时选用只读编辑器，并以文案说明恢复路径；此类 child 仍在运行期间，selector 会让位给普通编辑器——其输入区与 Send 操作被禁用，但独立的 Stop 保持可用，停止后只读替代恢复。确切 parent 存活时，可继续 child 保留普通输入 chrome，其会话通过 `subagent.prompt` 路由提示词：child 运行期间输入和 Send 保持可用，因为每条后续消息都会进入 child 的 FIFO inbox，而独立的 Stop 经由 `subagent.interrupt` 路由。本包绝不接收宿主上下文，也不调用面向模型的工具。编辑器行为由 [Web subagent 对话 Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) 与[当前轮次中断 Agent Note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md) 规定。

普通侧边栏会省略带 subagent origin 的会话行，活动面板是它们的导航入口。普通 fork 仍保留在侧边栏中。

`@` source 仍然刻意保持独立且惰性。候选是从 `ctx.sessions.list` 零 RPC 得到的运行中 child；pick 会插入字面文本 `@label `，codec 投影为 `@label`。它不参与命令裁决，也不会把 label 解析成继续执行地址。

## 模型体验

### 用户提示词中的 subagent label 文本

#### 模型看到的内容

只有旧有 `@` 引用 source 会影响模型输入：pick 的候选以字面文本 `@label` 进入普通用户消息，没有专用内容块或宿主侧解析。查看持久化 transcript 不会添加提示词 section；已接收的继续交互内容会经宿主 subagent 适配器成为普通 FIFO 用户消息。

#### Token 影响

有条件且仅追加：字面 `@label` 或用户后续消息只会向对应的新用户消息增加 token。transcript 操作增加零模型 token。

#### KV Cache 影响

仅追加。本包绝不改写更早的请求 token。

## 已知限制与暂缓事项

- **`@` 引用仍是显示标题文本**：重复或改名后的 label 会有歧义，因此它们刻意不获得继续执行语义。
