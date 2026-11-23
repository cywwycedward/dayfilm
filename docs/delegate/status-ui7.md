# status-ui7：v1.5 界面收尾（R50–R54 界面侧）

任务来源：[brief-ui7b.md](brief-ui7b.md)，规格 [dayfilm-v1.5.md](../specs/dayfilm-v1.5.md)（R50–R53 界面部分、R54 界面侧），
视觉 [visual-language.md](../product/visual-language.md)。

接手时的状态：只有 `src/renderer/src/lib/poster.ts` 有主题类型与调色板，界面没接线。本轮把主题、对比、日历、
导出 PDF、放映快捷键事件全部接上，并补齐纯函数与测试。`src/main/**`、`src/shared/**`、`package.json`、
构建配置未改（`git status` 里 main / shared / preload 的改动是主 Agent 之前留下的，不是本轮）。

## 1. 做了什么

| 需求 | 实现 |
| --- | --- |
| R50 海报主题 | `#exportPoster` 改成先弹主题菜单（经典/黑色电影/极简，`.menu` 用 `.tip`/`.drawer` 的视觉语言，无新弹窗）；选中后带主题导出。`posterTheme` 是模块内变量，只记本次会话。 |
| R51 双日对比 | 胶片标题区加「对比」按钮 → `#compare` 浮层；左右各一个日期下拉（选项来自 `listDays()`，默认今天与上一个真有镜头的天），中间差异列；任一侧胶片带可点，关闭浮层并切到该天。 |
| R52 片场日历 | 胶片标题区加「日历」按钮 → `#calendar` 浮层：7 行（周一→周日）× 12 列（近 12 周），每批 7 个并发 `getDay`，加载中显示「已载入 N/84」，已载入的格子先渲染。 |
| R53 导出 PDF | 顶栏「导出剧本」旁加次要样式的「导出 PDF」，走 `state.source.exportPdf(date)`；成功/取消/演示环境/失败各有 toast。 |
| R54 放映快捷键 | `window.dayfilmProjection?.onToggle(cb)` 订阅（preload 已注入，契约在 `src/shared/ipc.ts`）；收到时在放映/退出放映之间切换，没有该能力时静默忽略。 |

### 1.1 海报主题（`lib/poster.ts` + `paint.ts`）

- `computePoster({ ..., theme })`（不传＝`classic`），`PosterLayout` 多出 `theme` 与 `palette`；`paintPoster` 全部颜色
  改从 `palette` 取（底色、胶片带、齿孔、印相描边、图注、四档文字色、页脚、手记竖线）。
- 三套变体：
  - 经典：原样（胶片带 150 高、12 格刻度、四张印相 340×191、题材水印 4%）。
  - 黑色电影：胶片带收成 28 高的细缝（齿孔同步缩小）、只留一张「最长镜头」印相并放大到 540×303、`y=240` 居中、
    题材标题 `letterSpacing: -2`、水印 6%、强调色换成 `#b8524a`。
  - 极简：纸白底墨黑字，`film`/`holes`/`backdrop` 为 `null`、`prints`/`blocks` 为空，不画点评，手记只留 1 行。
- 数字格式化三套主题共用同一份代码（`computePoster` 只在没有主题分支的地方拼字符串）：
  活跃时长 `fmtMinutes`（`4 分` / `3 小时 40 分`）、镜头与剪辑纯数字、印相下的镜头时长 `fmtDuration`（`26 分 52 秒`）。
- 顺带修掉一个**先前就存在**的版式缺陷：三组数字原来是固定 `96/296/496` × 200px 三列，`3 小时 40 分` 在 56px 下会压到
  相邻列。现在三列按内容估算宽度排开（`monoTextWidth`：CJK 1em、ASCII 0.6em，列间至少 40px），
  文字文本与字号不变，只是 x 坐标随内容变；极简的纸白底上数字用 `title` → `palette.paper`（#14161a），对比度 >7。
- noir 的印相图注原先仍按 `PRINT_H` 算 `captionY`，放大后会落到卡片里；改为按实际高度算，图注在卡片下方 20px。

### 1.2 双日对比（`lib/compare-days.ts` + `app.ts`）

- `compareDays(a, b)` → `{ left, right, diff }`。`left/right`：`date`、`empty`、`genre`、`note`、三项数字、
  素材区间块（`from/to` 是当天首尾的 0–1 比例，族色 hue）、进程前 3。没有镜头的一天（含 `null` 与空 rollup）算空侧。
