# Dayfilm 架构

## 目标

单进程桌面程序的可演进结构：把"采集 → 闸门 → 存储 → 切分 → 呈现"分开，各段可独立测试，UI 不依赖系统调用，主进程不依赖界面。

## 分层

| 层 | 位置 | 职责 | 依赖 |
| --- | --- | --- | --- |
| 采集层 | `src/main/capture` | 拉起采样子进程、切行解析为 `Sample`、按 1s/3s/9s 退避重启、退出时收掉进程树 | Node 子进程、Windows PowerShell |
| 闸门层 | `src/main/ingest`, `src/main/redact` | 采样唯一入口：时钟守卫 → 脱敏 → 进缓存 + 进落盘缓冲 | 无 Electron |
| 存储层 | `src/main/store`, `src/main/store/buffer` | 按日追加 JSONL、按日读取、列出日期；写失败留在内存缓冲并每 5 秒重试 | Node fs |
| 状态文件层 | `src/main/settings`, `src/main/notes`, `src/main/marks`, `src/main/retention` | 四类 JSON 状态（设置 / 手记 / 标记）与保留期清理；写入都是 tmp + rename | Node fs |
| 切分层 | `src/main/reel` | 采样 → 镜头、汇总、题材、检索；`rules` 定口径，`aggregate` 增量聚合，`cache` 按日 LRU | 无 Electron |
| 导出层 | `src/main/edl`, `src/main/pdf`, `src/main/export`, `src/main/save-image` | 剧本 Markdown、CMX3600 EDL、PDF、PNG 的生成与写盘 | Node fs |
| 接口层 | `src/main/index.ts`, `src/main/ipc`, `src/main/security`, `src/preload` | Electron 生命周期、通道登记、来源守卫、向两个窗口推送状态 | Electron |
| 常驻界面 | `src/main/tray`, `src/main/hud`, `src/main/shortcuts`, `src/main/window-chrome` | 三态托盘、置顶 HUD 窗口、全局快捷键、无边框窗口按钮 | Electron |
| 呈现层 | `src/renderer` | 纯 UI 与派生视图：胶片、放映、镜头表、周电影、对比、日历、海报 | 仅 `window.dayfilm` 与四个 bridge |

切分层是纯函数 + 增量状态：`samples + date → DayRollup`。它不读文件、不看时钟，因此可以用固定采样直接断言边界行为。这是整套设计里唯一需要重点测的逻辑；`tests/main/aggregate.test.ts` 用随机序列守着"增量结果 == 全量结果"。

## 数据流

1. `capture.ps1` 每 2 秒输出一行 JSON（只给窗口事实），主进程收到行时打时间戳并截断标题到 512 字。
2. 闸门丢弃倒序采样（时钟回拨），把命中脱敏词的标题写成 `[已隐藏]`，然后同一份采样进两处：当日缓存与落盘缓冲。
3. 落盘缓冲写 `days/<本地日期>.jsonl`；写失败每 5 秒重试，超过 1000 条丢最旧的并计数，退出前 `drain`。
4. 当日缓存用 `DayAggregator` 只处理尾部新增；读取时再叠加标记与自动花絮阈值（`applyMarks`），得到 `DayRollup`。
5. 主进程每 2 秒用当日缓冲重算 `LiveState`，推给主窗口与 HUD（`dayfilm:tick`），同时刷新托盘提示。
6. 界面只渲染收到的状态；检索、导出、标记、设置都通过 `invoke` 回主进程处理。

## 架构图

| 问题 | 图 |
| --- | --- |
| 系统由哪些部分组成，谁连谁 | [系统总览](system-overview/system-overview.html) |
| 一行采样怎么变成当天汇总 | [采样到汇总](sample-pipeline/sample-pipeline.html) |
| 窗口、桥与主进程之间的信任边界 | [窗口与信任边界](window-trust-boundary/window-trust-boundary.html) |
| 常驻程序有哪几种状态 | [常驻程序与采样状态](resident-lifecycle/resident-lifecycle.html) |
| 四类导出怎么走完 | [四类导出的同一条路径](export-paths/export-paths.html) |

