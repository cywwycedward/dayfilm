# 界面实现状态（df-ui）

任务来源：[brief-ui.md](brief-ui.md)。本文件记录文件清单、视觉与交互决策、验证结果和遗留事项。

## 1. 交付范围

| 文件 | 作用 |
| --- | --- |
| `src/renderer/index.html` | 静态骨架（顶栏、正在拍摄、胶片、回放条、汇总、镜头列表）+ CSP `color-scheme`；产品名是 `h1`，正在拍摄条带 `data-live` |
| `src/renderer/src/main.ts` | 引入样式、启动 `boot()` |
| `src/renderer/src/style.css` | 设计变量（颜色/间距/字体/缓动）与全部版式、状态、响应式、`prefers-reduced-motion` |
| `src/renderer/src/app.ts` | 状态、渲染、回放、选择、检索、导出、键盘与指针交互 |
| `src/renderer/src/paint.ts` | Canvas：程序化剧照、胶片、中场休息斜纹、无素材点阵、未来区、缩略图缓存、画布 DPR 缩放 |
| `src/renderer/src/data.ts` | `DayfilmSource` 抽象：`window.dayfilm` 存在时走 IPC，否则走 mock；剧本 Markdown 生成 |
| `src/renderer/src/mock.ts` | 确定性 mock：按 `(date, nowMs)` 生成一整天的镜头、中场休息、汇总、题材 |
| `src/renderer/src/lib/hash.ts` | FNV-1a 哈希、`unitAt` 派生、mulberry32 |
| `src/renderer/src/lib/time.ts` | 零点/日期字符串、时间轴比例、`HH:MM`、时长与计时器格式化 |
| `src/renderer/src/lib/still.ts` | 剧照参数（进程族色带、色相、几何形状、角度、重复次数） |
| `src/renderer/src/lib/reel.ts` | 胶片布局 `layoutReel`、命中判定 `sceneAt` |
| `tests/renderer/hash.test.ts` | 9 个用例 |
| `tests/renderer/time.test.ts` | 12 个用例 |
| `tests/renderer/reel.test.ts` | 9 个用例 |
| `tests/renderer/still.test.ts` | 6 个用例 |
| `tests/renderer/mock.test.ts` | 14 个用例 |

只改动了 `src/renderer/**`、`tests/renderer/**` 和本文件。未新增依赖，未引入框架，未联网，未改动 `src/main/**`、`src/shared/**`、`package.json`、构建配置与其他文档。构建与自查过程产生的 `out/**`、`node_modules/.vite/**` 是工具产物，未手工编辑。

## 2. 数据与契约

- 只有 `src/renderer/src/data.ts` 接触数据来源：`window.dayfilm` 存在时逐通道透传
  `listDays / getDay / live / search / exportScreenplay / onTick`，不存在时用 mock 提供同一接口。
- 回退条件是运行时判断（`window.dayfilm` 为 `undefined`），类型来自 `src/shared/ipc.ts`，没有改动契约。
- mock 用 `hashString('mock|' + date)` 播种 mulberry32：同一 `(date, nowMs)` 生成同一份胶片，`nowMs`
  前进只会延长影片，不会重写已有镜头。mock 提供今天与前三天，供日期切换与跨日检索演练。
- `?mock=error` 查询参数让 mock 返回 `captureError`，用于自查采集错误横幅（见 §6 第 6 条）。

## 3. 视觉决策

- **影院而非仪表盘**：近黑底（`#06070a`）+ 极轻的顶部暖光径向渐变，暖灯色 `#f0c480` 只用在"正在拍/选中/播放"
  这些需要被注意的地方。中性灰承载正文，避免彩色面板堆叠。
- **进程族色带**：`exeBand(exe)` 把 exe 哈希到 12 个 30° 色相带，色相在带内再抖动 ±5°，因此同类进程成组、
  组间可辨；饱和度和亮度压得很低（`38% / 33% → 28% / 12%`），保证 132px 高的条带里仍像"剧照"而非色卡。
- **剧照几何**：`hash(exe + '|' + title)` 决定渐变角度、辅助色相、漏光位置和四种几何之一
  （斜线 / 同心圆 / 竖条 / 画框 + 对角），底部再压一层暗角；同一镜头在胶片、缩略图、放大帧里完全一致。
