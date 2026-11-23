# 任务说明书：v1.5 界面（df-ui）

## 目标

v1.5 的三件界面工作：海报三主题、双日对比、片场日历；外加 `exportPdf` 的界面入口与 mock。规格见 `docs/specs/dayfilm-v1.5.md`（R50–R52、R53 的入口），视觉见 `docs/product/visual-language.md`。

## 可写范围

- `src/renderer/**`、`tests/renderer/**`
- `docs/delegate/status-ui7.md`

不要改 `src/main/**`、`src/shared/**`、`package.json`、构建与打包配置。

## 契约变化

`src/shared/ipc.ts` 新增 `exportPdf(date)`（主进程实现，另一位负责）。你的 `data.ts` 里 `DayfilmSource` 需要补 `exportPdf`：live 模式转调 `window.dayfilm.exportPdf`，mock 模式用一个可下载的占位 PDF 文本或直接返回空路径并提示"演示环境不支持"，不要崩。

## 必须实现

### 1. 海报三主题（R50）

- 导出海报时先选主题：在"导出海报"按钮上挂一个轻量菜单（经典 / 黑色电影 / 极简），选择后生成并保存。
- `lib/poster.ts` 的纯参数增加 `theme: 'classic' | 'noir' | 'minimal'` 维度：
  - `classic`：现有版式。
  - `noir`：近黑底 + 强侧光（左侧一道 12% 宽的暖白渐变），只用暖白与一处强调红；只留一张最大的接触印相（最长镜头），胶片带压成 8px 细缝；标题字距收紧 0.06em。
  - `minimal`：纸白底（`#efece4`）+ 墨黑字（`#14161a`），无胶片带、无接触印相；日期、题材、三项数字、当日之最、手记（有则显示）竖向排布，留白为主。
- 三套主题共用同一份数据，测试断言：同一天在三种主题下的画布尺寸一致、必含元素（日期/题材/三项数字）都在版心内、noir 只有一张印相、minimal 没有胶片带。
- 主题选择只记本次会话。

### 2. 双日对比（R51）

- 胶片标题区加"对比"入口（次要按钮），打开对比浮层 `#compare`：左右两栏各一个日期选择（默认今天与上一个有数据的日期），中间差异列。
- 每侧显示：题材 + 点评一句、三项数字（活跃/镜头/剪辑）、素材区间胶片带（各自按首尾铺满所在半宽、用族色块）、进程前 3。
- 差异列：活跃时长差、镜头数差、每小时剪辑数差，正负分别用暖色/银色；文案只描述变化（如"活跃 +18 分钟"），不做评价。
- 点任一侧胶片带：关闭浮层并切到该天日视图。
- 任一侧无数据：该侧空状态，差异显示"—"。
- 纯函数 `compareDays(a, b)` 返回差异数组，测试覆盖两侧有数据、一侧为空、完全相等。

### 3. 片场日历（R52）

- 胶片标题区加"日历"入口，打开浮层 `#calendar`：7 行（周一至周日）× 12 列（近 12 周）。
- 数据：取 `listDays()` 中最近 84 天，按每批 7 个并发 `getDay`；加载中显示"已载入 N/84"，已载入的格子先渲染。
- 色阶：活跃时长 0 → 2px 暗格；>0 按平方根映射到 18%–82% 的暖白；当天有镜头时格内 1px 内描边。
- 悬停显示"日期 · 活跃 X 分钟 · 题材"；点击切到该天并关闭浮层；Esc 或点背景关闭。
- 纯函数 `calendarGrid(dates, today)` 返回 84 格（含前置空白对齐周一），测试覆盖周对齐、跨月、缺失日期。

### 4. 导出入口

- 顶栏"导出剧本"旁加"导出 PDF"，调 `source.exportPdf(date)`；成功提示路径，取消提示"已取消"，失败显示可读错误。

### 5. 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

不要跑 `npm run dev`。mock 自查可继续用 `npx vite src/renderer --port 5179`。

## 交付

`docs/delegate/status-ui7.md`：文件、视觉与交互决策、验证输出、未完成项。完成后结束本轮。
