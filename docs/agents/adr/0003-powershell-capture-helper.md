# ADR 0003 采集：常驻 PowerShell 辅助进程

- 状态：已采纳（第二里程碑计划替换为 C# 辅助程序）
- 日期：2026-11-22

## 背景

需要读取 Windows 前台窗口的标题、进程名与空闲时长。可选方案：Node 原生模块（N-API）、PowerShell 常驻脚本、`csc.exe` 编译的 C# 小程序、每轮采样都启动新进程。

## 决策

MVP 使用一个常驻的 PowerShell 子进程，脚本内用 `Add-Type` 内联 C# 调用 `GetForegroundWindow`、`GetWindowTextW`、`GetLastInputInfo`，每 2 秒向标准输出写一行 JSON。

## 证据

本机探针结果：单次快照约 6–10 ms（含进程名解析），`Add-Type` 首轮编译约 1 秒，之后每轮循环开销可忽略。

## 后果

- 无编译链、无原生模块，跨 Node/Electron 升级稳定。
- 代价：额外进程常驻约 50 MB，启动有约 1 秒预热，脚本被杀后需要主进程监督重启。
- 第二里程碑：用 `csc.exe` 预编译同名接口的 C# 小程序，保留"逐行 JSON"输出协议，主进程只替换启动命令。
