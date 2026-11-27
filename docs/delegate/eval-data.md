# 评委 A：记录内容维度

评审对象：每个镜头（scene）落盘的东西够不够。只读代码与文档，未改动任何源文件、未跑构建与测试。

## 1. 总评

现有 4 个字段（`t` / `exe` / `title` / `idleMs`）能回答"谁、哪个文档、多久、有没有在敲"：镜头、剪辑、中场休息、题材、最长镜头、进程排行都能算出来，`title` 已经把内容维度吃得很满。它答不了的是四类：同一窗口里"在写还是在看"（`idleMs` 落了盘，但只被当成 60 秒空闲的开关，见 `src/main/reel/index.ts` 的 `groupRuns`）、窗口的形态（全屏 / 半屏 / 浮窗 / 第几块屏）、有没有声音，以及"2 秒之内发生了什么"。最伤的是粒度那一类：采样每 2 秒一次，2 秒内的任何切换都不存在，`cuts` 系统性偏低，而"跳切风暴"正是产品唯一的当日结论（`src/main/reel/rules.ts` 的 `judge`）所依赖的数字。判断：**偏薄**，但缺口不在"更多内容"，而在"把已有字段用尽 + 加一到两个零语义枚举"——现有数据里至少还有三样东西没被解析：`idleMs` 的差分（有输入 / 只看）、`exe` 相同而 `title` 变化的切换（应用内换文档现在和"换应用"一起算进同一个 `cuts`）、`t` 的差分（采样缺口与休眠）。

## 2. 候选记录项

字段一律可选、只增不删。`docs/data/store-format.md` 的「变更」一节已经定下"字段只增不删，读取方对未知字段忽略，对缺失的可选字段使用默认值"，`src/main/store/index.ts` 的 `isSample` 也不拒绝多余字段，`readDay` 直接把 `JSON.parse` 的结果放进 `samples`——所以**不需要版本迁移**，老文件照读，新文件被老代码读也无害。

落盘成本按 8 小时采样（2 秒一条 = 14,400 条）估算，当前每条约 90 字节（约 1.3 MB/天，30 天约 39 MB）。

### 2.1 `win`：窗口矩形 + 所在显示器矩形

