# 第二阶段界面状态（df-ui2）

任务来源：[brief-ui2.md](brief-ui2.md)，权威要求见 [dayfilm-delivery.md](../specs/dayfilm-delivery.md)（R10–R16）。
本轮补的是控制面与状态表达：设置面板、暂停/写入异常、长列表性能。

## 1. 交付范围

| 文件 | 本轮改动 |
| --- | --- |
| `src/renderer/index.html` | 顶栏加 `设置` 按钮；新增写入异常横幅；镜头列表改为 `scroll → spacer → ol` 三层；新增设置抽屉（保留期 / 脱敏词 / 常驻开关 / 数据位置 / 退出） |
| `src/renderer/src/app.ts` | 设置面板与焦点管理、`paused`/`storageError` 状态、虚拟列表渲染与 `revealRow` |
| `src/renderer/src/data.ts` | `DayfilmSource` 新增 `getSettings/setSettings/quit`；mock 用内存设置；`?mock=` 组合钩子 |
| `src/renderer/src/mock.ts` | `LiveState` 补 `storageError`/`paused`；新增 `dense` 密集模式（长列表验收用） |
| `src/renderer/src/lib/window.ts` | 新增：可见区间与滚动定位的纯函数 |
| `src/renderer/src/style.css` | 抽屉/面板/开关/词条 chip/写入异常横幅/暂停状态；列表改为固定行高（`--row-stride: 44px`）+ spacer + transform |
| `tests/renderer/window.test.ts` | 新增，16 个用例 |
| `tests/renderer/mock.test.ts` | 17 个用例（新增暂停/写入异常、密集模式 3 条） |
| `docs/delegate/status-ui2.md` | 本文件 |

未改动 `src/main/**`、`src/preload/**`、`src/shared/**`、`package.json`、`electron-builder.yml` 与其他文档。

## 2. 契约使用

- 设置类型与常量直接来自 `src/shared/settings.ts`：`RETENTION_OPTIONS` 渲染下拉，`BUILTIN_REDACT_TERMS`
  只读展示，`DEFAULT_SETTINGS` 作为面板初始值。
- `DayfilmSource` 新增 `getSettings()` / `setSettings(patch)` / `quit()`，与 `DayfilmApi` 一一对应。
- **preload 落后时不崩**：live 源按运行时实际暴露的成员判断（`Partial<DayfilmApi>`），缺哪个通道就返回
  `Promise.reject('当前构建未暴露 <通道名> 接口，重启应用后再试')`，面板把这句原文显示在状态行里，
  而不是假装保存成功。
- mock 模式设置存在内存里，`getSettings` 返回副本（避免界面改到 mock 的内部对象）；`quit()` 立即 resolve，
  界面提示"演示环境不会真的退出"。
- mock 自查钩子可组合（`?mock=a+b`，`+` 会被浏览器解码成空格，所以按 `[+,\s]` 切分）：
  `error`（采集错误）、`storage`（写入异常）、`burst`（783 个镜头的密集一天）、`readonly`（设置写入被拒）。

## 3. 设置面板

- **形态**：右侧抽屉（420px，`min(420px, 92vw)`），左侧 scrim 压暗背景；`role="dialog" aria-modal="true"`
  且 `aria-labelledby` 指向标题。之所以用抽屉而不是居中对话框：面板内容是逐条调整的设置项，右侧抽屉不遮住
  胶片，改保留期时还能看到界面本身。
- **焦点**：打开时 focus 落在"保留期"下拉（第一项可操作内容），关闭后固定回到 `设置` 按钮（触发器只有一个，
  不依赖 `document.activeElement`，程序化点击也能正确回焦）；`Tab/Shift+Tab` 在面板内循环，用
  `button/input/select/textarea/a[href]/[tabindex]` 白名单 + `offsetParent` 过滤不可见项；`Esc` 关闭。
  `设置` 按钮的 `aria-expanded` 跟随开关。
- **保留期**：选项来自 `RETENTION_OPTIONS`（7/30/90/365 天、不自动清理），`change` 立即 `setSettings`。
  旁边写明"启动时清理超出保留期的日文件，界面的日期列表只列出保留期内的日期"（R11）。
- **脱敏关键词**：已有关键词是带 `×` 的 chip（`aria-label="删除关键词 …"`，事件委托在容器上）；回车或点"添加"
  提交；重复词在本地拦下并提示；`BUILTIN_REDACT_TERMS` 以 `·` 分隔只读展示；固定说明
  "命中后标题显示为 [已隐藏]，只影响之后的新记录"（R10.5 的生效时间）。