- **中场休息与空隙是两种东西**：中场休息画成中性斜纹块（可点击、进列表）；采样未运行的空隙直接留黑。
  第一版斜纹用暖色低透明度，实测几乎看不见，改为 `#12151b` 底 + 9% 亮线。
- **没拍到的时段有两种底纹**（联调后补）：首个镜头之前的空胶片是 `2×1px`、`15×11px` 步进、8% 亮度的短横点阵，
  读得出是"还没有素材"而不是渲染失败；今天"现在"之后改用更暗的底（`#040508`）+ 每小时一条 4.5% 竖线，
  两种处理在同一行里一眼可分。历史日最后一个镜头之后回到点阵（同样是"没有采样"）。
- **字体**：CSP 为 `default-src 'self'` 且不能联网，没有自托管字体可用，所以显示字用 Windows 自带的
  Bahnschrift，正文用 Segoe UI，时刻/时长用 Cascadia Mono + `tabular-nums`（数字是数据，不是装饰）。
- **版式密度按窗口实测调过**：1440×900 的窗口实际可用高度 808px，第一版留给镜头列表 142px（约 3 行）。
  收紧分区间距（14→10px）、胶片段高度（132→96px @ ≤840px）、汇总行距后，列表得到 226px（约 5 行）。
- **浏览器自带表面**：选区、滚动条、焦点环都按调色板上色；导出提示改成固定右下角的 toast，避免导出时布局跳动。
- 动效统一 160–200ms，`prefers-reduced-motion` 下全部关掉；焦点环 2px 暖灯色 + 2px 偏移。

## 4. 交互决策

- **回放**：播放键在"停在现在"时没有前方空间，会先回到 00:00 再播（第一版实测"按播放没反应"，即由此修复）；
  播到当日终点自动暂停，不循环。倍速 60x/600x/3600x 用 `aria-pressed` 表达选中。进度用 0–1439 的 range 拖拽。
- **回放时的绘制开销**：胶片 canvas 只在数据/尺寸/选中变化时重画（并对 `镜头数/firstAt/lastAt/选中/尺寸` 做键去重，
  空闲时的 2 秒 tick 不会重绘），放大帧与缩略图是缓存的 `data:` 位图，回放指针和"现在"标记是 DOM `transform`。
  因此每帧只有 1–2 次 `translate3d` 写入和（镜头变化时的）文本更新，canvas 零重绘，也没有每帧布局读取
  （`ResizeObserver` + `pointerenter` 时缓存一次 `getBoundingClientRect`）。
  这比"每帧重绘 canvas 的一小块"开销更小，也是"当下指示器沿胶片推进"的实现方式。
- **指针落在没有镜头的时间**：放大帧显示"空档 / 没有采样 · 下一个镜头 09:14"，不再冒充上一个镜头，
  也不冒充"空白的一天"（那是零镜头日的文案）。文案用"没有采样"而不是"摄影机未运行"，因为主进程会把
  Dayfilm 自身窗口的采样从胶片里剔除（R1.3），空隙也可能只是"你在看 Dayfilm"。
- **选中**：点击胶片或列表行都会选中并把指针移到该镜头起点；胶片用 2px 暖色环标记，列表行同时高亮。
- **键盘**：胶片本身可聚焦；`←/→` 逐个镜头移动，`Home/End` 首尾，`Enter` 打开详情（把焦点送到列表里那一行，
  详情信息就在行内），`空格` 播放/暂停；选中内容通过 `aria-live` 播报。
- **悬停**：提示框显示标题、起止时间、时长，x 位置按指针夹取到轨道内，避免贴边被裁。
- **检索**：输入 160ms 防抖，空查询直接回到当日列表；结果按时间倒序、最多 200 条，跳日期时行首补 `MM-DD`；
  点击结果会定位到胶片（必要时切换日期），并保留结果列表不打断检索；手动切换日期会退出检索，回到那一天的镜头列表。
- **列表**：当日列表按时间正序，中场休息也是可选中行（图位改为斜纹、标题用"离开键盘"），标题右侧统计写成
  "4 段中场休息 · 29 个镜头"，与汇总面板的"镜头"计数口径一致。
