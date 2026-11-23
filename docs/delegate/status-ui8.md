# status-ui8：v1.6 界面铬重做 + 双日叠片

任务来源：[brief-ui8.md](brief-ui8.md)。视觉权威：[visual-language.md](../product/visual-language.md) §八（界面铬）与 §四/§六。
可写范围只有 `src/renderer/**`、`tests/renderer/**`、本文件；`src/main/**`、`src/shared/**`、`package.json`、构建配置未改。

本轮分两段：先按 §八 把界面铬整体重做、把双日对比改成上下叠片；随后按监督者截图反馈做了四项收尾
（指标换行、顶栏分隔、放映空档态、对比差值上下文）。

## 1. §八 逐条落实（选择器 → 做法）

| § | 要求 | 落点 |
| --- | --- | --- |
| 8.1 滚动条 | 6px、轨道透明、滑块 `rgba(236,231,220,.16)`、悬停 `.34`、圆角 3、悬停才显现 | 全局 `::-webkit-scrollbar` / `-track` / `-thumb` / `-corner`；`*:hover::-webkit-scrollbar-thumb` 才给底色；`html/body/#app` 显式 6px。删掉了 `.shots__scroll` 与 `.week-film__scroll` 原来的 8px 单独规则 |
| 8.2 滑块 | 轨道 2px、已播放段琥珀 55%、拇指 6px 暖白、拖动时 8px 变琥珀、过渡 120ms | `input[type='range']::-webkit-slider-*`；轨道用 `--played` 变量画渐变，`updateTransport()` 每次定位时写入百分比；`:active` 放大变琥珀；`:focus-visible` 只给拇指描边 |
| 8.3 输入框 | 无四边框、只留底部 1px 发丝线、聚焦底线变琥珀、不加外框 | `select, input[type=search|text], textarea` 基础规则（透明底 + `border-bottom`）；`:focus-visible` 设 `outline: none` |
| 8.4 下拉框 | `appearance: none` + 自绘指示 + 只有底线 | `select` 用两段 45°/135° 渐变画 10px 下三角，`select option` 跟随面板底色 |
| 8.5 按钮 | 主按钮琥珀实底近黑字；次按钮纯文字悬停下划线；图标按钮无边框悬停 4% 底；全部去 1px 边框、圆角 2 | `.btn`（次）/ `.btn--primary`、`.btn--play`（主）/ `.btn--icon`（图标）/ `.btn--danger`；`.story__cell` 的 1px 边框改成 `inset box-shadow` |
| 8.6 面板/浮层 | 1px 发丝线 + `#14161c`、不画圆角大框、只有真正浮起的层加 `0 24px 64px rgba(0,0,0,.55)` | 新增 `--panel / --panel-line / --panel-shadow`；`.panel`（设置抽屉）、`.overlay__panel`（对比/日历）、`.menu`（海报主题）、`.tip`、`.notice` 统一使用；全部无圆角 |
| 8.7 焦点环 | 2px 琥珀 + 2px 偏移 | 沿用全局 `:focus-visible`；`.track` 的 `outline-offset` 从 3 改回 2，滑块/输入框按 8.2/8.3 单独处理 |
| 8.8 剧照卡片 | 去外框、`inset 0 0 0 1px rgba(236,231,220,.06)`、选中才 1px 暖白内描边 | `paint-still.ts` 的帧内描边 `.08` → `.06`；`.frame` 加内发丝线；选中态仍用 `paintReel` 的 1px 暖白内描边 |
| HUD | 发丝线 + 5% 底色、不要圆角大框 | `hud.css` 的 `.hud`：`1px rgba(236,231,220,.08)` + `rgba(20,22,28,.96)`，无圆角 |

## 2. 双日叠片（R51 改版）

- **数据模型**（`lib/compare-days.ts`）：`CompareBlock` 改成**日内偏移**（离当天零点的毫秒），两天才能叠在同一条刻度上；
  `CompareSide` 收成 `{ date, empty, genre, hue, blocks }`（`hue` = 当天最长镜头的族色，给左侧 2px 条）。
- **纯函数**：`unionRange(a, b)` 取两天素材区间的并集（任一侧空用另一侧、都空返回 null）；`axisTicks(range)` 返回 5 个刻度，
  标签用算术算 `HH:MM`（不经过 `Date`，避免时区/夏令时把刻度拉歪）。`compareDays` 现在一并返回 `range` 与 `ticks`。
- **绘制**（`paint.ts`）：`paintCompareStrip(ctx, blocks, range, w, h)` 按共享范围投影；没有镜头的一侧画点阵空胶片。
- **界面**（`index.html` + `app.ts`）：浮层结构改为「两行日期（选择 + 题材）→ 两卷 44px 胶片（间隔 8px，左侧 2px 族色条）
  → 共用一条 5 刻度时间轴 → 差异区三块」。日期换边只重画该侧与差异区（`compareRenderToken` 防竞态）。
- **交互**：点任一条带 → 关闭浮层并切到该天日视图（`data-date` + `selectDay`）。

## 3. 监督者截图反馈的四项收尾

1. **指标不换行**：`.metric__value` 加 `white-space: nowrap`、字号 24 → 20；`.metric` 加 `min-width: 0; text-align: left`；
   `.metrics` 保持 `repeat(5, minmax(0, 1fr))` 等宽。1280 宽下「12 小时 06 分」单行显示，不再折成「12 小时 06 / 分」。
2. **顶栏分隔**：四个导出按钮之间与「设置」之前各插入一个 `<span class="topbar__sep">`（1px × 12px，`.topbar__end` 的
   `align-items: center` 保证上下居中）；`.btn` 左右内边距 8 → 12px（`--quiet` 不再单独收紧）。
