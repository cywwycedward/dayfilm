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
node scripts/probe-packaged.mjs dist\win-unpacked\Dayfilm.exe
node scripts/pack/verify.cjs dist\win-unpacked
```

## 未验证项与限制

- **托盘图标与菜单的可见性**：`agent-desktop` 在本机无法打开系统托盘表面（shell surface 超时），无法自动化确认图标出现在托盘区、菜单三项可点击。间接证据：关窗后进程常驻并继续采样、二次启动聚焦同一窗口、托盘文案与菜单逻辑有单测。
- **无 Node.js 的干净机器**：只在本机验证了打包产物可运行；没有第二台机器。
- **代码签名**：无证书，首次运行会有 SmartScreen"未知发布者"提示。
- **真机休眠/唤醒**：只核对了 `powerMonitor` 事件接线与逻辑，没有真的合盖测试。
- **便携 exe 的远程调试**：NSIS 便携包不转发 `--remote-debugging-port`，因此便携版的证据来自窗口无障碍树与数据落盘，而不是 DevTools 协议。