- **记什么**：`win?: string`，格式 `"宽x高+X+Y"`，示例 `"2560x1400+0+0@2560x1440+0+0"`（`@` 后是窗口所属显示器的 `rcMonitor`）。一块屏也存，读取侧才判得出全屏。
- **增量价值**：能回答"这一天有多少时间是全屏一口气写、多少时间是半屏对照、窄窗待命、或在第二块屏上放着"。落在 hero 的题材点评（现在只有剪辑率一个维度）、右栏「今日统计」多一行"全屏 X 小时"、周电影每幕的一句。
- **Windows 可行性**：`GetWindowRect`（user32）+ `MonitorFromWindow` + `GetMonitorInfoW`（`MONITORINFO.rcMonitor`）。不需要提权，Win10/11 一致。两个必须处理的坑：(a) DPI —— PowerShell 宿主默认 DPI-unaware，`GetWindowRect` 返回按缩放折算的虚拟坐标，而 `rcMonitor` 是物理像素，混用会让"全屏"判断在 150%/200% 缩放下恒为假，必须先 `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`（Win10 1703+；1607 用 `SetProcessDpiAwareness(2)`）；(b) `GetWindowRect` 含不可见边框，精确可见边界用 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`。失败（返回 `false`、rect 全 0、或窗口属于更高完整性级别进程）→ **省略字段**，不写 0。
- **隐私等级**：A（只有几何整数）。
- **采样成本**：约 0.01–0.05 ms/次（比现在的 `Process.GetProcessById` 便宜）。落盘 +22～45 B/条 → +0.3～0.6 MB/天，30 天 +10～20 MB。
- **最小实现**：`resources/capture.ps1`（C# `Snapshot()` 加 P/Invoke 与 JSON 拼接）、`src/main/capture/index.ts` 的 `parseCaptureLine`（当前是字段白名单，不明写透传就会丢）、`src/shared/types.ts` 的 `Sample`、`docs/data/store-format.md` 日文件表。只落盘 = S；要显示到界面得让 `Scene` 带上形态（`src/main/reel/index.ts` 的 `groupRuns`、`src/main/reel/aggregate.ts` 的 `append`、`src/main/index.ts` 的 `liveScene`）= M。纯增量，不删任何字段。
- **失败模式**：**不要参与"是否同一镜头"**。拖动/缩放窗口会在 2 秒内改变 rect，一旦参与切分，一天会被切成几十个"同一窗口的不同位置"镜头，`cuts` 翻几倍、题材跳到"跳切风暴"，`Scene.id` 重排还会让 `marks.json`（按镜头开始时刻为键）上的正片/花絮标记全部错位。
- **工作量**：S（只落盘）/ M（带到镜头与界面）。

### 2.2 采样粒度：前台窗口变化即补采（不加字段）

- **记什么**：不加字段。改采集节奏：`resources/capture.ps1` 的循环里每 100–250 ms 比一次 `GetForegroundWindow()` 句柄，变了就立刻输出一行，其余仍按 2 秒。
- **增量价值**：把 `cuts` 从"2 秒采样点上的变化次数"改成接近真实的切换次数。直接改 hero 的题材与点评、脊柱上胶片碎片的数量、放映时的剪辑音效节奏。
- **Windows 可行性**：`GetForegroundWindow()`（已在用，约 0.005 ms）。不需要提权，Win10/11 一致。失败按现有路径处理（`no foreground window`）。
- **隐私等级**：A。
- **采样成本**：100 ms 轮询 → 8 小时 288,000 次 × 0.005 ms ≈ 1.4 秒 CPU/天（常驻 CPU < 0.01%）；落盘只增"变化行"，每小时 50 次切换的话 +400 行 ≈ +40 KB/天。
- **最小实现**：只改 `resources/capture.ps1` 主循环（`Start-Sleep -Milliseconds 2000` 拆成 20 段 100 ms + 句柄比较）。不动 TS 侧、不动格式、不动类型。
- **失败模式**：口径变化比切分风险更大。①`docs/specs/dayfilm-v1.md` R3.5 明写"镜头 `end` 向后延伸一格采样（约 2 秒）"，而 `SAMPLE_MS = 2000` 就是这条，采样变密后"一格"不再是 2 秒，`sceneEnd`/`sealView` 的语义要重写。②一次 500 ms 的 alt-tab 现在会生成 5 条同窗采样、被 `MIN_SHOT_MS = 3000` 丢掉，于是**不产生 `cuts`，却把原来的长镜头断成两段**——脊柱上碎片变多而题材不变，看起来像跳切、数据上不算跳切。③新旧数据的 `cuts` 不可比，跨周对比与"与上周相比"的周评语会误报。
- **工作量**：M（改脚本 + 实测 CPU / 磁盘 / 真实切换频次）。

### 2.3 `away`：无前台窗口 / 锁屏的合法采样

- **记什么**：`away?: 1`（示例 `{"t":1763779200000,"exe":"","title":"","idleMs":480000,"away":1}`）。
- **增量价值**：现在 `GetForegroundWindow()` 返回 `NULL` 时脚本输出 `{"ok":false,"error":"no foreground window"}`，`parseCaptureLine` 把它算成"第 N 条采样无效"，`LiveState.captureError` 被填上，于是 `src/renderer/src/lib/hud.ts` 的 `hudMood()` 返回 `'error'`、`src/main/tray/tooltip.ts` 的 `trayMood()` 也返回 `'error'`——**锁屏去吃午饭，HUD 和托盘在报错**。修掉之后，锁屏那段在胶片上是"看得见的中场休息"，不是错误也不是空洞。
- **Windows 可行性**：零新 API —— `resources/capture.ps1` 已经有 `handle == IntPtr.Zero` 分支。不需要提权，Win10/11 一致（锁屏时输入桌面是安全桌面，`GetForegroundWindow` 返回 `NULL`，需一次实测确认）。更精确的锁屏判定要 `WTSRegisterSessionNotification` + `WM_WTSSESSION_CHANGE`，需要窗口消息泵，不值得为此上。
- **隐私等级**：A。
- **采样成本**：≈0。落盘 +9 B × 锁屏期间的条数。
- **最小实现**：`resources/capture.ps1` 零句柄分支改成输出合法采样；`src/main/capture/index.ts` 的 `parseCaptureLine` 放行空 `exe`/`title`（类型校验已允许空串）；`src/shared/types.ts`；`docs/data/store-format.md`。S。
- **失败模式**：**这条最危险**。若 `away` 采样被当成 `shot`，锁屏 8 小时会变成"最长镜头"，`longestShot`、`topApps`、海报三项数字、周电影主线全部失真。必须让它在 `groupRuns`/`append` 里走 `kind === 'intermission'` 分支（锁屏时 `idleMs` 本就 >60 s，可直接复用 `sample.idleMs >= IDLE_MS`）。另外它把"无采样空隙"变成"有中场休息"，`DayRollup.idleMs`、剧本的"中场休息 X 分钟"与海报口径都会变。
- **工作量**：S。

### 2.4 `flips`：本采样区间内的前台切换次数

- **记什么**：`flips?: number`（0–255），示例 `{"t":...,"flips":3}`。
- **增量价值**：和 2.2 同一个问题（`cuts` 低估），但不动采样节奏。右栏「今日统计」可以多一行"最碎的一分钟切了 14 次"，hero 的"跳切风暴"才有依据；这是唯一不改变历史数据结构就能拿到"2 秒内切换频次"的办法。
- **Windows 可行性**：`SetWinEventHook(EVENT_SYSTEM_FOREGROUND, ..., WINEVENT_OUTOFCONTEXT)`。**必须自建消息泵**（`GetMessage`/`DispatchMessage`，或 `SetTimer` + `PeekMessage`）——现在的脚本是 `while(true){ Snapshot(); Start-Sleep }`，没有消息循环，钩子收不到回调。不需要提权，Win10/11 一致。失败 → 省略字段。
- **隐私等级**：A。
- **采样成本**：回调本身 <0.01 ms。落盘 +11 B/条 → +158 KB/天。
- **最小实现**：`resources/capture.ps1`（C# 里加钩子，主循环改成消息驱动，改动全在脚本内）、`parseCaptureLine`、`Sample`、`docs/data/store-format.md`。
- **失败模式**：不参与切分。但一旦有人让它参与，等于用 `flips` 改写 `cuts` 定义——`judge()` 的 3/8/20 三档边界与 `tests/main/reel.test.ts` 的 `dayWithCuts(21)` 类用例全部失效。
- **工作量**：L（PowerShell 里写消息泵 + 实测 CPU）。

### 2.5 `audio`：默认输出设备上是否有声音

- **记什么**：`audio?: 0 | 1`，示例 `{"audio":1}`。不记进程名、不记音量、不记曲名。
- **增量价值**："下午三点在开会"和"下午三点在写代码"现在完全同形。有了这一位，右栏「今日统计」能多一行"有声音 X 小时"，周电影"与上周对比"才敢说"这周有半场是会议"。
- **Windows 可行性**：WASAPI。`IMMDeviceEnumerator.GetDefaultAudioEndpoint` → `IAudioMeterInformation.GetPeakValue`（简单），或 `IAudioSessionManager2.GetSessionEnumerator` 遍历会话看 `IAudioSessionControl2::GetState == AudioSessionStateActive`（更贴"有人在播"）。需要 COM interop（PowerShell 里 `Add-Type` 写接口定义）。不需要提权，Win10/11 一致。失败/异常 → 省略字段，不打断循环。
- **隐私等级**：B（"有声音"不含内容，但"会议/音乐"是可推断语义）。降级：只存 0/1；设备切换或独占模式下拿不到就省略；把这一项的采集做成可在设置里关掉的开关。
- **采样成本**：首次初始化 50–200 ms（COM 建对象），之后 0.1–1 ms/次。**必须缓存 COM 对象**，每次新建会到 10–50 ms，直接违反"常驻开销可忽略"。落盘 +10 B/条 → +144 KB/天。
- **最小实现**：`resources/capture.ps1`（大头，约 100 行接口定义）+ `parseCaptureLine` + `Sample` + `docs/data/store-format.md`。
- **失败模式**：不参与切分。真正的风险在异常路径：设备切换、独占模式、蓝牙耳机掉线时 `GetPeakValue` 可能抛错，必须吞掉并省略字段，否则一次设备切换就会产出一条"无效采样"，进而污染 `captureError` 与 HUD 状态。
- **工作量**：M。

### 2.6 `kbd`：前台窗口的键盘布局语言

- **记什么**：`kbd?: string`，`GetKeyboardLayout` 返回 HKL 的低 16 位，4 位十六进制，示例 `"0804"`（中文简体）、`"0409"`（英语美国）。
- **增量价值**：对写作者那一半用户，"这一天像什么"的一大区别是"在写中文"还是"在写代码"，现在只能从标题猜。hero 点评可以多一句"下午三小时后切到中文输入环境"，海报可以多一项。
- **Windows 可行性**：`GetKeyboardLayout(GetWindowThreadProcessId(hwnd, &pid))` → `LOWORD(hkl)`。不需要提权，跨进程安全（按线程查，不注入），Win10/11 一致。失败 → 省略字段。**局限**：布局 ≠ 输入模式，中文输入法里的"英文模式"仍是 `0804`；要区分得 `GetGUIThreadInfo` 取 `hwndFocus` 再 `ImmGetConversionStatus` 看 `IME_CMODE_NATIVE`，跨进程行为不确定，需要实验。
- **隐私等级**：A/B 边界（不含内容，但泄漏语言偏好）。按 B 级对待：只存语言 ID，不存输入法名。
- **采样成本**：约 0.01 ms。落盘 +14 B/条 → +202 KB/天。
- **最小实现**：`resources/capture.ps1` 一行 P/Invoke + JSON、`parseCaptureLine`、`Sample`、`docs/data/store-format.md`。S。
- **失败模式**：不参与切分。它跟线程/窗口走，同一窗口内切输入法时 `kbd` 可能不变，所以只能按镜头取"出现最多的那个"，不能指望它按采样变化切镜。
- **工作量**：S。

### 2.7 `cls`：前台窗口类名

- **记什么**：`cls?: string`，`GetClassNameW` 结果截断 32 字，示例 `"Chrome_WidgetWin_1"`、`"#32770"`（系统对话框）。
- **增量价值**：区分"停在应用主窗"和"停在一个对话框 / 加载态 / 独立浮层"。右栏「最近镜头」能标出"这是对话框"；更重要的是能把 `#32770` 这类系统弹窗从"最长镜头"里排除——现在一个卡住的对话框会被算成专注。
- **Windows 可行性**：`GetClassNameW(hwnd, buf, 256)`。不需要提权，Win10/11 一致。失败 → 省略字段。
- **隐私等级**：A。
- **采样成本**：约 0.01 ms。落盘 +31 B/条 → +446 KB/天。
- **最小实现**：`resources/capture.ps1`、`parseCaptureLine`、`Sample`、`docs/data/store-format.md`。S。
- **失败模式**：不参与切分。若有人用它切分（"对话框和主窗是两个镜头"），直接与 `docs/specs/dayfilm-v1.md` R3.1 的"同进程同标题"冲突，并让 `cuts` 暴涨。
- **工作量**：S。

