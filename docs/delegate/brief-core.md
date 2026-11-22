# 任务说明书：主进程实现（df-core）

## 目标

实现 Dayfilm 的主进程侧：采集、落盘、镜头切分、IPC 与导出，使 `npm run dev` 启动后立刻有真实数据流入界面。

## 权威资料

- 功能规格：`docs/specs/dayfilm-v1.md`（R1、R2、R3、R5、R6、R7、R8、R9）
- 架构：`docs/architecture/dayfilm.md`
- 数据格式：`docs/data/store-format.md`
- 契约：`docs/api/ipc-contract.md`、`src/shared/types.ts`、`src/shared/ipc.ts`

## 可写范围

- `src/main/**`
- `src/preload/**`
- `resources/**`
- `tests/main/**`
- `docs/delegate/status-core.md`（你自己的状态记录）

不要在以下位置写入或改动，需要变更时写进状态记录并停止等待指示：

- `src/shared/**`、`package.json`、`electron.vite.config.ts`、`tsconfig*.json`
- `src/renderer/**`（另一位实现者负责）
- `docs/` 下其他文件

## 必须交付

### 1. `resources/capture.ps1`

常驻循环，每 2 秒向标准输出写一行 JSON（用 `[Console]::Out.WriteLine`，避免缓冲）：

- 正常：`{"ok":true,"title":"...","exe":"Code","idleMs":1200}`
- 异常：`{"ok":false,"error":"..."}`

用 `Add-Type` 内联 C# 调用 `GetForegroundWindow`、`GetWindowTextW`、`GetWindowThreadProcessId`、`GetLastInputInfo` 与 `GetTickCount64`。注意 .NET Framework 没有 `Environment.TickCount64`，用 P/Invoke。`exe` 取 `Process.ProcessName`（不带 `.exe`），解析失败留空。标题里的引号、反斜杠要正确转义。脚本进程被启动时不得要求交互。

参考实现（已在真机验证可用）：`C:/Users/Administrator/AppData/Local/Temp/dayfilm-probe/fg.ps1`。

### 2. `src/main/capture/index.ts`

- 用 `child_process.spawn` 拉起 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>`。
- 脚本路径：开发时取仓库 `resources/capture.ps1`，打包时取 `process.resourcesPath`。用 `app.isPackaged` 判断，路径解析写成可测试的纯函数。
- 逐行读取 stdout（按 `\n` 切分，处理跨块半行），解析为 `Sample`，通过回调交给上层；解析失败只计数，不抛。
- 子进程退出时标记 `capturing=false`、写入 `captureError`，按 1s/3s/9s 退避最多重启 3 次；成功后清除错误。
- 提供 `stop()`，退出时杀掉子进程（Windows 用 `taskkill /pid <pid> /T /F` 或 `child.kill()`，确保不留孤儿）。
- 不做 Electron 依赖，便于测试：把 spawn 与时钟做成可注入的参数（默认用真实实现）。

### 3. `src/main/store/index.ts`

- 目录：`app.getPath('userData')` 下的 `days/`；构造时可注入根目录以便测试。
- `append(sample)`：按 `sample.t` 的本地日期选择文件，追加一行 JSON；目录不存在时先创建。
- `readDay(date)`：读文件、逐行 `JSON.parse`，坏行跳过；字段缺失或类型不符的行也跳过。
- `listDays()`：列出 `days/` 下符合 `YYYY-MM-DD.jsonl` 的文件名，倒序。
- `sample.t` 的本地日期用本地时区计算，不要用 `toISOString()`。

### 4. `src/main/reel/index.ts`（纯函数，无 IO、无 Electron）

```ts
export function buildDayRollup(samples: Sample[], date: string, now: number): DayRollup
export function searchScenes(query: string, days: DayRollup[]): Scene[]
export function renderScreenplay(day: DayRollup): string
```

规则见规格 R3、R6、R7、R9，要点：

- 样本先按 `t` 升序稳定排序；同一 `t` 保留先出现的。
- 空闲判定：`idleMs >= 60000`。
- 归并：同 `exe` 同 `title` 且相邻间隔 <= 90000ms 归入同一镜头。
- 时长 < 3000ms 的镜头丢弃，其时间不并入相邻镜头。
- 空闲连续区间生成 `kind:'intermission'` 镜头；空闲持续到 `now` 时，镜头 `end` 取区间内最后一次采样时刻（不要拉到 `now`，避免"空闲很久"被算成活跃）。
- 镜头 `id` 用 `${date}-${index}` 形式，索引从 1 开始，同输入稳定。
- `activeMs` 为所有非空闲镜头时长之和；`idleMs` 为中场休息镜头时长之和。
- `cuts` 为相邻非空闲镜头（中间的中场休息不计入但也不阻断切换计数）的切换次数：按时间序，连续两个 `kind:'shot'` 且 `exe|title` 不同即 +1。
- `verdict.cutRate` = cuts / max(activeMs/3600000, 极小值)；密度阈值 <3 长镜头、3–8 标准剪辑、8–20 快切、>20 跳切风暴。`label` 用上述四词，`note` 一句中文点评：有最长镜头时提到它（进程名 + 分钟数），否则提示还没形成长镜头。
- `searchScenes`：不区分大小写，匹配 `title` 或 `exe`，空串返回 `[]`，结果按 `start` 倒序，最多 200 条。
- `renderScreenplay`：第一行 `# YYYY-MM-DD · Dayfilm 剧本`，第二段写题材与汇总，然后每个镜头一行：`- [HH:MM–HH:MM] exe · title（Xm）`；中场休息写成 `（中场休息 Xm）`。

