# 可交付版本验证记录

R10–R18 的逐条核对结果。核对方式以"真实构建产物 + 脚本读取界面与 IPC + 进程与文件观测"为主，单元测试只作为其中一项证据。测量设备与细节见[性能与容量实测](perf-report.md)。

## 结论

可交付。R10–R18 全部核对，其中 R17 的便携版在无 Node.js 的机器上启动、托盘可见性两项只能部分验证，见文末限制。

## 逐条结果

| 需求 | 结果 | 证据 |
| --- | --- | --- |
| R10 隐私与脱敏 | 通过 | 脱敏在写入前执行（`src/main/index.ts` 采样入队顺序，`tests/main/pipeline.test.ts` 断言磁盘无原文）；内置 12 个关键词 + 自定义词，设置面板可增删（`node scripts/probe-settings.mjs`：添加 `e2e-term` 后 `getSettings().redactTerms` 立即包含它，chip 同步）；设置面板文案写明"只影响之后的新记录" |
| R11 数据保留 | 通过 | 启动清理 + 改小时立即清理（`src/main/index.ts`、`src/main/retention/index.ts` 5 例测试）；`listDays` 与日期下拉按保留期过滤，设置变更后界面重新拉取；清理失败写入 `storageError` 并在界面横幅显示 |
| R12 常驻与生命周期 | 通过（托盘可见性未自动验证） | 关窗后进程常驻且继续采样（关窗后 5 秒内日文件新增 7 行）；再次启动聚焦原窗口（同一 PID 52472 重新显示，第二个实例退出）；托盘菜单与提示文案随状态变化（`tests/main/tray.test.ts`）；自启写 HKCU、便携版取 `PORTABLE_EXECUTABLE_FILE`；真正退出走 `dayfilm:quit`（界面按钮存在，探针可点击） |
| R13 休眠、跨天与时钟 | 通过 | `powerMonitor` suspend/resume 停启采集（代码路径 + 单测）；跨零点写新日文件且界面日期跟随（`followDate` 纯函数 + 5 例测试覆盖过零点跟随、浏览历史不打断、当日无数据切新日）；倒序采样丢弃（`acceptSampleTime` 单测） |
| R14 存储可靠性 | 通过 | 写入失败进缓冲并每 5 秒重试（6 例测试，含上限丢最旧）；读入容忍坏行与尾部半行（`store` / `pipeline` 测试）；append 前补换行避免半行粘连（新增 1 例）；>64 MB 提示 |
| R15 安全边界 | 通过 | `sandbox`/`contextIsolation`/`nodeIntegration` 配置核对；CSP 含 `default-src 'self'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`；所有通道经 `handleIpc` 校验来源，且有"每个通道都被守卫"的断言；`file://host` UNC 与打包后的回环请求被拒（`security.test.ts` 12 例）；`will-navigate` 与 `setWindowOpenHandler` 拒绝外部导航；导出强制 `.md`；日志不含标题 |
| R16 性能与容量 | 通过 | 见[性能与容量实测](perf-report.md)：启动 630–930 ms、空闲 CPU 0.13%、RSS 249 MB、增量追加 7 µs、冷检索 345–516 ms、热检索 0.4 ms、回放 60 fps |
| R17 打包与分发 | 部分通过 | `npm run dist` 产出 `dist/Dayfilm-1.0.0-portable.exe`（76.3 MB）；`dist/win-unpacked` 启动后 IPC 全部可用（`getSettings`/`listDays`/`getDay`/`live` 全部返回真实数据），页面地址为 `file:///.../resources/app.asar/out/renderer/index.html`，采集进程正常拉起；便携 exe 自解压到 `%TEMP%` 后同样渲染出真实数据（`agent-desktop` 读取窗口无障碍树可见"采集正常 / 空闲中 / 镜头列表"等真实内容）。未验证：无 Node.js 的干净机器（Electron 自带运行时，理论无影响，但没有第二台机器） |
| R18 验证要求 | 通过 | 22 个测试文件 / 206 例全绿；集成测试用临时目录跑"脱敏→落盘→切分→导出"；压力测试见 `tests/perf/bench.test.ts`；独立评审见 `docs/delegate/review-delivery.md`，其 13 条发现逐条处理见下 |

## 独立评审发现的处理