### 2.8 `pow`：供电与节电状态

- **记什么**：`pow?: string`，示例 `"AC,82"` / `"BAT,9,saver"`（`ACLineStatus` + `BatteryLifePercent` + 是否节电）。
- **增量价值**：解释"下午两点之后镜头突然稀"——是离电、进节电，还是真的离开。周电影的"与上周对比"少一句错判，右栏「今日统计」可以注明"其中 2 小时在电池上"。
- **Windows 可行性**：`GetSystemPowerStatus`（kernel32）→ `SYSTEM_POWER_STATUS`。不需要提权，Win10/11 一致。失败 → 省略字段。
- **隐私等级**：A。
- **采样成本**：约 0.01 ms。落盘 +13 B/条 → +187 KB/天。
- **最小实现**：`resources/capture.ps1`、`parseCaptureLine`、`Sample`、`docs/data/store-format.md`。S。台式机恒为 `AC,255`，字段退化为常量，读取侧直接忽略即可。
- **失败模式**：不参与切分。
- **工作量**：S。

### 2.9 `prod`：进程的产品名

- **记什么**：`prod?: string`，`FileVersionInfo.FileDescription`（拿不到则退回可执行文件名，不含路径），截断 40 字，示例 `"Visual Studio Code"`。
- **增量价值**：`exe` 只有 `Code` / `msedge` / `WindowsTerminal` 这种内部名。有了产品名，右栏「今日统计」的进程排行、海报的三项数字才读得懂；也能区分同名的不同安装（正式版与 Insiders 表现为两个产品名）。
- **Windows 可行性**：`Process.MainModule.FileName` + `FileVersionInfo.GetVersionInfo(path).FileDescription`。**对提升权限的进程或其它会话的进程会抛 `Win32Exception`（访问被拒）**，必须吞掉并省略字段。不需要提权，Win10/11 一致（PowerShell 5.1 自带 `System.Diagnostics.FileVersionInfo`）。成本 1–5 ms/次，**必须按 pid 缓存**，否则每次采样 2 ms 会明显侵蚀"常驻开销可忽略"。
- **隐私等级**：B（`FileName` 会带 `C:\Users\<用户名>`）。降级：只存 `FileDescription`，拿不到就存基名，**绝不存完整路径**。
- **采样成本**：命中缓存 ≈0.01 ms，未命中 1–5 ms。落盘 +30 B/条 → +432 KB/天。
- **最小实现**：`resources/capture.ps1`（含 pid→产品名缓存）、`parseCaptureLine`、`Sample`、`docs/data/store-format.md`。S。
- **失败模式**：不参与切分。无版本资源的绿色程序会给空串，读取侧必须回落到 `exe`。
- **工作量**：S。

