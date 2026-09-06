# 看板演示 · Agent 指南

最小看板应用：一列卡片，人类经表单新建，Agent 经 `createTask` 驱动。

## 何时用

演示或验收 App Stage 的双通道：人类在应用界面与 Agent 的 `app_invoke` 写同一个 `board.items`，数据经 journal 双向同步。

## 操作工作流

- 建卡：`app_invoke({appId:'kanban-demo', action:'createTask', params:{title:'任务名'}})`——返回 `result.created` 为新建卡片（含 column 与 createdAt）；`column` 可省略，默认 `todo`。
- 回读：`app_data_read({appId:'kanban-demo', path:'board.items'})` 验证效果（超时后先读再决定重试）。
- 呈现：`app_open({appId:'kanban-demo', focus:true})` 把用户带到应用桌面。

## 注意

- `title` 为空字符串会被 handler 拒绝（HANDLER_FAILED）——先想好卡片文案。
- 本应用无二进制资产；若扩展图片卡，走 `app_asset_write` 存 url 引用，不把字节写进 AppData。
