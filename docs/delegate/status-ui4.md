# v1.2 周电影状态（df-ui4）

任务来源：[brief-ui4.md](brief-ui4.md)，规格见 [dayfilm-v1.2.md](../specs/dayfilm-v1.2.md)（R30–R34），
方向依据见 [ADR 0004](../agents/adr/0004-week-film-direction.md)。数据全部来自现有 IPC
（`listDays` / `getDay` / `getSettings`），没有新增通道。

## 1. 交付范围

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/lib/week-film.ts` | 新增：周切分（`mondayOf`/`weekDates`/`weekRangeLabel`）、主线、故事线矩阵（色相/四档亮度/主角描边/连线/切回标记）、周评语、精选 |
| `tests/renderer/week-film.test.ts` | 新增，38 例 |
| `tests/renderer/week-picks.test.ts` | 新增，7 例 |
| `src/renderer/src/app.ts` | 日/周模式、14 天取数与缓存、七幕/矩阵/评语/精选渲染、跳转回日模式并选中 |
| `src/renderer/index.html` | 顶栏胶片区加 `日/周` 切换；周模式容器 `#weekFilm`（`#weekRange` / `#weekPrev` / `#weekNext` / `#weekToday` / `#weekArcs` / `#storyline` / `#weekVerdict` / `#weekEvidence` / `#weekPicks`） |
| `src/renderer/src/style.css` | 模式切换、周模式隐藏日模式区域、七幕卡片、故事线矩阵、评语与证据表、精选卡片 |
| `src/renderer/src/data.ts` | mock 默认三条项目规则（设计 / Dayfilm / 阅读） |
| `src/renderer/src/mock.ts` | mock 扩到 14 天（两周）；每四天有一天只做设计与杂事，让主角切换可见 |

未改动 `src/main/**`、`src/shared/**`、`package.json`、打包配置与其他文档。

## 2. 日 / 周模式（R30）

- 切换器在胶片标题行：`#modeDay` / `#modeWeek`（两个 button，`aria-pressed`）。默认日模式。
- 切到周模式：`#app[data-mode='week']`，CSS 隐藏 `#reelTitle`、`#week`（迷你条）、`#ruler`、`#track`、
  `.transport`（含 `#frameBox`）、`.summary`、`.highlights`、`.shots`（含 `#listTitle`/`#list`）与缩放工具；
  `#weekFilm` 展开并占据剩余高度，内部滚动。
- 取数：本周 7 天 + 上周 7 天并行 `getDay`，结果进 `weekCache`（失败存 `null`，按无数据处理）；
  切周时只补缓存里没有的日期；今天优先用 `live.day`，跟着 tick 重算（不重复读盘）。
- 周导航：`#weekPrev` / `#weekNext` / `#weekToday`；`#weekNext` 在当前周禁用（再往后全是未来日期）；
  `#weekToday` 已在本周时禁用。
- 跳转：七幕卡片、故事线格子、精选卡片点击后都走 `gotoDay(date, sceneId)` —— 先切回日模式、
  载入该天、再选中并 `revealRow(center)`；格子还会按 `data-line` 找到该天该故事线的第一个镜头。

## 3. 七日叙事弧与故事线（R31）

- **七幕**：日期 + 星期、当天主线、最长镜头、剪辑次数；`换戏` 与 `<主线> · 连续 N 天` 作为标签。
  三种状态分开：`没有采样`（整天无采集）、`没有镜头`（有记录但没有镜头）、`未归项目`（有镜头但没命中项目规则）、
  未来日期写 `未到` 并弱化（不显示 0）。