### 2.10 `tt`：标题被截断的标记

- **记什么**：`tt?: 1`（原始标题超过 512 字符，`title` 已被截断）。
- **增量价值**：接近 0，只消掉一个不确定性：现在 512 字截断是静默的（`src/main/capture/index.ts` 的 `MAX_TITLE`），读取方无法区分"标题就这么长"和"被砍了"，检索与故事线候选都会因此漏召回。列在最后是因为它 7 个字节就能修。
- **Windows 可行性**：`GetWindowTextW` 用 1024 缓冲；返回长度达到缓冲上限即视为更长（该 API 不告诉你真实长度）。不需要提权。
- **隐私等级**：A。
- **采样成本**：≈0；落盘 +7 B/次，只有真被截断的才写。
- **最小实现**：`resources/capture.ps1` 里 `length > title.Length` 的判断已经在算，多输出一位；`parseCaptureLine` 透传。
- **失败模式**：不参与切分。
- **工作量**：S。

**若全部采纳**：每条 +10～45 B，合计约 +158 B/条 → 日文件从 1.3 MB 涨到 3.6 MB/天，30 天约 108 MB（保留期拉到 365 天约 1.3 GB）。仍在 `docs/specs/dayfilm-delivery.md` R14.3 的 64 MB/日 提示线之内，冷启动只读当日文件，R16 的启动与切日指标不受影响；但"常驻内存 ≤300 MB"（R16）与 `docs/operations/perf-report.md` 的基准需要重测一次。