## 关键约束

- **窗口隔离**：两个渲染进程（主窗口、HUD）都是 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，只通过 preload 暴露的白名单接口访问能力；站外导航、新窗口和远程请求在启动时就关掉。
- **数据契约单一来源**：`src/shared/types.ts`、`src/shared/ipc.ts`、`src/shared/settings.ts` 是主进程与界面之间唯一的类型来源。
- **通道登记单一来源**：`src/main/ipc` 用 `Record<Channel, Handler>` 登记通道，漏一个编译不过；IPC 守卫对 `invoke` 与 `send` 用同一套来源判断。
- **可测性**：闸门、切分、缓冲、采集监督、导出正文都不引用 Electron，可在 Node 下直接测试；Electron 只在 `src/main/index.ts` 里接线。
- **失败不致命**：采集失败只影响新采样，UI 继续展示已有胶片；写盘失败进缓冲并暴露状态；HUD 页面缺失只告警一次并保持隐藏。

## 后续演进

- 采样改用编译后的原生辅助程序（`csc.exe` 编译的 C# 小程序）以降低开销，接口仍是"逐行 JSON"。
- 四条导出函数（Markdown / EDL / PDF / PNG）有共同的"校验 → 对话框 → 写盘"骨架，可以收成一个导出入口，减少新增格式时的重复。
- 观众态放映目前只有单日一个入口，周电影是独立视图而不是跨天连续回放。

## v1.1 的取舍

- **项目归属放在 `src/shared/projects.ts`。** 主进程（剧本导出）与界面（汇总、镜头标签、海报、周电影）都要判断"这个镜头属于哪个项目"，两份实现必然漂移，所以共享同一组纯函数。
- **海报在界面渲染、主进程只负责存盘。** 程序的视觉资产（剧照、配色、版式）都在渲染层，让主进程重画一遍等于把设计复制两份；界面画好 PNG 交给 `saveImage`，主进程只做校验与写文件。
- **手记是独立数据。** 不塞进日文件（采样是事实，手记是观点），单独放 `notes.json`，损坏时按空集合处理。
- **周视图是派生视图。** 界面按需拉 7 天 `getDay` 并分桶，不新增存储。

## v2 的取舍

- **标记单独存 `marks.json`，键是镜头开始时刻。** 采样是事实、标记是观点，混进日文件会让只追加的格式变成可写格式；用开始时刻而不是镜号，因为镜号会随新数据变动。
- **标记与自动花絮都是读取时叠加。** 它们变了不需要重建增量状态，重算一次 `rollup` 就是新结果；代价是每帧多一次 map，换来"改设置立即全量生效"。
- **无边框窗口由界面自绘按钮。** 标题栏、最小化/最大化/关闭走 `window:*` 三个通道，`close` 与系统关闭同一条路径（收进托盘），最大化状态由主进程主动通知。
- **HUD 是独立窗口而不是浮层。** 它要置顶于全屏应用之上、不抢焦点、不占任务栏，这三点只能由 `BrowserWindow` 提供；位置写回设置，多显示器变化时重新夹回可见范围。
- **放映音效在渲染层用 WebAudio 合成。** 底噪与咔哒都是生成的，仓库里没有音频文件；音量和模式来自设置，电平条读 `AnalyserNode`，关闭时释放 `AudioContext`。
- **周电影只计正片。** 一周的主线、剪辑密度、精选都按 `scene.mark !== 'extra'` 过滤；当天有花絮时活跃时长改用 `featureMs`，并在周评语里说明花絮占比。

## 架构决策

技术栈与存储格式的决策见 [ADR 0001](../agents/adr/0001-electron-typescript-stack.md) 与 [ADR 0002](../agents/adr/0002-jsonl-day-files.md)；采集脚本用 PowerShell 的取舍见 [ADR 0003](../agents/adr/0003-powershell-capture-helper.md)；周电影方向见 [ADR 0004](../agents/adr/0004-week-film-direction.md)。