- **主线**：项目优先（`totalByProject`），没有项目规则时按进程名；并列按名称字典序（确定性）。
- **故事线矩阵**（按外部评审的视觉规则实现，规则参数全部由纯函数返回，界面只照数据画）：
  - 行 = 一周内出现过的项目（无规则时进程名），按周总时长倒序取前 5；
  - 每行一个**固定色相**（`hashString(name) % 360`，同周撞色时按 +29° 错开），界面用低饱和
    `hsl(hue 24% 56% / alpha)` 填充，色相即项目身份；
  - 格子亮度 = 当天该项目时长 ÷ 该行周最大值，开平方后落进**四档透明度** `0.25 / 0.42 / 0.62 / 0.82`；
  - **当天主角**（该天时长第一的项目）加 `2px` 暖白描边 `#e9ddc6`（`outline-offset: -2px`，无光晕），
    一天最多一个描边；
  - 相邻两天主角相同，才在格子间隙画一段 `2px` 项目色短线（宽度恒为间隙宽 8px，时长只由亮度表达，
    不画贯穿七天、随时长变宽的流带）；
  - 主角从 A 换到 B：A 的线终止、B 获得描边，列头日期下方标 `切`；回到本周早前的主角标 `回`；
    中间隔了别的项目时**不画**跨过去的幽灵连线；
  - 空状态三态：该项目当天无命中 = 暗格 `#202226` + 极淡边界；整天没有采集 = 整列斜纹暗底并标 `无记录`；
    当天有记录但没有项目命中 = 不指定主角（描边留空）；
  - 没有项目规则时矩阵下方补一句 `在设置里加一条项目规则，故事线会更清楚。`
- 标记一律用汉字（`切` / `回` / `无记录` / `换戏`），不用图标符号。

## 4. 周导演评语（R32）

- `buildWeekVerdict(本周, 上周)`：比较三项指标——最长镜头时长、剪辑密度（每小时剪辑数）、活跃时长。
- 相对变化幅度排序取前两项写句子，数字用 `fmtDuration` / `fmtMinutes` 口径，例如
  `本周最长镜头是 44 分 28 秒，比上周多 1 分 05 秒；活跃时长比上周少 1 小时 01 分。`
- 只描述变化，不出现“效率/专注/进展”等评价词；完全没变化时给中性总结（`本周与上周基本一样：…`），
  不会出现“多 0 分”。
- 上周没有任何镜头：句子固定为“这是第一周，还没有可以对比的上周。”，证据表的“上周/变化”两列全为 `—`。
- 证据：`<details>` 默认折叠，表头为三项指标，三行为 `本周 / 上周 / 变化`。

## 5. 本周精选（R33）

- `pickWeekHighlights(week, projects)` 按规格顺序挑：① 本周最长镜头 ② 最密 30 分钟窗口里最长的镜头
  ③ 各故事线本周第一次登场 ④ 每次换戏当天的第一个镜头 ⑤ 本周最后一镜。
- 去重键 `date + scene.start`，最多 7 条；30 分钟窗口按天分窗（不跨零点）。
- 卡片显示理由 / 日期时间 / 进程 / 标题 / 时长，点击回到该天并选中；一周没有镜头时显示“这一周还没有镜头。”

## 6. 视觉与版式决策

- **矩阵是主体**：三行以内时一屏能看到七幕 + 矩阵 + 评语 + 精选的上半部分；矩阵行高 22px，
  列头（日期/星期/切回标记）与格子一一对齐；行名左侧带 8px 色块，右侧显示周总时长。
- **不给连线加粗**：线只负责“连续主演”，线宽恒 2px、长度就是格子间隙 8px；时长信息完全交给亮度，
  避免出现“流带”把矩阵变成面积图。
- **描边用 outline 而不是 border**：不改变格子尺寸，也不会让相邻格错位；不加 box-shadow（评审要求无光晕）。
- **无记录列用斜纹**：这是本产品里唯一合法的纹理使用（“没采集”本身需要一眼区分），其余区域保持纯色。
- **周模式仍是近黑 + 暖灯**：项目色只出现在矩阵与七幕的极少量元素上，色相低饱和（24% 饱和、56% 亮度底），
  不与“正在拍 / 选中 / 播放”的暖灯色抢注意力。
- 周一为一周起点（`mondayOf` 用本地日历运算，周日归属上一周），跨月/跨年都按本地日期算。

## 7. 验证结果

