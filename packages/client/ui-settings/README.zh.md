# @ryanyujazz/dsh-client-ui-settings

[English](README.md) | 中文

DeepCreator 的设置扩展契约，叠加在保留的官方 `@deepseek-ai/dsh-client-ui-settings` 底座之上。`ctx.settingsScope`、`ctx.settingsSchema`、共享 describe mirror 及全部官方设置 slot 仍只由官方插件持有。本包仅声明产品专属的 `deepcreator.settings.preferences.item` 列表座位，并为自定义消费方重导出官方设置类型。

把传输与 schema 服务留在官方层就是升级边界：官方新增的设置功能可以继续注入官方模块，无需依赖 DeepCreator 的复刻实现。本包不实现任何运行时服务，也不得禁用或遮蔽 composition 中的官方 `ui-settings` 行。

## 模型体验

无。本包只声明浏览器 UI 扩展座位，不参与模型请求组装。

## 已知限制与暂缓事项

- 只有 DeepCreator 设置外壳声明对应父级时，自定义 Preferences 座位才存在。
- 持久化设置行为（包括 loopback 限制与写入语义）遵循仓库锁定的官方设置包。
