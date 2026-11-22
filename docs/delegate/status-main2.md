# df-main2 状态记录（第二阶段主进程）

第二阶段主进程侧完成：设置、脱敏、保留期、托盘常驻与暂停、自启、休眠与时钟守卫、落盘缓冲与重试、增量聚合 + LRU 缓存、IPC 与网络边界。三条验收命令通过，并在构建产物上做了四次真机验证（常驻、关窗存托盘、强杀清理、暂停启动）。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/settings/index.ts` | `SettingsStore`：字段级回落 + 写回修复、tmp+rename 原子写、`update(patch)` 白名单归一；导出 `normalizeSettings` |
| `src/main/redact/index.ts` | `redactSample`：内置 + 自定义关键词，标题替换为 `[已隐藏]`，进程名保留，512 截断 |
| `src/main/retention/index.ts` | `cleanupExpired(store, days, now)`：按本地日期删旧文件，逐日收集错误 |
| `src/main/tray/index.ts` | `createTray`：菜单（打开 / 暂停-继续 / 退出）、悬停提示、点击打开 |
| `src/main/tray/tooltip.ts` | 托盘纯文本：`trayStatusLabel` / `trayTooltip` / `pauseMenuLabel` |
| `src/main/security/index.ts` | `isTrustedFrameUrl`（IPC 来源校验）、`isLocalRequest`（网络白名单） |
| `src/main/resources.ts` | `resolveResource(name, paths)`：开发取仓库 `resources/`，打包取 `process.resourcesPath` |
| `src/main/errors.ts` | `describeError`：只输出错误码/类型名，不含标题与路径 |
| `src/main/store/buffer.ts` | `WriteBuffer`：上限 1000 条、丢最旧计数、每 5 秒重试、`drain()` |
| `src/main/reel/rules.ts` | 切分规则常量与 `judge` / `formatDurationSpan` / `minutesAtLeastOne`（全量与增量的唯一来源） |
| `src/main/reel/aggregate.ts` | `DayAggregator`：只更新尾部的增量聚合 |
| `src/main/reel/cache.ts` | `DayCache`：按日惰性加载 + LRU（默认 8 天）+ `keep` 过滤 |
| `resources/tray.png` | 32×32 暖白胶片齿孔图标（4× 超采样，透明背景） |
| `tests/main/{settings,redact,retention,buffer,aggregate,cache,security,tray,pipeline}.test.ts` | 见下“测试” |
| `tests/perf/bench.test.ts` | 30 天 × 5 万条压力基准（打印 R16 各指标） |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/index.ts` | 重写：设置/托盘/暂停/自启/休眠/时钟守卫/落盘缓冲/IPC 与网络边界/增量缓存 |
| `src/main/store/index.ts` | 新增 `removeDay`、`sizeOf`、`acceptSampleTime`（时钟守卫谓词） |
| `src/main/reel/index.ts` | 常量与 `judge` 抽到 `rules.ts`；`orderSamples` 增加“已递增”快速路径并导出 |
| `src/main/capture/index.ts` | `resolveCaptureScript` 改为委托 `resolveResource` |
| `src/preload/index.ts` | 补 `getSettings` / `setSettings` / `quit` |

未改：`src/shared/**`、`src/renderer/**`、`package.json`、`electron-builder.yml`（仓库里还不存在）、其它文档。

## 关键设计取舍

### 设置

