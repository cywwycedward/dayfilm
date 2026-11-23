# status-ui13：导演剪辑标记 / 片场日历题材色相 / 首次运行引导

范围：`src/renderer/**`、`tests/renderer/**`、本文件。概念图 [ui-concept-v4-editing.png](../product/ui-concept-v4-editing.png)（A/B/C）。
`src/main/**`、`src/shared/**`、`package.json`、构建配置未改。

## 1. 测试夹具与 mock 的 featureMs / extraMs

- `DayRollup` 新增 `featureMs` / `extraMs` 后，三个测试夹具补齐：
  - `tests/renderer/week-film.test.ts`、`week-picks.test.ts`：`featureMs = 镜头时长合计`、`extraMs = 0`；
  - `tests/renderer/week.test.ts`：`featureMs: 0, extraMs: 0`。
- `src/renderer/src/mock.ts` 的 `rollup()` 现在累加 `featureMs` / `extraMs`（`scene.mark === 'extra'` 计入花絮，其余计正片），
  生成的 `DayRollup` 两个字段齐全。
- `src/renderer/src/data.ts`：mock 端维护 `marks` Map（`${date}|${start}` → feature/extra），`dayFor` 与 `liveNow` 都会把标记合并回
  `scenes` 并重算 `featureMs`/`extraMs`；`DayfilmSource.setMark` 上线（live → `window.dayfilm.setMark`，缺失时报可读错误）。

## 2. B 块 · 片场日历题材色相

- `lib/calendar.ts` 新增 `GENRE_PALETTE` / `NO_RECORD_PALETTE` / `cellPalette(genre, level)`：
  无记录 `H0 S0 B8`、长镜头 `H200 S35 B55`、标准剪辑 `H45 S8 B58`、快切 `H48 S38 B68`、跳切风暴 `H30 S62 B82`；
  亮度在基色上按活跃度 ±6 微调（`B = base − 6 + level × 12`，夹在 8–92）。
- 格子 24×24、gap 2；格子背景改成 `hsl(hue sat% lum%)`；选中日（当前 `state.date`）1px 琥珀外描边 + 内阴影。
- 右侧图例：`#calendarLegend` 五条「题材 · H/S/B」+ 色块，面板宽度随内容（`.calendar-wrap` flex）。
- 测试：`tests/renderer/calendar.test.ts` 新增 3 例（调色板取值、亮度随活跃度单调、格子带题材色相且未知题材回落标准剪辑）。

## 3. A 块 · 导演剪辑版标记

- 列表行：`scene.mark === 'extra'` → 整行 `opacity: .56`、左侧 2px `#9aa0a6` 竖条、标题后「花絮」小标签（12px、`#9aa0a6`、4% 底）。
- 悬停行右侧出现两个 24px 高按钮「正片 / 花絮」（内距 12、间距 8），当前态琥珀底黑字；点击 `markScene()`
  → `state.source.setMark(date, scene.start, mark)`（再点同态即清除）→ 用返回的 `DayRollup` 整份刷新当日数据与列表。
- 脊柱：花絮帧叠 42% 墨色 + 45° 斜纹（降饱和 40%）。
- 今日统计下方新增一行「正片 X · 花絮 Y」：正片 16px 暖白、花絮 12px `#9aa0a6`。
- 端到端自查（dev server + mock）：点第一行的「花絮」后返回
  `{extra: true, opacity: "0.56", tag: "花絮", marks: "正片 6 小时 10 分 · 花絮 18 分"}`。

## 4. C 块 · 首次运行引导

- `index.html` hero 内新增 `#onboarding` 卡片：左侧场记板素材（`clapper-strip.png` + 暗渐变）+ PRODUCTION/SCENE/TIME CODE 字样；
  右侧标题「今天还没有镜头。准备开始拍摄。」+ 三条说明 + 两个按钮 + 「首次运行，不打断使用。」。
- 按钮规格按概念图：主按钮高 40 / 内距 20 / `#e8b45a` 底 + `#0a0b0d` 字；次按钮高 40 / 1px `#454a50` 描边 / `#131518` 底 + `#ece7dc` 字。
- `renderOnboarding()`：`state.day.scenes.length === 0 && localStorage['dayfilm.onboarded'] !== '1'` 时显示，
  同时隐藏剧照与高光；主按钮写入 `dayfilm.onboarded = '1'` 并重绘，次按钮打开设置抽屉。

## 5. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run tests/renderer            26 files / 348 tests passed（calendar 9 例）
npx vitest run（全量）                    50 files / 615 tests passed
npm run build                           css 78.27 kB / js 176.33 kB
```

界面自查（`npx vite src/renderer --port 5182` + mock + 自建 BrowserWindow）：

```text
MARK     {extra: true, opacity: "0.56", tag: "花絮", marks: "正片 6 小时 10 分 · 花絮 18 分"}
CALENDAR {size: 24, bg: "rgb(110, 160, 185)"（hsl 200 35% 58%）, legend: 5 条, selected outline: "rgb(232, 180, 90)"}
```

## 6. 未完成 / 已知问题

1. **截图全为 0 字节**：本轮 `capturePage()` 在 `%TEMP%\ui13\` 产出的三张图都是空文件（窗口已聚焦并等了 600ms 仍是 0），
   所以视觉证据只有上面的 DOM 断言；下一轮换 `probe-v20` 或换机器再截。
2. **`node scripts/probe-v20.mjs` 仍然跑不了**：打包版 Dayfilm 正在运行（5 个进程、单实例锁），第二个实例直接退出。
3. **首次运行引导没有真机截图**：mock 的每一天都有数据，触发不了空日；引导只按代码路径实现，
   需要主进程造一个空日文件才能验证（`localStorage` 键、按钮行为也没在真机点过）。
4. **花絮标记只在 mock 上验证**：主进程的 `setMark` 契约（返回整份 `DayRollup`）已接上，但没有真机 IPC 回归。
5. **日历选中日的「内阴影」用的是 `inset 0 1px 2px` 近似**：概念图写的是 (0,0,0,0.30)，深浅随格子亮度略有差异。
6. **旧版遗留 CSS 仍未清理**（status-ui9 记的约 700 行）。
