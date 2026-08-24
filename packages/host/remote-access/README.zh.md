# @ryanyujazz/dsh-remote-access

DeepCreator 的可选可信局域网 HTTP Host 插件。它保持官方 Host 只监听 loopback，通过显式移动端 RPC 白名单代理现有 Web UI，并负责 fragment 票据、桌面确认和持久设备配对；Cordis fiber 卸载时会关闭全部监听器和服务器。白名单允许只读的 `commands/list` 目录，使现有 Composer 的 `/` 输入检测和前置 `+` 按钮能够渲染同一个命令菜单，但不开放命令管理接口。插件不会生成或安装证书，设置与配对页面会明确提示传输未加密，不能暴露到公共网络或互联网。

服务默认关闭，只持久化启用/端口设置、稳定 Host id 和哈希后的设备凭据。认证 Cookie 为 host-only、`HttpOnly`、`SameSite=Strict`，按 30 天滚动；Host 也会拒绝 30 天未使用的凭据。Session、Workspace、Agent 与 UI 状态仍由官方 Harness 服务持有。由于使用 HTTP，本模式不提供标准 Service Worker/PWA 安装。

非 loopback HTTP 不属于浏览器安全上下文，因此网关会在代理的官方 HTML 最前方加入最小兼容引导：在原有官方 Client Runtime 加载前，使用 `crypto.getRandomValues()` 补齐 `crypto.randomUUID()`。它绝不回退到 `Math.random`，也不替换任何产品 UI 或 Runtime 状态。
