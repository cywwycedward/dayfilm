# 评委 B：截图与隐私

> 只回答一个问题：Dayfilm 现在用标题 + 进程名合成一帧"剧照"，要不要升级成真实截图？
> 评审依据：`PRODUCT.md`、`DESIGN.md`、`docs/product/dayfilm.md`、`docs/specs/dayfilm-delivery.md`、`src/renderer/src/lib/still-frame.ts`、`src/renderer/src/paint-still.ts`、`src/main/{save-image,redact,security,settings,retention}.ts`、`resources/capture.ps1`、ADR 0002/0003。

## 1. 总评

1. **判断：只做局部**——不做任何可读的真实截图；唯一允许的像素路径是"在内存里把一帧降到 32×18、只落 ≤1 KB 的光签名（亮度 + 主色）、默认关闭、永不写盘成图"。
2. 它**不推翻**"不截屏"，但要求把这条产品真相改写成更窄的一句："**不保存画面**"——读取一次、立刻降采样到不可读、永不落盘成图、永不出口（`PRODUCT.md`「不可让步的产品真相」第一条、`docs/product/dayfilm.md` 原则 1、`src/renderer/index.html` 引导第 1 条、`docs/specs/dayfilm-v2.md` R68.2 都要逐字改）。
3. 硬依据：今天的剧照是纯函数产物（`still-frame.ts` 顶部注释"只算画什么、画多大、放在哪"；`stillParams()` 只吃 `exe/title/kind/index/date/size`，`DESIGN.md`「素材」写明"剧照、密度柱、齿孔、颗粒一律程序化生成，不引入其它位图"），而真实截图会让同一份数据在 30 天后渲染出不同的帧，直接与 `PRODUCT.md` 的"确定性"冲突。
4. 真实截图的增量收益比想象的小：480×270 的一帧只多给"这块画面是什么颜色、多密、有没有视频"，而"在干什么"已经写在 `title`+`exe` 里（`stillParams()` 的 `lines` 第二行就是 `input.title`）。
5. 如果非要像素，32×18 光签名是唯一算得过来的形态：150–400 行/天、3.5–9.2 MB/30 天（现有 120 MB 的 +3–8%）、7.5 秒 CPU/天，且不含任何可读内容。
6. 如果连这个也不接受，退到 §5 的"几何 + 实体"——那才是**零像素**下的 80% 画面感。

## 2. 如果做真实截图，代价算清楚

### 2.1 三条 Windows 路径的实际差异

| | `Windows.Graphics.Capture`（WGC） | `IDXGIOutputDuplication`（桌面复制） | `PrintWindow` + `PW_RENDERFULLCONTENT`（0x2） |
| --- | --- | --- | --- |
| 只抓单窗口 | 能：`GraphicsCaptureItem::CreateForWindow(hwnd)` | **不能**：只能整屏，再按窗口矩形裁剪 | 能：直接传 HWND |
| 抓被遮挡窗口 | 能（读 DWM 合成面） | **不能**：抓到的就是覆盖它的那个窗口 | 能（Win10 1903+ 且目标处理 `WM_PRINT`） |
| 抓最小化窗口 | **不能**（无合成面，帧停或全黑） | **不能**（屏幕上本来就没有） | **不能**（黑帧或旧内容） |
| DRM 内容 | 黑 | 黑 | 黑 |
| 会话 / 权限 | 同会话即可，无需提权；UAC、锁屏、Ctrl+Alt+Del 在另一个桌面，拿不到帧；**Win10 强制在被抓窗口上画黄框**，Win11 要 `GraphicsCaptureAccess.RequestAccessAsync(Borderless)` + 受限 `graphicsCapture` capability 才能关，未打包 exe 基本拿不到 | 必须在驱动该输出的那块 GPU 上跑；锁屏/RDP 报 `DXGI_ERROR_SESSION_DISCONNECTED` / `ACCESS_LOST`，混合显卡笔记本上常见 `DXGI_ERROR_UNSUPPORTED` | 跨完整性级别被 UIPI 拦（高权限窗口返回失败）；`PW_RENDERFULLCONTENT` 未文档化；同步调用可被无响应窗口卡死（无超时） |
| Electron 接入 | `desktopCapturer.getSources({types:['window'], thumbnailSize})` → `source.thumbnail.toJPEG(70)` 一行就能拿到缩略图，但**一次枚举所有窗口的缩略图**、且 `DesktopCapturerSource.id` 是 Chromium 内部 ID，**映射不到 HWND**，只能按标题猜；要单窗口精确抓就得 `getUserMedia` + `setDisplayMediaRequestHandler` 持一条 30fps 流 | **没有 API**：要 N-API 原生模块（违反 ADR 0002"零原生依赖"）或自写 C# 边车（照 ADR 0003 的形状再加一个常驻进程） | **没有 API**，但可以塞进现有 `resources/capture.ps1` 的 `Add-Type` 内联 C#（同一个进程、同一个 2 秒循环、同一个逐行 JSON 协议）——**三条路里唯一不新增依赖的** |

