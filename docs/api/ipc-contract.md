# 主进程与界面契约

权威来源是 `src/shared/types.ts` 与 `src/shared/ipc.ts`。本文说明其语义与调用约定。

## 通道

| 通道 | 方向 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| `dayfilm:get-day` | invoke | `date?: string` | `DayRollup` | 取指定日期（默认当天）的胶片与汇总 |
| `dayfilm:list-days` | invoke | 无 | `string[]` | 已有数据的日期，倒序 |
| `dayfilm:live` | invoke | 无 | `LiveState` | 当前实时状态快照 |
| `dayfilm:search` | invoke | `query: string` | `Scene[]` | 标题与进程名子串匹配，按时间倒序 |
| `dayfilm:export-screenplay` | invoke | `date: string` | `{ path }` | 导出 Markdown 剧本 |
| `dayfilm:get-settings` | invoke | 无 | `Settings` | 读取用户设置 |
| `dayfilm:set-settings` | invoke | `Partial<Settings>` | `Settings` | 提交部分字段，返回落盘后的完整设置 |
| `dayfilm:get-note` | invoke | `date: string` | `string` | 读取某天的导演手记，没有时为空串 |
| `dayfilm:set-note` | invoke | `date: string, text: string` | `string` | 写入手记，返回落盘后的内容（超 200 字截断） |
| `dayfilm:save-image` | invoke | `defaultName: string, pngBase64: string` | `{ path }` | 保存界面渲染的 PNG（≤ 20 MB），取消返回空路径 |
| `dayfilm:quit` | invoke | 无 | 无 | 停止采集并退出应用 |
| `dayfilm:tick` | send | 无 | `LiveState` | 主进程每 2 秒推送一次 |

`LiveState` 在 MVP 基础上增加 `storageError: string | null`（落盘异常）与 `paused: boolean`（用户暂停采样）。

## 约定

- 日期一律使用本地日期字符串 `YYYY-MM-DD`；时间戳一律使用 Unix 毫秒。
- 渲染进程只能通过 `window.dayfilm` 访问以上能力，不直接使用 Node API。
- 返回对象必须是可结构化克隆的纯数据，不含函数、类实例或循环引用。
- 主进程对入参做类型与范围校验：非法日期返回空汇总，非字符串查询返回空数组，非法导出日期返回 `{ path: '' }`；不抛异常、不崩溃。
- `dayfilm:get-day` 省略日期时取当天；`dayfilm:search` 只检索最近 7 天，跨日期合并后按开始时间倒序截断到 200 条。
- `dayfilm:export-screenplay` 由主进程弹出保存对话框，用户取消返回 `{ path: '' }`。
- `dayfilm:set-settings` 只处理白名单字段：`retentionDays` 取 0/7/30/90/365，`redactTerms` 去空去重、单条不超过 64 字符、最多 100 条，布尔字段按 `Boolean()` 归一；非法值回落到当前值。
- 主进程只接受来自本应用窗口的 IPC 调用，其余来源直接拒绝。