### 7.1 自检命令（brief 指定的三条，全部通过）

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 ✓ tests/renderer/date-follow.test.ts (7 tests) 4ms
 ✓ tests/renderer/time.test.ts (12 tests) 6ms
 ✓ tests/renderer/highlights.test.ts (9 tests) 7ms
 ✓ tests/renderer/reel.test.ts (9 tests) 7ms
 ✓ tests/renderer/hash.test.ts (9 tests) 9ms
 ✓ tests/renderer/window.test.ts (16 tests) 9ms
 ✓ tests/renderer/still.test.ts (6 tests) 9ms
 ✓ tests/renderer/week.test.ts (10 tests) 9ms
 ✓ tests/renderer/zoom.test.ts (22 tests) 10ms
 ✓ tests/renderer/poster.test.ts (11 tests) 9ms
 ✓ tests/renderer/week-picks.test.ts (7 tests) 12ms
 ✓ tests/renderer/week-film.test.ts (38 tests) 21ms
 ✓ tests/renderer/mock.test.ts (17 tests) 37ms
 Test Files  13 passed (13)
      Tests  173 passed (173)
   Duration  1.62s

PS> npm run build
out/main/index.js   53.27 kB   ✓ built in 200ms
out/preload/index.js 1.52 kB   ✓ built in 10ms
out/renderer/index.html                10.22 kB
out/renderer/assets/index-CpI0rN34.css 33.44 kB
out/renderer/assets/index--2668ytF.js  108.55 kB   ✓ built in 185ms
```

v1.1 的 128 例全部保留，本轮新增 45 例（week-film 38 + week-picks 7），合计 173。

新增测试覆盖：`mondayOf`（周一/周日边界、跨月、跨年）、`weekDates` 与 `weekRangeLabel`、
主线判定（并列、无数据、无规则回退进程、有规则但未命中）、故事线分桶（空格、亮度归一、最多 5 行）、
长主线（连续 3 天、中间断一天、上周日参与首幕判断）、换戏（前二条件）、矩阵规则（每列最多一个描边、
四档透明度、连线只在相邻同主角、回到旧主角不画幽灵线、三态空数据、色相唯一且确定）、
评语（正常对比、首周分支、按幅度取前二、无变化兜底、确定性、不含评价词）、
精选（去重、上限 7、首尾镜头、空周、换戏与登场不重复计）。

### 7.2 真实渲染与交互核对（headless Edge + DevTools Protocol，1440×900）

用 `npx vite src/renderer --port 5177` 起页面（自查完已停止，未跑 `npm run dev`）。实测原文：

```text
=== 默认日模式
{"dayBtn":true,"weekFilmHidden":true,"trackVisible":"block"}

=== 切到周模式
{"weekFilmHidden":false,"weekBtn":true,"range":"11月16日 – 11月22日","arcs":7,
 "arcDates":["2026-11-16",...,"2026-11-22"],"storyCells":21,"storyLines":["设计","Dayfilm","阅读"],
 "verdict":"本周最长镜头是 44 分 28 秒，比上周多 1 分 05 秒；活跃时长比上周少 1 小时 01 分。",
 "evidenceRows":3,"evidenceDetailOpen":false,
 "picks":["本周最长镜头","最密的 30 分钟","设计 本周登场","Dayfilm 本周登场","阅读 本周登场","换戏 · 设计","换戏 · Dayfilm"],
 "dayHidden":["none","none","none"],"nextDisabled":true,"todayDisabled":true}

=== 矩阵规则实测
{"outlinedPerColumn":[1,1,1,1,1,1,1],"maxOutline":1,"emptyCells":4,"links":3,
 "marks":["切","回","回"],"hues":["rgb(142, 176, 120)","rgb(120, 169, 176)","rgb(176, 136, 120)"]}

=== 周导航
{"before":"11月16日 – 11月22日","prev":"11月9日 – 11月15日","nextDisabled":false,
 "back":"11月16日 – 11月22日","todayDisabled":true}

=== 点精选卡片回日模式并选中
{"clicked":"2026-11-16","id":"2026-11-16-36","mode":true,"weekFilmHidden":true,
 "dateValue":"2026-11-16","activeId":"2026-11-16-36","time":"21:15 / 24:00","frame":"#eng — Dayfilm"}