- **不允许任何横向滚动**：`overflow-y: auto` 会把 `overflow-x` 带成 `auto`，任何一次多出的横向内容都会在窗口
  底部留下一条横向滚动条；列表显式改为 `overflow-x: hidden`，文档根也不再横向滚动，时刻列用
  `minmax(112px, max-content)` 保证跨日时间戳不被截断。
- **时长口径**：`fmtMinutes` 与主进程 `renderScreenplay` 的 `span()` 同口径——`ms > 0` 时
  `max(1, round(ms / 60000))`，避免"活跃时长 0 分"旁边写着"镜头 1"；进程排行行用同一个函数。
- **空状态与错误**：零镜头日显示"还没有拍摄任何素材"；`captureError` 非空时顶栏 chip 变红为"采集中断"，
  并在顶栏下方展开 `role="alert"` 横幅，已有胶片照常展示。

## 5. 验证结果

### 5.1 项目自检（全部通过）

```powershell
PS> npm run typecheck
> dayfilm@0.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npm test
> dayfilm@0.1.0 test
> vitest run
 ✓ tests/renderer/time.test.ts (12 tests) 8ms
 ✓ tests/renderer/hash.test.ts (9 tests) 9ms
 ✓ tests/renderer/still.test.ts (6 tests) 10ms
 ✓ tests/renderer/reel.test.ts (9 tests) 9ms
 ✓ tests/renderer/mock.test.ts (14 tests) 13ms
 ✓ tests/main/capture.test.ts (15 tests) 15ms
 ✓ tests/main/reel.test.ts (24 tests) 26ms
 ✓ tests/main/store.test.ts (8 tests) 64ms
 Test Files  8 passed (8)
      Tests  97 passed (97)
   Duration  1.59s

PS> npm run build
> dayfilm@0.1.0 build
> electron-vite build
out/main/index.js   18.33 kB   ✓ built in 114ms
out/preload/index.js 0.86 kB   ✓ built in 16ms
out/renderer/index.html                4.59 kB
out/renderer/assets/index-D3heVhbd.css 16.82 kB
out/renderer/assets/index-DuEk9Hw-.js  38.16 kB   ✓ built in 106ms
```

交付前 `npm test` 原本因"没有任何测试文件"以退出码 1 失败（`No test files found`），现在有 8 个测试文件、
97 个用例（其中界面侧 50 个）。

测试覆盖的就是 brief 要求的纯函数面：哈希与派生的稳定性、时间轴比例（00:00→0、24:00→宽度、12:00→0.5）、
非法时间戳与空数据不产生 NaN、时长/计时器格式化、mock 的确定性、镜头升序不重叠、汇总与镜头集合自洽、
题材与剪辑密度一致、零镜头日无 NaN。

### 5.2 真实渲染与交互核对

用 `npx vite src/renderer --port 5175`（自查完已停止，未占用 5174，未运行 `npm run dev`）起页面，
再用 headless Edge 通过 DevTools Protocol 跑真实点击与键盘事件。实测输出（原文）：

```text
=== boot + live state
{"live":"正在拍摄：Explorer · dayfilm","chip":"ok","rows":33,"metrics":5,"time":"19:21 / 24:00"}
=== playback: rewind to 00:00 and advance at 600x
{"t0":"19:21 / 24:00","mid":"暂停","t1":"00:12 / 24:00","after":"播放"}
=== speed button switches to 3600x
{"pressed":"true","active":1}
=== keyboard arrows move selection
{"before":null,"after":"2026-11-22-2","frame":"Canvas API — MDN Web Docs","marker":"translate3d(540.754px, 0px, 0px)"}
=== Enter opens detail row
{"tag":"BUTTON","cls":"shot is-active","id":"2026-11-22-2","live":"镜头详情：09:29–09:40，chrome，Canvas API — MDN Web Docs，10 分 54 秒"}
=== list row click locates on reel
{"clicked":"2026-11-22-6","active":"2026-11-22-6","time":"10:45 / 24:00","frame":"style.css - dayfilm - Visual Studio Code"}
=== hover tooltip (title/range/duration)
{"hidden":false,"title":"中场休息","meta":"09:49–10:21 · 31 分 47 秒"}
=== search switches to result list
{"title":"检索结果","count":13,"firstClock":"17:30–17:40"}
=== search result click locates on reel
{"clicked":"2026-11-22-27","active":"2026-11-22-27","marker":"translate3d(998.3px, 0px, 0px)","time":"17:30 / 24:00"}
=== gap state before first shot
{"time":"00:30 / 24:00","frame":"空档","sub":"没有采样 · 下一个镜头 09:14","kind":"empty"}
=== scrub to 12:00
{"time":"12:00 / 24:00","frame":"Downloads"}
=== export screenplay
{"notice":"剧本已导出：dayfilm-2026-11-22.md（演示环境：浏览器下载）","open":"true","disabled":false}
=== focus ring on reel
{"focused":"track","outline":"3px solid"}
=== capture error banner (?mock=error)
{"bannerHidden":false,"banner":"采样子进程已退出（代码 1），30 秒后重试","chip":"error","chipText":"采集中断","live":"正在拍摄：Explorer · dayfilm"}
```

