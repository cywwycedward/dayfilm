# 任务说明书：v1.1 界面（df-ui）

## 目标

把 v1.1 的新玩法做出来：时间轴缩放与周视图、项目标签、导演手记、海报导出、高光。权威要求见 `docs/specs/dayfilm-v1.1.md`（R20–R26）。

## 可写范围

- `src/renderer/**`
- `tests/renderer/**`
- `docs/delegate/status-ui3.md`

不要改：`src/main/**`、`src/preload/**`、`src/shared/**`、`package.json`、打包配置、其他文档。

## 已更新的契约（直接用）

- `src/shared/settings.ts`：`Settings.projects: { name, terms }[]`。
- `src/shared/projects.ts`：`matchProject` / `totalByProject`（不要另写一套）。
- `src/shared/ipc.ts`：`getNote(date)`、`setNote(date, text)`、`saveImage(defaultName, pngBase64)`。

## 必须实现

### 1. 时间轴缩放与平移（R20）

- 胶片视窗用 `{ startMs, spanMs }` 表示，缩放 1x–48x，跨度夹紧在 30 分钟–24 小时。
- 滚轮缩放以指针位置为锚点；按住拖动平移；工具栏加 `-` / `+` / `回到全天`。
- 刻度自适应：>12h 每 6 小时、>3h 每 1 小时、>1h 每 15 分钟、否则每 5 分钟。
- 平移夹紧到 0:00–24:00；选中镜头与"现在"不会因缩放丢失（选中时自动保证可见）。
- 纯函数放 `src/renderer/src/lib/zoom.ts` 并测试：缩放锚点、夹紧、刻度步长、可见区间、布局映射在缩放下的正确性。

### 2. 周视图（R21）

- 胶片上方 7 格迷你条：每格表示一天 24 小时，把当天非空闲镜头按 24 桶着色（桶内有时长>0 即点亮，亮度随时长对数增长）。
- 点击切日；选中天描边高亮；读取失败的天显示空桶。
- 数据：`listDays()` + 最近 7 天各 `getDay(date)`（并行），失败跳过。
- 纯函数 `buildWeek(dates, days)` 与分桶 `dayBuckets(day, 24)` 放 `lib/week.ts` 并测试。

### 3. 项目标签（R22）

- 设置面板新增"项目"分区：已有项目以卡片展示（名称 + 关键词，逗号分隔，可删除），下方表单添加新项目（名称 + 关键词）。
- 汇总面板在进程排行之后加"项目"分区（最多 5 个，倒序，横条），没有规则时显示"在设置里加一条项目规则，把镜头归到故事线上"。
- 镜头列表在进程名后显示项目小标签（有命中时）。

### 4. 导演手记（R23）

- 题材下方一个单行/多行输入（最多 200 字），停止输入 600ms 自动保存，右上角显示字数。
- 空时占位"写一句今天的评语…"；保存失败显示可读错误并保留内容。
- 切换日期时加载该天手记；mock 模式存内存。

### 5. 海报导出（R24）

- 顶栏"导出海报"按钮（放在"导出剧本"旁）。
- 用离屏 canvas 画 1600×1000 海报：日期与星期大字、题材与点评、活跃/镜头/剪辑三项数字、当日胶片缩略（复用已有剧照绘制）、进程前 4、项目前 3（有则画）、最长镜头、手记（有则画）。
- `canvas.toDataURL('image/png')` 去掉前缀后调 `saveImage('dayfilm-<date>.png', base64)`；返回空路径视为取消，给一句提示；异常显示可读错误。
- 海报绘制拆成纯参数计算（`lib/poster.ts`：布局矩形、文字行、缩略胶片段位置）并测试；绘制函数只做 ctx 调用。

### 6. 高光（R25）

- 汇总面板下方或镜头列表上方一行三张卡片：最长镜头、最密 30 分钟、时长第一的进程。
- 点击"最长镜头"卡片选中该镜头并定位（复用现有选中逻辑）；当天无镜头时整块隐藏。
- 纯函数 `pickHighlights(day)` 放 `lib/highlights.ts` 并测试（含空日、并列、边界 30 分钟窗口）。

### 7. mock 与测试

- mock 数据要同步支持：项目规则（默认给两条示例规则，让界面有内容可看）、手记、周视图其它日期已有。
- `tests/renderer` 新增 zoom/week/poster/highlights 四个文件的测试，并保持既有 69 例不回归。

## 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

全量 `npm run typecheck` 会连带主进程侧（另一位实现者正在改），失败时先确认不是你的文件。不要跑 `npm run dev`，可用 mock 起静态服务自查。

## 交付

`docs/delegate/status-ui3.md` 写清文件、交互与视觉决策、验证输出、未完成项，然后结束本轮。