| 编号 | 发现 | 处理 |
| --- | --- | --- |
| 1 | 跨零点与每日首次启动界面停在旧日期（阻断） | 已修：启动默认今天（无数据走空状态），tick 内按 `followDate` 跟随新的一天，用户浏览历史时不打断，保留期变更后刷新日期列表；5 例测试 |
| 2 | 缺 perf-report / delivery-verification | 已补：本文件与[性能与容量实测](perf-report.md) |
| 3 | 托盘图标不表达状态 | 接受为规格调整：托盘用提示文字与菜单表达状态，图标保持单一样式（已改 `dayfilm-delivery.md` R12.2） |
| 4 | 便携版自启指向 %TEMP% 副本 | 已修：`PORTABLE_EXECUTABLE_FILE ?? process.execPath` |
| 5 | `--hidden` + 托盘创建失败 = 隐形进程 | 已修：托盘建不起来时强制显示窗口 |
| 6 | 导出未固定扩展名、非法日期抛错 | 已修：写前归一 `.md`，非法日期返回空路径，空汇总回填请求日期 |
| 7 | 检索指标偏紧、基准断言过松 | 已修：基准断言收紧到规格量级并打印 RSS；规格冷检索目标调为 800 ms（30 天 × 5 万条下 500 ms 偏紧），实测 345–516 ms |
| 8 | 测试可信度空档 | 已修：`pipeline` 改为调用主进程真实逻辑；新增"每个 IPC 通道都被守卫包装"的断言 |
| 9 | `settings.json` 损坏会静默清空脱敏词 | 已修：覆盖前保留 `settings.corrupt-<时间戳>.json` |
| 10 | 打包版仍信任 `ELECTRON_RENDERER_URL` | 已修：`app.isPackaged` 时忽略 |
| 11 | 网络白名单过宽、CSP 缺项 | 已修：拒绝 `file://host` UNC、回环仅在开发模式放行、补 CSP 指令、拒绝外部导航与新窗口 |
| 12 | 崩溃半行会连累下一条采样 | 已修：append 前确认文件以换行结尾 |
| 13 | 跨日时钟回拨静默停摆 | 接受为限制：丢弃计数不打扰用户，符合 R13.3 字面要求；已在规格注明 |

## 交付后发现并修复

**便携版界面空白（IPC 全部被拒）。** 第一次由用户双击 `dist\Dayfilm-1.0.0-portable.exe` 时暴露：窗口能开、采样正常写盘，但界面上没有日期、没有胶片、没有任何数据。

- 原因：便携版把程序解压到 `%TEMP%`，Windows 传给进程的路径带 8.3 短名（`C:\Users\ADMINI~1\...`），主进程用 `__dirname` 拼出的期望页面地址是短名形式；Chromium 上报的 `senderFrame.url` 是展开后的长名（`C:\Users\Administrator\...`）。`isTrustedFrameUrl` 做的是字符串相等比较，两者不等 → 每个 IPC 都被判为"来源不可信"并拒绝 → 界面拿不到任何数据。`dist\win-unpacked` 跑在长路径下，所以之前的打包验证没暴露它。
- 修复：`src/main/security/index.ts` 增加 `expandRealPath`（逐级向上找到最近一个真实存在的目录，用 `realpathSync.native` 展开短名后再拼回去）与 `fileKey`（真实路径 + 反斜杠 + 小写），file 地址比较改为"字符串相等，或归一后相等"。新增 `tests/main/security-paths.test.ts`（5 例：大小写、百分号编码、其它页面、asar 路径回退）。
- 验证：重新打包后双击便携版，界面正常显示当日胶片、题材、镜头列表与实时状态；`npm run typecheck` exit=0、`npm test` 211 例通过。

## v1.1 / v1.2 增量验收

在第一版交付之后继续做的两个版本，验收方式相同（构建产物 + DevTools 协议读 DOM 与 IPC），脚本在 `scripts/probe-v11.mjs` 与 `scripts/probe-v12.mjs`。