- 读路径只回落单字段：`retentionDays` 必须命中 {0,7,30,90,365}，`redactTerms` 必须是数组（trim/去空/单条 ≤64/大小写不敏感去重/最多 100），布尔用 `Boolean()`；读到的结果与原文不同就写回，下次启动是干净的。
- 写路径 `tmp + rename`；失败清理 tmp 并抛 `设置保存失败：<code>`，由 IPC 调用方决定展示。
- 读路径的写回失败只 `console.warn`：磁盘只读也不该让应用起不来。
- **踩到一个坑并已修**：Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` 会写 BOM，`JSON.parse` 直接失败，设置被静默重置成默认值（真机上 paused=true 启动后又被改回 false）。现在读取时先剥 `\uFEFF`，并加了单测。

### 脱敏

- 先截断到 512 再匹配：落盘的就是这 512 字符，第 512 之后的关键词不会落盘，因此不需要隐藏（单测把这个口径固定下来）。
- 匹配对象是“标题 + 进程名”，任一命中即隐藏标题；进程名保留，界面才能区分是哪个程序。
- 只在写入前调用一次（`onSample` 里），磁盘、内存、界面三处看到的都是脱敏后的值（R10.4）。历史数据不回溯（R10.5）。

### 保留期

- 清理只做“删文件”，不做改写；分界线是 `localDate(now - days*86400000)`，比较日期字符串本身（严格早于才删）。
- 启动时清一次；`retentionDays` 改动时立刻再清一次（用户改成 7 天就是要求删）。
- 界面日期列表另外按保留期过滤（`keptDays()`），即使清理失败也不会把过期日期给界面（R11.3）。
- 清理失败写进 `storageError`（文案 `清理过期数据失败（EPERM），N 个日文件未能删除`）。**这是契约上的复用**：`LiveState` 只有 `storageError` 一个落盘相关字段，见待裁决。

### 托盘与生命周期

- 关窗 `preventDefault()` + `hide()`；真正退出只有两条路：托盘“退出”和 `dayfilm:quit`。
- `window-all-closed` 注册为空处理器（Electron 默认行为是关完就退，必须显式覆盖）；只有托盘没建起来时才回退到“关完就退”，避免留下看不见的进程。
- 托盘菜单第二项是 checkbox：`label` 随状态在 `暂停采样` / `继续采样` 之间切换，`checked` 表示“当前已暂停”。这是二选一的取舍，见待裁决。
- 悬停提示：`Dayfilm · 采集中/已暂停/出错 · 今日 X 小时 Y 分钟`，出错的优先级高于已暂停。
- 菜单与提示只在文字真正变化时重建（每 2 秒一次 tick，不重建就只是一次字符串比较）。
- 暂停 = 不创建采集子进程（不是“采了但不记”）；`LiveState.paused` 直接读设置，是单一事实来源。
- `--hidden` 启动时窗口以 `show: false` 创建：渲染进程照常加载（界面本身要能取到实时状态），只是不显示。见待裁决。
- 自启按 brief 原样：`app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--hidden'] })`。打包后正确；开发模式下 `process.execPath` 是 electron.exe，所以开发模式不要开自启。

### 休眠与时钟

- `powerMonitor` 的 `suspend` → 停止采集子进程；`resume` → 未暂停就重启。休眠期间没有采样，天然表现为空隙，不补数据（R13.1）。
- 时钟守卫在 `onSample` 最前面：`acceptSampleTime(cache.lastT(date), t)`，新采样不比当日最后一条晚就丢弃、不落盘、不进内存。丢弃只计数并每 50 条打一条不带标题的告警（R13.3）。
- 跨零点由 `localDate(sample.t)` 决定写入哪个日文件；`DayCache` 按日期分条目，前一天已缓存的结果不受影响（R13.2）。

### 存储可靠性

- 所有写入都走 `WriteBuffer`：成功则清空缓冲与错误；失败保留未写入部分，置 `storageError`，每 5 秒重试。缓冲上限 1000 条，超出丢最旧并计数（文案里带丢弃条数）。
- 写入是“先缓冲再冲刷”，所以正常路径就是一次 `appendFileSync`，没有额外延迟。
- 单日文件体积：启动时查一次，之后每 150 条采样（约 5 分钟）查一次，超过 64 MB 就在 `storageError` 里给提示文案（含 MB 数，不含标题）。
- `storageError` 的取值顺序：写入失败 > 清理失败 > 体积提示。三个来源互不覆盖，写入恢复正常后自动回落到后两者。
- 读取容错沿用第一轮：坏行、半行、字段类型不符的行整行跳过，不丢整天。集成测试里补了“尾部半行”用例。

### 性能与容量

