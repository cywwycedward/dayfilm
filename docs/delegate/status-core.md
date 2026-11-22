# df-core 状态记录

主进程侧实现完成，三条验收命令通过，并在本机跑通 `npm run dev`：采集子进程启动、采样逐行落到 `%APPDATA%\dayfilm\days\YYYY-MM-DD.jsonl`、关窗后无残留进程。第二轮把崩溃路径的退出时延与进程树清理做了加固（见[第二轮加固](#第二轮加固崩溃路径的退出时延与进程树清理)）。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `resources/capture.ps1` | 常驻采样脚本：`Add-Type` 内联 C#（`GetForegroundWindow` / `GetWindowTextW` / `GetWindowThreadProcessId` / `GetLastInputInfo` / `GetTickCount64`），每 2 秒 `[Console]::Out.WriteLine` 一行 JSON |
| `src/main/capture/index.ts` | 子进程 supervise：spawn（带 `-ParentPid`）、跨块按行切分、行解析、1s/3s/9s 退避重启、`stop()` 走 `taskkill /T /F`；spawn/kill/时钟/定时器可注入 |
| `src/main/store/index.ts` | `DayStore`（按本地日期追加 JSONL、按日读取跳坏行、`listDays` 倒序）+ `localDate()` |
| `src/main/reel/index.ts` | `buildDayRollup` / `searchScenes` / `renderScreenplay`，纯函数，无 IO 无 Electron |
| `tests/main/reel.test.ts` | 24 例：归并、短镜头、中场休息、cuts、题材四档边界、检索、剧本格式 |
| `tests/main/store.test.ts` | 8 例：写入读回、坏行、跨天、只追加、`listDays` 排序、非法日期、本地时区 |
| `tests/main/capture.test.ts` | 15 例：脚本路径解析、跨块半行、行解析、重启退避、`-ParentPid` 参数拼装、`taskkill` 参数与失败回退、`stop()` 走 killTree |

重写：`src/main/index.ts`（单实例、窗口、IPC、2 秒推送、导出、退出清理）。

未改：`src/preload/index.ts` 已与 `docs/api/ipc-contract.md` 一致，无需改动。`src/shared/**`、`package.json`、构建配置、其他文档均未触碰。

## 关键设计取舍

1. **采样时刻由主进程打点。** 脚本只给窗口事实（`ok/title/exe/idleMs`），`Sample.t` 是主进程收到该行的 `Date.now()`；脚本不输出时钟，避免两套时钟。标题在采集层截断到 512 字符（`docs/data/store-format.md`）。
2. **镜头结尾向后延伸一格采样。** 一条采样代表它之后约 2 秒仍在该窗口，所以 `end = min(最后一条 t + 2000, 下一条采样 t ?? now)`。后果：连续 n 条采样成镜时长为 n×2 秒，即"3 秒成镜"实际对应至少 2 条采样。若不延伸，每个镜头会系统性少算 2 秒，`activeMs` 也会偏小。
3. **中场休息不外延。** `end` 恒为区间内最后一次空闲采样时刻，与 brief 的"空闲持续到 now 时不要拉到 now"一致；`idleMs` 因此比真实空闲短最多 2 秒。时长为 0 的中场休息（单条空闲采样）丢弃。
4. **cuts 在过滤后的非空闲镜头序列上算。** 中间隔着中场休息不阻断计数，跨中场休息的同窗口镜头不算切换。
5. **题材边界归属。** `<3` 长镜头、`<8` 标准剪辑、`<=20` 快切、`>20` 跳切风暴（8 与 20 归低一档，与规格 "3–8 / 8–20 / >20" 的写法一致）。测试用"cuts+1 个镜头均匀铺满 1 小时"构造出精确的 0/2/3/7/8/20/21 密度。
6. **R1.3 自身窗口。** 原始采样照常落盘（数据是事实），`buildDayRollup` 的输入剔除自身进程名（`basename(process.execPath, '.exe')`：开发时为 `electron`，打包后为 `dayfilm`），自身窗口因此不计入专注镜头、活跃时长与排行。`LiveState.scene` 仍会显示自身窗口（"正在拍摄：electron · Dayfilm"），因为契约里没有"剪辑中"这一表示，见待裁决第 1 条。
7. **按日惰性缓存。** `sampleCache` 以日期为键，当天数组在首次访问时从文件加载（"当天首次从文件加载"），此后新采样直接 push；检索只取最近 7 天（含当天）。不做淘汰，MVP 下一天约 4 万条采样。
8. **采集监督。** 退出后按 1s/3s/9s 重启，最多 3 次，用尽后保留 `captureError` 不再重试。子进程存活 ≥ 60 秒才把重启计数归零，避免“启动即崩”无限循环。`stop()` 用 `taskkill /PID <pid> /T /F` 整树结束（PowerShell 可能在 `Add-Type` 期间派生 `csc.exe`），`taskkill` 报错或返回非 0 时退回 `child.kill()`。
9. **`capture.ps1` 保持纯 ASCII。** Windows PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI 解析源码，非 ASCII 注释可能吃掉后续引号导致语法错误，所以脚本内注释用英文；输出编码显式设为 UTF-8 供主进程按 utf8 解码。失败时 stdout 仍写合法 JSON，细节走 stderr，由主进程拼进 `captureError`。
10. **落盘同步追加。** 每 2 秒一次 `appendFileSync`，代价可忽略，换来"异常退出最多丢最后 2 秒"；写入失败只 `console.error`，内存中的采样仍可展示（契约里 `LiveState` 没有落盘错误字段）。
11. **IPC 入参校验。** 日期用 `/^\d{4}-\d{2}-\d{2}$/`，非法日期返回 `buildDayRollup([], 今天, now)`；非字符串查询返回 `[]`；导出日期非法返回 `{ path: '' }`（与用户取消同形）。
12. **分钟数统一取整口径。** 镜头行与汇总行都用“四舍五入、正数下限 1 分钟”，否则会出现“活跃 0 分钟”却列着镜头的矛盾（真机数据上踩到过）。
13. **采集进程两条自退出保险。** `-ParentPid` 每轮用 `Get-Process -Id` 判活（PID 复用会误判为存活，属可接受残留风险）；另一条是写 stdout 失败即 `exit 0`（管道断了就说明宿主没了）。两条互补：管道句柄被继承时写不会失败，宿主换成另一进程读管道时父进程判活仍能收尾。

## 验证命令与真实输出

### `npm run typecheck`

```text
> dayfilm@0.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json

（无输出，exit=0）
```

### `npm test`

```text
> dayfilm@0.1.0 test
> vitest run

 ✓ tests/renderer/hash.test.ts (9 tests) 6ms
 ✓ tests/renderer/time.test.ts (12 tests) 5ms
 ✓ tests/renderer/reel.test.ts (9 tests) 7ms
 ✓ tests/renderer/still.test.ts (6 tests) 9ms
 ✓ tests/renderer/mock.test.ts (14 tests) 8ms
 ✓ tests/main/capture.test.ts (15 tests) 11ms
 ✓ tests/main/reel.test.ts (24 tests) 20ms
 ✓ tests/main/store.test.ts (8 tests) 48ms

 Test Files  8 passed (8)
      Tests  97 passed (97)
   Duration  1.30s
```

（renderer 的 50 例属于界面实现者，同一命令一起跑。）

### `npm run build`

```text
out/main/index.js   18.33 kB  ✓ built in 111ms
out/preload/index.js 0.86 kB  ✓ built in 11ms
out/renderer/index.html 4.59 kB / assets/index-D3heVhbd.css 16.82 kB / assets/index-DuEk9Hw-.js 38.16 kB  ✓ built in 99ms
```

### 真机 `npm run dev`（两次，含最终代码）

采集子进程命令行（`ParentProcessId` 为 electron 主进程）：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\core\workspace\mine\github_mine\not-my-app\resources\capture.ps1
```

落盘结果（两次运行累计 27 行，窗口关闭后停止增长）：

```text
day file: C:\Users\Administrator\AppData\Roaming\dayfilm\days\2026-11-22.jsonl  exists=True
{"t":1795344886211,"exe":"electron","title":"Dayfilm","idleMs":212031}
{"t":1795344888223,"exe":"electron","title":"Dayfilm","idleMs":214047}
{"t":1795344908777,"exe":"WindowsTerminal","title":"LZD-20250906UAB: not-my-app","idleMs":0}
```

渲染进程日志（`ELECTRON_ENABLE_LOGGING=1`）只有 `[vite] connecting... / connected`，没有 IPC 或主进程报错。`Port 5173 is in use` 是界面实现者的 dev server，本次 dev 走 5174。

关窗（`CloseMainWindow`）后：

```text
electron procs after close: 0
capture.ps1 left: 0
```

第一次关窗尝试误关了 renderer 进程无效，改关持有窗口的进程后彻底退出——这点提醒主 Agent：只按 PID 假设主进程身份不可靠，要按 `MainWindowTitle` 或子进程父子关系找。

### `resources/capture.ps1` 单独运行（5 秒）

```text
{"ok":true,"title":"Herdr","exe":"herdr-app","idleMs":49953}
{"ok":true,"title":"Herdr","exe":"herdr-app","idleMs":51953}
{"ok":true,"title":"Herdr","exe":"herdr-app","idleMs":53984}
```

行尾是 CRLF（`0d 0a`），主进程按 `\n` 切分并去掉尾部 `\r`。`idleMs` 递增说明 `GetLastInputInfo` + `GetTickCount64` 的组合是对的。

### 剧本导出格式（用真实数据跑的临时探针，探针文件已删）

探针直接对当天 27 条采样调 `buildDayRollup` + `renderScreenplay`（未经 R1.3 的自身进程过滤）：

```text
samples=27 scenes=3 cuts=0 rate=0
# 2026-11-22 · Dayfilm 剧本

题材：长镜头。最长的一个镜头是 WindowsTerminal 的 1 分钟。活跃 1 分钟，中场休息 1 分钟，1 个镜头，0 次剪辑。

- [18:54–18:55] （中场休息 1m）
- [18:55–18:55] WindowsTerminal · LZD-20250906UAB: not-my-app（1m）
- [18:57–18:57] （中场休息 1m）
```

## 第二轮加固：崩溃路径的退出时延与进程树清理

**背景更正。** 先前“强杀 electron 后 `capture.ps1` 会变成永久孤儿（存活 11 分钟）”的观察是测量错误：过滤命令行里含有 `capture.ps1` 字面量，把查询命令自己也当成了采集进程。用拼接过滤串 + 排除自身 PID 复测：启动后只有 1 个采集进程；强杀 electron 主进程后 6 秒内采集进程消失，0 残留，electron 0 残留。也就是说加固前脚本本来就会退出（写 stdout 失败后循环终止），只是要等到下一轮写管道才发生。

这轮加固保留，价值在于退出不再依赖写失败、来得更早，并且退出时能收掉整棵进程树：

1. `resources/capture.ps1` 加 `param([int]$ParentPid = 0)`：每轮采样前用 `Get-Process -Id $ParentPid -ErrorAction SilentlyContinue` 判活，父进程不在就 `exit 0`；缺省 0 时不检查，保持手工调试行为。
2. 把快照失败与写失败分开：快照异常仍写一行 `{"ok":false,...}` 继续跑；`WriteLine`/`Flush` 抛异常就 `exit 0`（管道断了，宿主已经没了）。
3. `src/main/capture/index.ts`：spawn 参数改为 `captureArgs(script, process.pid)`（带 `-ParentPid`）；`stop()` 改走 `killProcessTree`（`taskkill /PID <pid> /T /F`，报错或非 0 退回 `child.kill()`），可用 `killTree` 注入替身。
4. `tests/main/capture.test.ts` 补 4 例：spawn 参数含真实 `process.pid`、`taskkillArgs`、`taskkill` 成功与失败两条分支、`stop()` 把子进程 pid 交给 `killTree`。

真机证据（临时探针，已删）：

```text
# 加固前的行为（主 Agent 复测）：宿主消失后写管道失败，采集进程 6 秒内退出，0 残留
# 加固后：父进程 pid 已不存在时直接退出，且一行都不输出
powershell -File resources\capture.ps1 -ParentPid 999999  →  exited=True, output lines: 0

# node 宿主跑满 6 秒后把自己 SIGKILL 掉，采集子进程必须消失
mode=guarded capturePid=42280 lines=3
  → guarded   : stillAlive=False after=22ms    （-ParentPid 已传）
mode=unguarded capturePid=24620 lines=3
  → unguarded : stillAlive=False after=3ms     （不传 -ParentPid，仅靠写失败退出）

# 默认行为保持常驻
无参数        → exited=False lines=3
-ParentPid 0  → exited=False lines=3
```

修复过程中自己踩了文件头的那个坑：第一次把中文注释写进了 `param()` 里，PS 5.1 按 ANSI 读源码后注释吞掉了紧跟的 `[int]$ParentPid = 0`，参数根本不存在，探针先报 FAIL 才发现。已改为 ASCII 注释，并用字节扫描确认 `capture.ps1` 非 ASCII 字节为 0。这个“纯 ASCII”约束不是我之前的洁癖，改这个文件时必须守住。

## 已知未完成项

1. **R1.3 的"剪辑中"没有契约表示。** 现在自身窗口既不进胶片也不进汇总，实时条仍把自身窗口当"正在拍摄"。要让界面显示"剪辑中"，需要在 `Scene`/`LiveState` 上加字段（例如 `Scene.kind: 'editing'` 或 `LiveState.selfFocused: boolean`），属于 `src/shared/**`，我未改动。
2. **打包路径未验证。** `resolveCaptureScript` 的 `isPackaged` 分支已写并在单测里覆盖字符串结果，但仓库没有 electron-builder 配置，`resources/capture.ps1` 不会自动进 `process.resourcesPath`；打包时需要 `extraResources`。
3. **落盘失败无界面出口。** `LiveState` 只有 `captureError`，磁盘写失败只进主进程 console。
4. **缓存不淘汰。** 检索过的历史日期一直留在内存（每天约 4 万条采样）。MVP 允许，第二里程碑再加 LRU。
5. **未测：中文标题 UTF-8 往返。** 脚本强制 UTF-8、主进程按 utf8 解码，链路一致；但本次 smoke 只采到 ASCII 标题，含引号/反斜杠/中文的标题未在真机复现。
6. **强杀/断电恢复已测强杀，未测断电。** 强杀宿主实测：加固前靠写管道失败在 6 秒内退出，加固后父进程判活先生效（实测 22ms 内消失），两条路径都 0 残留；PID 复用时会漏判（`Get-Process -Id` 看到的是另一个进程），但那种情况下管道一般已断，写失败会兜住。

## 需要主 Agent 处理的事项

1. 裁决 R1.3 "剪辑中" 的契约表示（见未完成项 1）：改 `src/shared/types.ts` 后我这边只需一处过滤调整。
2. 需要同步进 `docs/` 的口径（我无权改文档）：
   - `Sample.t` 由主进程在收到采样行时打点，不是脚本输出；
   - `Scene.end` 的语义：镜头向后延伸一格采样（≈2 秒）、夹紧到下一条采样或 `now`；中场休息不延伸，=`end` 最后一次空闲采样；因此成镜条件实际是"至少 2 条采样"；
   - 题材边界归属：`<3` / `[3,8)` / `[8,20]` / `>20`；
   - `renderScreenplay` 的分钟数四舍五入且正数下限 1 分钟（3 秒镜头写 `1m`，汇总行同理，避免“活跃 0 分钟”却有镜头）；
   - `searchScenes` 会把查询串 trim，空白串返回 `[]`；200 条上限是跨日期合并后截断，截断前先按 `start` 倒序。
3. `%APPDATA%\dayfilm\days\2026-11-22.jsonl` 有我 smoke 测试留下的 27 条采样（内容是 `electron · Dayfilm` 与一次 `WindowsTerminal` 窗口，都是我操作时真实采集的）。其中自身窗口的部分已被 R1.3 过滤，不影响胶片；是否删除由你决定，我没有动这份数据。