## 3. 推荐先做的 2 条

**第一条：2.3 `away`（无前台窗口的合法采样）。** 它修的是一个现存可见故障，不是加功能：锁屏时脚本报 `ok:false`，主进程记成"第 N 条采样无效"，`hudMood()` 与 `trayMood()` 双双变 `'error'`——用户只是锁屏离开，HUD 在报错。零新 API、A 级、S 工作量，且它把一段"不存在的时间"变成"看得见的中场休息"，对"这一天像什么"是净增而不是改写。

**第二条：2.1 `win`（窗口矩形 + 显示器）。** 它是唯一真正新增语义的 A 级字段：现有 4 个字段里没有任何一个能推出"全屏 / 半屏 / 浮窗 / 第几块屏"，而这一整类问题都指向"这一天像什么"的质地。代价 S（只落盘），失败时省略字段即可，不必参与切分。

**为什么不把 2.2 / 2.4（采样粒度）放进前二**：它们改的是口径，会让新旧数据的 `cuts` 与题材档位不可比，还会撞上 `docs/specs/dayfilm-v1.md` R3.5 的"延伸一格采样（约 2 秒）"。先做一次探针再决定：100 ms 轮询 `GetForegroundWindow` 的实测 CPU、一天真实的切换次数分布、以及 `SetWinEventHook` 在 PowerShell 里加消息泵是否可维护。探针结果出来再选"补采"还是"`flips`"。