- `diff`：活跃时长（ms）、镜头数（count）、每小时剪辑（rate），`delta = 左 − 右`，任一侧空就是 `null`。
  `formatDelta()` 给文案（`+1 小时 12 分` / `−8 个` / `+1.2 次/小时` / `持平` / `—`，数值带单位），
  `deltaDirection()` 给上色方向（正 `--amber`、负 `--silver`、持平与无数据不上色）。
- 差值的毫秒口径与 `fmtMinutes` 一致：先各自取整到分钟再相减，否则「1 小时 44 分 → 8 小时 18 分」会算出「−6 小时 35 分」这种对不上的差。
- 浮层里两侧各是：日期下拉 + 题材 + 点评 + 三项数字 + 胶片带（`paintCompareStrip`，复用族色，按各自首尾铺满半宽，
  高 36px）+ 进程前 3；差异列三块都是「标签在上、数值在下」，两侧读数不重复写在差异列里（各侧数字已经写了）。
  换日期只重画该侧与差异列（`compareRenderToken` 防竞态）；`compareCache` 记住取回的一天（失败也记，不反复打主进程）。

### 1.3 片场日历（`lib/calendar.ts` + `app.ts`）

- `calendarDates(today)` 给 84 天：本周一往前 11 周起，到本周周日，周一为行首。
- `calendarCells(days, today)` → 84 格：`dow`（周一=0）、`level`（0 或 `0.18 + 0.64·sqrt(active/max)`）、`activeMs`、
  `genre`、`shots`、`future`。缺数据的天按 0 记。
- 界面：容器是显式网格 `grid-template-columns: 42px repeat(12, 18px)`、`grid-template-rows: 14px repeat(7, 18px)`、
  间距 3px；格子 18×18、圆角 2，按 `column = 周`（0 起，+2 避开标签列）与 `row = dow`（+2 避开月份行）逐一放置。
  左侧行标签只写周一/周三/周五（第 1/3/5 行），顶部从第 1 列起每 4 列一个月份标签（相邻同月不重复写）。
  没有采样仍是 2px 暗格（不再隐藏整格），有镜头加 1px 内描边，今天加 amber 描边，未来格禁用且留白，
  其余格子都有 1px 发丝内描边，所以除今天后面那几天外，84 格是完整可见的 12×7 网格。
  浮层收到内容大小（`width: auto` + `padding: 16px`，实测 ≈ 326px），不撑满窗口。
  `title`/`aria-label` 是「日期 · 活跃 X 分钟 · 题材」，点击切日并关闭，Esc 与点遮罩关闭。
  载入按每批 7 个并发，进度行「已载入 N/84」，已完成则清空；跨零点再开只补缺的日期。
- 焦点：打开后焦点落在第一格；分批重画会把焦点还原到同一日期（否则会被 `replaceChildren` 打回 `body`）。

### 1.4 导出 PDF / 放映快捷键（`data.ts` + `app.ts`）

- `DayfilmSource.exportPdf(date): Promise<{ path: string }>`：live 直接返回 preload 的 `exportPdf`（缺通道给可读错误），
  mock 返回 `{ path: '' }`；界面据此提示「演示环境不支持导出 PDF」，live 空路径提示「已取消导出 PDF」，异常走
  「PDF 导出失败：…」，按钮导出期间 `disabled`。
- `window.dayfilmProjection?.onToggle(...)`：放映中则退出，否则进入放映。self-check 用一个注入的 preload 桩验证过
  进入/退出两条路径（见 §4）。

### 1.5 顺带的可用性修补

- 两个浮层的遮罩是 `rgba(10, 11, 13, .92)`，面板用 `--charcoal` 实底 + 1px 发丝线（真机截图看不到背景了）。
- 浮层（对比、日历）加了 Tab 循环（`focusables` / `trapTab`，与设置抽屉共用同一套实现），关闭后焦点回到触发按钮。
- 海报主题菜单：Esc 关闭并把焦点还给按钮、上下键在三个主题间移动、点外部关闭、`aria-haspopup`/`aria-expanded`。