布局几何用同一通道量过（1440×900 窗口，可用高度 808px）：`topbar 51 / live 35 / reel 148 / transport 71 /
summary 160 / 镜头列表 254`，列表可视高度 226px、32 行共 1598px 可滚动；此前为 142px，是第 3 节所述密度调整的依据。

截图（临时目录，未入库）：`%TEMP%\dayfilm-ui6.png`（1440×900 整屏，可看空胶片点阵与未来区竖线）、
`%TEMP%\dayfilm-tooltip.png`（中场休息悬停 + 选中环）、`%TEMP%\dayfilm-state.png`（跨日检索 + 选中行）、
`%TEMP%\dayfilm-void-zoom3.png`（空胶片底纹 2× 放大）。

### 5.2.1 联调复查（四处反馈的实测）

主 Agent 的四处反馈改完后的实测输出（原文，1440×900 与 1264×755 用 CDP `Emulation.setDeviceMetricsOverride` 锁定）：

```text
=== supervisor probe shape (h1 / data-live)
{"h1":"DAYFILM","live":"正在拍摄：Explorer · dayfilm","api":"undefined","sceneRows":33}
=== 1440x900 overflow
{"innerWidth":1440,"innerHeight":900,"docSW":1440,"docCW":1440,"bodySW":1440,"listOverflowX":"hidden","listSW":1382,"listCW":1382,"horizontalScrollers":[]}
=== 1264x755 overflow
{"innerWidth":1264,"innerHeight":755,"docSW":1264,"docCW":1264,"listSW":1206,"listCW":1206}
=== long capture error banner (measured synchronously, wrapping not clipping)
{"bannerHeight":60,"bannerScrollWidth":1390,"bannerClientWidth":1390,"approxLines":3,"docSW":1440,"textClips":false}
=== gap copy before first shot / after last shot
{"beforeFirstShot":"空档 / 没有采样 · 下一个镜头 09:14","afterLastShot":"空档 / 这一天的胶片到此结束"}
=== minute formatting on the summary/ranking (min 1 minute rule)
{"metrics":["活跃时长=6 小时 40 分","空闲时长=1 小时","镜头=29","剪辑=24","最长镜头=26 分 27 秒"],"ranking":["Code=1 小时 25 分","WeChat=59 分","Explorer=55 分","Slack=44 分","Figma=43 分"]}
```

关于横向滚动条的复现结论：在 1440×900 与 1264×755 下遍历 `#app` 全部元素，`document.scrollWidth === clientWidth`、
`#app` 与 `#list` 的 `scrollWidth === clientWidth`，即使注入 200 字的无空格标题、超长进程名、几百字的采集错误路径，
也没能造出横向溢出（`horizontalScrollers` 始终为空）。唯一能产生"窗口底部一条横向滚动条"的结构是列表本身：
`overflow-y: auto` 会把 `overflow-x` 隐式带成 `auto`（实测计算值原本就是 `auto`）。已按此修掉——列表显式
`overflow-x: hidden`、文档根 `overflow-x: hidden`、时刻列改为 `minmax(112px, max-content)` 不再撑开行。

### 5.3 交付过程中实际修掉的问题

