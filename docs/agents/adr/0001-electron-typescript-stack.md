# ADR 0001 桌面技术栈：Electron + TypeScript

- 状态：已采纳
- 日期：2026-11-22

## 背景

需要一款 Windows 桌面应用，具备系统前台窗口采集、常驻后台、以及可定制的视觉呈现。本机环境核实结果：Node.js 22.19 与 npm 可用，Rust、.NET SDK、Python 均未安装；`csc.exe`（.NET Framework 4 编译器）存在。

## 决策

使用 Electron + TypeScript + `electron-vite` 构建，渲染层使用原生 DOM、CSS 与 Canvas，不引入 UI 框架。

## 备选方案

| 方案 | 结论 |
| --- | --- |
| Tauri（Rust） | 排除：本机无 Rust 工具链，安装成本高，且与"先跑通"的目标冲突。 |
| .NET WPF | 排除：无 .NET SDK；即便可用，自定义视觉与迭代速度不如 Web 技术栈。 |
| 纯 Web（浏览器） | 排除：无法采集前台窗口，不符合桌面软件定位。 |
| Electron + 原生 UI 框架 | 排除：为一个界面引入框架依赖，超出必要复杂度。 |

## 后果

- 界面迭代快，视觉表现力强，测试可用 Node 直接跑纯逻辑。
- 代价是打包体积约 100 MB 级别，常驻内存高于原生应用；以"安静常驻"为指标在第二里程碑优化。
- 系统能力通过子进程脚本获取（见 [ADR 0003](0003-powershell-capture-helper.md)），避免原生模块编译链。