## 2. 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/lib/poster.ts` | `theme`/`palette` 进 `PosterLayout`，三套变体，数字列按内容宽度排开，noir 单张放大印相与图注修正 |
| `src/renderer/src/paint.ts` | `paintPoster` 全量改读 `palette`（含 `letterSpacing`、可空胶片带/水印）；新增 `paintCompareStrip` |
| `src/renderer/src/lib/compare-days.ts` | 新增：`compareDays` / `formatDelta` / `deltaDirection` |
| `src/renderer/src/lib/calendar.ts` | 新增：`CALENDAR_DAYS`、`calendarDates`、`calendarCells` |
| `src/renderer/src/data.ts` | `DayfilmSource.exportPdf`（live / mock） |
| `src/renderer/src/app.ts` | 主题菜单、导出 PDF、对比浮层、日历浮层、放映事件订阅、焦点循环；`State`/`Ui` 新字段 |
| `src/renderer/index.html` | `#exportPdf`、`#compareOpen`/`#calendarOpen`、`#posterMenu`、`#compare`、`#calendar` |
| `src/renderer/src/style.css` | 主题菜单、浮层骨架、对比三栏、日历格子与色阶（约 330 行） |
| `tests/renderer/poster.test.ts` | 主题相关 8 例（新增：三主题同数字同列位、印相时长口径、纸白底对比度）；数字断言改为「7 小时 28 分」类全词写法；三处旧断言补空值收窄 |
| `tests/renderer/compare-days.test.ts` | 新增 13 例（两侧有数据 / 一侧空 / 全等 / 取整口径 / 区间带 / 进程前 3） |
| `tests/renderer/calendar.test.ts` | 新增 6 例（周对齐 / 跨月连续 / 缺日 / 空数据 / 色彩映射） |

## 3. 验证输出

```text
npx tsc --noEmit -p tsconfig.web.json      TSC exit=0
npx vitest run tests/renderer               23 files / 321 tests passed
npx vitest run（全量，含主进程）              46 files / 548 tests passed
npm run build                               out/renderer/index.html 14.56 kB
                                            assets/index-*.css 46.58 kB
                                            assets/index-*.js 168.83 kB（本轮第一次构建 166.63 kB）
node scripts/probe-v15.mjs                  见 §4.2，84 cells / 三个主题 / PDF 入口都在
```

新增测试覆盖：三主题画布同尺寸与必含元素在版心内、三主题的数字文本与列位完全一致、`minimal` 无胶片带/无印相/无水印/手记 1 行、
`noir` 只 1 张印相且比经典大、不传主题＝经典、印相下镜头时长用「N 分 M 秒」、极简纸白底的对比度 >7；
对比的两侧有数据、一侧空（含「有日期没镜头」）、两侧全空、完全相等、差值取整与读数一致、区间块 0–1、
进程前 3 倒序；日历的 84 格周一对齐、今天在最后一行与 future 标记、跨月连续无重复、缺日按 0、空数据、18%–82% 平方根映射。

## 4. 界面自查（`npx vite src/renderer --port 5179` + mock，Electron 截图）

临时脚本与截图在 `%TEMP%\ui7check\`（不在仓库里）：`01-day`、`02-poster-menu`、`03-calendar`、`04-compare`、
`05-compare-switched`、`06-projection`、`10-poster-{classic,noir,minimal}`。

```text
menu {"hidden":false,"items":["经典","黑色电影","极简"],...}            Esc 后 hidden=true
calendar {"cells":84,"future":6,"lit":84,"progress":"已载入 0/84"→"",...}
calendar click 2026-11-12 → {"hidden":true,"date":"2026-11-12","title":"当日胶片"}
compare {"strips":2,"disabled":0,"apps":6,"canvasPainted":[true,true]}
         （当时的差异列还有一行「左 → 右」读数；round 2 已改成只有「标签 + 带单位差值」，真机截图见 §4.2）
compare switched ["2026-11-22","2026-11-10"]（换右侧日期后整列重算）
compare strip 点右侧 → 浮层关闭，#date=2026-11-22
focus calendarOpen: 焦点在格子 → 8 次 Tab 仍在浮层内 → Esc 后焦点回 #calendarOpen
focus compareOpen: 焦点在左侧 select → 9 次 Tab 仍在浮层内
poster export（菜单选“极简”）→ notice「海报已导出：dayfilm-2026-11-23.png（演示环境：浏览器下载）」
pdf（mock）→ notice「演示环境不支持导出 PDF」，按钮恢复可点
放映事件（注入 preload 桩）：trigger → #projection.hidden=false、SHOT 01 / 05、canvas 已绘制；再 trigger → hidden=true
poster classic {prints:4, film:[150,5]} / noir {prints:1, film:[28,5]} / minimal {prints:0, film:null}
ERRORS []（四支自检脚本的 console error 都是空）
```

三张海报逐张看过：经典四张印相与胶片带正常、数字不再压列；黑色电影是细缝胶片带 + 一张放大印相 + 红色字标；
极简只有日期、题材、三项数字、一句手记与页脚。

### 4.2 真机截图复查（round 2，`node scripts/probe-v15.mjs`）

复跑整个脚本（真实构建 + 真实数据，截图在 `%TEMP%\dfv15\`）：

```text
compare  selects=[2026-11-23, 2026-11-22]，差异列文字：活跃时长 −50 分 / 镜头数 −65 个 / 每小时剪辑 +12.4 次/小时
         （截图：两侧胶片带 36px，负值银色、正值 amber）
