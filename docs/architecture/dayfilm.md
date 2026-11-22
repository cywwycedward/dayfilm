# Dayfilm 架构

## 目标

单进程桌面程序的可演进结构：把"采集 → 存储 → 切分 → 呈现"四段分开，各段可独立测试，UI 不依赖系统调用，主进程不依赖界面。

## 分层

| 层 | 位置 | 职责 | 依赖 |
| --- | --- | --- | --- |
| 采集层 | `src/main/capture` | 拉起采样子进程，把标准输出解析为 `Sample`；监督子进程存活 | Node 子进程、Windows PowerShell |
| 存储层 | `src/main/store` | 按日追加 JSONL、按日读取、列出已有日期 | Node fs |
| 切分层 | `src/main/reel` | 采样 → 镜头、汇总、题材、检索；纯函数，无 IO | 无 |
| 接口层 | `src/main/index.ts`, `src/preload` | Electron 生命周期、IPC 注册、向渲染进程推送实时状态 | Electron |
| 呈现层 | `src/renderer` | 纯 UI：胶片、实时状态、检索、日期切换、导出入口 | 仅 `window.dayfilm` |

切分层是纯函数：`samples + date → DayRollup`。它不读文件、不看时钟，因此可以用固定采样直接断言边界行为。这是整套设计里唯一需要重点测的逻辑。

## 数据流

1. `capture` 子进程每 2 秒输出一行 JSON。
2. 主进程把行解析为 `Sample`，追加到当日文件（存储层），并推入内存中的当日采样缓冲。
3. 每个采样到达后，主进程用当日缓冲重算 `DayRollup`，把 `LiveState` 推送给渲染进程（IPC `dayfilm:tick`）。
4. 渲染进程只渲染收到的状态；检索与导出通过 `invoke` 回主进程处理。

## 关键约束

- **窗口隔离**：渲染进程 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，只通过 preload 暴露的白名单接口访问能力。
- **数据契约单一来源**：`src/shared/types.ts` 与 `src/shared/ipc.ts` 是主进程与界面之间唯一的类型来源。
- **可测性**：切分层与存储层不引用 Electron，可在 Node 下直接测试。
- **失败不致命**：采集失败只影响新采样，UI 继续展示已有胶片。

## 后续演进

- 采样改用编译后的原生辅助程序（`csc.exe` 编译的 C# 小程序）以降低开销，接口仍是"逐行 JSON"。
- 切分改为增量聚合，避免每次全量重算。
- 历史日期按需加载与缓存，限制内存驻留。

## v1.1 的取舍

- **项目归属放在 `src/shared/projects.ts`。** 主进程（剧本导出）与界面（汇总、镜头标签、海报）都要判断"这个镜头属于哪个项目"，两份实现必然漂移，所以共享同一组纯函数。
- **海报在界面渲染、主进程只负责存盘。** 程序的视觉资产（剧照、配色、版式）都在渲染层，让主进程重画一遍等于把设计复制两份；界面画好 PNG 交给 `saveImage`，主进程只做校验与写文件。
- **手记是独立数据。** 不塞进日文件（采样是事实，手记是观点），单独放 `notes.json`，损坏时按空集合处理。
- **周视图是派生视图。** 界面按需拉 7 天 `getDay` 并分桶，不新增存储。

## 架构决策

技术栈与存储格式的决策见 [ADR 0001](../agents/adr/0001-electron-typescript-stack.md) 与 [ADR 0002](../agents/adr/0002-jsonl-day-files.md)。