- **常驻**：开机自启、暂停采样两个原生 checkbox（`accent-color` 走调色板），各触发一次
  `setSettings({ autoStart })` / `({ paused })`；注释说明与托盘菜单是同一个开关（R12.1）。
- **退出**：`退出 Dayfilm` 调 `quit()`，按钮旁注明"关闭窗口会收到托盘继续采样"；不做弹窗（brief 要求）。
- **数据位置**：等宽字体展示 `%APPDATA%\dayfilm\days\`。
- **失败路径**：任何一次 `setSettings` 抛错都会把设置回滚到提交前的值、重渲染控件、在面板底部用
  `data-kind="error"` 显示"保存失败：…"，面板保持打开，输入框里的关键词不清空。成功则显示"已保存"并在 4 秒后淡出。
  暂停开关成功后立刻把 `state.live.paused` 同步给实时条，不等下一轮 tick。

## 4. 状态表达

- `paused`：实时条文案"已暂停"（替代"正在拍摄/空闲中"），实时点与顶栏 chip 都变暖黄；chip 文案"已暂停"。
  "已持续"计时冻结在最后一轮 tick 的 `now`，不会一边暂停一边涨。
- `captureError` 优先于暂停：chip 变红显示"采集中断"，即使同时处于暂停状态。
- `storageError`：顶栏下方新增 `role="alert"` 横幅，暖黄配色（`#1c160d` 底 / `#4a3a1f` 边框 /
  `#f2e0bd` 文字），与采集错误的暖红（`#1b1010` / `#4a2320` / `#f0cfc6`）同形不同色，两条可以同时出现，
  采集错误在前。文案直接用主进程给的字符串；渲染侧只加标签"写入异常"。
- 关闭窗口收托盘的说明只出现在设置面板，不弹窗。

## 5. 长列表

- **结构**：`#listScroll`（唯一滚动容器）→ `#listSpacer`（`height = count × stride`）→ `<ol id="list">`
  （`position: absolute` + `translate3d(0, start × stride, 0)`）。视觉行高由 CSS 变量 `--row-stride: 44px`
  定义（按钮 42px + 2px 行距），JS 只在尺寸变化时读一次 `getComputedStyle(...).getPropertyValue('--row-stride')`。
- **区间**：`windowRange({ count, rowHeight, scrollTop, viewportHeight, overscan: 5 })` 全是纯函数，
  滚动时用 `requestAnimationFrame` 合并，事件里不读写布局。
- **行为保持**：键盘 `←/→/Home/End` 仍选镜头，`Enter` 用 `revealScrollTop(align: 'center')` 把该行滚进视野
  再聚焦（虚拟列表下不能再用 `scrollIntoView`）；点击列表行、点检索结果跨日定位也同样走 `revealRow`。
  换日期 / 换检索结果会把 `scrollTop` 归零，避免停在上一次的位置。
- **无障碍**：每行带 `aria-setsize` / `aria-posinset`，屏幕阅读器能读出"第 N 行，共 M 行"；
  `aria-current` 仍标在选中行上（只有渲染出来的行才有，选中项不在窗口内时由放大帧承担上下文）。
- **性能实测**：`?mock=burst` 生成 783 个镜头（spacer 34452px = 783 × 44），任意时刻只渲染 12–18 行；
  连续滚动 40 次的帧耗时中位数 16.5ms、p95 18.4ms、最大 18.5ms（约一帧），滚到底时最后一行就是最后一个镜头。

## 6. 验证结果

### 6.1 自检命令（brief 指定的三条，全部通过）

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 ✓ tests/renderer/window.test.ts (16 tests) 6ms
 ✓ tests/renderer/time.test.ts (12 tests) 4ms
 ✓ tests/renderer/hash.test.ts (9 tests) 6ms
 ✓ tests/renderer/still.test.ts (6 tests) 7ms
 ✓ tests/renderer/reel.test.ts (9 tests) 8ms
 ✓ tests/renderer/mock.test.ts (17 tests) 29ms
 Test Files  6 passed (6)
      Tests  69 passed (69)
   Duration  1.57s

PS> npm run build
out/main/index.js   39.83 kB   ✓ built in 207ms
out/preload/index.js 1.16 kB   ✓ built in 11ms
out/renderer/index.html                7.03 kB
out/renderer/assets/index-BMkQ0lL2.css 21.09 kB
out/renderer/assets/index-BHAURsAl.js  51.16 kB   ✓ built in 107ms
```

顺带（非 brief 要求，仅供参考）：`npm run typecheck` 全量通过，`npm test` 全量 19 文件 / 178 用例通过
（含主进程侧），说明本轮改动没有牵连其他实现者。

### 6.2 真实渲染与交互核对（headless Edge + DevTools Protocol，1440×900）

用 `npx vite src/renderer --port 5176` 起页面（自查完已停止，未运行 `npm run dev`）。实测输出原文：

```text
=== boot: chip / live / row count / structure
{"chip":"ok","chipText":"采集正常","live":"正在拍摄：Explorer · dayfilm","renderedRows":13,"spacerHeight":"1452px","listCount":"4 段中场休息 · 29 个镜头","scrollHeight":1452,"clientHeight":278}

