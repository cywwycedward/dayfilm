# 主进程与界面契约

权威来源是 `src/shared/types.ts`、`src/shared/ipc.ts` 与 `src/shared/settings.ts`。本文说明其语义与调用约定。

通道分四类：`invoke`（界面请求主进程，有返回值）、`send`（HUD 单向请求，无返回值）、主进程推送（`webContents.send`）、窗口按钮（无边框窗口的三个 `invoke`）。通道名登记在 `src/shared/ipc.ts` 与 `src/main/ipc`，后者用 `Record<Channel, Handler>` 保证漏一个编译不过。

## invoke 通道

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `dayfilm:get-day` | `date?: string` | `DayRollup` | 取指定日期（默认当天）的胶片与汇总 |
| `dayfilm:list-days` | 无 | `string[]` | 保留期内且有数据的日期，倒序 |
| `dayfilm:live` | 无 | `LiveState` | 当前实时状态快照 |
| `dayfilm:search` | `query: string` | `SearchOutcome`（`{ hits, coverage, retainedFrom }`） | 多词 AND + 时间词；先按目标日期与保留范围求交，再检索，最多 200 条 |
| `dayfilm:previous-episode` | `date: string` | `EpisodeRef \| null` | 该日最长镜头的窗口上一次出现在哪一天（只看更早的保留日期） |
| `dayfilm:export-screenplay` | `date: string` | `ScreenplayExport`（`{ path }`） | 导出 Markdown 剧本，取消返回空路径 |
| `dayfilm:get-settings` | 无 | `Settings` | 读取用户设置 |
| `dayfilm:set-settings` | `Partial<Settings>` | `Settings` | 提交部分字段，返回落盘后的完整设置 |
| `dayfilm:get-note` | `date: string` | `string` | 读取某天的导演手记，没有时为空串 |
| `dayfilm:set-note` | `date: string`, `text: string` | `string` | 写入手记，返回落盘后的内容（超 200 字截断） |
| `dayfilm:save-image` | `defaultName: string`, `pngBase64: string` | `{ path }` | 保存界面渲染的 PNG（≤ 20 MB），取消返回空路径 |
| `dayfilm:export-edl` | `date: string` | `{ path }` | 导出 CMX3600 EDL（24fps），取消返回空路径 |
| `dayfilm:export-pdf` | `date: string` | `{ path }` | 导出剧本 PDF，取消返回空路径 |
| `dayfilm:set-mark` | `date: string`, `startMs: number`, `mark: SceneMark \| null` | `DayRollup` | 标正片 / 花絮 / 清除，返回重算后的当日汇总 |
| `dayfilm:suggest-stories` | 无 | `StorySuggestions` | 从最近 30 天的标题里找故事线候选（纯规则，不发网络请求） |
| `dayfilm:ai-stories` | 无 | `StorySuggestions` | 用户点按钮时让模型补充候选；失败时仍返回确定性候选，`failure` 说明原因 |
| `dayfilm:ai-probe` | 无 | `{ ok, detail }` | 验证模型通道的基址、key 与模型名 |
| `dayfilm:set-hud` | `visible: boolean` | `{ visible: boolean }` | 显示/隐藏导演 HUD，返回切换后的状态 |
| `dayfilm:quit` | 无 | 无 | 停止采集并退出应用 |

## 窗口按钮通道

无边框主窗口的自绘按钮。与业务通道一样过来源守卫；窗口不存在时静默忽略。

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `window:minimize` | 无 | 无 | 最小化主窗口 |
| `window:toggle-maximize` | 无 | `{ maximized: boolean }` | 切换最大化，返回切换后的状态 |
| `window:close` | 无 | 无 | 与点系统关闭同一路径：收进托盘，不退出 |

## send 通道

| 通道 | 方向 | 入参 | 说明 |
| --- | --- | --- | --- |
| `dayfilm:hud-open` | HUD → 主进程 | 无 | 单击 HUD 时打开并聚焦主窗口 |

## 主进程推送

