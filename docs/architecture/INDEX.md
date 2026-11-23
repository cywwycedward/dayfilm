# 架构文档索引

定位系统结构、模块边界和架构图。分析跨模块依赖、设计复杂变更或维护架构图时查阅。

| 文档入口 | 何时查阅 | 职责与应包含的内容 | 职责边界 |
| --- | --- | --- | --- |
| [Dayfilm 架构](dayfilm.md) | 改动模块划分、进程职责、数据流或窗口安全边界时。 | 分层、职责、依赖方向、数据流、关键约束、架构图入口、演进方向。 | 不替代契约与数据格式，分别见 [API](../api/INDEX.md) 与[数据](../data/INDEX.md)。 |

## 架构图

架构图统一用 `archify` Skill 设计，图种按 `architecture-design` 选择：结构、流程、时序、数据或部署各取对应的视图，一张图只说一件事。每张图在 `docs/architecture/` 下独占一个文件夹，文件夹名体现图的对象和视图，例如 `operation-lifecycle` 表示 operation 对象的生命周期图。成品与可编辑源文件同放该文件夹，更新沿用原目录；每张图在下表登记。

每个文件夹里放两样东西：`<图名>.html` 是成品（自带明暗主题与动效，双击即可看），`candidate.json` 是可编辑源。改图时编辑 `candidate.json`，用 `finalize` 重新生成，不手改 HTML：

```powershell
node .agents/skills/archify/bin/archify.mjs finalize <图种> docs/architecture/<图名>/candidate.json docs/architecture/<图名>/<图名>.html --repo-root . --quality showcase --json
```

图里的来源引用钉在 `meta.repository.revision` 指定的提交上；源码变了要重跑 `finalize`，并同步更新该提交号与下表“最近核对”。

## 长期架构图登记

每张长期架构图占一条记录，链接到图及其证据来源。图的状态变化时同步更新条目。

| 图名 | 图种 | 用途与范围 | 视图与状态 | 维护者 | 最近核对 | 依据与查看入口 |
| --- | --- | --- | --- | --- | --- | --- |
| Dayfilm 系统总览 | 结构（architecture） | 采集、闸门、存储、切分、呈现的分层，以及窗口、桥、守卫与数据目录的分工。 | 当前实现，覆盖主窗口与 HUD 两个渲染进程。 | 主 Agent | 2026-11-23 | [成品](system-overview/system-overview.html) · [源](system-overview/candidate.json) |
| 采样到汇总 | 数据（dataflow） | 从 `capture.ps1` 的一行 JSON 到 `DayRollup`，含时钟守卫、脱敏、写缓冲与冷读回填。 | 当前实现；失败重试与停采集收尾在卡片里说明。 | 主 Agent | 2026-11-23 | [成品](sample-pipeline/sample-pipeline.html) · [源](sample-pipeline/candidate.json) |
| 窗口与信任边界 | 结构（architecture） | 两个渲染进程、preload 白名单桥、IPC 来源守卫、网络守卫与远程内容拒绝。 | 当前实现；CSP 与日志约束在卡片里。 | 主 Agent | 2026-11-23 | [成品](window-trust-boundary/window-trust-boundary.html) · [源](window-trust-boundary/candidate.json) |
| 常驻程序与采样状态 | 状态（lifecycle） | 启动、采集中、暂停、系统休眠、采集中断、重试用尽与退出。 | 当前实现；窗口隐藏与托盘不在状态机里。 | 主 Agent | 2026-11-23 | [成品](resident-lifecycle/resident-lifecycle.html) · [源](resident-lifecycle/candidate.json) |
| 四类导出的同一条路径 | 流程（workflow） | 剧本 / EDL / PDF / 海报的校验、保存对话框、生成、写盘，以及取消与失败出口。 | 当前实现；海报的渲染在界面，图中以副标题标出。 | 主 Agent | 2026-11-23 | [成品](export-paths/export-paths.html) · [源](export-paths/candidate.json) |