- `buildDayRollup` 保留为参考实现；`DayAggregator` 只维护“当前未封存的尾部区间 + 已封存镜头的聚合值”，`rollup(now)` 只推演尾部，代价与镜头数同阶、与采样数无关。
- 一致性靠 200 组随机序列的属性测试保证（乱序、重复时间戳、空闲切换、>90 秒空档、尾部未闭合），另加 120 组分批追加、每次追加后逐步比对。
- `orderSamples` 增加快速路径：日文件只追加，读回来几乎总是严格递增，此时跳过 Set 去重与排序（全量 50000 条从 ~17 ms 降到 ~4.5 ms）。乱序输入仍走原路径。
- `DayCache` 是 LRU：命中后移到末尾，超过 8 天淘汰最久未用；`keep` 过滤（剔除 Dayfilm 自身窗口，R1.3）只影响喂给聚合器的采样，`samples()` 仍返回原始数组给实时镜头用。
- 增量索引遇到时间不递增的追加会整体重建，保证“增量结果 === 全量结果”。

### 安全边界

- IPC：`handleIpc` 统一校验来源——`event.senderFrame` 的 URL 必须等于本应用页面（打包/预览时是 `file://…/out/renderer/index.html`，开发时以 `ELECTRON_RENDERER_URL` 前缀放行），且 sender 必须属于本应用窗口；不可信来源只记录通道名并抛错（不记录参数，参数里可能有标题）。
- 网络：`session.defaultSession.webRequest.onBeforeRequest` 取消一切非本地请求，放行 `file:/data:/blob:/devtools:/chrome-extension:` 与回环地址的 http(s)/ws(s)（开发模式需要 vite 的 HMR websocket）。
- 日志：主进程只输出通道名、错误码、计数，不输出标题原文。

## 测试

`tests/main`（12 个文件，108 例）：

| 文件 | 例数 | 覆盖 |
| --- | --- | --- |
| `settings.test.ts` | 14 | 缺文件/坏文件/单字段坏、BOM、归一（关键词与保留期）、白名单、原子写、写失败 |
| `redact.test.ts` | 8 | 内置词、自定义词、大小写、中文、进程名命中、无命中、512 截断口径 |
| `retention.test.ts` | 5 | 删旧留新、0 不清理、错误收集、本地日期分界 |
| `buffer.test.ts` | 6 | 正常、失败缓冲与恢复、上限丢最旧、5 秒重试、drain、文案不含标题 |
| `aggregate.test.ts` | 5 | 空输入、200 组随机序列与全量深度相等、120 组分批追加、逐步比对、拒绝倒序 |
| `cache.test.ts` | 8 | 惰性加载、LRU 顺序、keep 过滤、追加、倒序重建、lastT、invalidate、跨天 |
| `security.test.ts` | 7 | devserver/file 页面校验、端口与域前缀攻击、非法 URL、本地与远程请求判定 |
| `tray.test.ts` | 6 | 状态优先级、悬停提示（含/不含时长）、菜单文字 |
| `pipeline.test.ts` | 2 | 采集→脱敏→落盘→切分→导出整链（临时目录，不启窗口）、尾部半行 |
| `capture.test.ts` / `reel.test.ts` / `store.test.ts` | 15 / 24 / 8 | 第一轮既有用例，未回退 |

`tests/perf/bench.test.ts`：30 天 × 5 万条，一次跑完约 1.4 s（数据生成 0.9 s）。

## 验证命令与真实输出

### `npx tsc --noEmit -p tsconfig.node.json`

```text
（无输出，exit=0）
```

### `npx vitest run tests/main tests/perf`

```text
=== Dayfilm R16 基准 ===
设备：Intel(R) Core(TM) i5-14400 / 16 核 / 内存 32536.0 MB / node v22.19.0 / win32
数据：30 天 × 50000 条（写入 936 ms，落盘 106.9 MB）
单日读取 50000 条：34.00 ms
全量 buildDayRollup（单日 50000 条）：4.57 ms  → 场景 205 个
增量建索引（单日 50000 条）：6.39 ms
增量追加 1000 条（每步追加 + 取一次汇总）：合计 7.02 ms，均摊 7.0 µs
跨 7 天检索（冷，含读盘与建索引）：345.44 ms，命中 200 条
跨 7 天检索（热，走缓存）：0.33 ms，命中 200 条
堆占用：65.9 MB
=== 结束 ===

 Test Files  13 passed (13)
      Tests  109 passed (109)
   Duration  2.62s
```

