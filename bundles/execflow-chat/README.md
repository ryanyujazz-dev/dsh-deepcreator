# @ryanyujazz/dsh-execflow-chat

DeepSeek Harness 对话 UI 的渲染模式插件:在原生对话 tab 内提供**渲染模式环**,不需要整包替换对话体验。

## 功能

- **tab 栏渲染方式菜单**:三点图标(带 Tooltip)选择 原生模式 / 经典模式 / 思考模式,选择持久化
- **经典模式(执行流)**:连续工具调用聚合为单槽位运行(起草 → 运行 → 聚合头,可展开);起草阶段可见行;header 切换动画;方向性折叠折角;图标轴线垂线 + 标题列对齐
- **思考模式**:思考内容内联展开(15 行钳制、渐变遮罩、Show more),运行保持步骤内聚合
- 原生模式 = 官方原版对话流,零改动
- 文件工具标题只显示文件名;未映射工具聚合统一为"执行 N 次工具"

## 用户安装

```sh
dsh plugin --profile web add @ryanyujazz/dsh-execflow-chat
```

重启 `dsh web` 生效。卸载:

```sh
dsh plugin --profile web remove @ryanyujazz/dsh-execflow-chat
```

## 发布流程(维护者)

三个包同版本号发布(见仓库根 `VERSION`):

1. **`@ryanyujazz/dsh-client-ui-conversation`** — fork 包,`pnpm --filter @ryanyujazz/dsh-client-ui-conversation publish`
2. **`@ryanyujazz/dsh-client-ui-tool`** — 同上
3. **本 bundle** — `pnpm --filter @ryanyujazz/dsh-execflow-chat publish`

## 维护(跟随上游)

```sh
git fetch upstream && git merge upstream/master
pnpm run build   # 类型错误 = 契约漂移,当场暴露
# 三包同版本号重发
```

## 兼容性边界

- 槽键与官方一致:模式环 `conversation.chat.render` 由 fork 的 chat 视图声明,其余官方插件照常组合
- 契约扩展仅可选 prop(`ChatNodeOwnerProps.thinkMode`、`ToolCallOwnerProps.execflow`),原生模式零影响
- 持久化仅新增 chat store 字段(`renderMode`),与存量会话兼容