**另外一条不用加字段的**：`cuts` 现在把"换应用"和"同应用换文档"算成同一个数（`src/main/reel/index.ts` 的 `cuts` 判定是 `prev.exe !== curr.exe || prev.title !== curr.title`）。一个在三个文件间来回改的下午会被判成"跳切风暴"。拆成"跨应用剪辑"和"应用内剪辑"两个计数只需改一行判定与一处文案，零落盘、零新 API，这是第一笔确定收益。

**只能加一个字段时选 `win`。** `tt` / `prod` 的收益能被回落覆盖，`away` 修的是缺陷而非增加维度，`audio` 的成本与隐私等级都更差；只有 `win` 提供的信息在任何现有字段里都不存在，且一次给出全屏、多屏、画幅三类事实。

## 4. 明确不建议做

- 按键与输入内容（`WH_KEYBOARD_LL` 低级钩子）：`PRODUCT.md` 的不可让步项写了"不记键盘"，一开就没有回头路。
- 按键计数（哪怕只计数、不含内容）：与"不记键盘内容"只差一个判断，被质疑时无法解释。
- 剪贴板读写：内容级隐私，没有低成本脱敏。
- 鼠标轨迹与坐标：与"这一天像什么"无关，数据量按分钟爆炸。
- 屏幕像素 / 截屏 / OCR：`PRODUCT.md` 与 R10 明令禁止，且不在本维度范围。
- 浏览器地址栏 / URL（`Windows.UI.Xaml.Automation` 读地址栏控件）：C 级、每次 10–100 ms、对 Chromium 与 UWP 的可访问性树版本敏感，失败率高。
- 进程 CPU / 内存（`Process.TotalProcessorTime` / `WorkingSet64`）：只说明"在算"，不说明"在干什么"，还要两次采样做差。
- `EnumWindows` 全窗口枚举：每 2 秒枚举几十个窗口的开销（毫秒级）与"常驻开销可忽略"冲突，产品也只需要前台窗口。
- `pid` / `hwnd` 落盘：能区分同名同标题的两个窗口，但 pid 会复用、hwnd 会重建，跨天关联必然误判，收益抵不过误导。
- 应用专用接口（Teams 会议状态、音乐曲名、录制状态）：把产品绑在第三方私有实现上，且会议名与曲名是 C 级内容。
- 全局更密的固定采样（例如全程 500 ms）：磁盘与解析成本 ×4，精度还不如"变化时补采"。

## 5. 镜头切分风险清单

只要新字段（或新的切分依据）进入"是否同一镜头"的判断，下面这些会一起变。当前的判定串口是 `exe + title` 相等且间隔 ≤ `GAP_MS`（90 秒），**同一个判断在三个地方各有一份**，改一处必然不一致：

- `src/main/reel/index.ts` 的 `groupRuns()`（`sameWindow`）
- `src/main/reel/aggregate.ts` 的 `append()`（`sameWindow`，增量版副本）
- `src/main/index.ts` 的 `liveScene()`（HUD 的"正在拍什么"用的第三份副本）