```

`outlinedPerColumn` 全是 1 = 每列最多一个主角描边；`marks` 出现 `切/回/回` 三处；`links` 3 段；
三行色相互不相同；暗格 4 个。截图（临时目录）：`%TEMP%\dayfilm5-week.png`（周模式整屏）。

### 7.3 过程中发现并修掉的问题

1. `mondayOf` 对非法输入会返回 1969 年的日期（`startOfDay('bad')` 回落成 0）；改成先校验 `YYYY-MM-DD`。
2. 精选去重会让“本周最后一镜 / 各项目登场”与“最长镜头 / 最密窗口”重到时只剩一条——按规格顺序保留先出现的理由，
   测试改成构造互不重叠的数据并把去重本身也断言下来。
3. 未来日期曾被当成“整天没有采集”（会画斜纹 + 写“无记录”）；改为 `future` 与 `noRecord` 分开，
   未来列只是暗格、不写标记。
4. mock 里所有窗口标题都带 “Dayfilm”，第一条项目规则会把 Notion/Figma 的镜头也吞掉，周视图永远一个主角；
   把演示规则改成“设计优先 + 按进程/标题词表”，并让每四天有一天只做设计与杂事，现在能稳定看到 `切/回` 与换戏。

## 8. 未完成项与需要主 Agent 处理的事项

1. **真实 Electron 下没跑周模式**（本轮按要求只用浏览器 + mock；数据全部走现有 `getDay`，接口形状与日模式相同）。
   真机上 14 次 `getDay` 的耗时取决于主进程读盘与切分缓存，建议在 `probe-v11` 类脚本里量一下切换周的时间。
2. **周导航只能回到当前周为止**：`#weekNext` 在本周及以后禁用（未来没有数据）。要“看到下一周的空壳”需要放开这条限制。
3. **周模式没有键盘导航**：模式切换按钮、七幕卡片、矩阵格子、精选卡片都是原生 button（Tab/Enter 可用），
   但没有像胶片那样的方向键在七幕之间移动。
4. **精选上限 7、故事线 5 行**都是规格值；若某周项目超过 5 个，第 6 名以后不在矩阵里（仍会出现在精选的“登场”规则里，
   如果它能进 7 条）。
5. **矩阵列头不显示“今天”**：只显示日期/星期与切/回标记；需要的话可以加一圈淡描边。
6. **`?mock=sparse` 等自查钩子**仍在 `data.ts`；mock 的三条项目规则只用于演示，真实数据以用户设置为准。
7. **评语只做三项指标对比**（规格 R32.2 的三项），不涉及项目维度；如果之后想“本周主线是 X”这类句子，需要扩展纯函数签名。

## 9. 真机验收后的四处收尾

主 Agent 用 `scripts/probe-v12.mjs` 验收通过后提了四处视觉/交互问题，本轮只改周模式（日视图未动）：
`src/renderer/src/app.ts`、`src/renderer/src/style.css`、`src/renderer/src/data.ts`（改 `?mock=sparse` 的取日范围）。

### 9.1 故事线带压缩，无记录只写一次

- 格子高 22px → **30px**，行间 6px → **3px**，列头压缩到 23px（日期与星期一行、标记一行），
  每行左侧的主线名/周总时长与格子垂直居中。实测 **5 行时整块矩阵 188px**（要求 ≤ 约 190px）。
- “无记录”只在**列头写一次**（`story__mark`），格子不再有任何文字；格子改成
  `aria-label="<项目> <日期> 当天无采样，点击查看该天"`，屏幕阅读器仍能知道这一列没采样。
  实测：5 行周里 `cellTexts = 0`；本周周一–周三无采样时 `无记录` 文本 3 处（等于无采样列数），
  无采样格子 9 个。

### 9.2 点“没有采样”那一列能跳到那天

- 之前无采样格子是 `disabled`，点击不响应。现在它与日期下拉同语义：点击无采样格子（或它的列头）
  走 `gotoDay(date)` → 切回日模式、载入该天、显示“这一天没有采样”的空状态。