### `npm run build`

```text
out/main/index.js       39.97 kB  ✓ built in 291ms
out/preload/index.js     1.16 kB  ✓ built in 18ms
out/renderer/index.html  7.03 kB
out/renderer/assets/index-BMkQ0lL2.css 21.09 kB
out/renderer/assets/index-BHAURsAl.js  51.16 kB
```

### 收尾全量

```text
$ npm run typecheck   → exit=0（node + web 两套都过）
$ npm test            → Test Files 19 passed (19) / Tests 178 passed (178) / 2.80s
```

`npm test` 的 178 例里 108 例是主进程、1 例是性能基准、69 例是界面实现者的。

## 性能数字对照 R16

| 指标 | 目标 | 实测（本机 i5-14400 / 32 GB） | 结论 |
| --- | --- | --- | --- |
| 新增采样到界面更新（单日 5 万条） | ≤ 16 ms | 7.0 µs（追加 + 取一次汇总） | 达标（约 1/2000） |
| 切换历史日期（1 天 5 万条） | ≤ 300 ms | ~41 ms（读盘 34 + 建索引 6.4） | 达标 |
| 跨 7 天检索 | ≤ 500 ms | 345 ms（冷，含 7 天读盘）/ 0.33 ms（热） | 达标 |
| 全量 `buildDayRollup`（单日 5 万条） | —（参考值） | 4.57 ms | — |
| 主进程内存（30 天历史） | ≤ 300 MB | 堆 65.9 MB（LRU 驻留 8 天） | 达标（heapUsed 口径） |
| 冷启动到可交互 / 空闲 CPU / 帧率 | ≤ 2.0 s / ≤ 0.5% / ≥ 50 fps | 未测（需要长时间挂机与界面侧配合） | 见未完成 |

## 真机验证（构建产物，未用 dev）

三次 `npm run start`（`electron-vite preview`，加载 out/ 产物）：