=== virtualisation: scroll to middle
{"rows":18,"first":"11:57–12:01","last":"17:15–17:30","transform":"translate3d(0px, 352px, 0px)","ariaPos":"9","ariaSize":"33"}

=== virtualisation: scroll to bottom
{"rows":12,"last":"19:04–19:39","lastIsLastScene":true}

=== keyboard: End selects last scene, Enter reveals and focuses its row
{"activeId":"2026-11-22-33","activeVisible":true,"focused":"BUTTON","focusedId":"2026-11-22-33","live":"镜头详情：19:04–19:39，Explorer，dayfilm，35 分 07 秒"}

=== settings panel: open, focus, load
{"open":true,"role":"dialog","modal":"true","focused":"settingRetention","retention":"30","options":["7 天","30 天","90 天","365 天","不自动清理"],"builtin":"1password · keepass · bitwarden · lastpass · incognito · inp","status":""}

=== settings: change retention -> saved
{"value":"90","status":"已保存","kind":"ok"}

=== settings: add + remove a redact term
{"afterAdd":["secret-project×"],"afterRemove":["还没有自定义关键词"],"inputCleared":true,"status":"已保存"}

=== settings: paused toggle -> live bar + chip yellow
{"checked":true,"live":"已暂停","chip":"paused","chipText":"已暂停","status":"已保存"}

=== settings: autoStart toggle + quit in mock
{"autoStart":true,"status":"演示环境不会真的退出","buttonEnabled":true}

=== settings: tab trap wraps, Esc closes and restores focus
{"wrapped":true,"closed":true,"focusBack":"settings","expanded":"false"}

=== paused chip is amber, not red
{"chipColor":"rgb(240, 196, 128)","dotColor":"rgb(240, 196, 128)","liveDot":"rgb(240, 196, 128)"}

=== both banners (?mock=error+storage): error priority, amber vs red
{"capture":"采样子进程已退出（代码 1），30 秒后重试","storage":"写入 days\\2026-11-22.jsonl 失败（磁盘空间不足），采样已转入内存缓冲并重试","chip":"error","chipText":"采集中断"}
{"captureBg":"rgb(27, 16, 16)","captureBorder":"rgb(74, 35, 32)","storageBg":"rgb(28, 22, 13)","storageBorder":"rgb(74, 58, 31)","stacked":true}

=== burst (?mock=burst): 500+ rows
{"listCount":"783 个镜头","spacer":"34452px","renderedRows":13,"total":783}
{"samples":41,"medianMs":16.5,"p95Ms":18.4,"maxMs":18.5,"rowsNow":12}
{"rows":12,"lastClock":"19:41–19:42","lastIsEnd":true}

=== readonly (?mock=readonly): 保存失败要报错且回滚
{"before":"30","after":"30","status":"保存失败：演示环境：设置只读，写入被拒绝","kind":"error","panelStillOpen":true}
{"chips":["还没有自定义关键词"],"status":"保存失败：演示环境：设置只读，写入被拒绝","inputKept":"x-secret"}
{"status":"演示环境不会真的退出"}

