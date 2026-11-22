# v1.1 界面状态（df-ui3）

任务来源：[brief-ui3.md](brief-ui3.md)，权威要求见 [dayfilm-v1.1.md](../specs/dayfilm-v1.1.md)（R20–R26）。
本轮把 v1.1 的新玩法做出来：时间轴缩放与周视图、项目标签、导演手记、海报导出、高光。

## 1. 交付范围

**新增（纯函数 + 测试）**

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/lib/zoom.ts` | 视窗 `{ startMs, spanMs }`、缩放锚点、平移夹紧、刻度步长与本地对齐、可见区间、视窗内布局、`ensureVisible` |
| `src/renderer/src/lib/week.ts` | `dayBuckets`（24 桶、对数亮度）、`buildWeek`、`lastSevenDates` |
| `src/renderer/src/lib/highlights.ts` | `pickHighlights`：最长镜头、最密 30 分钟、时长第一的进程 |
| `src/renderer/src/lib/poster.ts` | 1600×1000 海报布局（矩形、文字行、缩略胶片段、横条）、`wrapText` |
| `tests/renderer/zoom.test.ts` | 22 例 |
| `tests/renderer/week.test.ts` | 10 例 |
| `tests/renderer/highlights.test.ts` | 9 例 |
| `tests/renderer/poster.test.ts` | 11 例 |

**改动**

| 文件 | 改动 |
| --- | --- |
| `src/renderer/index.html` | 顶栏 `导出海报`；胶片头加缩放工具栏；胶片上方加 7 格周视图；题材下加手记；汇总加项目分区；列表上方加高光行；设置面板加「项目」分区 |
| `src/renderer/src/app.ts` | 视窗状态与滚轮/拖动/工具栏、周视图渲染与切日、项目规则、手记自动保存、海报导出、高光卡片与定位 |
| `src/renderer/src/paint.ts` | 周视图柱状迷你条、海报绘制（文字/横条/缩略胶片） |
| `src/renderer/src/lib/reel.ts` | 全天布局改为委托 `zoom.layoutInView`，保留 `layoutReel` 与 `sceneAt` |
| `src/renderer/src/data.ts` | `getNote / setNote / saveImage` 三个通道（live 缺通道时报可读错误，mock 存内存 / 浏览器下载）；mock 默认两条项目规则 |
| `src/renderer/src/mock.ts` | `mockDates` 扩到 7 天（周视图要 7 格） |
| `src/renderer/src/style.css` | 周视图、缩放工具、手记、高光、项目卡片与标签；汇总的进程/项目两组横条并排，给新增区块腾高度 |

未改动 `src/main/**`、`src/preload/**`、`src/shared/**`、`package.json`、打包配置与其他文档。

## 2. 时间轴缩放与平移（R20）

- **视窗模型**：`state.view = { startMs, spanMs }`，跨度夹在 30 分钟–24 小时（1x–48x）。日期切换或点「回到全天」重置为 `fullDay(dayStart)`。
- **缩放入口**：胶片上滚轮（`preventDefault`）、工具栏 `−` / `+`（1.6 倍档）、级别文字 `1x…48x`、`回到全天`。滚轮以指针位置为锚点：`zoomAt` 保持锚点在视窗里的相对位置不变；`开始/结束` 两端的夹紧由 `clampView` 负责，贴边缩放时锚点仍在视窗内。
- **平移**：指针按下 → 移动超过 3px 才算拖动（`pointercapture`），否则抬手时按点击处理（点中镜头选中、点空白处 seek）。光标通过 `data-dragging` 切成抓手。拖动时隐藏悬停提示。
- **刻度自适应**：`tickStepMs` 按可见跨度取 6 小时 / 1 小时 / 15 分钟 / 5 分钟；刻度对齐到**本地时间轴**（不是 epoch 整倍数，否则中国时区会得到 02:00/08:00 这种刻度）；一天最后一个刻度写成 `24:00`。
- **选中与"现在"**：选中镜头后 `ensureVisible` 把镜头（必要时还包括它自己的时长）挪进视窗；"现在"标记和播放头在视窗之外时隐藏，不会在边缘假报位置。滚轮/平移本身不强制锁住这两个指针（用户主动拖走时允许），但缩放锚点与选中定位都能把它们带回来。
- **点击/键盘/播放头一致**：`timeAtClientX` 把指针换算成视窗里的时刻，点击、悬停提示、seek 都走这一条；键盘 `←/→/Home/End` 仍是按镜头选中，`空格` 播放不变。

## 3. 周视图（R21）

- 胶片上方 7 格，每格是一个真实的 `<button>`（`aria-pressed`、`aria-label="11月16日 周一，有记录"`），里面一张 192×44 的 canvas 画 24 个小时柱。
- 分桶：镜头按小时切片累加毫秒，亮度 `min(1, log1p(分钟)/log1p(30))`——半小时打满，空小时只留 3px 暗基线。没有数据的天是暗格。
- 高亮：选中天用暖色描边 + 标签变暖色，今天多一圈稍亮的边。
- 数据：`lastSevenDates(today)` + 并行 `getDay`，`listDays` 里没有的日期直接给 `null`（不请求），单天失败 `catch → null` 不影响其他格；今天优先用 `live.day`，跟着 tick 重画。
- 点击即切日（`selectDay`：退出检索、列表回顶、重置视窗、载入手记）。

## 4. 项目标签（R22）

- **设置面板**：已有项目是卡片（名称 + 关键词以「、」连接 + 删除），下方一行表单（项目名 / 关键词，逗号分隔，中英文逗号都认）。新增与删除都走 `setSettings({ projects })`，失败照旧回滚并报错。
- **匹配**：直接用 `src/shared/projects.ts` 的 `matchProject` / `totalByProject`，没有第二套口径。
- **汇总**：进程排行右侧并排「项目」分区，按命中时长倒序前 5；没有规则时显示「在设置里加一条项目规则，把镜头归到故事线上」，有规则但今天没命中时显示「今天没有镜头命中项目规则」。
- **列表**：进程名后面跟一个项目小标签（有命中才有），标签不参与省略，标题自己截断。
- **启动即可见**：`boot` 时就把设置读回来（之前只在打开面板时读，导致项目标签要开关一次面板才出现），读回后重算汇总与列表。

## 5. 导演手记（R23）

- 题材下方 2 行 textarea，`maxlength=200`，占位「写一句今天的评语…」，右上角字数 `N/200`，右下角状态（`保存中… / 已保存 / 保存失败：…`）。
- 停止输入 600ms 后 `setNote(date, text)`；服务端可能截断，界面用返回值覆盖自己；切换日期会清掉待保存的定时器再载入新一天，不会把 A 天的手记写到 B 天。保存失败时保留编辑内容并显示可读错误。
- mock 模式存在内存 Map 里，行为一致（切换日期能读回）。

## 6. 海报导出（R24）

- 顶栏「导出海报」→ 离屏 canvas 1600×1000 → `toDataURL('image/png')` 去掉前缀 → `saveImage('dayfilm-<date>.png', base64)`。
- 布局全在 `lib/poster.ts`（纯函数）：日期与星期、题材（88px）、点评、活跃/镜头/剪辑三项数字、胶片缩略（按 00:00–24:00 铺开，镜头超过 200 个时等间隔抽样）、进程前 4 与项目前 3 两组横条、最长镜头、手记（最多 3 行，`wrapText` 按估算宽度断行）、`DAYFILM` 角标。绘制函数只做 ctx 调用。
- 返回空路径 → 「已取消导出海报」；异常 → 「海报导出失败：…」；当天没有镜头 → 「当天还没有素材，无法导出海报」（不出海报）。

## 7. 高光（R25）

- 列表上方一行三张卡片：最长镜头（可点，点击后选中并把列表滚到那一行）、最密 30 分钟（窗口内剪辑次数 + 区间）、时长第一的进程。
- 窗口算法：以每个镜头起点作为 30 分钟窗口左端，数窗口内镜头起点个数，取最多的一段（并列取最早），`cuts = 镜头数 - 1`；正好落在窗口右端的镜头不算。
- 当天没有镜头时整块 `hidden` 并清空。

## 8. 视觉与版式决策

- **周视图**是"胶片上方的一张表格"：7 个等宽格子、每格 24 根柱，亮度即活跃度；不加图例文字，靠标题行「最近 7 天 · 点周格切日」的提示文字交代（占一行会挤掉列表）。
- **缩放工具**放在胶片标题行右侧，和「今日胶片」同一水平线：`− 12x + 回到全天`，级别数字用等宽字体，避免跳动。
- **汇总改两列**：进程排行与项目排行并排（各占一半宽），metrics 横跨两列。这样新的项目分区不额外占高度。
- **为腾出高度做过的压缩**（900px 窗口仍然要一屏）：≤840px 时胶片轨道 96→84px、回放帧 108×60→96×54、周格 34→38px（给标签留一行）、手记 42→38px、高光 46→44px。实测 1440×900 下镜头列表仍有 3 行可见且可滚动。
- **手记**用 textarea 而不是 input：一句评语经常到两行，`resize: none` + 固定高度避免把版面撑开。
- 新颜色没有引入：周视图柱、项目标签、高光数字全部复用 `--lamp`（暖灯）与既有中性灰，热区仍然是"正在拍/选中/播放"。

## 9. 验证结果

### 9.1 自检命令（brief 指定的三条，全部通过）

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 ✓ tests/renderer/date-follow.test.ts (7 tests) 6ms
 ✓ tests/renderer/highlights.test.ts (9 tests) 7ms
 ✓ tests/renderer/hash.test.ts (9 tests) 10ms
 ✓ tests/renderer/window.test.ts (16 tests) 8ms
 ✓ tests/renderer/time.test.ts (12 tests) 8ms
 ✓ tests/renderer/still.test.ts (6 tests) 9ms
 ✓ tests/renderer/reel.test.ts (9 tests) 8ms
 ✓ tests/renderer/week.test.ts (10 tests) 10ms
 ✓ tests/renderer/zoom.test.ts (22 tests) 12ms
 ✓ tests/renderer/poster.test.ts (11 tests) 12ms
 ✓ tests/renderer/mock.test.ts (17 tests) 40ms
 Test Files  11 passed (11)
      Tests  128 passed (128)
   Duration  1.82s

PS> npm run build
out/main/index.js   53.27 kB   ✓ built in 209ms
out/preload/index.js 1.52 kB   ✓ built in 11ms
out/renderer/index.html                8.81 kB
out/renderer/assets/index-HXC7viC6.css 25.91 kB
out/renderer/assets/index-BzJcrN1z.js  81.09 kB   ✓ built in 142ms
```

既有 76 例全部保留通过，本轮新增 52 例（zoom 22 / week 10 / highlights 9 / poster 11），合计 128 例。

### 9.2 真实渲染与交互核对（headless Edge + DevTools Protocol，1440×900）

用 `npx vite src/renderer --port 5176` 起页面（自查完已停止，未跑 `npm run dev`）。实测原文：

```text
=== boot: zoom/week/highlights/projects/note
{"zoom":"1x","weekCells":7,"weekCanvases":7,"weekLabels":["11月16日 周一","11月17日 周二","11月18日 周三","11月19日 周四","11月20日 周五","11月21日 周六","11月22日 周日"],"highlights":3,"highlightLabels":["最长镜头","最密 30 分钟","时长第一的进程"],"notePlaceholder":"写一句今天的评语…","noteCount":"0/200","rulerTicks":["00:00","06:00","12:00","18:00","24:00"]}
{"projectRows":["Dayfilm","阅读"],"projectTags":["Dayfilm","阅读","Dayfilm","Dayfilm"]}   ← 设置读回后项目分区与列表标签立刻有内容

=== wheel zoom at 60% keeps anchor
{"zoom":"2x","ticks":["12:00","18:00"],"tickCount":2,"resetDisabled":false}
=== zoom in 6 more notches, ruler adapts
{"zoom":"48x","ticks":["12:55","13:00","13:05","13:10","13:15","13:20"]}   ← 48x 时 5 分钟一刻
=== select last scene while zoomed: selection stays visible
{"zoom":"48x","playheadHidden":false,"playheadX":378,"trackWidth":1392,"time":"20:45 / 24:00"}
=== drag to pan
{"dragging":null,"firstTickBefore":"20:40","firstTickAfter":"20:45"}
=== back to full day
{"zoom":"1x","ticks":["00:00","06:00","12:00","18:00","24:00"],"resetDisabled":true}

=== week click switches date
{"clicked":"2026-11-20","dateValue":"2026-11-20","selected":1,"selectedDate":"2026-11-20","reelTitle":"当日胶片"}

=== settings shows project rules from mock
{"cards":["Dayfilm","阅读"],"terms":["dayfilm、visual studio code","mdn、github、文档"]}
=== add + remove a project
{"afterAdd":["Dayfilm","阅读","Writing"],"totalsAfterAdd":["Dayfilm","Writing"],"afterRemove":["Dayfilm","阅读"],"status":"已保存"}

=== note: type, autosave, counter
{"count":"32/200","status":"已保存","kind":"saved","len":32}
=== note per date: switch away and back
{"date":"2026-11-18","note":"","count":"0/200"}
{"date":"2026-11-22","note":"v1.1 shipped: zoom and week view","count":"32/200"}

=== highlight click selects and reveals the row
{"active":"2026-11-20-3","activeClock":"09:39–10:06","time":"09:39 / 24:00","frame":"#design — Dayfilm"}

=== export poster (mock saveImage)
{"notice":"海报已导出：dayfilm-2026-11-20.png（演示环境：浏览器下载）","downloads":1,"blobBytes":[1025777]}
```

海报那张 PNG 实测 1,025,777 字节（`URL.createObjectURL` 拦到的 blob 大小），说明 1600×1000 的绘制与编码真的产出了内容，不是空图。

截图（临时目录）：`%TEMP%\dayfilm4-main.png`（1440×900 整屏：周视图、缩放工具、手记、项目/高光、列表标签）、
`%TEMP%\dayfilm4-week-zoom2.png`（周视图 2× 放大，看 24 根柱与日期标签）。

### 9.3 过程中修掉的问题

1. 刻度按 epoch 整倍数对齐，在中国时区得到 02:00/08:00/14:00/20:00；改成从**本地零点**按步长对齐。
2. 一天最后一个刻度显示成下一天的 00:00；改为 `24:00`。
3. 项目规则只在打开设置面板时才读取，导致列表标签和项目分区一开始是空的；`boot` 时读取，并在读回后重算汇总与列表。
4. 高光卡片点击后只选中不滚动列表（虚拟列表下选中行可能不在窗口里）；补 `revealRow(center)`。
5. 周视图日期标签被 canvas 挤掉半行；canvas 改 `flex: 1`、格子加高到 38px（≤840px 时 36px）。

## 10. 未完成项与需要主 Agent 处理的事项

1. **`getNote / setNote / saveImage` 的真实 IPC 没联调**（本轮按要求只跑浏览器 + mock）。构建里 `out/preload/index.js` 已从 1.16 kB 涨到 1.52 kB，说明 preload 已补上这三个通道；界面侧对"通道缺失"有可读错误兜底。建议 `node scripts/probe-app.mjs` 时写一条手记、导一张海报确认真机路径。
2. **海报只有导出，没有预览**：R24 没有要求预览，所以按"点了就出文件"实现；如果之后想要预览面板，`computePoster` + `paintPoster` 可以直接复用。
3. **播放时视窗不跟随播放头**：48x 下播放几秒指针就会走出视窗（指针隐藏，播放继续）。要"跟随播放头"需要再加一条自动平移策略，这属于新需求。
4. **周视图只显示最近 7 天**（R21.1 的字面要求），没有"往前翻一周"的能力；需要的话要扩 `lastSevenDates` 的入参。
5. **最密 30 分钟的算法用镜头起点**（等价于数窗口内的剪辑次数），不按秒级滑窗重算；对 2 秒采样的数据两者结果一致。
6. **`?mock=burst|readonly|storage|error` 仍是自查钩子**；mock 的项目规则换成真实数据后会被设置里的规则覆盖（不再出现示例规则）。
7. **海报缩略在超长日抽样**：镜头超过 200 个时等间隔取样，避免一次画上千段；短片段的宽度最小 2px，仍是近似。

## 11. 验收复查修复（`scripts/probe-v11.mjs` 的四处发现）

主 Agent 在构建产物上用 `scripts/probe-v11.mjs` 实测到四个问题，本轮逐条修完。
文件仍限于 `src/renderer/**`、`tests/renderer/**` 与本文件。

### 11.1 点“没有数据的天”把日期下拉打成空值

- **原因**：`loadDate` 先 `ui.date.value = date`，而此时下拉选项还没包含这一天（`renderDates` 只在启动、跨零点与改保留期时跑）→ `<select>` 找不到匹配 option，值变 `""`。
- **修法**：`loadDate` 里先 `renderDates()`（它的选项集合永远是 `state.dates ∪ { 当前日期 }`），再由它设置 `ui.date.value`；顺手把空状态文案拆开：今天没素材仍是“还没有拍摄任何素材”，历史某天没采样显示“这一天没有采样”（列表空状态、放大帧、题材点评三处）。

### 11.2 周视图选中天没有高亮

- **原因**：选中态只写了 `is-selected` 类，验收脚本查的是 `.is-active` 与 `[aria-current]`，而且描边用的是 `--lamp-dim`（偏暗）。
- **修法**：选中格同时带 `is-active` + `is-selected` + `aria-current="date"`（`aria-pressed` 保留），描边改成 `--lamp`、底色 `--ink-2`、日期文字转暖色；今天（未选中时）只用 `--line-strong`，两者可区分。

### 11.3 高光区看不到卡片

- **复现**：用 `?mock=sparse`（新钩子：较早的 5 天没有采样）制造“点空日”的场景，在本构建下三张卡片照常渲染：
  `["最长镜头 26 分 27 秒 WeChat · 14:51–15:18","最密 30 分钟 2 次剪辑 09:14–09:44","时长第一的进程 1 小时 39 分 Code"]`，
  `#highlights` `hidden=false`、高度 46px；三个尺寸（1440×900 / 1180×720 / 1180×640）都正常。
  验收里那组“3 个子元素但 `innerText` 全空”的状态在本构建里复现不出来（该 Chromium 下 `display:none` 与零高元素的 `innerText` 都仍返回文本）。
- **实际修掉的两处风险**：
  1. **区块被压扁**：`#app` 是 flex 列，之前所有子项都可收缩，窗口矮或内容高时 `#highlights` / `.summary` 会被挤到很矮（截图里“题材下方直接是进程排行”就是这个现象）。现在 `#app > * { flex: 0 0 auto }`、只留 `.shots { flex: 1 1 auto; min-height: 96px }`，空间不够时只压缩镜头列表。
  2. **hidden 与子节点可能不一致**：`renderHighlights` 重写为“要么三张卡片且 `hidden=false`，要么清空子节点且 `hidden=true`”，不再先改 hidden 再清空。
- **行为确认**：有镜头 → 3 张卡片（最长镜头 / 最密 30 分钟 / 时长第一的进程），点最长镜头卡片会选中并 `revealRow(center)`（`active=2026-11-22-21`、`time=14:51`）；空日 → 0 个子节点且 `hidden=true`。

### 11.4 项目分区不随外部设置变化刷新

- **原因**：项目规则只在本面板保存（`applySettings`）与读设置时重算，外部（IPC / 托盘）改的设置不会通知主视图。
- **修法**：`handleTick` 里加 `syncSettingsFromHost()`：每 3 秒（且上一次未完成时跳过）拉一次 `getSettings()`，与 `state.settings` 做 `JSON.stringify` 比较，有变化就 `applyExternalSettings`（重算设置面板、汇总项目分区、列表项目标签）。面板内保存仍然即时重算。

### 11.5 另外两处自查

- **手记清空**：mock 的 `setNote(date, '')` 现在是 `notes.delete(date)`（不写空串）；真实通道由主进程负责，界面侧只透传。切换日期时先清空输入框与计数再 `loadNote`，不会把上一天的内容留在框里，并清掉待触发的 600ms 定时器。
- **滚轮锚点**：`onWheel` 每次重读 `getBoundingClientRect()`（不再用缓存的 `trackRect`），窗口变窄或出现滚动条后缓存矩形变旧会让锚点漂。
- 顺手补了 11.1 过程中发现的一个缺口：`handleTick` 里漏了 `renderWeek()`，周视图里“今天”那格此前不会跟着 tick 重画。

### 11.6 验证

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 Test Files  11 passed (11)
      Tests  128 passed (128)
   Duration  1.76s

PS> npm run build
out/main/index.js   53.27 kB   ✓ built in 206ms
out/preload/index.js 1.52 kB   ✓ built in 11ms
out/renderer/index.html                8.81 kB
out/renderer/assets/index-DcQSY0qn.css 26.22 kB
out/renderer/assets/index-BN23XQl7.js  82.91 kB   ✓ built in 149ms
```

浏览器实测（`?mock=sparse` 复现“点空日”，以及一个注入了 `window.dayfilm` 的假宿主模拟 IPC）：

```text
# 空日：下拉值与高亮都对
click : {"clicked":"2026-11-16","dateValue":"2026-11-16","dateLabel":"11月16日 周一","emptyText":"这一天没有采样","verdict":"这一天没有采样，胶片是空的。","weekActive":1,"ariaCurrent":"2026-11-16","highlightsChildren":0,"highlightsHidden":true}
back  : {"dateValue":"2026-11-22","highlightsChildren":3,"highlightsHidden":false,"height":46,"texts":["最长镜头 26 分 27 秒 WeChat · 14:51–15:18","最密 30 分钟 2 次剪辑 09:14–09:44","时长第一的进程 1 小时 39 分 Code"],"active":"2026-11-22","ariaCurrent":"date"}

# 矮窗口：高光不再被压扁
{"innerWidth":1180,"innerHeight":720,"highlightsHidden":false,"highlightHeight":44,"texts":["最长镜头 26 分 27 秒 …","最密 30 分钟 …","时长第一的进程 …"],"lists":69}
{"innerWidth":1180,"innerHeight":640,"highlightsH":44,"listH":69}

# 假宿主模拟外部 setSettings（项目分区 + 列表标签）
boot   : {"totals":"在设置里加一条项目规则，把镜头归到故事线上","tags":0}
extern : {"totals":"acceptance project 30 分","rankNames":["acceptance project"],"tags":["acceptance project"]}   ← 3 秒轮询后自动跟上
panel  : {"rankNames":["acceptance project","code work"],"tags":["acceptance project","code work"],"status":"已保存"}
note   : {"saved":"keep then clear","cleared":"","count":"0/200"}   ← 清空后宿主里这个键被删掉
```

### 11.7 遗留

1. 验收里的“3 个子元素 + `innerText` 全空”在本构建无法复现；已把能复现的两个真问题（区块被 flex 压扁、`hidden` 与子节点可能不同步）修掉，并用 `?mock=sparse` 把空日/有数据日的两条路径都跑了一遍。建议重跑一次 `node scripts/probe-v11.mjs` 确认。
2. 外部设置的同步是 3 秒轮询（`getSettings` 很小），不是推送；如果以后希望“改了设置立刻在所有窗口生效”，需要主进程在 tick 或新通道里带上 settings。
3. `?mock=sparse` 是新增的自查钩子（`src/renderer/src/data.ts`），与 `burst/readonly/storage/error` 同一机制，不想保留可删。