### 5. `src/main/index.ts`

- 单实例：`app.requestSingleInstanceLock()`，第二个实例聚焦已有窗口后退出。
- 启动顺序：创建窗口 → 启动采集 → 注册 IPC。
- 内存中保留当日采样数组（当天首次读取时从文件加载），每次新采样追加并重算 `DayRollup`。
- 每 2 秒向窗口推送 `LiveState`（通道 `IPC.tick`）；窗口销毁后停止推送。
- `IPC.getDay`：入参为空取当天；日期用 `/^\d{4}-\d{2}-\d{2}$/` 校验，非法直接返回空汇总（`buildDayRollup([], today, Date.now())`）。
- `IPC.listDays`、`IPC.live`、`IPC.search`：`search` 检索当天与已加载日期；超过 7 天时只加载最近 7 天。
- `IPC.exportScreenplay`：`dialog.showSaveDialog` 默认文件名 `dayfilm-YYYY-MM-DD.md`，用户取消时返回 `{ path: '' }`；写入用 `utf8`。
- 保留现有窗口配置（`contextIsolation`/`sandbox`/`nodeIntegration` 不变），不新开窗口。
- 退出时停止采集，确保不留孤儿进程。

### 6. 测试（`tests/main/**`）

用 vitest，覆盖：

- 归并：同窗口续接、换窗口切一刀、间隔 > 90s 切一刀。
- 短镜头（< 3s）被丢弃。
- 空闲 >= 60s 生成中场休息；空闲 59s 不生成。
- `cuts` 计数（含中间隔一次中场休息的情况）。
- `verdict` 四个阈值边界各一例。
- `searchScenes`：大小写、空串、200 条上限、倒序。
- `store`：临时目录写入→读取一致、坏行跳过、跨天分文件、`listDays` 排序。
- `renderScreenplay`：包含日期行与镜头行格式。

## 验收命令

```powershell
npm run typecheck
npm test
npm run build
```

三条都必须通过。可以顺手用 `npm run dev` 快速确认窗口能开、有数据流入（界面部分由另一位实现者负责，未完成属正常）。

## 交付

1. 代码落在上述可写范围。
2. `docs/delegate/status-core.md` 写明：改了哪些文件、关键设计取舍、验证命令与实际输出、已知未完成项、需要主 Agent 处理的事项（例如需要新增依赖）。
3. 结束时发送一条简短消息给主 Agent（见任务消息中的地址），然后结束本轮。