连带的硬后果，按严重程度排：

1. **用户标记错位。** `marks.json` 以"镜头开始时刻（毫秒字符串）"为键（`docs/data/store-format.md`「标记文件」，`applyMarks()` 用 `String(scene.start)` 取值）。切分口径一变，开始时刻全部漂移，已有的正片/花絮标记会挂到错误的镜头上，且没有迁移办法。
2. **`Scene.id` 重排。** id 是 `${date}-${序号}`，多切一刀后面全体 +1；任何按镜号存的东西（目前只有导出与台词"镜 N"）都会变。
3. **`cuts` 与题材跳档。** `judge()` 的 3/8/20 三档是硬边界，切分变碎会把"标准剪辑"直接推到"快切"、"快切"推到"跳切风暴"，同时改变 `docs/product/dayfilm.md` 概念表里"镜头"的定义本身。
4. **性能口径变。** 镜头数变多会改变 `DayAggregator` 的增量成本与渲染侧按镜头数的开销，`docs/specs/dayfilm-delivery.md` R16 的"新增采样到界面更新 ≤16 ms"、"切日 ≤300 ms"要重测。

会失效或必须同步修改的规格与文档：

- `docs/specs/dayfilm-v1.md` R3.1（同进程同标题 + ≤90 秒）、R3.2（≥3 秒才成镜）、R3.5（`end` 向后延伸一格采样，约 2 秒）
- `docs/product/dayfilm.md` 概念表的"镜头"一行
- `docs/data/store-format.md`「日文件」字段表与「规则」节（"镜头是派生数据，不落盘"）
- `docs/specs/dayfilm-v3.md` S2.2（`revisit` 按归一化标题计次，切分口径变了它的次数门槛 `>= 4` 含义也变）
- `docs/specs/dayfilm-delivery.md` R10.4（脱敏在写入前）、R14.3（64 MB / 日提示）、R16（性能基准）
- `PRODUCT.md`「不可让步的产品真相」的隐私与确定性两条（新字段若含语义要走一次脱敏与"同一份数据渲染一致"的复核）

会变红或需要扩写的测试：

- `tests/main/aggregate.test.ts`（200 组随机序列与全量结果深度相等、120 组分批追加；夹具的时间步长是 `pick([0, 2000, 2000, 2000, 30000, 95000, 200000])`，假设的就是 2 秒节奏）
- `tests/main/reel.test.ts`（`cuts`、`scenes.length`、`id`、题材四档、`LockApp` 用例——锁屏现在被当成一个普通进程）
- `tests/main/capture.test.ts`（`parseCaptureLine` 是字段白名单，新增字段不加校验就是这里红）
- `tests/main/store.test.ts`（`isSample` 的必填字段；新字段必须是可选的，否则旧日文件全部读不出来）
- `tests/main/pipeline.test.ts`（采集→落盘→切分→导出的整链）
- `tests/main/marks.test.ts`（标记按开始时刻查找）
- `tests/main/redact.test.ts`（若新字段含语义，需覆盖"命中即整条隐藏"）
- `tests/main/cache.test.ts`（当日缓存与重算路径）
- `tests/renderer/still-frame.test.ts` 与 `tests/renderer/still.test.ts`（`seed = hash(date|index|exe|title)`，把新字段塞进 seed 会让每一帧的颗粒与色相都变，画面不再是"同一份数据同一张图"）
- `tests/renderer/hud.test.ts`（`hudView()` 的 `exe`/`title`）、`tests/renderer/discover.test.ts`、`tests/renderer/spine.test.ts`、`tests/renderer/poster.test.ts`、`tests/renderer/edl.test.ts`（都按镜头序列断言）
- `tests/perf/bench.test.ts`（落盘体积与解析耗时的基准，加字段要更新）

安全的做法：新字段一律**不参与**切分，只在镜头封存后按"出现最多 / 首条"取一个镜头级摘要（`Scene` 上加可选字段）。这样上面第 1–3 条后果不成立，受影响的只剩字段校验、渲染输入与性能基准这几处。