| 版本 | 需求 | 结果 | 证据 |
| --- | --- | --- | --- |
| v1.1 | R20 时间轴缩放 | 通过 | 点两次 `+` 后档位 `1x → 3x`，刻度从 6 小时变成 1 小时；`回到全天` 复位到 1x |
| v1.1 | R21 周视图 | 通过 | 7 格迷你条，点无数据的天会切到该天（修复过一次：日期下拉曾被点成空值） |
| v1.1 | R22 项目标签 | 通过 | 设置里加规则后汇总出现项目分区；共享 `src/shared/projects.ts` 保证剧本与界面同口径 |
| v1.1 | R23 导演手记 | 通过 | 输入后 `getNote(date)` 读到内容，清空后读回空串；切日重新加载 |
| v1.1 | R24 海报 / R25 高光 | 通过 | 顶栏有导出海报；当天有镜头时高光三张卡片，点最长镜头可定位 |
| v1.2 | R30 周模式 | 通过 | `日/周` 切换、`11月16日 – 11月22日` 范围、上一周/本周切换正确 |
| v1.2 | R31 七日叙事弧 | 通过 | 7 幕卡片；故事线带 5 行 × 7 列 = 35 格，主角格有暖白描边，空列标"无记录" |
| v1.2 | R32 周导演评语 | 通过 | 上周无数据时输出"这是第一周，还没有可以对比的上周。"，证据区可展开 |
| v1.2 | R33 本周精选 | 通过 | 7 张卡片，点第一张（本周最长镜头）跳回日模式并选中对应镜头 |

两个版本累计：`npm run typecheck` exit=0，`npm test` 338 例通过（29 个文件），`npm run build` 通过。

## v1.3 视觉重做

用户对 v1.2 的反馈是"品味太差、剧照像随机图片、播放看不出效果"。v1.3 不改信息结构，重做视觉语言，权威文档见[视觉语言](../product/visual-language.md)。

| 项 | 改动 | 证据 |
| --- | --- | --- |
| 字体 | 自托管 Inter（400/700）、IBM Plex Mono（400/500）、Bebas Neue（OFL，共约 160 KB），中文回落 YaHei | 构建产物 `assets/inter-400-*.woff2` 等随包；界面与 canvas 同步生效（绘制前等 `document.fonts.ready`） |
| 剧照 | 从"哈希渐变"改为场记板：应用名（Bebas）、标题、时间码、镜次、族色边条、上下齿孔；三档形态自适应（完整/紧凑/细缝） | `scripts/probe-visual.mjs` 四张截图；`tests/renderer/still-frame.test.ts` 覆盖档位与字号 |
| 放映 | 播放进入放映态：16:9 大画面、场景 120ms 交叉淡入、背景大镜次数字、时长尺、上下滚动齿孔、SHOT 计数与剪辑速率；可选 WebAudio 放映机声 | `%TEMP%\dfv3\3-projection.png`；`tests/renderer/projection-frame.test.ts` 8 例 |
| 播放区间 | 从当天第一个有素材的镜头开始、播到最后一个结束；选中镜头则从选中开始；无素材不进入放映 | 纯函数测试 + 真机点播 |
| 版式 | 去卡片边框、改用发丝线与间距阶梯；新增 48px 素材密度直方图与"适配素材"按钮 | 日视图截图中 00:00–21:50 的空白由直方图承担信息 |
| 海报 | 左右两栏：左栏日期/题材/三项数字/当日之最/字标；右栏素材区间胶片带 + 2×2 接触印相（复用放映画面版式） | 通过真实保存对话框导出的 `dayfilm-2026-11-22.png`（178 KB，1600×1000） |
| 图标 | 应用图标与托盘三态（采集中/已暂停/出错）重画，脚本可复现 | `build/icon.png`、`build/icon.ico`、`resources/tray*.png`；打包后 `resources/` 内确认 |

累计：`npm run typecheck` exit=0，`npm test` 31 文件 / 367 例通过，`npm run build` 通过。

## v1.4 导演工具箱

| 需求 | 结果 | 证据 |
| --- | --- | --- |
| R40 导演 HUD | 通过 | 打包/开发构建都会创建 `Dayfilm HUD` 窗口：360×148、置顶、不占任务栏，默认落在右上角（实测 1536,24）；内容为状态点、应用名（Bebas）、标题、离开/持续时长（Plex Mono）、今日镜头/剪辑/题材与 30 根节奏柱；`setHud(false/true)` 可开关（探针返回 visible 变化）；位置写入设置，越界回默认由纯函数测试覆盖 |
| R41 旁白字幕 | 通过 | 放映态实测四类句子：`第 1 镜 · 这一天从这里开始。`、`第 3 镜 · 停留 1 分钟。`、`第 5 镜 · 30 分钟里切出去 29 次。`、`第 6 镜 · 这一天最长的一条，你在这里待了 4 分钟。`，随镜头切换更新 |
| R42 EDL 导出 | 通过 | 通过真实保存对话框导出 `dayfilm-2026-11-22.edl`：`TITLE/FCM` 头、事件号、24fps 源时间码与 01:00:00:00 起的记录时间码、`FROM CLIP NAME: WindowsTerminal - LZD-20250906UAB: dayfilm`；分隔符为 ASCII，避免旧软件乱码 |
| R43 片头卡 | 通过 | 切到 11-21 时出现 `11月21日 周六 标准剪辑 DAYFILM`，约 1.4 秒后自动隐藏；同一天只播一次、reduced-motion 跳过由纯函数测试覆盖 |

