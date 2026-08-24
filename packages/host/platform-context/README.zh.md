# DeepCreator Platform Context(平台事实快照)

以官方 `ctx.systemPrompt` 注册表上的一个动态运行时快照,注入本机
Windows 平台事实。插件在启动时检测一次 `pwsh.exe`(PowerShell 7)是否
可达——pwsh 工具在缺失时会静默回退到 Windows PowerShell 5.1,而 Harness
没有任何环节向模型披露这一点。

仅存在 PowerShell 5.1 时,快照陈述决定 Windows 脚本写法的事实:

- 无 BOM 的 UTF-8 `.ps1` 会按传统 ANSI 代码页(zh-CN 主机上为 GBK)解析,
  非 ASCII 字面量变成乱码并可能吞掉相邻 ASCII 语法——生成的脚本保持
  纯 ASCII;
- PowerShell 7 独有语法(`` `u{XXXX} `` 转义、`??`/`?:` 运算符、
  `ConvertFrom-Json -AsHashtable`)不存在——改用 `[char]N`;
- 文件读写需要显式编码(`-Encoding UTF8` 或 `[IO.File]` 方法);
- 含空格或非 ASCII 字符的路径保持引号;
- 沙箱内 GUI 子进程(Edge、Chrome、Electron)死于 mojo/platform-channel
  拒绝访问是命名管道 IPC 被沙箱阻断,不是浏览器问题——按策略升级一次
  或改用托管 Browser Provider。

装有 PowerShell 7 时,快照缩减为该事实加最后两条。非 Windows 主机产出
空文本且不注册任何内容:官方注册表会丢弃空上下文贡献,macOS/Linux 的
系统提示与未组合该插件时逐字节一致。贡献顺序为 120,排在官方沙箱
(110)与审批(115)策略之后。

DeepCreator bundle 以 `deepcreator-platform-context` 行组合该插件,禁用
该行即为退出。包测试钉住检测逻辑、5.1/7 两套文案、非 Windows 的空文本
门控,以及恰好一次的有序注册。