`webContents.capturePage()` 只能抓 Dayfilm 自己的窗口，不是候选。

结论：只有 PrintWindow 能落在现有架构里；WGC 要么用 `desktopCapturer`（一次抓全桌面、HWND 无法对应、黄框），要么加渲染进程与权限处理器；DXGI 直接出局（原生模块 + 常驻会话 + 只能整屏）。

### 2.2 采样策略成本（一天 8 小时 = 28,800 秒）

单张体积口径：480×270 = 129,600 px，JPEG q=70、4:2:0、典型 UI 约 0.1–0.25 B/px → **12–32 KB，取中位 20 KB**。
WebP 同画质约小 20–30%，但 **Electron 的 `nativeImage` 只有 `toJPEG()`/`toPNG()`，没有 `toWebP()`**；主进程/助手都没有 WebP 编码器 → 不加 libwebp 就只能是 JPEG。下表按 JPEG 20 KB 算。

| 策略 | 张数/天（算式） | 每天 | 30 天 | CPU 增量 | 电池 |
| --- | --- | --- | --- | --- | --- |
| 每 60 秒 | 28,800 ÷ 60 = **480** | 480 × 20 KB = **9.6 MB** | **288 MB** | 480 × 30 ms = **14.4 s/天** ≈ 0.05% 单核（0.003% 整机） | 约 0.06 Wh ≈ 60 Wh 电池的 0.1%，噪声内 |
| 每 5 分钟 | 28,800 ÷ 300 = **96** | 96 × 20 KB = **1.9 MB** | **58 MB** | 2.9 s/天 | 噪声内 |
| 只在切窗口时 | 镜头数 **150–400**（`docs/delegate/ask-gpt-1.txt:9`："一个典型工作日约 150-400 个镜头"），取 250 | **5.0 MB** | **150 MB** | 250 × 30 ms = **7.5 s/天** | 噪声内 |
| 画面变化 > 阈值 | 1 fps 探测 28,800 次，按"每 25–75 秒真变一次"落 380–1,150 张，取 **400–600** | **8–12 MB** | **240–360 MB** | 探测本身 3 ms/次 = 86 s/天 + 编码 | **唯一真花钱的选项**：要常驻 WGC/DXGI 会话，GPU 进不了低功耗档，估计 2–5% 电量/8h（本仓库无实测，实现前必须实测） |

单次端到端 30 ms 的构成：PrintWindow 1920×1080 **15–40 ms**（含 `StretchBlt(HALFTONE)` 降到 480×270 的 1–2 ms）+ JPEG 编码 480×270 **3–6 ms**。R16 给的空闲 CPU 预算是 0.5%（16 核），实测 0.13%（`docs/operations/perf-report.md`）——**点采的 CPU 增量全在噪声里，电池成本只来自常驻会话，所以不要常驻会话**。

### 2.3 去重

- dHash（64 bit，9×8 灰度）与 pHash（32×32 DCT）在 480×270 上一次都 < 1 ms；阈值取汉明距离 ≤ 6（dHash）/ ≤ 10（pHash）算同画面。pHash 抗缩放与压缩，dHash 更快，两者都够。
- 关键结论：**去重不是压缩，是把"时间采样"换成"事件采样"**——真正有意义的画面数上限就是镜头数（150–400），所以：
  - 只留首帧/镜头：250 → **200 张**（去掉 15–25% 的 <30 秒碎片镜头，`GAP_MS`/短镜头口径见 `src/main/reel/rules.ts`）≈ **4 MB/天**；
  - 每 60 秒采样 + 首帧 + 变化帧：480 → **120–190 张**（保留率 25–40%）= **2.4–3.8 MB/天**；
  - 每 5 分钟 + 去重：96 → **90 张** ≈ 1.8 MB/天。