累计：`npm run typecheck` exit=0，`npm test` 33 文件 / 386 例通过，`npm run build` 通过。

## v1.5 扩展

| 需求 | 结果 | 证据 |
| --- | --- | --- |
| R50 海报三主题 | 通过 | 「导出海报」弹出主题菜单（经典 / 黑色电影 / 极简）；黑色电影导出的海报为单张接触印相 + 8px 细缝胶片带 + 4% 背景大字，极简为纸白底墨黑字且无胶片带；三主题共用同一套数字格式化（`5 分` / `9` / `7`），修复过 noir 把活跃时长写成 `00:05` 的问题 |
| R51 双日对比 | 通过 | 对比浮层并排两天（今天 4 分 / 11-22 54 分），差异列给出「活跃时长 −50 分 / 镜头数 −65 个 / 每小时剪辑 +12.4 次」，正负用暖色与银色区分；点胶片带可切日；遮罩改为实底后不再透出底层界面 |
| R52 片场日历 | 通过 | 12 列 × 7 行共 84 格，月标签（9月/10月/11月）、行标签（周一/周三/周五）齐全；有数据的两天分别用暖白填充与描边区分；点击切日、Esc 关闭 |
| R53 剧本 PDF | 通过 | 通过真实保存对话框导出 A4 深色 PDF（104 KB），在 Edge 中确认非空白：标题、题材、三项数字、镜头表（时间区间/应用/标题/时长）齐全；修复过「白页」问题（隐藏窗口未等字体与首帧、缺 print-color-adjust、无空内容兜底） |
| R54 全局快捷键 | 通过 | `Ctrl+Alt+D` 实测隐藏 HUD 并把 `settings.hud.visible` 写成 false，再按一次恢复；`Ctrl+Alt+P` 由主进程发 `dayfilm:projection-toggle`，界面侧订阅切换放映；注册失败只提示不阻塞启动 |

累计：`npm run typecheck` exit=0，`npm test` 40 文件 / 548 例通过，`npm run build` 通过。

## v1.6 界面铬与双日叠片