1. **常驻**：窗口起来后 `settings.json` 按默认值创建；采集子进程 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File …\resources\capture.ps1 -ParentPid <主进程 pid>` 正常拉起；当天日文件持续增长。IPC 来源校验用一个临时文件探针验证（临时加在 `handleIpc` 里，验证后已删除）：渲染进程启动时确实调了 `dayfilm:list-days` / `dayfilm:get-day` / `dayfilm:live`，三条都是 `trusted=true`，即本应用页面通过了来源校验。探针文件已清理，代码里没有留下任何探针。
   - 学到的：Windows 上 electron.exe 是 GUI 子程序，**主进程的 `console.*` 不会进父进程的重定向文件**（`ELECTRON_ENABLE_LOGGING=1` 只把 Chromium 侧的日志送到 stderr）。所以“日志里没有告警”不能当作证词，要么用文件探针，要么打包后读日志文件。
   - 启动日志里也没有 `托盘创建失败/托盘图标读取失败` 的依据同样不存在（同上）；托盘图标是否可用以“无异常、进程常驻”为准，真机需手动看托盘区。
2. **关窗进托盘**：`CloseMainWindow` 后 electron 进程仍在（4 个），日文件从 97 行涨到 100 行——采样没停。随后强杀主进程：采集子进程 242 ms 内消失，electron 0 残留、capture 0 残留。
3. **暂停启动**：`settings.json` 写 `paused: true`（无 BOM）后再启动：采集子进程 0 个、当天日文件 106 → 106 行不变、设置保持 `paused:true`；杀掉进程后 0 残留。

## 未完成项 / 未验证

1. **托盘图标目视未确认**：构建产物启动无异常、进程常驻、关窗后仍在采样，但托盘区是否真的显示图标、菜单项是否正确需要人眼在 Windows 托盘区看一眼（主进程日志在 Windows GUI 子程序下不可见，见上一节）。
2. **休眠/恢复**没在真机上验证（需要真的合盖或 `powercfg` 触发的挂起）；代码路径只有 `powerMonitor` 两个事件加单元测试以外的推断。
3. **托盘菜单点击**（打开 / 暂停-继续 / 退出）没有自动化，只验证了“设置里 paused=true 启动时不采集”。建议验收时手动点一遍。
4. **界面侧设置**：`setSettings` / `getSettings` 的通道与归一已实现并有单测，但界面是否已接入由 df-ui 决定；主进程侧行为以 `tests/main/settings.test.ts` 为准。
5. **打包路径**：`resolveResource` 假定 `resources/` 被 electron-builder 复制到 `process.resourcesPath`；仓库里还没有 `electron-builder.yml`（`package.json` 的 `pack`/`dist` 已引用它）。打包时需要把 `capture.ps1` 与 `tray.png` 放进 `extraResources`，否则打包后采集与托盘图标都会缺。
6. **冷启动 ≤2 s / 空闲 CPU ≤0.5% / 帧率 ≥50 fps** 未测：前两项需要长时间挂机采样，帧率属界面侧。
7. **主进程常驻内存**只测了 `heapUsed`（65.9 MB）；R16 写的是“常驻内存”，严格应看 RSS。用 30 天真实历史跑一次 `npm run start` 再读 `WorkingSet64` 更准。
8. **删除即生效**：改小 `retentionDays` 会立刻删除超期文件（我选的），如果产品希望“下次启动才清”，需要改一处调用。

## 需要主 Agent 处理的事项

1. **契约缺口（第一轮遗留）**：R1.3 的“剪辑中”仍没有表示。现状是自身窗口的采样照常落盘，但不进胶片与汇总；要显示“剪辑中”需要给 `Scene`/`LiveState` 加字段。
2. **`storageError` 承载了三种来源**（写入失败 / 清理失败 / 体积提示）。若界面需要区分，需要契约里加字段或加枚举；现在只有一句中文文案。
3. **托盘暂停项的语义**：现为 `checkbox`，`checked` = 已暂停，文字随状态切换。如果验收想要“勾选=正在采样”，改一行。
4. **`--hidden` 的语义**：现在是“窗口存在但不显示”，渲染进程仍会加载（这样托盘打开时是热的）。如果要“完全不创建窗口”，需要改成按需创建窗口，会影响首次打开的时延。
5. **开机自启在开发模式指向 electron.exe**：按 brief 原样实现，只在打包产物下有意义。
6. `%APPDATA%\dayfilm\settings.json` 与 `days\2026-11-22.jsonl` 里留着我真机验证产生的内容（约 100 条采样 + 默认设置）；pause 测试前备份并已还原，`settings.json` 现在是 `paused:false` 的默认值。

---

# 第二轮：独立评审 9 条意见的处理（2026-11-22 20:10）

逐条对应 `docs/delegate/review-delivery.md`（下文编号是评审里的发现编号）。全部改动仍在 `src/main`、`src/preload`、`resources`、`tests/main`、`tests/perf` 内。

## 1) 导出扩展名与日期入参（评审 6）

- `src/main/export/index.ts` 新增 `ensureMarkdownPath`：`.md`/`.MD` 原样返回；`x.txt`→`x.md`、`x.tar.gz`→`x.tar.md`、无扩展名补 `.md`；目录名里的点（`C:\a.b\name`）不当扩展名。
- `exportScreenplay`：写盘前归一扩展名，返回的 `path` 也是归一后的真实路径；非法日期不再 `throw`，返回 `{ path: '' }`（对齐 `docs/api/ipc-contract.md`）。写盘失败仍抛 `剧本保存失败：<code>`。
- `getDay` 的非法日期分支：改为 `buildDayRollup([], 请求的日期, now)`；入参归一抽成 `parseDayRequest`（`src/main/ipc/index.ts`），返回 `{kind:'today'|'requested'|'invalid'}`，单测断言“非法日期保留请求日期”。

## 2) 开机自启路径（评审 4）

- `src/main/autostart/index.ts`：`loginItemSettings(openAtLogin, env, execPath)`，`path = PORTABLE_EXECUTABLE_FILE || execPath`，`args: ['--hidden']`。portable 目标运行时 `process.execPath` 是 `%TEMP%` 解包副本，写进启动项会在清理后失效。
- 单测三支：普通安装用 execPath、portable 用 `PORTABLE_EXECUTABLE_FILE`、变量为空串时回落。

## 3) `--hidden` + 托盘创建失败（评审 5）

- 托盘创建抛异常时：`tray = null` 之外，若本次是 `--hidden` 启动，则置 `forceShowWindow = true` 并立刻 `showWindow()`；`ready-to-show` 也检查这个标记。不会再出现“无窗口无托盘只能任务管理器杀”的进程。
- 这条只能靠代码审查（要复现得故意破坏 `tray.png`），未做破坏性真机实验。

## 4) settings.json 损坏留档（评审 9）

- `SettingsStore.get()` 区分“解析失败/不是对象”（`corrupt`）与“字段被归一”：前者先用 `copyFileSync` 把原文件复制成 `settings.corrupt-<ISO 时间戳>.json`，再写修复后的文件；备份失败只告警，不影响启动。
- 单测：坏 JSON 留下 1 份备份且内容与原文件一字不差、重启不再重复备份；`[]` 也算损坏；仅字段归一（`retentionDays:45`）不产生备份。
- 语义上的改进：自定义脱敏词被重置时，原设置还在磁盘上可人工找回，不再是“一次静默清空”。

## 5) 打包版忽略 devserver 环境变量（评审 10）

- 新增 `devServerUrl()`：`app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL`。`isTrustedSender`（可信来源）与 `createWindow`（加载地址）都只用它，打包版不会因为外部注入环境变量而加载/信任别的页面。

## 6) 网络守卫与导航（评审 11）

- `isLocalRequest(rawUrl, { allowLoopback })`：
  - `file:` 只放行 host 为空的本机路径，`file://server/share/x`（UNC，等于 SMB 访问）与 `file://attacker.example/...` 一律拒绝；
  - 回环 `http(s)/ws(s)` 只在开发模式（存在 devserver）放行，打包后全部取消；
  - `data:/blob:/devtools:/chrome-extension:/chrome:` 放行，其余协议拒绝。