| 通道 | 入参 | 时机 |
| --- | --- | --- |
| `dayfilm:tick` | `LiveState` | 每 2 秒一次；主窗口与 HUD 都靠它刷新 |
| `dayfilm:projection-toggle` | 无 | 全局快捷键 `Ctrl+Alt+P` 触发放映切换 |
| `dayfilm:maximized-changed` | `boolean` | 主窗口最大化 / 还原时 |

`LiveState` 含 `capturing`（子进程存活）、`captureError`、`storageError`（落盘或清理异常）、`paused`（用户暂停）、`now`、`scene`（正在拍摄的镜头，空闲为 `null`）与 `day`（当日汇总）。

## preload 暴露的入口

| 全局对象 | 方法 | 对应能力 |
| --- | --- | --- |
| `window.dayfilm` | `DayfilmApi` 的全部方法 + `onTick` | 上表 15 个 invoke 通道与 `tick` 推送 |
| `window.dayfilmWindow` | `minimize` / `toggleMaximize` / `close` / `onMaximizeChange` | 三个窗口按钮与最大化通知 |
| `window.dayfilmProjection` | `onToggle` | 放映切换通知 |
| `window.dayfilmHud` | `open` | HUD 单击打开主窗口 |

HUD 页面同样拿到完整的 `window.dayfilm`，但它只用 `live` / `onTick` 渲染，写操作都在主窗口里。

## 约定

- 日期一律使用本地日期字符串 `YYYY-MM-DD`；时间戳一律使用 Unix 毫秒。
- 渲染进程只能通过上述四个对象访问能力，不直接使用 Node API。
- 返回对象必须是可结构化克隆的纯数据，不含函数、类实例或循环引用。
- 主进程对入参做类型与范围校验：非法日期返回空汇总或空路径，非字符串查询返回空数组，非法标记抛可读错误；除 `set-mark` 的显式错误外不抛异常、不崩溃。
- `dayfilm:get-day` 省略日期时取当天；非法日期返回空汇总，但 `date` 字段回填请求的那个日期。
- `dayfilm:search` 只检索“时间词点名的日期”与保留范围的交集；没有时间词时取最近 7 天。查询先归一化（全角折半角、去后缀与脏标记），多词时要求全部命中（`title` 或 `exe`），排序先按标题命中词数，再按开始时刻倒序，截断到 200 条。返回值里的 `reason` 与匹配同一趟算出（命中的词与日期），`coverage` 区分 `full` / `partial` / `expired`，`retainedFrom` 是保留范围内最早的一天。
- 模型通道是主进程唯一的网络出口：默认关闭，启动、采样、翻日与渲染路径上没有任何请求；只有 `dayfilm:ai-stories` / `dayfilm:ai-probe` 会访问 `ai.baseUrl`（超时 20 秒，失败只降级为确定性候选）。
- 四种导出都由主进程弹保存对话框，强制扩展名（`.md` / `.edl` / `.pdf` / `.png`），用户取消返回 `{ path: '' }`。
- `dayfilm:set-settings` 只处理白名单字段：`retentionDays` 取 0/7/30/90/365；`redactTerms` trim、去空、去重、单条 ≤64 字符、最多 100 条；`projects` 名称 ≤32 字、最多 20 条、每条关键词 ≤20 个；`autoExtraUnderSec` 取 0/3/10/30；`sound.mode` 取 `projector` / `cuts`，`sound.volume` 夹到 0–1；`hud.visible` 按 `Boolean()` 归一，`hud.x` / `hud.y` 只收有限数；`ai.baseUrl` 必须是 `http(s)` 绝对地址（空串表示未配置），`ai.model` ≤64，`ai.apiKey` ≤256 且去控制字符（空串表示清除；界面里留空提交表示保留旧 key，只有“清除 key”按钮才发空串）。非法值回落到当前值。
- 主进程只接受来自本应用窗口、本应用页面的调用（开发模式的 devserver 地址，或本地 `index.html`）；其余来源直接拒绝，只记通道名。