- 合计：**任何策略去重后都落在 120–250 张/天、2.4–5.0 MB/天、72–150 MB/30 天**，加上现有的 JSONL 120 MB，总量变成 192–270 MB（+60% ~ +125%）。真实数据下的 hamming 距离分布需要标定（我这里是按"打字 3–8 位、翻页 8–20 位、切标签 15–40 位"估的，实现前用一天真实数据跑一遍再定阈值）。

## 3. 隐私方案（本节是重点，能直接照做）

### 3.1 只在本地：截图会不会离开本机

**会，而且现有两套防线对这条路几乎为零。**

- 能挡住的：渲染进程的一切 `http(s)/ws(s)`（`src/main/index.ts` `installNetworkGuard()` → `session.defaultSession.webRequest.onBeforeRequest` + `security/index.ts` `isLocalRequest()`），以及远程 `file://host/share`（UNC = SMB）；CSP `default-src 'self'; img-src 'self' data:` 再挡一层（`src/renderer/index.html:6`，没有 `connect-src`，回落 `default-src`）。
- 挡不住的，逐条：
  - **主进程 `fetch` / `node:http` / `node:net`**：守卫是 `session` 级的，只管 Chromium 网络栈。挡 0。
  - **`child_process`**：采集助手本身就是 PowerShell，`Invoke-WebRequest` 一行就能发出去。挡 0。
  - **`shell.openExternal`**：今天**没有**（`src/main/index.ts:1` 的 electron 导入是 `app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, session`，不含 `shell`）。一旦加进来，它只泄漏 URL 不泄漏图片——但把 base64 塞进 query 就是外泄通道，等于开后门，必须写死禁用。
  - **崩溃上报**：`crashReporter` 未引入，今天 0 风险。一旦 `crashReporter.start({uploadToServer:true})`，minidump 里可能带着堆上的截图像素——崩溃上报与像素是互斥的，必须 `uploadToServer:false`。
  - **`save-image` 用户主动导出**：`src/main/index.ts` `saveImage()` + `save-image.ts` `decodePngBase64()` 收渲染进程给的任意 PNG 字节，`sanitizeImageName()` 只固定扩展名，路径由 `dialog.showSaveDialog` 让用户选（可以在 Desktop、可以在 OneDrive 目录）。今天只导出海报（`poster.ts` `computePoster()` 是纯参数，没有位图），所以安全；**一旦剧照含真图，任何"导出海报/剧本"都会把截图写到用户桌面**。规则：导出物永远不含像素。
  - 另外：`installNetworkGuard()` 只挂在 `defaultSession` 上，将来任何 `session.fromPartition()` 开的窗口不受它约束。
- 结论：**"不联网"是代码审阅约束，不是技术强制**。`docs/specs/dayfilm-v3.md:154` 已经这么要求（"`installNetworkGuard` 之外再加代码评审确认 `src/main/ai` 是唯一网络出口"）；上像素之前必须把这条升级成测试级断言（枚举 `src/main/**` 里的 `fetch|http|https|net.connect`，白名单只有 `src/main/ai`）。

### 3.2 加密落盘（DPAPI）

- 结论：**真实截图必须加密；32×18 光签名不必**（不可读，加密只是给"被拷走也没用"再加一层，成本 28 B/条，可以顺手做）。
- 做法（不加依赖的两条路）：
  - 主进程：`safeStorage.encryptString(keyHex)` 存 `frames.key`（Windows 上走 DPAPI，`safeStorage.isEncryptionAvailable()` 为 true），图片字节用 Node `crypto` 的 AES-256-GCM，每文件前置 12 B nonce + 16 B tag。
  - 助手内：`Add-Type -AssemblyName System.Security` + `[System.Security.Cryptography.ProtectedData]::Protect(bytes, $null, 'CurrentUser')`，每文件多几百字节头。
- 边界，必须写进设置页而不是藏在代码里：**DPAPI CurrentUser 防"文件被拷到另一台机器 / 另一个 Windows 账户 / 账户删掉后从回收站恢复"；不防"同一用户态下的任何进程"（恶意程序、远控、另一个 Electron 应用、用户自己），也不防内存里的明文被系统截图工具/录屏再拍一次。** 而且主密钥在 `%APPDATA%\Microsoft\Protect\<SID>`，域漫游配置文件会把它一起带走——那时加密对"云上那份"也不成立。

### 3.3 不进备份 / 不进云