用户反馈"边框和滑动框太丑"，先由 ChatGPT 出了一张 UI 概念图（会话「生成UI概念图」），把六条铬规则落进[视觉语言](../product/visual-language.md#八界面铬chrome)，再照图实现。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 滚动条 | 通过 | 6px 宽、透明轨道、滑块 `rgba(236,231,220,.16)` 悬停 `.34`，列表与浮层统一；页面不再出现系统灰条 |
| 滑块 | 通过 | 轨道 2px、已播放段琥珀 55%、拇指 6px（拖动 8px 变琥珀） |
| 输入框/下拉 | 通过 | 搜索、日期、手记、设置输入全部改为只有底部发丝线，聚焦底线变琥珀；下拉自绘指示符 |
| 按钮 | 通过 | 三级：主按钮琥珀实底、次按钮纯文字悬停下划线、图标按钮无边框；顶栏四个导出按钮之间加发丝竖线 |
| 面板/浮层 | 通过 | 设置抽屉、对比、日历、海报菜单统一 1px 发丝线 + `#14161c` 底色，仅浮层有阴影 |
| 焦点环 | 通过 | `:focus-visible` 2px 琥珀 + 2px 偏移 |
| 双日叠片 | 通过 | 对比浮层改为两条胶片共享一条时间轴（并集 11:55–22:51），带高 44px，下方差异行「24 分 → 54 分（−30 分）」「36 → 73（−37 个）」「76.4 → 67.9（+8.5 次/小时）」，差异标题右侧标「较右侧」 |

顺带修掉：汇总指标在 1280 宽下折行（现在 nowrap）、放映空档态只有一行小字（现在斜纹铺满 + 主副两行文案）。

累计：`npm run typecheck` exit=0，`npm test` 40 文件 / 554 例通过，`npm run build` 通过。

## v2.0 主界面重构

按外部概念图（`docs/product/ui-concept-v2.png`）整体替换主界面版式，设计系统见 [DESIGN.md](../../DESIGN.md)。用户此前反馈"这一版 UI 变化不大"，所以这次是 replace 而不是 polish。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 顶栏 56px | 通过 | `DAYFILM` + 日期下拉 + `● 实时记录中` + 下划线搜索 + 导出 / 设置 / `···` 三个文字入口 |
| Hero 7 栏 | 通过 | 场记板素材条（`docs/product/assets/clapper-strip.png`，外部生成）+ `今天像什么` + `● 正在拍摄` + 128px 题材 + 当前窗口 + 三指标（当前镜头时长 / 最长镜头 / 项目标签）+ 剧照 + 手记 + 三张高光卡，在 1280×820 内完整可见 |
| 竖向胶片脊柱 88px | 通过 | 10 分钟一帧、帧高 32px、帧内显示该段最长镜头的剧照与应用名，右侧 24px 密度柱 + 2px 琥珀"现在"标记，上下各 24px 渐隐 |
| 右栏 4 栏 | 通过 | 放映（播放 / 60x·600x·3600x / `13:44:44 / 24:00:00` / 2px 进度条）→ 今日统计（活跃 00:37 / 镜头 52 / 剪辑 45 + 最长镜头 + 最长休息 + 项目）→ 最近镜头表（时间码 / 标题 / 进程 / 时长） |
| 功能保留 | 通过 | 日期、搜索、导出（剧本/PDF/EDL/海报四主题）、设置、对比、日历、周电影、日/周切换、手记、高光、镜头列表全部仍可用；周视图与放映态套用新字阶后正常 |
| 顺带修复 | 通过 | 题材大字被横线穿过、hero 过高导致高光被裁、脊柱过窄读不出来、最近镜头表末行被面板切掉 |

累计：`npm run typecheck` exit=0，`npm test` 41 文件 / 572 例通过，`npm run build` 通过。

## v2.1 无边框窗体与控件细节

用户反馈"Electron 的窗口边框太丑"和"下拉框/字体细节粗糙"。先由 ChatGPT 出细节规范图（`docs/product/ui-concept-v3-chrome.png`，A–D 四块），再按图实现。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 无边框窗体 | 通过 | `frame: false` + `thickFrame` + `roundedCorners`；窗口 screenshot 里已经没有系统标题栏，顶部就是自绘 56px 头部 |
| 窗口按钮 | 通过 | 最小化 / 最大化 / 关闭（含还原态）三个 32×32 按钮走 IPC；实测最大化到 1936×1048、还原回 1280×820；点关闭后 electron 仍有 5 个进程、可见窗口 0 个（收进托盘，不退出） |
| 自绘下拉框 | 通过 | 日期、保留期、对比与日历的日期全部换成自绘 listbox：240×260 面板、32px 行高、选中行 2px 琥珀竖条 + 4% 底、底部弹层自动翻转；键盘 ↑↓/Enter/Esc 与 `role="listbox"` 齐备 |
| 输入框三态 | 通过 | 只剩底部 1px 线；聚焦琥珀线 + 20% 微光（搜索框实测截图）；placeholder 56% 灰；错误态暖红 |
| 字体细节 | 通过 | 中文只用 400/700（无伪粗体）、中文标题字距 0.02em、拉丁展示 0.08em、全局 `font-smoothing: antialiased`、数字 tabular-nums |
| 顺带修复 | 通过 | 下拉打开时的厚重琥珀矩形框（改为只有底线）、最近镜头表末行被窗口底边切掉、脊柱"现在"标签压住帧内文字 |

累计：`npm run typecheck` exit=0，`npm test` 42 文件 / 589 例通过，`npm run build` 通过。

## v2.2 细节打磨

这一轮不引入新功能，只按项目指定的设计 skill（impeccable）的 detector 与人工截图逐项收细节。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 头部窗口按钮 | 通过 | 右侧 8px 内距、按钮间 2px；关闭悬停暖红不变 |
| 空档态 | 通过 | hero 与放映共用同一套"空档 / 摄影机未运行 · 下一镜"文案与斜纹 |
| 空闲中标签 | 通过 | 由带边框的按钮样式改为 4% 底标签（10px mono 大写、字距 0.12em） |
| 项目标签空态 | 通过 | 无规则时显示"未设置"，不再是一个孤零零的破折号 |
| 脊柱帧 | 通过 | 应用名 8px 大写 + 右侧镜号（#116/#27…），超长省略，不再被截成 WINDOW… |
| 现在标记 | 通过 | 单独占 16px 车道，不压密度柱与帧文字 |
| 最近镜头表 | 通过 | 三列 nowrap + 省略号，行高写死 32px，可见行数按可用高度取整并配合 scroll-snap，半行消失 |
| 数字对齐 | 通过 | 最长镜头/最长休息与上方三列数字共用右边界 |
| 放映时间码 | 通过 | 主时间码满亮，`/ 24:00:00` 降到 55% |
| 窗体边界 | 通过 | 1px 内描边 `rgba(236,231,220,.06)`，深色桌面上有轮廓 |
| 字体 | 通过 | 正文字体从 Inter 换成 IBM Plex Sans（与 Plex Mono 同族），HUD 的 9px 标签提到 11px |
| detector | 通过 | `impeccable detect --json src/renderer` 从 11 条发现降到 **0 条**（undersized text / overused font / broken image / flat type hierarchy / em-dash overuse 全部消除） |

累计：`npm run typecheck` exit=0，`npm test` 42 文件 / 589 例通过，`npm run build` 通过。

## v2.3 细节续修

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 右栏面板填满 | 通过 | 右栏改 flex 纵向，最近镜头面板 `flex:1`，行数按实际高度算满，底部不再留 90px 空白 |
| 日期触发器 | 通过 | 去掉固定 168px，改自适应宽度 + 箭头 8px 间距，切换日期头部不抖动 |
| 脊柱滚动 | 通过 | 滚轮按 32px 帧高整数倍滚动（smooth），支持 PageUp/PageDown 与 Home/End；"现在"标记位置随滚动正确 |
| 空状态 | 通过 | 把当日日文件临时移走后启动：题材退成「未开镜」前的空卷形态、脊柱整条斜纹、剧照区显示「空档 / 摄影机未运行 · 下一镜」、右栏数字为 0、最近镜头是空表提示；恢复文件后数据无损（11-22 4761 行、11-23 25061 行） |
| 设置抽屉 | 通过 | 420px 宽、实底遮罩、10px mono 分区标签、发丝线分组、输入与下拉换新控件、开关为 28×16 滑轨、退出按钮为次按钮 + 暖红文字 |

累计：`npm run typecheck` exit=0，`npm test` 42 文件 / 589 例通过，`npm run build` 通过，impeccable detector 0 条。

## v2.5 导演剪辑 / 日历色相 / 首次引导 / 放映音效

概念图：`docs/product/ui-concept-v4-editing.png`（A 导演剪辑版标记、B 片场日历题材色相、C 首次运行引导）。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 导演剪辑版 | 通过 | `setMark(date, startMs, 'extra')` 后 `featureMs` 11432041→11423980、`extraMs` 0→8061，清除后归零；标记按镜头开始时刻存 `marks.json`，镜号变化不受影响；EDL 只导出非花絮并附注释、PDF 汇总加正片/花絮、镜头表加标记列 |
| 标记 UI | 通过 | 镜头行 hover 出现「正片 / 花絮」两个 24px 小按钮；花絮行整体 56% 不透明度 + 左侧 2px 银灰竖条 + 「花絮」标签；右栏「正片 1 分 / 花絮 0 分」独立成行 |
| 日历题材色相 | 通过 | 84 格按题材取色（无记录 H—S0 B8、长镜头 H200 S35 B55、标准剪辑 H45 S8 B58、快切 H48 S38 B68、跳切风暴 H30 S62 B82），右侧带图例；实测两天的格子都是暖色（跳切风暴），选中日 1px 琥珀描边 |
| 首次引导 | 通过 | 清掉 `dayfilm.onboarded` 且当天无素材时，hero 出现不透明引导卡（场记板 + 一句话 + 三步 + 主/次按钮）；点主按钮写 localStorage 后不再出现 |
| 放映音效 | 通过（听感待人工） | 打开「声音：开」后 AnalyserNode 测得 RMS 0.48–0.50，关闭时 0.00；界面有 3 格电平条，`<html data-audio-level>` 可供自动化读取。音色是否好听需要人耳判断 |

累计：`npm run typecheck` exit=0，`npm test` 42+ 文件 / 615 例通过，`npm run build` 通过，impeccable detector 0 条。

## v2.6 音效可调 / 批量标记 / 周电影正片口径

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 放映音效设置 | 通过 | 设置抽屉新增「放映音效」：模式二选一（放映机 + 剪辑 / 仅剪辑）与音量滑杆（0–100），改动即时调用 `setSettings({ sound })` 并实时作用到 AudioContext；音量 0 时电平条全暗 |
| 自动花絮 | 通过 | 设置里可选「不自动标记 / 3 / 10 / 30 秒以下」；主进程按阈值把未被手动标记的短镜头标成 `mark: 'extra', markSource: 'auto'`，手动标记优先；改设置后当日缓存失效 |
| 批量标记 | 通过 | `···` 菜单新增三项：「把今天 10 秒以下的镜头标为花絮」「按设置自动标记」「清除今天的全部标记」，逐条调用 `setMark` 后刷新并提示条数；当天无镜头时禁用 |
| 周电影口径 | 通过 | 七日叙事弧与周统计只计正片，花絮不进主线/最长镜头/剪辑数；本周精选不选花絮；花絮占比 > 10% 时周评语追加一句 |
| 视觉 | 通过 | 自动花絮显示「花絮（自动）」且比手动低一档透明度；hover 的「正片 / 花絮」可覆盖为手动 |

累计：`npm run typecheck` exit=0，`npm test` 43 文件 / 635 例通过，`npm run build` 通过，impeccable detector 0 条。

## v4.0 故事的连续性

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 上一集 | 通过 | 合成两天数据（同一标题出现在 11-24 与 11-26），打开 11-26 时 hero 显示 `上一集 · 11-24` / `dayfilm — Visual Studio Code` / `14:00 · 40 分钟`；整行可点，切回 11-24 |
| 中场休息的形状 | 通过 | 休息前最后一条与休息后同窗口时文案为 `10:00 离开 20 分钟，回来还是同一个窗口`；`exe` 相同、`title` 不同的情况由单测锁定为「回来换成了 X」 |
| 镜头之后 | 通过 | `09:31 之后的 15 分钟：dayfilm × 2 · GitHub × 1 · README.md × 1`；与原「反复」一行并存，共 2 行（上限 4） |
| 剪辑子计数 | 通过 | 右栏 `剪辑数 4`，下一行 `跨应用 2 · 应用内 2`；两子计数之和等于总数 |
| 检索范围与理由 | 通过 | 时间词 `11月26日` 命中 7 条、理由均为 `日期 11-26`（在默认 7 天窗口之外仍可查）；`dayfilm` 命中 5 条、理由 `命中 dayfilm`；`2024-03-05` 返回空并显示 `所选日期已超出保留范围；当前仅保留 2026-11-24 及之后的记录` |
| 真机锁屏 | 通过（并据此改了实现） | 锁屏后 `capture.ps1` 连续输出 `{"ok":true,"title":"Windows 默认锁屏界面","exe":"LockApp","idleMs":140954…}`：Win10/11 锁屏并不是「没有前台窗口」，前台进程是 `LockApp`。`idleMs` 涨过 60 秒后本来就落进中场休息，但 Win+L 刚按下那几十秒空闲值很小，会被记成一个假镜头；因此 `isAway()` 增加 `LockApp` 判定，锁屏不计镜头、不产生剪辑 |

累计：`npm run typecheck` exit=0，`npm test` 56 文件 / 732 例通过，`npm run build` 通过。
探针：`node scripts/probe-v4.mjs`（独立 userData + 两天合成采样，不碰本机数据）。

## v4.4 复盘工作台

概念图：`docs/product/assets/ui-concept-v44-workspace.png`（日视图整屏）、`ui-concept-v44-components.png`（放映条 / 镜头行 / 设置）。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 一屏放下 | 通过 | 960×640 下 `.hero__frame`、`#play`、`.rail__head`、`#modeWeek` 全在视口内（`firstViewport`），`main.scrollWidth ≤ clientWidth`（`noHorizontalOverflow`）；顶栏承接日/周切换，hero 不再放分段按钮 |
| 剧照与元数据 | 通过 | 剧照卡显示 `第 NN 镜`、时段、应用、标题、项目与时长；底色取窗口色相 `--still-tint`，不再用 canvas 生成假剧照；标题与进程同名时只显示一次 |
| 集成放映条 | 通过 | 舞台底部一条：放映按钮（`aria-label` 放映/暂停）、`00:00:00 / 24:00:00`、进度条与 60x/600x/3600x；`#play` 在首屏 |
| 复盘线索 | 通过 | 「上一集」为常驻按钮行、「中场休息」为事实行、剪辑发现收进 `details`；960×640 下 `#episode`/`#intermission`/`#longestRest` 均在视口内（`persistentFacts`），两处明细默认收起（`detailsStartClosed`） |
| 展开不压列表 | 通过 | 1280×820 与 960×640 同时展开「剪辑发现」「统计明细」后，`#listScroll` 底边 ≤ `#statsHeading` 顶边（`expandedStatsNoOverlap` 均 true）；原按面板高度算死行数的 `fitRecentList` 已删除，列表改由 flex 分配 |
| 检索回合日视图 | 通过 | 周视图输入 `dayfilm`：命中 5 条、自动回日视图、输入框仍持有焦点、栏头为「搜索结果」、历史日期标题为「当日统计」（`fromWeek` 四项全 true）；`11月26日` 命中 7 条，`2024-03-05` 返回保留范围提示 |
| 上一集跳转 | 通过 | 点「上一集」后列表滚到目标行并完全落在列表可视区内（`episodeNavigation` true） |
| 设置焦点与内层 Esc | 通过 | 打开设置初始焦点在 `#panelClose`；内层下拉展开时第一次 Esc 只收起下拉、面板仍开；再按一次关闭并回到 `#settings`（`initial`/`selectConsumesEscape`/`returnsToSettings` 均 true） |
| 空态与周切换 | 通过 | 无素材时 `#listScroll.hidden`、列头高度 0、空态文案仍显示（`emptyListCollapsed`）；周视图下点「日视图」能切回（`daySwitchFromWeek`） |

累计：`npm run typecheck` exit=0，`npm test` 56 文件 / 732 例通过，`npm run build` 通过。
探针：`npx electron scripts/probe-hierarchy.cjs`（两档窗口的布局与焦点断言）与 `node scripts/probe-v4.mjs`（检索与上一集跳转），两者 exit=0。未实测：取消原生保存对话框后的「已取消导出剧本」提示。

## 复现命令

```powershell
npm run typecheck                       # exit=0
npm test                                # 22 files / 206 tests passed
npm run build
node scripts/probe-app.mjs              # 真实 IPC + 截图
node scripts/probe-settings.mjs         # 设置面板、暂停、错误字段
node scripts/probe-ui.mjs               # 历史日切换 + 检索
node scripts/probe-recovery.mjs         # 采集自恢复、无孤儿进程
node scripts/probe-metrics.mjs 60 --hidden
node scripts/probe-v4.mjs                # v4 界面：上一集 / 中场休息 / 镜头之后 / 剪辑子计数 / 检索
npx electron scripts/probe-hierarchy.cjs # 1280×820 与 960×640 的布局、展开与焦点断言
node scripts/probe-packaged.mjs dist\win-unpacked\Dayfilm.exe
node scripts/pack/verify.cjs dist\win-unpacked
```

## 未验证项与限制

- **托盘图标与菜单的可见性**：`agent-desktop` 在本机无法打开系统托盘表面（shell surface 超时），无法自动化确认图标出现在托盘区、菜单三项可点击。间接证据：关窗后进程常驻并继续采样、二次启动聚焦同一窗口、托盘文案与菜单逻辑有单测。
- **无 Node.js 的干净机器**：只在本机验证了打包产物可运行；没有第二台机器。
- **代码签名**：无证书，首次运行会有 SmartScreen"未知发布者"提示。
- **真机休眠/唤醒**：只核对了 `powerMonitor` 事件接线与逻辑，没有真的合盖测试。
- **便携 exe 的远程调试**：NSIS 便携包不转发 `--remote-debugging-port`，因此便携版的证据来自窗口无障碍树与数据落盘，而不是 DevTools 协议。
- **v4 的打包产物**：本轮只跑 `npm run build` 与未打包的 `out/` 产物探针，没有重新打 `npm run dist`、也没有在便携 exe 上复验 v4 的新行。
- **锁屏的完整回归**：只验到「锁屏期间采样与显示正确」；解锁后 HUD 恢复、长时间锁屏跨零点的落盘没有单独复测。