3. **放映空档态**：`paintProjectionGap` 重写——45° 细斜纹铺满整幅（`rgba(141,147,158,.10)`，间距随宽度 6–8px，
   与中场休息的 hatch 同一套语言）+ 主文案「空档」+ 次行「摄影机未运行 · 下一镜 12:18」（或「…这一天的胶片到此结束」）；
   字号按画面宽度放大，主 28–30、次 12–13，Plex Mono，居中两行。
4. **对比差值上下文**：差异列标题行改为 `标签 +「较右侧」`（10px mono，`rgba(236,231,220,.28)`），说明差值始终是「左减右」。

## 4. 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/style.css` | §八 全套（滚动条/滑块/输入/下拉/按钮/面板/焦点/卡片）+ 顶栏分隔、指标行、对比新布局 |
| `src/renderer/src/hud.css` | HUD 发丝线 + 5% 底色 |
| `src/renderer/index.html` | 对比浮层结构（两行日期 + 图表 + 差异区）、顶栏分隔符 |
| `src/renderer/src/app.ts` | 对比渲染（日期行/共享轴带子/差异块「较右侧」）、空档文案、滑块 `--played` |
| `src/renderer/src/lib/compare-days.ts` | 日内偏移模型、`unionRange`、`axisTicks`、`range`/`ticks` |
| `src/renderer/src/paint.ts` | `paintCompareStrip` 按共享范围投影 |
| `src/renderer/src/paint-still.ts` | 剧照内发丝线 `.06`；`paintProjectionGap` 斜纹 + 双行文案 |
| `tests/renderer/compare-days.test.ts` | 重写为叠片模型：并集范围（含单侧空/都空/同一天）、5 刻度、日内偏移、族色条、差值口径 |

## 5. 验证输出

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run tests/renderer            23 files / 327 tests passed
npx vitest run（全量）                    46 files / 554 tests passed
npm run build                            out/renderer/index.html 14.92 kB
                                         assets/index-*.css 49.43 kB
                                         assets/index-*.js 171.36 kB
node scripts/probe-visual.mjs            %TEMP%\dfv16c\{1-day,2-frame,3-projection,4-week}.png
```

`probe-visual` 的四张图逐张看过：日视图的指标单行（12 小时 06 分）、顶栏四条竖线、放映空档的斜纹 + 双行文案、
周视图与放大帧正常。

另用 mock + Electron 自查（截图在 `%TEMP%\ui8check\`）：`01-day`、`03-compare`、`04-calendar`、`05-settings`、
`06-poster-menu`、`07-projection`、`08-hud`、`09-list-scrolled`、`scroll-zoom`。

计算值抽查（`getComputedStyle` / 几何）：

```text
search:    border-top 0px, border-bottom 1px, background rgba(0,0,0,0)
date:      appearance none, border-bottom 1px
btn:       border 0px, radius 2px, color rgba(236,231,220,.55)
icon btn:  border 0px
scrub:     --played 99.5%
compare:   panel bg rgb(20,22,28) / border 1px rgba(236,231,220,.08) / shadow ✓
           bands 2 × 44px, gap 8px, 两条 canvas 均已绘制
           axis 5 刻度：09:14 / 12:26 / 15:37 / 18:49 / 22:00（两天的日内并集）
           diff: 活跃时长 较右侧 1 小时 44 分 → 8 小时 18 分 / −6 小时 34 分
calendar:  panel bg rgb(20,22,28), 宽 328px
hud:       border 1px rgba(236,231,220,.08), bg rgba(20,22,28,.96), radius 0
band click → 浮层关闭、#date=2026-11-22、标题「当日胶片」
```

## 6. 未完成 / 已知限制

1. **对比浮层不再显示每侧的点评与进程前 3**：brief 把 R51 改成「日期 + 题材 / 两条带 / 三项差异」，
   原来 v1.5 的三项数字与进程前 3 被差异区取代；`v1.5` 规格 R51.2 的字面要求（点评、进程前 3）现在没有对应的 UI 位置。
2. **共享轴按「日内时刻」对齐**：`unionRange` 用的是两天各自的零点偏移，所以跨午夜的日（镜头跨 00:00）会被压到轴的边缘；
   目前没有跨天镜头的处理与测试（mock 不会产生）。
3. **「较右侧」是固定文案**：差值永远是「左减右」，标签不随日期选择变化；如果以后要支持交换左右，需要同步改文案。
4. **指标 20px 只在 1280 宽验过**：更窄的窗口（约 <1100px）下 `12 小时 06 分` 可能又会被 `1fr` 列裁到间隙里（`nowrap` 不折行，但会溢出）；
   没有做字号自适应（`clamp()`）。
5. **滚动条「悬停才显现」用 `*:hover::-webkit-scrollbar-thumb` 实现**：无鼠标时截图里看不到滑块（这是设计使然）；
   `min-height: 24px` 写在滚动条伪元素上，Chromium 是否采纳不保证（滑块长度仍按内容比例）。
6. **HUD 底色改成近不透明 `rgba(20,22,28,.96)`**：§八 要「5% 底色」，代价是透出桌面的比例比之前的 94% 墨色 + 8% 纸色更低。
7. **未在打包产物上重新点一遍原生对话框/全局快捷键**：本轮只跑 `probe-visual` 与 mock 自查（brief 允许）。
8. **`scripts/probe-visual.mjs` 本轮由主 Agent 改过**，我只运行未修改。
