# 交付前独立评审（df-review）

- **评审对象**：工作区 `not-my-app`。仓库无提交（`git rev-parse --short HEAD` → `fatal: your current branch 'main' does not have any commits yet`），`git status` 全部为未跟踪文件，因此本轮按"2026-11-22 19:55 (+08:00) 的工作区内容"评审（`src/main/index.ts` mtime 19:47、`src/renderer/src/app.ts` 19:40）。
- **自跑结果**：`npm run typecheck` → exit=0；`npm test` → 19 文件 / 178 例通过（含 1 例性能基准，输出见发现 7）；`node scripts/pack/verify.cjs dist/win-unpacked` → exit=0（6 项断言全过）。
- **额外证据**：把 `dist/win-unpacked/resources/app.asar` 解到 `%TEMP%` 逐文件比对，`out/main/index.js`、`out/preload/index.js`、`out/renderer/**` 与当前 `out/` **SHA-256 完全一致**（仅 asar 内 `package.json` 被 electron-builder 裁剪为 178 B），说明打包自检针对的就是当前源码构建；`Icon.ExtractAssociatedIcon(Dayfilm.exe)` 得到 32×32 图标，版本信息 `ProductName=Dayfilm/FileVersion=1.0.0/CompanyName=Dayfilm`。
- **限制**：未启动应用、未跑 `npm run dev` / `npm run dist`；评审期间 `%APPDATA%\dayfilm\days\2026-11-22.jsonl` 有实例在持续追加（183 行、0 坏行、0 条 `[已隐藏]`），我仅只读统计，未做任何启动/退出/破坏性实验。临时探针放在 `%TEMP%\dayfilm-review\`，未进仓库。

## 1. 结论

**有条件交付。** 代码主体确实实现了 R10–R15 与 R18.1/R18.2，打包产物结构正确、asar 与当前构建一致；但交付前必须：①修掉"跨零点 / 当日启动时界面停在旧日期"（常驻场景每天必现，R8.1/R11.3/R13.2 的界面侧）；②补写规格点名的 `docs/operations/perf-report.md` 与 `docs/operations/delivery-verification.md`；③在真实打包产物上启动一次，补齐 R17.2、R12.2/R12.3、R12.5 的证据；④修 portable 目标下的开机自启路径。

## 2. 需求对照

状态取值：实现了 / 部分实现 / 未实现 / 无法从代码判断。

| 需求 | 状态 | 依据 |
| --- | --- | --- |
| R10 隐私与脱敏 | **实现了** | 1) `src/main/redact/index.ts:8-13` 标题先截 512 再与"标题+进程名"做 lower-case 子串匹配；2) `src/shared/settings.ts:31-45` 12 个内置词全覆盖密码管理器/隐私浏览/银行支付；3) `main/index.ts:249-263` 每次采样 `settings.get().redactTerms` 即时读取，`SettingsStore.update` 成功即更新 `cached`（`settings/index.ts:87`、`99-111`）；4) 脱敏在 `cache.append`/`writeBuffer.push` **之前**（`main/index.ts:259-261`），磁盘、内存、UI 三处同源，`tests/main/pipeline.test.ts:64-68` 断言磁盘无原文；5) `src/renderer/index.html` 脱敏说明写"只影响之后的新记录"，历史文件不回溯（`store.readDay` 只读不再脱敏） |
| R11 数据保留 | **部分实现** | 1) `shared/settings.ts:14-28` 默认 30 + 7/30/90/365/0；2) `main/index.ts:232-239` 启动清理 + `retention/index.ts:24-38` 逐日收错、错误进 `storageError`（`main/index.ts:55-57`）→ 界面"写入异常"横幅；3) **未兑现**：`keptDays()`（`main/index.ts:64-70`）只在 `listDays` 被调用时过滤，而界面只在启动时取一次日期列表（`app.ts:1094`、`1117`），运行中改保留期删掉的文件仍留在下拉框里 |
| R12 常驻与生命周期 | **部分实现** | 1) `main/index.ts:312-316` 关窗 `preventDefault()+hide()`，托盘菜单"打开/暂停-继续/退出"齐备（`tray/index.ts:32-53`）；2) **部分**：`tray/tooltip.ts` 的状态文案与菜单 label 随状态变，但 `tray/index.ts:28` 只 `new Tray(image)` 一次，图标本身从不随"采集中/已暂停/出错"变化；3) **部分**：`main/index.ts:224-230` 机制正确（HKCU、无需管理员），但按 `electron-builder.yml:24-26` 实发的是 portable 目标，运行期 `process.execPath` 是 `%TEMP%` 解包副本（见发现 4）；4) `main/index.ts:422-433` 停 tick → 停缓冲 → `drain()`（同步 `appendFileSync`）→ `stopCapture()`（taskkill `/T /F`）；5) `main/index.ts:386-391` 单实例 + `second-instance` 聚焦 |
| R13 休眠、跨天与时钟 | **部分实现** | 1) `main/index.ts:378-384` suspend 停采集、resume 且未暂停则重启，休眠区间无采样 → 自然成空隙；2) **落盘正确、界面不跟随**：`localDate(sample.t)` 决定文件（`main/index.ts:250`、`store/index.ts:14-20`、`43-49`），但 `app.ts:836-846` 只在 `live.day.date === state.date` 时更新画面，零点后主视图冻结在昨天；3) `acceptSampleTime`（`store/index.ts:9`）+ `main/index.ts:252-258` 丢弃倒序采样且不落盘不入缓存；4) `localDate` 用本地日期、历史文件名不重写 |
| R14 存储可靠性 | **实现了**（1 处边界瑕疵） | 1) `store/buffer.ts:64-79` 失败保留未写部分、`setError` 走 `onError` → `storageError` → 界面横幅，5 秒重试（`buffer.ts:101-106`），上限 1000 丢最旧并计数；2) `store/index.ts:67-95` 逐行 `JSON.parse` + `isSample` 校验，坏行/半行整行跳过；3) `main/index.ts:241-246` 启动查一次、之后每 150 条查一次，>64 MB 进 `storageError`。瑕疵：崩溃留下的半行会与恢复后第一条新采样粘连（见发现 12） |
| R15 安全边界 | **部分实现** | 1) `main/index.ts:298-303` sandbox/contextIsolation/nodeIntegration 三项正确，`index.html:6-7` CSP `default-src 'self'; script-src 'self'`（无远程脚本/样式/图片/`eval`）；2) `main/index.ts:170-180` **所有**通道经 `handleIpc` 校验 `senderFrame.url` + `BrowserWindow.fromWebContents`，入参做 typeof/正则校验、非法值回空而不抛；3) **部分**：只写对话框选定路径 ✓，扩展名未固定 `.md`（只给了 filter），非法日期 `throw` 而非契约的 `{ path: '' }`（见发现 6）；4) 无日志文件，`console.warn` 只含通道名/错误码/计数（`errors.ts:1-9`），`captureError` 是脚本 stderr 摘要（脚本本身不打印标题）；5) `main/index.ts:348-352` 会话级 `onBeforeRequest` 取消非本地请求，属"代码评审 + 运行期拦截"，不是进程级网络禁用（见发现 11） |
| R16 性能与容量 | **无法完整验证** | 本次 `npm test` 基准（i5-14400/32 GB/node 22.19.0）：单日读取 5 万条 39.0 ms、全量 `buildDayRollup` 4.70 ms、增量建索引 6.49 ms、追加+汇总均摊 6.9 µs、**跨 7 天检索冷 515.52 ms / 热 0.53 ms**、`heapUsed` 68.4 MB。→ 检索目标（≤500 ms）本次未达标；冷启动 ≤2 s、空闲 CPU ≤0.5%、常驻内存（RSS）≤300 MB、"单日提交后 ≥50 fps" 均无实测数据 |
| R17 打包与分发 | **部分实现 / 无法验证** | 1) `electron-builder.yml:10-26` 配置齐全，但 `dist/` 里只有 `win-unpacked`（`npm run dist` 的 portable exe 未产出）；2) **无法判断**：产物从未被启动过（`status-*.md` 的真机验证跑的是 `npm run start`，加载 `out/` 而不是 asar）；3) `verify.cjs` 断言通过 + 我解包确认：asar 内 11 条，无 `src/`、`tests/`、`.map`，含 `out/main/index.js` 与 `package.json`，`capture.ps1`/`tray.png` 位于 `resourcesPath` 根 |
| R18 验证要求 | **部分实现** | 1) 覆盖到了，但有时钟守卫接线、IPC 接线两处空档（见发现 8）；2) `tests/main/pipeline.test.ts` 用临时目录跑"脱敏→落盘→切分→导出"，不启窗口 ✓；3) **未实现**：无 `docs/operations/perf-report.md`，实测值只存在于测试 stdout 和 `status-main2.md`；4) 本轮执行 |

## 3. 发现

### 阻断

**1. 跨零点与"当日启动"时，主界面停留在旧日期，且日期下拉里永远没有新的一天。**
- 依据：`app.ts:1094-1096` 启动时 `const dates = await source.listDays(); const date = dates.includes(today) ? today : (dates[0] ?? today)`；`app.ts:1117` 只调一次 `renderDates()`；`state.dates` 全会话不更新；`app.ts:836-846` 的 tick 只在 `live.day.date === state.date` 时替换 `state.day`，否则只挪标记。
- 触发：①应用常驻过零点；②每天首次启动（自启/登录时当日日文件还不存在——`DayStore.append` 要等第一行采样才建文件）。此时默认日期取"最近一个有数据的日子"，也就是昨天。
- 影响：胶片、汇总、镜头列表整天停在昨天，新一天不在下拉框里，用户只能重启才看得到当天；自启用户每天早上第一眼就是昨天的片子。R8.1「默认当天」、R11.3、R13.2 的界面侧都不成立。
- 建议：tick 里发现 `live.day.date !== state.date` 且当前选中的是"上次的今天"时切到新日期并重取 `listDays()`；启动时即使今天没有文件也默认今天（走空状态）。

**2. 规格点名的两份验收文档不存在。**
- 依据：`Get-ChildItem -Recurse docs -File | ? Name -match 'verif|perf|delivery'` 只返回 `docs/operations/mvp-verification.md` 与 `docs/specs/dayfilm-delivery.md`；`docs/operations/INDEX.md` 也只登记 `run.md` 与 `mvp-verification.md`。
- 影响：`dayfilm-delivery.md` 的「验收」段（逐条核对 + 证据写入 `delivery-verification.md`）与 R18.3（压测结果写入 `perf-report.md`）都无法成立；R16 目前没有任何可长期查阅的实测记录。
- 建议：把本轮基准数字 + 真机指标按 R16 表格写入 `perf-report.md`，把 R10–R18 逐条结论写入 `delivery-verification.md`，并在 `docs/operations/INDEX.md` 登记。

### 重要

**3. 托盘图标不表达状态（R12.2 只做了提示文字）。** `tray/index.ts:28` 只在启动时 `new Tray(image)`；`render()`（`tray/index.ts:45-53`）只 `setToolTip` + `setContextMenu`，图标本身永远是同一张 `tray.png`。规格写的是"托盘图标提示当前状态（采集中/已暂停/出错）"。建议至少按三态换图或加角标。

**4. portable 目标下开机自启会写进 `%TEMP%` 的解包副本路径。** `main/index.ts:224-230` 用 `app.setLoginItemSettings({ path: process.execPath })`；`electron-builder.yml:24-26` 的实发目标是 `portable`，该目标由 NSIS 自解压到临时目录后运行，`process.execPath` 指向那份副本（用户自己的 portable exe 路径在 `PORTABLE_EXECUTABLE_FILE`）。下次登录该路径已被清理，自启失效（或报找不到文件）。R12.3 在真实分发形态下不成立。建议 `path: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath`。证据级别：机制推断（portable 产物尚未构建，未实测），但 `PORTABLE_EXECUTABLE_FILE` 的存在本身就说明 `process.execPath` 不是用户启动的那个文件。

**5. `--hidden` 启动遇上托盘创建失败时，应用变成"无窗口、无托盘、只能任务管理器杀"的进程。** `main/index.ts:354-376` 把 `createTray` 的异常吞成 `tray = null`；`main/index.ts:307-309` 在 `--hidden` 下不 `show()`；`main/index.ts:436-439` 的回退（无托盘则关窗即退）只有窗口被关闭才会触发，而它根本不可见。触发条件是 `tray.png` 读取失败或 `new Tray()` 抛错（例如图标损坏/被杀软拦截）。建议托盘创建失败时忽略 `--hidden` 强制显示窗口，或直接退出。

**6. 导出路径的两处契约/规格偏离（R15.3）。** `main/index.ts:136-152`：①`filters` 只是默认过滤器，用户手输 `x.txt` 时仍会写 `.txt`，规格要求"扩展名固定 `.md`"；②`main/index.ts:137` 对格式不合法的日期 `throw`，而 `docs/api/ipc-contract.md` 写的是"非法导出日期返回 `{ path: '' }`"。附带：`main/index.ts:184` 对非法日期返回的是 `date` 字段为**今天**的空汇总，不是请求的日期。建议写文件前把扩展名归一为 `.md`，非法日期返回空路径，`getDay` 把请求的日期原样回填。

**7. R16 的检索指标本次未达标，且性能测试的阈值比规格松一个数量级。** 本次 `npm test` 输出"跨 7 天检索（冷，含读盘与建索引）：**515.52 ms**"（`status-main2.md` 记的是 345 ms，同一台机器），超过规格的 500 ms；而 `tests/perf/bench.test.ts` 的断言是 `coldMs < 3000`、`heapUsed < 1 GB`，对 500 ms / 300 MB 的目标没有任何保护，内存还用了 `heapUsed` 而不是 R16 说的"常驻内存"（RSS）。建议把断言收紧到规格量级并区分冷/热，同时补 RSS 口径。

**8. 测试可信度的三个空档。** ①`tests/main/pipeline.test.ts:52-62` 把 `onSample` 的步骤（时钟守卫 → 脱敏 → `cache.append` → `buffer.push`）**复制**到测试里，而不是调用主进程的 `onSample`；主进程里顺序写反或漏调 `redactSample`，这个"整链"测试仍然会通过。②`isTrustedSender`、`handleIpc` 的包装、`installNetworkGuard` 完全无测试——新增一个不经过 `handleIpc` 的通道不会被任何断言发现；可以枚举 `IPC` 常量断言"每个通道都被包装"。③`src/renderer/src/app.ts`（1000+ 行、全部界面逻辑，含本轮发现 1 的日期跟随）零测试，`tests/renderer/**` 只覆盖 `lib/` 纯函数与 mock 数据。

### 次要

**9. `settings.json` 损坏或单字段类型不符时，自定义脱敏词被静默清空并写回。** `settings/index.ts:72-75`：坏文件/坏字段 → `normalizeSettings` 逐字段回落 `DEFAULT_SETTINGS`（`redactTerms: []`）→ 立即 `writeQuietly` 覆盖原文件。隐私后果不是"丢设置"而是"原本被隐藏的标题从此明文落盘"，界面没有任何提示。建议至少保留一份 `.bak` 或在面板/横幅提示"设置已重置为默认值"。

**10. 打包产物仍然信任 `ELECTRON_RENDERER_URL`。** `main/index.ts:167` 无条件把 `process.env.ELECTRON_RENDERER_URL` 传给 `isTrustedFrameUrl`，`main/index.ts:322-327` 也无条件用它 `loadURL`。已打包版本被外部环境变量注入时，窗口会加载并信任该源页面（远程地址会被发现 11 的网络守卫拦下，所以实际只有本地回环源可用）。建议 `app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL`。

**11. 网络白名单比"不发任何网络请求"宽。** `security/index.ts:10`、`41-48`：`file:` 全放行（含 `file://attacker-host/share/x` 这类 UNC = SMB 网络访问），并放行任意端口的回环 http(s)/ws(s)（开发期需要 HMR，打包后不需要）。CSP 也缺 `object-src 'none'` / `base-uri 'none'` / `form-action 'none'`，且没有 `will-navigate` 与 `setWindowOpenHandler` 兜底。远程 `http(s)` 图片/`fetch`/WebSocket 确实会被 `onBeforeRequest` 取消（Electron ≥10 起 webRequest 覆盖 WebSocket，见 electron/electron#22040），所以这是加固缺口而非可利用漏洞。

**12. 崩溃留下的半行会让恢复后的第一条采样一起报废。** `DayStore.append`（`store/index.ts:43-49`）直接 `appendFileSync(line+"\n")`，不检查文件当前是否以 `\n` 结尾；崩溃后残留 `{"t":123,"exe":"Co` 时，新行拼上去成为一条非法 JSON，`readDay` 连它一起跳过。后果是多丢 1 条采样（~2 秒），仍在 R2.2 的 2 秒口径内，但 `--hidden` 常驻 + 强行关机场景会稳定复现。建议 append 前检查尾部字节、必要时先补 `\n`。

**13. 跨日级别的时钟回拨会让采样静默停摆。** `main/index.ts:250-258` 用 `localDate(raw.t)` 选目标日、再与该日最后一条比较：若时钟被调回前一天（或时区变更跨回前一天），新采样的 `t` 仍小于"昨天"文件里的最后一条，于是全部被丢弃，界面只显示"采集中"却不增长，直到墙上时钟追平。这符合 R13.3 的字面要求，但用户无法察觉。建议在丢弃计数超过阈值时把"时钟异常"反映到实时状态。

## 4. 已核对、未发现问题

- **脱敏确实在写入前生效**：`main/index.ts:259-261` 先 `redactSample` 再 `cache.append`/`buffer.push`，`pipeline.test.ts:64-68` 断言磁盘无原文。真实日文件 183 行、0 坏行，但本轮样本没有命中脱敏词，不能作为该结论的独立证据。
- **缓冲重试不会重复写入**：`buffer.ts:64-79` 只丢弃已成功的前缀，失败项留在下标 0 重试；即便出现同 `t` 的重复行，`orderSamples`（`reel/index.ts:24-43`）按 `t` 去重并保持"先出现者"，切分结果不变。
- **增量 ≡ 全量**：我在 `%TEMP%` 探针里跑了 1000 组随机序列（同毫秒重复、恰好 90000/90001 ms 空档、首镜头 <3 秒、`now < lastT`）+ 200 组"逐条追加后逐步比对"，与 `buildDayRollup` 0 处不一致；仓库自带的 200 + 120 组也全过。brief 点名的三种情形实现正确，只是仓库测试没有把它们写成命名用例。
- **LRU 淘汰后的 `lastT`**：`cache.ts:43-45` 从 `entry.samples` 尾部取值，条目被淘汰后从磁盘重建，正常路径写盘是同步 `appendFileSync`，重建结果与淘汰前一致；理论缺口（写盘持续失败 + 当日条目被淘汰）被 2 秒一次的 tick 持续刷新当日条目挡住，实际不可达。
- **IPC 来源校验无绕过**：临时探针试了大小写（`HTTP://LOCALHOST:5174/` 放行、语义不变）、`http://localhost:5174@evil.example/`、`http://localhost:51740/`、`http://localhost:5174.evil.example/`、`file:///d:/...`（拒绝，fail-closed）、`%00`、`../` 归一、`data:` —— 除"同一文件的 `..` 归一后放行"外没有可利用差异。
- **打包内容**：`files: out/**` 没漏运行必需文件，`extraResources` 两条都落在 `resourcesPath` 根，asar 与当前构建字节一致。

## 5. 无法验证项

- **R17.2 / 打包版 IPC**：产物从未启动过。特别值得真机确认的一点：打包后 `rendererFileUrl()`（`main/index.ts:153-155`）算的是 `file:///.../app.asar/out/renderer/index.html`，需要与 Chromium 实际上报的 `senderFrame.url` 逐字符一致（含空格/非 ASCII 安装路径与 asar 段）。若不一致，打包版所有 IPC 都会被拒、界面直接不可用——这是本轮我最想看到真机证据的一点。
- **R12.2/R12.3**：托盘图标是否真的出现、菜单三项点击是否可用、登录项是否写进 HKCU（`HKCU:\...\Run` 当前无 Dayfilm 项，与 `autoStart:false` 一致），本机没有可信的自动化手段；评审期间已有实例在跑，我没有重启或改设置。
- **R12.4/R12.5**：真正退出时的子进程树清理、二次启动聚焦、`--hidden` 下的单实例行为，都需要真的启动/退出进程。
- **R13.1**：真机休眠/恢复（合盖或 `powercfg` 挂起）无法在只读评审里做。
- **R16 的冷启动 ≤2 s、空闲 CPU ≤0.5%、≥50 fps、RSS ≤300 MB**：需要长时间挂机采样与界面侧 profiling，基准测试覆盖不到；R18.3 要求的 `perf-report.md` 也还不存在，因此这些指标既无实测值也无记录。
- **R15.5 的 WebSocket 拦截**：只有"Electron ≥10 已修复 webRequest 对 WebSocket 的支持"这一外部事实（electron/electron#22040），没有在本产物上实测；同样，`file://` 页面里 `http://` 图片与 `fetch` 的实际拦截效果也只做了代码核对。
- **R17.1**：`portable` exe 未构建（`dist/` 只有 `win-unpacked`），`artifactName`、自解压行为、无 Node 机器启动都只能待真跑。