- `installNetworkGuard` 用 `devServerUrl() !== undefined` 作为 `allowLoopback`。
- `createWindow` 加了两道导航兜底：`setWindowOpenHandler(() => ({ action: 'deny' }))`，以及 `will-navigate` 里用 `isTrustedFrameUrl` 判断，除应用自身页面外一律 `preventDefault()`。
- 单测：UNC file: / 远程 file: / 本地 file: / `data:` / `blob:` / 回环四协议在开发与打包两种模式下的放行差异 / 远程与非法 URL。

## 7) 崩溃半行（评审 12）

- `DayStore.append` 前确认目标文件以 `\n` 结尾（每个日文件只在首次写入时读一次末尾字节，之后靠自己的写入维护；`removeDay` 会清掉该缓存），不以换行结尾就先补一个 `\n`。崩溃留下的 `{"t":123,"exe":"Co` 不会再和下一条粘成非法 JSON。
- 单测：预置半行后 `append`，`readDay` 能读回新采样；文件里确实出现 `\n{"t":`；连续追加不会多插空行。

## 8) IPC 测试空档（评审 8 的①②）

- 通道清单单一来源：`src/main/ipc/index.ts` 的 `GUARDED_CHANNELS`（`IPC` 中除 `tick` 外全部）+ `createHandlers(deps)` 返回 `Record<GuardedChannel, Handler>`。`registerIpc` 改为遍历 `GUARDED_CHANNELS` 注册，**新增通道却漏给守卫会先编译失败、再被测试抓到**。
- 新增 `tests/main/ipc.test.ts`：断言 `GUARDED_CHANNELS` 恰好等于 `IPC` 去掉 `tick`、无重复且不含 `tick`；每个通道都有函数实现；每个通道把入参原样转交给实现；`parseDayRequest` 三种入参。
- 采样入口抽成 `src/main/ingest/index.ts` 的 `createIngest`（时钟守卫 → 脱敏 → 缓存 → 落盘缓冲 + 两个回调），主进程 `onSample` 只剩一行调用；`tests/main/pipeline.test.ts` 改为调用**真实的**这段逻辑，不再复制步骤，并断言 `accepted` 序列、时钟丢弃计数、落盘行数与脱敏结果。
- 安全判定可测化：`isTrustedSenderInfo({frameUrl, hasWindow}, origin)` 纯函数（窗口缺失/空 URL/远程页面 → 不可信），`isTrustedSender` 只负责从事件里取这两个事实。

