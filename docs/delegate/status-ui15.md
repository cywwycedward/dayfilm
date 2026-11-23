# status-ui15：放映音效设置 / 批量标记 / 自动花絮标签 / 周电影正片口径

范围：`src/renderer/**`、`tests/renderer/**`、本文件。契约（`Settings.sound`、`Settings.autoExtraUnderSec`、
`Scene.markSource`、`DayRollup.featureMs/extraMs`）已就绪，按契约写；`src/main/**`、`src/shared/**`、
`package.json`、构建配置未改。

## 1. 放映音效（设置 → 放映音效）

- 设置抽屉「常驻」分区加了「自动花絮」自绘下拉（`AUTO_EXTRA_OPTIONS`，写 `autoExtraUnderSec`），下面新开「放映音效」分区：
  模式二选一（`放映机 + 剪辑` / `仅剪辑`，按钮组 + `aria-pressed`）与音量滑杆（0–100、步进 5，右侧读数）。
- `projection-audio.ts` 新增 `setVolume(v)` / `setMode(m)`：
  - 底噪增益 = `0.04 × volume`、咔哒 = `0.26 × volume`（volume 0.35 时与旧手调值 0.014 / 0.091 一致），`volume 0` 时 `click()` 直接返回、`level()` 也返回 0；
  - `cuts` 模式关掉底噪与 analyser（电平条随之全暗），但保留 `AudioContext` 给咔哒；
  - `setEnabled(false)` / `dispose()` 会停底噪并释放 AudioContext。
- 界面改动即时生效：`applySound()` 先把音量/模式同步到 `projectorAudio`，再 `setSettings({ sound })`；
  进入放映前也按当前设置 `setVolume`/`setMode` 一次。
- mock 的设置存在内存里（原有逻辑）。

## 2. 批量标记（`···` 菜单）

- `···` 菜单新增三项：`把今天 10 秒以下的镜头标为花絮`、`按设置自动标记`、`清除今天的全部标记`（带一个「导演剪辑版」小标签）。
- 逐条串行调用 `setMark(date, start, mark)`，上限 200 条，结束后用最后一个返回的 `DayRollup` 刷新当日数据并 toast；
  当天没有镜头时三个菜单项 `disabled`（`renderBulkState()`）。
- `按设置自动标记` 用当前 `autoExtraUnderSec`（为 0 时提示先去设置里选阈值），不改设置本身。
- `清除今天的全部标记` 用两段式确认：第一次点提示「再点一次…确认（4 秒内有效）」，4 秒内再点才真正清除——沿用已有的 toast，没有新造弹窗。

## 3. 自动花絮的视觉

- 列表行：`markSource === 'auto'` 的标签显示「花絮（自动）」，透明度比手动低一档（`.shot__mark.is-auto { opacity: .68 }`）；
  hover 的「正片 / 花絮」按钮仍可覆盖（覆盖后主进程按手动记）。
- 脊柱：花絮帧照旧降饱和 + 45° 斜纹（自动/手动一样）。
- 右栏正片/花絮行：「花絮 X 分（含自动 Y 分）」，Y 只在 > 0 时出现。
- mock 的 `setMark` 会按阈值推断 `markSource`（`extra` 且时长 < `autoExtraUnderSec` → `auto`），方便本地演示与自查。

## 4. 周电影只算正片

- `lib/week-film.ts`：
  - `weekEntries` 排除花絮；`weekMetrics` 在有花絮的天用 `featureMs` 与「正片镜头间的剪辑数」，没有花絮时保持原来的 `day.activeMs/day.cuts`（不动既有口径）；
  - `mainLineOf` 与 `buildStoryline` 过滤花絮；`ActModel` 新增 `extraMs`，每幕卡片右下角加一行 10px 银灰「花絮 X 分」（有才显示）；
  - `buildWeekVerdict` 在本周花絮占比 > 10% 时补一句「；其中花絮占 X%。」；
  - 本周精选走 `film.entries`，因此自动不含花絮镜头。
- 测试：`tests/renderer/week-film.test.ts` 新增 3 例（花絮不计入周统计/剪辑数/最长镜头、主线与每幕 `extraMs`、周评语花絮占比）。

## 5. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run                          50 files / 635 passed（renderer 26 / 348 + week-film 新增 3）
npm run build                           css 82.42 kB / js 185.61 kB
```

界面自查（dev server + mock + 自建 BrowserWindow）：

```text
设置     {"autoExtra":"不自动标记","modeProjector":"true","modeCuts":"false","volume":"35"}
改音效   {"modeCuts":"true","label":"60"}（滑杆 60 → 0.60）
批量菜单 三项均 disabled:false（当天有镜头）
自动标记 ?mock=burst + 阈值 30 秒 → notice「已标记 128 条」，
         stats「正片 7 小时 05 分 花絮 50 分（含自动 50 分）」，autoTags ["花絮（自动）","花絮（自动）"]
周视图   arc__extra ["花絮 50 分"]，周评语「…；其中花絮占 11%。」
```

## 6. 未完成 / 已知问题

1. **主进程的自动规则没有联调**：界面只负责传 `autoExtraUnderSec` 与渲染 `markSource`；自动标记真正由谁写 `markSource` 取决于主进程实现，
   本轮只在 mock 里按阈值推断。
2. **批量标记没有进度反馈**：200 条串行 `setMark` 期间只有最后的 toast，没有进度条；大文件时可能感觉卡一下。
3. **「清除全部标记」的两段式确认是 toast 文案，不是可点确认**：4 秒窗口内再点菜单项才生效，误点风险低但不符合“按钮式确认”。
4. **放映音效的音量只作用于本进程的 WebAudio**：没有跟随系统音量；`cuts` 模式下电平条恒暗（因为没有底噪可测），
   这是产品上可接受的取舍，但没有专门提示用户。
5. **`weekMetrics` 在没有花絮时仍用 `day.activeMs/day.cuts`**：为了不破坏既有周统计口径；有花絮时才切到 `featureMs` 与重算剪辑数，
   两种口径在同一天有/无花絮时会有细微差异（activeMs 不含中场休息的口径不变）。