1. 停在"现在"时按播放没有任何推进（没有前方空间），改成先回到 00:00 再播。
2. 指针落在空隙时放大帧错误显示"还没有拍摄任何素材"，改为"空档 / 下一个镜头 …"。
3. 剧照在 132px 高度下读不出颜色块，中场上斜纹几乎不可见：上调底色亮度、减弱底部压暗、重做斜纹。
4. 汇总面板过高导致列表只剩 3 行：收紧分区间距、胶片段高度与汇总行距。
5. 片中"现在"标签被父级 0 宽容器挤成竖排：加 `white-space: nowrap` 与贴边翻转，加底色保证在剧照上可读。
6. 中场休息被选中时无障碍播报出现空进程名（"，，中场休息"）：抽出 `announceScene` 统一拼装。
7. 导出 toast 会挤动整屏布局：改为固定右下角浮层。

### 5.4 联调复查后修掉的四处

1. **汇总时长 0 分**：真实数据里 4 秒活跃时长显示成"活跃时长 0 分"，旁边又写着"镜头 1"。`fmtMinutes` 改为与
   主进程 `renderScreenplay` 的 `span()` 同口径（`ms > 0` 时 `max(1, round(ms/60000))`），排行行同一函数，
   新增一条测试固定边界（1ms / 4s / 29s / 30s / 89s / 90s / 59 分 / 60 分）。
2. **空档文案**："摄影机未运行"不准确（R1.3 会把 Dayfilm 自身窗口的采样剔除，空隙可能只是你在看 Dayfilm），
   改为"没有采样 · 下一个镜头 09:14"。
3. **胶片空白区**：首个镜头前与历史日末尾补 8% 亮度的短横点阵，今天"现在"之后改用更暗的底 + 每小时竖线，
   两种处理互不混淆；空胶片不再像渲染失败。
4. **横向滚动条**：见 §5.2.1 的复现结论与修法；另外把长采集错误路径、长导出路径改成 `overflow-wrap: anywhere`，
   不让长路径撑破横幅或提示条。

## 6. 未完成项与需要主 Agent 处理的事项

1. **联调状态**：主 Agent 已在真实 Electron + IPC 下验收通过（`getDay / listDays / live / search / export` 六个通道
   都可用，真实采样已进胶片）。本次四处修复仍只在浏览器侧的 mock 数据下自测（未运行 `npm run dev`），
   若想把修复也过一遍真实窗口，建议再跑一次 `node scripts/probe-app.mjs`。
   顺带把监督工具依赖的 DOM 钩子补齐了：产品名现在是 `h1`，正在拍摄条带 `data-live`（`scripts/probe-app.mjs`
   的 `h1` / `[data-live]` 不再返回 null）。
2. **导出路径**：mock 模式用浏览器下载（`Blob` + `<a download>`），真实模式展示主进程返回的 `path`。
   若主进程改成让用户选路径，界面文案无需改动；若返回结构与 `ScreenplayExport` 不同需要告知我。
3. **字体**：没有自托管显示字体（CSP + 不能联网），显示字依赖 Windows 的 Bahnschrift。要更强的自有视觉
   需要字体资源文件，超出我的可写范围，需要主 Agent 决定是否加入 `src/renderer` 之外的资源目录。
4. **浅色模式**未实现（规格为可选）。
5. **长列表**未做虚拟滚动：当日镜头很多时列表一次渲染全部行（缩略图按 `exe|title` 复用位图，最多缓存 512 条）。
   搜索侧已有 200 条上限。若单日常见 500+ 镜头，建议改为虚拟滚动。
6. **`?mock=error`** 是留在 `src/renderer/src/data.ts` 的自查入口，用来预览采集错误横幅；不想在产品里保留可删除，
   不影响其他逻辑。
7. **题材口径与文案**：mock 里的题材分支（长镜头/标准剪辑/快切/跳切风暴）按 R6 的密度阈值实现，只用于 mock；
   真实数据以主进程返回的 `verdict` 为准，界面只做展示（不重算），若主进程文案口径不同也无需改界面。
8. **回放边界**：今天只播到"现在"，历史日播到最后一个镜头；不循环、不跨日连播。若产品要求跨日连播需要新需求。