## 9) 性能断言（评审 7）

- `tests/perf/bench.test.ts` 断言收紧到规格量级（`docs/specs/dayfilm-delivery.md` 的 R16，冷检索目标已改为 800 ms）：单日全量 `< 50 ms`、增量追加均摊 `< 1 ms`、跨 7 天冷检索 `< 800 ms`、热检索 `< 5 ms`、`heapUsed < 300 MB`；另加一行 `RSS` 输出与 `< 1 GB` 的兜底断言。

## 本轮验证

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0）

=== 2) npx vitest run tests/main tests/perf ===
=== Dayfilm R16 基准 ===
设备：Intel(R) Core(TM) i5-14400 / 16 核 / 内存 32536.0 MB / node v22.19.0 / win32
数据：30 天 × 50000 条（写入 805 ms，落盘 106.9 MB）
单日读取 50000 条：37.00 ms
全量 buildDayRollup（单日 50000 条）：4.53 ms  → 场景 205 个
增量建索引（单日 50000 条）：6.79 ms
增量追加 1000 条（每步追加 + 取一次汇总）：合计 6.74 ms，均摊 6.7 µs
跨 7 天检索（冷，含读盘与建索引）：368.48 ms，命中 200 条
跨 7 天检索（热，走缓存）：0.58 ms，命中 200 条
堆占用：65.8 MB，RSS：159.5 MB
=== 结束 ===

 Test Files  15 passed (15)
      Tests  130 passed (130)

=== 3) npm run build ===
out/main/index.js       44.20 kB  ✓ built in 284ms
out/preload/index.js     1.16 kB  ✓ built in 11ms
```

收尾全量：`npm run typecheck` exit=0；`npm test` → 22 文件 / 206 例通过（其中 130 例属主进程 + 性能，其余是界面侧用例）。

真机回归（构建产物 + 临时文件探针，探针已删）：重写 IPC 注册后启动一次，渲染进程的 `dayfilm:list-days` / `dayfilm:get-day` / `dayfilm:live` 仍全部 `trusted=true`，窗口正常、采集子进程正常、强杀主进程后 capture 0 残留。顺带观察：强杀 Electron 主进程时，Chromium 的 GPU 辅助进程（`--type=gpu-process`）可能多活几秒，属 Electron/Chromium 自身行为，我们的采集子进程不受影响（早已消失）。

## 本轮新增/修改文件

- 新增：`src/main/export/index.ts`、`src/main/autostart/index.ts`、`src/main/ipc/index.ts`、`src/main/ingest/index.ts`、`tests/main/ipc.test.ts`、`tests/main/export-autostart.test.ts`
- 修改：`src/main/index.ts`（导出/自启/托盘失败/发布版环境变量/导航与网络守卫/IPC 注册/ingest 接入/退出顺序）、`src/main/security/index.ts`（UNC、回环开关、`isTrustedSenderInfo`）、`src/main/settings/index.ts`（损坏留档）、`src/main/store/index.ts`（半行补齐）、`tests/main/{security,pipeline,settings,store}.test.ts`、`tests/perf/bench.test.ts`

## 这轮之后仍未解决（不属本轮范围）

- 评审阻断项 1（跨零点界面停在旧日期）与阻断项 2（缺 `perf-report.md` / `delivery-verification.md`）在界面侧与文档侧，未动。
- 评审发现 3（托盘图标按状态换图）未做：本轮只做了文字提示与菜单状态，换图需要三套图标资源，评审列为“重要”而非阻断。
- 评审发现 13（跨日时钟回拨导致静默停摆）仍按 R13.3 字面实现：丢弃并计数，只在主进程日志里按 50 条节流告警；要反映到界面需要契约加字段。