=== 检索跨日定位（虚拟列表下）
{"rows":13,"crossDay":6,"first":"17:30–17:40"}
{"date":"2026-11-20","listTitle":"检索结果","activeId":"2026-11-20-29","activeRendered":true,"time":"20:55 / 24:00","frame":"capture.ps1 - dayfilm - Visual Studio Code"}
{"search":"","listTitle":"镜头列表","scrollTop":0,"renderedRows":13}
```

抽屉遮罩也量了：`drawer 1440×900`、`scrim 1440×900 rgba(3,4,6,0.62) opacity 1`、`panel left 1020 width 420`；
截图里同一段标题文字的亮度从 157 降到 62（≈0.4 倍），遮罩确实生效。

截图（临时目录，未入库）：`%TEMP%\dayfilm2-panel.png`（设置抽屉打开）、`%TEMP%\dayfilm2-banners.png`
（采集错误 + 写入异常两条横幅）、`%TEMP%\dayfilm2-burst.png`（783 镜头的密集一天）、`%TEMP%\dayfilm2-main.png`。

### 6.3 过程中修掉的问题

1. 面板打开时 `panelTrigger` 取 `document.activeElement`，程序化点击下是 `<body>`，Esc 后焦点没回到按钮；
   改为固定回到唯一的触发按钮。
2. `?mock=error+storage` 里 `+` 被 URL 解码成空格，模式解析没切分，两个横幅都不出现；
   切分改为 `[+,\s]+`，并支持任意组合。
3. 密集模式最初只生成 399 行，够不上"500+"的验收口径；把镜头时长收到 18–54 秒后是 783 行，
   测试阈值定在 `> 500`。
4. 密集模式下镜头不是整分钟，`seconds * 1000 === end - start` 出现浮点误差；测试改为按毫秒四舍五入比较。

## 7. 未完成项与需要主 Agent 处理的事项

1. **真实 Electron 下的设置通道没跑过**（本轮按要求只跑 `npx vite` + mock；`npm run dev` 留给主进程侧）。
   `out/preload/index.js` 已经是 1.16 kB，说明 preload 已补上 `getSettings/setSettings/quit`，但界面侧只验证了
   mock 源与"通道缺失时报错"的守卫分支。建议用 `node scripts/probe-app.mjs` 时顺手点一次设置面板。
2. **暂停与托盘的联动无法在渲染层验证**：界面只提交 `{ paused }` 并展示 tick 里的 `live.paused`；
   托盘菜单点是另一条路径，需要主进程侧确认两边读到同一份设置。
3. **写入异常文案来自主进程**：界面只加"写入异常"标签，若主进程希望展示"已缓冲 N 条"之类的细节，
   需要把信息放进 `storageError` 字符串（或另加字段，那要改契约）。
4. **虚拟列表假定固定行高**：`--row-stride` 变了会重测（ResizeObserver + 读取 CSS 变量），但行内内容
   （超长标题换行等）若把某行撑高会破坏对齐——当前所有行内文本都是单行省略，靠 CSS 保证。
5. **`?mock=burst|readonly|storage|error` 是自查钩子**，留在 `src/renderer/src/data.ts`；不想在产品里保留可删除。
6. **搜索仍保留 200 条上限**（主进程定的），虚拟列表只负责渲染；若之后放开上限，界面不需要改。
7. **浅色模式、`prefers-contrast`** 仍未做（第一阶段已记录，非本轮范围）。

## 8. 评审复查修复（[review-delivery.md](review-delivery.md) 阻断项第 1 条）

评审指出：常驻过零点与"每日首次启动"时，界面停在昨天的胶片/汇总/列表，新一天不在下拉框里。
本轮按四条要求修正，文件仍限于 `src/renderer/**`、`tests/renderer/**`。

新增文件：`src/renderer/src/lib/date-follow.ts`（日期跟随判定，纯函数）、
`tests/renderer/date-follow.test.ts`（7 个用例）。改动：`app.ts`、`index.html`、本文件。

### 8.1 日期跟随

- **纯函数** `followDate({ current, today, browsingHistory, liveDate, knownDates, refreshedFor })`
  → `{ nextDate, refreshDates }`：
  - 未在翻历史且 `current !== liveDate`：只有 `liveDate === today` 时切换到它（异常时钟不会把界面带走），并刷新列表；
  - 未在翻历史且 `current === liveDate`：只在“今天还没进过日期列表、且没为这一天补拉过”时刷新一次；
  - 正在翻历史：`nextDate` 恒为 `null`，只在实时日期还没出现在下拉里时补拉一次（不打断视图）。
- **启动默认今天**：`boot()` 不再 `dates.includes(today) ? today : dates[0]`，直接 `const date = today`；今天没有日文件时
  `renderDates()` 会把当前日期补进选项（`[state.date, ...state.dates]`），所以下拉框里始终有今天，胶片走空状态。
- **tick 跟随**：`handleTick` 每 2 秒算一次 `followDate`；`nextDate !== null` 时 `loadDate(nextDate)`（重取当天汇总、归零
  滚动、重置回放），`refreshDates` 时重拉 `listDays()` 并重渲染下拉；`datesRefreshedFor` 记住已补拉过的日期，
  同一天不会每轮 tick 重复拉。
- **历史不被拉回**：`loadDate()` 用 `date !== isoDate(Date.now())` 维护 `state.browsingHistory`；用户点日期下拉、
  点跨日检索结果都走这里，所以主动翻历史后即使跨零点也停在原处（下拉框仍会补上新的一天）。
- **保留期变更**（评审 R11.3 界面侧）：`applySettings` 成功后若 `patch.retentionDays !== undefined`，
  清掉 `datesRefreshedFor` 并 `refreshDates()`，删掉的日期不会留在下拉框里。

### 8.2 CSP

`src/renderer/index.html` 的 CSP 补上 `object-src 'none'; base-uri 'none'; form-action 'none'`，
`script-src 'self'`、无 `eval`、无远程源保持不变。脱敏词表单是 `<form>` + `preventDefault()`，
`form-action 'none'` 不影响它（提交不发生导航）；实测添加关键词仍然成功且零 CSP 违规。

### 8.3 验证（本轮三条命令 + 跨零点实测）

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 ✓ tests/renderer/date-follow.test.ts (7 tests) 6ms
 ✓ tests/renderer/still.test.ts (6 tests) 7ms
 ✓ tests/renderer/window.test.ts (16 tests) 8ms
 ✓ tests/renderer/time.test.ts (12 tests) 7ms
 ✓ tests/renderer/hash.test.ts (9 tests) 9ms
 ✓ tests/renderer/reel.test.ts (9 tests) 7ms
 ✓ tests/renderer/mock.test.ts (17 tests) 35ms
 Test Files  7 passed (7)
      Tests  76 passed (76)
   Duration  1.58s

PS> npm run build
out/main/index.js   44.20 kB   ✓ built in 251ms
out/preload/index.js 1.16 kB   ✓ built in 24ms
out/renderer/index.html                7.09 kB
out/renderer/assets/index-BMkQ0lL2.css 21.09 kB
out/renderer/assets/index-BfvAa5mR.js  52.42 kB   ✓ built in 140ms
```

`date-follow.test.ts` 覆盖评审点名的四种情形：过零点跟随、用户看历史不跟随、今天无数据也切到新今天、
同一天不重复刷新；另外补了“补拉后即使日文件还没建也不再重拉”“实时日期不是今天时不跟随”
“启动时今天不在列表里也不退回旧日期”。

跨零点用可挪动的时钟（`Page.addScriptToEvaluateOnNewDocument` 里替换 `Date.now`）在真实页面上实测，
三个场景互不干扰，均为原文输出：

```text
# A 常驻过零点：23:58 启动（今天有数据）→ 跨到次日 00:02
boot : {"dateValue":"2026-11-22","dateLabel":"今天 · 11月22日 周日","listCount":"5 段中场休息 · 41 个镜头","reelTitle":"今日胶片"}
tick : {"dateValue":"2026-11-23","dateLabel":"今天 · 11月23日 周一","options":["2026-11-23","2026-11-22","2026-11-21"],"reelTitle":"今日胶片"}
next : {"dateValue":"2026-11-23","listCount":"1 个镜头"}   ← 再过一轮 tick 不重复切换
csp  : {"violations":[]}

# B 用户主动翻历史：选 11-21 后跨零点
pick : {"picked":"2026-11-21","dateValue":"2026-11-21","reelTitle":"当日胶片"}
tick : {"dateValue":"2026-11-21","reelTitle":"当日胶片","optionCount":4,"optionsHead":["2026-11-23","2026-11-22"]}   ← 视图不动，下拉框补上新一天

# C 每日首次启动：次日 00:00:30，当天还没有日文件
boot : {"dateValue":"2026-11-23","dateLabel":"今天 · 11月23日 周一","listCount":"0 个镜头","emptyShown":true,"emptyText":"还没有拍摄任何素材","frameTitle":"还没有拍摄任何素材","reelTitle":"今日胶片","live":"空闲中"}
retention : {"rebuilt":true,"firstOption":"今天 · 11月23日 周一","status":"已保存"}   ← 改保留期后下拉重建
form  : {"chips":["csp-check×"],"status":"已保存","violations":[]}
```

截图（临时目录）：`%TEMP%\dayfilm3-rollover.png`（跨零点后的新一天）、`%TEMP%\dayfilm3-empty.png`
（当天无文件时的空状态）；构建产物里的 CSP 已带三个新指令。

### 8.4 本轮遗留

1. 历史模式下只补下拉框、不拉回视图是刻意的；如果产品希望“看历史时底部提示『今天的胶片已开始』”，
   需要另加一条提示，不在本轮范围。
2. `datesRefreshedFor` 是会话内的一次性标记：同一天最多自动补拉一次；若主进程在这一天后半段才建日文件，
   用户手动切一次日期或改一次保留期即可刷新（切日期本身也会 `listDays` 之外重新渲染）。
3. 本轮未在真实 Electron 下跑跨零点（用 `Date.now` 挪动时钟在浏览器里复现）；真机过零点的行为与
   本节证据同源（同一段 `followDate` + tick 接线）。