- 现状：`app.getPath('userData')`（`src/main/index.ts:665`）= `%APPDATA%\dayfilm`（设置页里写的是 `%APPDATA%\dayfilm\days\`）。
- 结论：**消费级 OneDrive 不会同步这里**——Known Folder Move 只覆盖 Desktop / Documents / Pictures / Screenshots，不含 AppData。真正的风险是企业环境的**漫游用户配置文件**或 **Folder Redirection**（两者都会搬 `AppData\Roaming`）。
- 按成本从低到高：
  1. 文件名用 `.bin` 不用 `.webp/.jpg`：Explorer 不缩略、备份面板不预览、拖进聊天窗口不会自动变成图。
  2. 启动时比一次路径前缀：`process.env.OneDrive / OneDriveConsumer / OneDriveCommercial` 是否命中影像目录，命中就出一条 banner（复用 `storageError()` 那条 banner 通道）。
  3. 真要稳：影像落 `%LOCALAPPDATA%\dayfilm\frames\`（永不漫游），代价是"删一个目录"变成两个，`docs/operations/run.md:51` 的说明要跟着改。

### 3.4 黑名单 / 白名单

- 进程级：今天 `redact/index.ts` 的 `matches()` 只按 `title + exe` 子串匹配 `BUILTIN_REDACT_TERMS`（12 条：1password/keepass/bitwarden/lastpass、incognito/inprivate/隐私、银行/网银/支付/wallet）+ 用户词。对**标题**够用，对**像素**远远不够——缺聊天（WeChat/Telegram/Slack/Discord/Teams）、邮件（OUTLOOK/thunderbird）、会议（Zoom）、远程桌面（mstsc，抓到的是另一台机器的屏幕）、虚拟机（vmware/VirtualBox）、HR/医疗/行情。必须另立一张 `captureDenyExe`。
- 更稳的是**白名单**：`captureAllowExe` 只列 3–5 个（Code、Obsidian、Word、Chrome…），默认"没有点名就不抓"。黑名单永远追不上新应用，白名单把默认值翻成"不抓"。
- 判定时机：必须在**取帧之前**，且按 `exe`（`capture.ps1` 里 `Process.ProcessName`，无路径）而不是 `title`。`matches()` 目前没导出 → 导出一个 `isSensitive(sample, terms)`，一行改动。助手侧再硬编码 5 个密码管理器 exe 兜底（标题里可能一个关键词都没有）。
- 系统级（不用写代码，但必须"当成正常"）：UAC 提示、锁屏、Ctrl+Alt+Del 在另一个桌面，拿不到 HWND 或拿不到帧；DRM/`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 的窗口系统直接给黑；RDP 报会话断开。**黑帧 = 正常结束，不重试、不上报、不留占位图**，否则用户会看到"这个镜头是黑的"，等于变相确认那里有敏感内容。

### 3.5 像素上的脱敏

- **区域模糊不可行**：客户端矩形是可知的（`GetClientRect` / `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`），但敏感控件在哪不可知。统一"遮顶部 80px"在 VS Code 里盖住标签页、在浏览器里盖住地址栏（有时正好该盖）、在 PDF 阅读器里盖住正文第一行——它给人"已脱敏"的错觉，比不做更危险。
- 可行的三档：
  1. **整窗不抓**（§3.4 的白/黑名单）；
  2. **抓完立刻在内存里降到不可读**：1080p → 480×270 是 1/4 线性缩放，12px 正文变 3px、24px 标题变 6px，只有 ≥96px 的展示字（幻灯片标题、视频大字幕）还能认；这一步要说清"对正文安全、对大字号不安全"；
  3. **只留签名**：1080p → 32×18 时一格覆盖 60×60 px，任何文字都消失，只剩"这块是深色还是白底、主色是什么"。
- 反过来一条硬线：**绝不把像素交给 `settings.ai`**。`aiStories()` / `probeModel()` 是唯一的网络出口，`src/renderer/index.html` 里那句"标题摘要会发往该接口"必须改成"只发文字，不发画面"，并且 `ai/*` 的入参类型里不允许出现 `sig`、字节或 data URL。

### 3.6 保留期与"一键抹掉"

