# 任务说明书：v1.5 界面收尾（df-ui2）

## 你现在接手的状态

上一位界面实现者把 v1.5 做了一半就停了：**只有 `src/renderer/src/lib/poster.ts` 加了主题支持**（`PosterTheme = 'classic' | 'noir' | 'minimal'`、`POSTER_THEMES`、`posterPalette(theme)`），但界面没接、对比视图与日历没做、导出 PDF 入口没做、也没有状态文件。

当前工作区是唯一事实来源：先读 `src/renderer/src/app.ts` 里 `exportPoster()` 与 `paintPoster` 的用法，确认 `computePoster` 现在接受什么参数（可能已经带 `theme`，也可能没有——没有就补）。

## 目标

完成 v1.5 剩下的界面工作。规格：`docs/specs/dayfilm-v1.5.md`（R50–R53 的界面部分）。视觉：`docs/product/visual-language.md`。不要推倒重来，沿用现有结构。

## 可写范围

- `src/renderer/**`、`tests/renderer/**`、`docs/delegate/status-ui7.md`

不要改 `src/main/**`、`src/shared/**`、`package.json`、构建与打包配置。不要启动子 Agent。

## 必须完成

### 1. 海报主题接线（R50）

- `#exportPoster` 现在直接导出。改成点击后弹出一个轻量菜单（三个主题：经典 / 黑色电影 / 极简），选择后带主题导出；菜单用现有 `.drawer`/`.tip` 的视觉语言，不要新造弹窗。
- 把主题传进 `computePoster({ ..., theme })`；`paintPoster` 按主题取色（`posterPalette`）。
- 主题只记本次会话（模块内变量即可），重开回到经典。
- 测试：同一天三种主题下 `computePoster` 的画布尺寸一致、必含元素（日期/题材/三项数字）都在版心内；`minimal` 不产生胶片带与接触印相元素；`noir` 只产生一张接触印相。

### 2. 双日对比（R51）

- 胶片标题区（`#reelTitle` 附近）加"对比"次要按钮，打开浮层 `#compare`（hidden 默认）。
- 左右两栏各一个日期下拉（选项来自 `listDays()`，默认今天与上一个有数据的天），中间差异列。
- 每侧：题材 + 点评、三项数字、素材区间胶片带（复用族色与 `paintReel` 的绘制思路，按各自首尾铺满半宽）、进程前 3。
- 差异列：活跃时长差、镜头数差、每小时剪辑数差；正负分别用 `--amber`/`--silver`；文案只描述变化。
- 点任一侧胶片带：关闭浮层、切到该天日视图。
- 任一侧无数据：该侧空状态、差异显示"—"。
- 纯函数 `lib/compare-days.ts`：`compareDays(a: DayRollup | null, b: DayRollup | null)` → `{ left, right, diff: {label, current, previous, delta, unit}[] }`，测试覆盖两侧有数据、一侧为空、完全相等。

### 3. 片场日历（R52）

- 胶片标题区加"日历"入口，浮层 `#calendar`：7 行 × 12 列（近 12 周），每周一为行首。
- 数据：`listDays()` 取最近 84 天，按每批 7 个并发 `getDay`；加载中显示"已载入 N/84"，已载入的先渲染。
- 色阶：0 → 2px 暗格；>0 按活跃时长平方根映射 18%–82% 暖白；有镜头当天 1px 内描边。
- 悬停提示"日期 · 活跃 X 分钟 · 题材"；点击切日并关闭；Esc/背景点击关闭。
- 纯函数 `lib/calendar.ts`：`calendarCells(dates, today)` → 84 格（含周一前置空白），测试周对齐、跨月、缺失日期、空数据。

### 4. 导出 PDF 入口（R53 界面侧）

- 顶栏"导出剧本"旁加"导出 PDF"（次要样式），调 `state.source.exportPdf(date)`。
- `data.ts` 的 `DayfilmSource` 补 `exportPdf`：live → `window.dayfilm.exportPdf(date)`；mock → 返回 `{ path: '' }` 并提示"演示环境不支持导出 PDF"。
- 成功提示路径、取消提示"已取消"、失败显示可读错误（复用现有 toast）。

### 5. 放映快捷键事件（R54 界面侧）

- 主进程会发 `dayfilm:projection-toggle`。preload 里若已有 `onProjectionToggle` 就用；没有再在 `data.ts` 用一个可选订阅（`window.dayfilm.onProjectionToggle?.(cb)`），收到后切换放映态；没有该能力时忽略，不报错。

### 6. 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

不要跑 `npm run dev`。用 `npx vite src/renderer --port 5179` 配 mock 自查三处浮层与海报主题。

## 交付

`docs/delegate/status-ui7.md`：做了什么、文件清单、验证输出、未完成项（要如实写）。完成后结束本轮。