calendar cells=84，文字：片场日历 关闭 9月 10月 11月 周一 周三 周五
         （截图：12 列 × 7 行完整网格、格子 18×18/间距 3/圆角 2、浮层 ≈326px）
posterMenu items=[经典, 黑色电影, 极简]、pdfButton=true
```

又用 `%TEMP%\dfv15\calendar-zoom2.png`、`compare-zoom.png` 放大核过：日历行标签不再被格子遮住、月份对齐到列、
没有采样的白天也不再消失（每格有 2px 暗格 + 1px 发丝内描边，只有今天之后的天留白）；对比的标签/数值两层关系清楚，
差值单位齐全。

### 4.3 海报数字格式化复查（round 3）

用一整天（`buildMockDay(date, 22:00)`，活跃 7 小时 28 分）在三套主题下同步渲染，读回 `computePoster` 的数字文本与 x：

```text
classic/noir/minimal 三者完全一致：
  活跃时长  x=96   7 小时 28 分   tone=title
  镜头      x=506  25             tone=title
  剪辑      x=613  18             tone=title
  印相图注：09:39–10:06 · 26 分 52 秒（fmtDuration）
```

截图 `%TEMP%\ui7check\20-poster-{classic,noir,minimal}.png`：“7 小时 28 分 / 25 / 18” 间距清楚不重叠，
极简的黑字在纸白底上对比充足。

## 5. 与 brief 的偏离（需要知情）

1. **海报三组数字的 x 坐标改成按内容宽度排开**：原固定 200px 三列装不下「3 小时 40 分」，但格式化又必须与界面一致，
   所以改的是列位置（不是字号）：列间至少 40px，数据变长时后面的列右移；数据极长（如 12 小时 + 三位数镜头数）时
   最后一列会越过左栏边界（见 §6）。
2. **noir 印相放大到 540×303、上移到 y=240**：规格说「只留一张最大图」，按 340×191 留一张会让右栏大半空白。
   仍复用 `paintProjectionBoard`，没有第二套排版。
3. **对比的活跃时长差按分钟取整后再相减**：保证「左读数 − 右读数 = 差值」，与 `fmtMinutes` 口径一致；纯函数里的 `delta` 仍是毫秒。
4. **顺手加了浮层 Tab 循环与打开时的焦点落点**：brief 没写，但 `aria-modal="true"` 不锁焦点是可达性缺口。
5. **日历月份标签相邻同月不重复写**（窗口起于月初时第 1、5 列可能同月，只标一次）：严格「每 4 列一个」会出现「9月 9月」。
6. **对比差异列不再重复写两侧读数**（只留「标签 + 带单位的差值」）：直接回应 round 2 的「标签在上、数值在下」。

## 6. 未完成 / 未验证（如实）

1. **真实主进程 IPC 没联调**：本轮只跑 mock（brief 要求）。`exportPdf` 的保存对话框、真实 `printToPDF` 结果、
   `saveImage` 的对话框都没在 Electron 真进程里点过；界面侧只验证了 mock 分支与可读错误文案。
2. **`Ctrl+Alt+P` 的真实链路没跑**：主进程 → preload → 渲染的订阅已验证（用注入的 preload 桩模拟），
   但没有在打包产物上按真快捷键。主 Agent 验收 R54 时值得顺手确认一次。
3. **日历的零数据格只在真机截图里粗看**：`probe-v15.mjs` 跑的是真实数据（窗口里大部分天没采样），
   所以截图里能看到 84 格完整网格 + 3 个有数据的格子；但「悬停提示、点击切日、进度行刷新」仍只在 mock 下走过（见 §4）。
4. **主题菜单没有 Home/End、也没有窗口 resize 时重定位**（Esc/↑↓/点外部都有）；菜单宽度固定 152px。
5. **日历没有周次/月份以外的标签**（月份每 4 列一个，没有「第几周」）：规格没要求。
6. **海报数字列的极端情况**：本机测过「7 小时 28 分 / 25 / 18」排开不重叠；如果某天活跃超过约 10 小时且镜头数是三位数，
   估算宽度加上 40px 间隔会超过左栏 600px，最后一列会压到右栏（未做截断与换行）。
7. **对比浮层不随 tick 更新**：打开期间主视图在动，对比两侧停在被取回的快照上；要「跟着今天长」需要另做（规格没要求）。
8. **状态文件之外的文档没动**：`docs/specs/INDEX.md`、`visual-language.md` 均未改（不在可写范围）。
