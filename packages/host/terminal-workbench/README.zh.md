# DeepCreator Terminal Workbench Remote

官方 `ctx.terminals` 服务之上的 Agent-scope Remote 门面与交互式系统 Shell Backend。Backend 接收 Registry 生成的终端 ID 和真实 live Agent，因此所有权、列表、关闭以及 Agent／Host 销毁仍由官方服务负责。DeepCreator 只补齐逐行官方 Backend 没有开放的用户终端能力：原始 ANSI 增量读取、顺序 raw input 和 PTY resize。

终端始终运行在本地 Desktop Host。Windows 使用 `node-pty` ConPTY，依次解析 `pwsh.exe`、Windows PowerShell 和 `cmd.exe`；macOS／Linux 优先使用 Host 用户的登录 Shell，并以 zsh／bash／sh 兜底。Workbench 新终端从普通 Session 的 Workspace 根目录启动。子进程保留正常的 PATH、HOME 和 locale，同时使用官方 subprocess scrub 去除 Harness 变量与疑似凭据环境变量。

`system` Backend 是增量能力。官方 Bash Backend 继续服务既有模型／工具消费者，Workbench 创建用户终端时则把 `system` 放在第一位。终端 Session 仍是进程本地状态，随精确 Agent 或 Host 进程消失；Host 重启不会自动重建。