- `src/main/retention/index.ts` `cleanupExpired()` 只认 `RetentionStore` 的 `listDays()` / `removeDay()`，`store/index.ts:93` 删的是单个 `days/<date>.jsonl`；`retentionDays <= 0` 直接 return（"不自动清理"）。
- **坑在这里**：`RETENTION_OPTIONS` 里的 `0 = 不自动清理`（`src/shared/settings.ts:82`）意味着"文字永久保留"。图片不能跟着这条走——**图片固定 30 天 + 2 GB 上限，与 `retentionDays` 解耦**，否则一个"永久保留"的用户会攒到几十 GB 的屏幕录像。
- 一键抹掉：**今天没有这个通道**。`src/main/ipc/index.ts:10` 的 `GUARDED_CHANNELS` 18 项里没有 clear/delete，`docs/operations/run.md:51` 是让用户自己删 `days\`。但 `src/renderer/index.html` 引导第 3 条已经承诺"可随时删除或清空"——上像素之前必须先补 `clearFrames`（或统一 `clearData`）：主进程 `rm -rf frames/` + 删 `frames.key` + 二次确认（照 `docs/specs/dayfilm-v2.md:32` 已有的"4 秒内二次确认"），抽屉里用 DESIGN.md 已有的危险按钮。
- 诚实一句：`unlink` 不是安全擦除（HDD 上可恢复，SSD 靠 TRIM）。界面上写"已删除"，不要写"已抹除"。

### 3.7 可见性

- 已有的可见性够用，不要新造 UI：托盘提示 `trayTooltip()`（`Dayfilm · 采集中 · 今日 1 小时 12 分钟`）、顶栏 `● 实时记录中`、HUD、首启引导。上像素时把 hero 的 `正在拍摄 chip` 切成"正在留影"即可。
- **默认值：关。** `PRODUCT.md` 把它列进"不可让步的产品真相"，默认开等于替用户改契约。首次开启用一次模态，逐项写清：抓什么（只抓前台窗口、只在切窗口时）、不抓什么（白名单之外全部不抓）、存在哪、留多久、怎么删。
- 顺带：WGC 的黄框（Win10 强制、Win11 非打包 exe 基本关不掉）会把"正在被抓"变成肉眼可见，但它每帧闪一下，用户会当成 bug 而不是提示——不构成可依赖的可见性方案。

## 4. 如果做，最小可用形态（B 档：32×18 光签名）

一句话：**给剧照真光，不给画面。**

- 数据：`Sample.sig?: string`——32×18 = 576 格，每格 RGB 各 4 bit → 1,728 nibble → 864 B → base64 约 1,152 字符。**只在 `exe`/`title` 与上一条不同时出现**（"只在切窗口时"这个节流放进助手，跨进程协议只多一个可选字段）。
- 落点（6 处，每处都很小）：
  1. `resources/capture.ps1`：新增 `Signature(hwnd)` —— `GetWindowRect` → `PrintWindow(hwnd, memDC, 0x2)` 到 32×18 的 32bpp DIB（`StretchBlt` 用 `HALFTONE` 直接降采样）→ `GetDIBits` 读回 2,304 B → 量化 → base64；`Snapshot()` 记住上一条 `exe/title`，变了才附带 `sig`。
  2. `src/main/redact/index.ts`：`redactSample()` 命中 `matches()` 时顺手 `delete sig`（一个判断一行）。
  3. `src/main/reel/aggregate.ts`：`Run` 初始化的 68–72 行与场景组装的 142–146 行各加一行，把镜头首条采样的 `sig` 提到 `Scene.sig`。
  4. `src/renderer/src/lib/still-frame.ts`：`StillInput` 加 `sig?`，`stillParams()` 多返回一个 `light: { grid, tint } | null`；`sig` 缺省时 `light = null`，其余参数逐字节不变。
  5. `src/renderer/src/paint-still.ts`：`paintStillFrame()` 在填底色之后、齿孔之前，把这 32×18 网格放大成模糊色场（先 `putImageData` 到 32×18 离屏再 8 次线性放大就是软过渡，不需要 `filter: blur`）。
  6. `src/shared/settings.ts` + `src/main/settings/index.ts` + `src/renderer/index.html` 采集分区：一个 `captureLight: boolean`（默认 `false`）开关，进 `normalizeSettings` / `update()` 白名单。
- 第一版砍掉：真实截图、JPEG/WebP 落盘、DPAPI、`frames/` 目录、独立保留期、导出、海报、检索、OCR、ICC 校色、多显示器拼接、HUD/放映里用签名。
- 验证：`tests/main/capture.test.ts`（只在切换时出现、长度与 base64 可解码）、`tests/main/redact.test.ts`（命中即剥 `sig`）、`tests/renderer/still-frame.test.ts`（**无 `sig` 时参数与今天逐字段相等**——这是回归闸门）。
- 代价：150–400 行/天 × 1.2 KB = **180–480 KB/天、5.4–14 MB/30 天**（现有 120 MB 的 +5–12%）；250 次 PrintWindow × 30 ms = **7.5 s CPU/天**。
- 它仍然**需要一次产品真相改写**（"不截屏" → "不保存画面"）。不做这次改写就上，等于用旧文案骗用户。

## 5. 如果连光签名也不接受：3 条不碰像素的路线（按性价比排序）

1. **标题归一化 + 更强实体抽取**（A 级隐私 / 工作量 S）
   - 得到：帧上第二行从"被截断的原文"变成"实体 · 动作"（`dayfilm · fix login bug`），比现在 10px 一行小字可读得多；同一套实体喂给检索、故事线候选、剪辑发现（`src/shared/stories.ts` 已有抽取、`matchProject()` 已有子串匹配）。**这是"画面感"里最便宜的一半**。
   - 放弃：任何颜色/形状；看不懂的标题依然是看不懂。
   - 判据：同一进程里 90% 的镜头，归一化后长度 ≤ 40 字符且不含窗口后缀（`- Visual Studio Code`、`— Mozilla Firefox`）。

2. **窗口几何：把假颜色换成真形状**（A 级隐私 / 工作量 S）
   - 得到：3 个数就够——`GetWindowRect` 的宽高比、占屏比、是否最大化（`IsZoomed` / `GetWindowPlacement`），除以 `GetSystemMetrics(SM_CXVIRTUALSCREEN)`。16:9 全屏视频、3:4 竖排文档、左右分屏的终端，在 hero 那一帧里**比例是真的**，仍然走 `stillParams()` 纯函数渲染，确定性不破。
   - 放弃：亮度、颜色、内容——它给"构图"，不给"光"。
   - 额外好处：`GetWindowRect` 已在同一份 `Add-Type` 里可用，不加依赖、不加进程、不加像素权限。

3. **单窗口 UIA 文本**（B/C 级隐私 / 工作量 M）
   - 得到：`IUIAutomation::GetFocusedElement` 的 `CurrentName` + `CurrentControlType` + **`CurrentIsPassword`**——`IsPassword=true` 是官方标记，是最干净的脱敏原语（比关键词匹配可靠一个量级）；能拿到"正在编辑文件.txt""标签页名""表单字段标签"，比 `title` 细一档。
   - 放弃：跨进程 COM 可能挂起（必须带 deadline，超时就放弃这一次）、UWP/Win32 覆盖率不一致、Chromium/Electron 只暴露部分 Web 树、表单标签可能含姓名/邮箱（所以是 B/C 级）。
   - 不做 OCR 的理由单独说：`Windows.Media.Ocr` 是 WinRT 异步，PowerShell 5.1 没有 `await`、Node 没有 WinRT 绑定，接进来要预编译 C# 或加 CsWinRT（新依赖），而且**OCR 输出随缩放/语言包变化，不满足"同一份数据渲染一致"**，收益又与"标题已可搜"重叠。

## 6. 明确不建议做

- **整屏/多显示器定时截图（DXGI）**：抓到的永远是"桌面"不是"窗口"，还要常驻会话，隐私与电池双输。
- **"480×270 WebP + DPAPI"的标准截图方案**：加密只防另一台机器、不防同用户进程，却要 +288 MB 磁盘、新目录、独立保留期、一键擦除、导出边界五套新机制，换来 hero 里 260px 高的一块"哇"。
- **把缩略图发给模型接口**：唯一网络出口 + 用户内容，一次就毁掉"数据只在本机"。
- **海报/剧本导出里嵌真实帧**：导出路径由用户选（`saveImage()`），等于把截图写进 Desktop/OneDrive。
- **区域模糊/马赛克**：布局不可知，遮蔽位置靠猜，给了"已脱敏"的错觉。
- **OCR 落文本**：把不可读的像素换成可读的文本，隐私等级从 B 跳到 C，而收益与现有标题检索重叠。
- **让 `stillParams()` 依赖文件是否存在**：它现在是纯函数（`still-frame.ts`），一旦有 I/O，"同一份数据渲染一致"当场失效，`tests/renderer/still-frame.test.ts` 也保不住。
- **`crashReporter.start({uploadToServer:true})` 与像素共存**：minidump 会带堆上的画面。

## 7. 一句话回答

**把"剧照"的假颜色换成真形状**——一帧只取窗口几何（宽高比 / 占屏比 / 是否最大化）加归一化后的实体名，用现有 `stillParams()` 的纯函数重画：同一份数据永远画出同一帧，一眼看出"这次是分屏看文档还是全屏看视频"，不产生任何可读像素。
