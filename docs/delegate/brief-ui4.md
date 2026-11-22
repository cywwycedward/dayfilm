# 任务说明书：v1.2 一周电影（df-ui）

## 目标

在 v1.1 之上加"周"这一层：把七天剪成一部电影，而不是七份日报相加。规格见 \`docs/specs/dayfilm-v1.2.md\`（R30–R34），方向依据见 \`docs/agents/adr/0004-week-film-direction.md\`。

## 可写范围

- \`src/renderer/**\`、\`tests/renderer/**\`
- \`docs/delegate/status-ui4.md\`

不要改 \`src/main/**\`、\`src/shared/**\`、\`package.json\`、打包配置、其他文档。数据全靠现有 IPC：\`listDays\` / \`getDay\` / \`getSettings\`，不需要新通道。

## 界面骨架（主 Agent 验收要用的稳定 id）

- \`#modeDay\` / \`#modeWeek\`：日 / 周模式切换（segmented，可用两个 button）。
- 周模式容器 \`#weekFilm\`，内部依次是：
  - \`#weekRange\`：周范围文字，例如 \`11月16日 – 11月22日\`；两侧 \`#weekPrev\` / \`#weekNext\` 切换上一周/下一周；\`#weekToday\` 回到本周。
  - \`#weekArcs\`：七幕卡片。
  - \`#storyline\`：故事线带（行=项目/进程，列=七天），格子带 \`data-date\` 与 \`data-line\`。
  - \`#weekVerdict\`：一句周导演评语；\`#weekEvidence\`：可展开的证据表（默认折叠，用 \`<details>\`）。
  - \`#weekPicks\`：本周精选卡片。
- 周模式隐藏日模式的 \`#reelTitle/#week/#ruler/#track/#frameBox/#plan/#summary/#listTitle/#list\` 等，或整体替换容器；日模式保持现状。

## 必须实现

### 1. 周模式与切换（R30）

- 顶栏胶片区右上角加"日 / 周"切换，默认日。
- 周模式默认当前自然周（周一为起点）；\`#weekPrev/#weekNext\` 切换，\`#weekToday\` 回到本周。
- 取数：本周 7 天 + 上周 7 天，各 \`getDay(date)\`，并行；失败的日期按无数据处理。结果按日期缓存，切换周时只取缺失的。
- 周模式下点击任何镜头（七幕里的镜头、故事线格子、精选卡片）都要：切回日模式 → 载入该天 → 选中该镜头。

### 2. 七日叙事弧（R31）

- 每幕：日期+星期、当天主线（有项目规则时用项目名，否则进程名）、最长镜头时长、剪辑次数；有数据/无数据两种视觉。
- 主线 = 当天项目时长第一（无规则时进程时长第一）；并列取时长相同则按名称字典序，保证确定性。
- 故事线带：\`storylineRows\` 取一周内出现过的项目（无规则时进程名），按周总时长倒序取前 5；每格亮度 = 当天该项目时长 / 该行周最大值，取对数或平方根压缩；空格用暗底。
- 剧情标记：
  - 长主线：同一主线连续 >= 3 天，标记在该段的最后一幕（例如 \`Code · 连续 4 天\`）。
  - 换戏：某天主线与前一天不同，且当天主线在全周总时长为前二，标记"换戏"。
- 无项目规则时，故事线带下方给一句提示（可复用现有文案风格）。

### 3. 周导演评语（R32）

- \`buildWeekVerdict(thisWeek, lastWeek, projects)\` 纯函数，输出 \`{ sentence, evidence: {label, current, previous, delta}[] }\`。
- 比较三项：最长镜头时长、每小时剪辑数、活跃时长。按相对变化幅度排序取前两项写进句子，句子里的数字用现有格式化工具（时长用 \`fmtDuration\`/\`fmtMinutes\` 口径）。
- 句子只描述变化，例如："本周最长镜头是 42 分钟，比上周多 11 分钟；剪辑密度升到每小时 18 次。" 不要出现"效率""专注度""进展"等评价词。
- 上周完全无数据：\`这是第一周，还没有可以对比的上周。\`，证据表显示"—"。
- 证据表用 \`<details>\`，三行：本周 / 上周 / 变化。

### 4. 本周精选（R33）

- \`pickWeekHighlights(week)\` 纯函数，返回 5–7 条 \`{ reason, date, scene }\`，按规格顺序去重：
  1. 本周最长镜头（reason：本周最长镜头）
  2. 本周最密 30 分钟窗口里最长的镜头（reason：最密的 30 分钟）
  3. 各项目本周首次登场镜头（reason：<项目> 本周登场）
  4. 每次换戏当天的第一个镜头（reason：换戏 · <当天主线>）
  5. 本周最后一个镜头（reason：本周最后一镜）
- 最多 7 条；去重按 \`date + scene.start\`。
- 卡片显示理由、日期、时间、进程、标题、时长；点击跳转（见 R30.4）。
- 一周无镜头：显示空状态文案。

### 5. 测试

新增 \`tests/renderer/week-film.test.ts\` 与 \`tests/renderer/week-picks.test.ts\`，覆盖：

- \`mondayOf\`：周一起点、跨月、跨年、周日与周一边界。
- \`weekDates\`：7 天、顺序、字符串格式。
- 主线判定：并列、无数据、无项目规则回退进程。
- 故事线分桶：空格、亮度归一、最多 5 行。
- 长主线与换戏识别：连续 3 天、中间断一天、换戏的前二条件。
- 评语：正常对比、首周分支、三项变化幅度排序取前两。
- 精选：去重、上限 7、首尾镜头、空周。

### 6. 自检

\`\`\`powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
\`\`\`

不要跑 \`npm run dev\`（主 Agent 要用构建产物验收）。可用 \`npx vite src/renderer --port 5177\` 配 mock 自查；mock 需要能给出跨 14 天的数据，让周视图有内容。

## 交付

\`docs/delegate/status-ui4.md\`：文件清单、周视图的交互与视觉决策、验证输出、未完成项。完成后结束本轮。