- 无采样列头是键盘可达的（`role="button"`、`tabIndex=0`、Enter/空格触发）；列内格子只响应鼠标，
  `tabIndex=-1` 不占 Tab 顺序（避免 Tab 在同一个日期上停 5 次）。
- 实测：点 11-16 列 → `modeDay=true`、`weekFilmHidden=true`、`#date.value=2026-11-16`、
  `#empty` 文案“这一天没有采样”。

### 9.3 七幕卡片固定两行

- 新结构：第一行 `11-16 周一` + 主线（单行省略），第二行 `最长 44 分 28 秒 · 15 次剪辑` + 徽标
  （`换戏` / `Dayfilm · 连续 3 天`）满在同一行末尾；空/未来幕只有一行（字色减弱）。
- 实测：七张卡片高度全部 51px、`wrappedLines = 0`（没有一行的文字换行）。

### 9.4 只有“当天有时长”的格子可点

- 有 ms 的格子：可点可聚焦（`cursor: pointer`，跳到当天该故事的第一个镜头）。
- 该项目当天为 0（当天有别的记录）的格子：`disabled` + `cursor: default` + 极淡边界，
  不抢焦点、不响应点击。实测 5 行周里 10 个这样的格子全部 `disabled`。
- 未来格子仍为 `disabled` 的暗格；无采样列的格子按 9.2 可点但不进 Tab。

### 9.5 验证

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 Test Files  13 passed (13)
      Tests  173 passed (173)
   Duration  1.65s

PS> npm run build
out/main/index.js   53.27 kB   ✓ built in 195ms
out/preload/index.js 1.52 kB   ✓ built in 10ms
out/renderer/index.html                10.22 kB
out/renderer/assets/index-ChcWMyO9.css 33.81 kB
out/renderer/assets/index-Dc9IyxAL.js  109.37 kB   ✓ built in 196ms
```

浏览器实测（`?mock=sparse` 先把本周周一到周三置为无采样；为凑满 5 行临时通过设置面板加了两条项目规则）：

```text
# 矩阵几何（5 行）
{"rows":5,"gridHeight":188,"cellHeight":30,"colHeight":23,"rowGap":"3px"}

# 文字与可点性（5 行周，7 天都有数据）
{"norecordMarks":0,"cellTexts":0,"disabledCells":10,"enabledCells":25,
 "emptyCursor":"default","filledCursor":"pointer","disabledAttr":true}

# 七幕卡片
{"heights":[51,51,51,51,51,51,51],"maxHeight":51,"wrappedLines":0,
 "texts":["11-16 周一 Dayfilm 最长 44 分 28 秒 · 15 次剪辑","11-17 周二 设计 最长 25 分 48 秒 · 17 次剪辑 换戏",…]}

# 无采样列（周一到周三）
{"cols":7,"norecordCols":3,"norecordMarks":3,"norecordCells":9,"cellTexts":0,
 "firstLabels":[{"hasNoSample":true,"tabIndex":-1,"disabled":false}]}

# 点无采样格子
{"clicked":"2026-11-16","modeDay":true,"weekFilmHidden":true,"dateValue":"2026-11-16",
 "emptyText":"这一天没有采样","emptyShown":true}

# 无采样列头
{"role":"button","tabIndex":0,"text":"11-16 周一无记录"}
```

截图（临时目录）：`%TEMP%\dayfilm6-week.png`（5 行矩阵、两行幕卡、描边与连线）。

### 9.6 本轮遗留

1. 无采样列的每个格子都能点（同一目标重复 5 次），以 `tabIndex=-1` 让他们不占 Tab；
   如果希望“整列只有一个点击热区”，需要把列包成一个覆盖层。
2. 矩阵行数最多 5（规格），第 6 名以后的项目不出现在矩阵里。
3. `?mock=sparse` 的含义改为“本周周一–周三无采样”（之前是最近 14 天里最早的 5 天），
   仍然只用于自查与演示。
