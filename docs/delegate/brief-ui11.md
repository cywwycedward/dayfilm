# 任务说明书：v2.6 音效控制、批量标记、周电影正片口径（df-ui2）

## 目标

三件收尾：

1. 放映音效可调（设置里选模式与音量），避免"太吵"只能靠改代码。
2. 导演剪辑版的批量操作（更多菜单）。
3. 周电影按正片/花絮分开统计。

## 可写范围

`src/renderer/**`、`tests/renderer/**`、`docs/delegate/status-ui15.md`。不要改 `src/main/**`、`src/shared/**`、`package.json`、构建配置。

## 契约（已就绪）

- `Settings.sound: { mode: 'projector' | 'cuts'; volume: number }`（默认 `{ projector, 0.35 }`）。
- `Settings.autoExtraUnderSec: number`（0/3/10/30，主进程侧实现自动花絮规则；界面只提供选择）。
- `Scene.markSource?: 'manual' | 'auto'`；`DayRollup.featureMs / extraMs` 已存在。

## 必须实现

### 1. 音效控制

- 设置抽屉"常驻"分区下方加"放映音效"：模式二选一（`放映机 + 剪辑` / `仅剪辑`）与音量滑杆（0–100，映射 0–1，步进 5）。
- 改动即时生效：调用 `setSettings({ sound })`；放映中改音量也要实时反映到 `projectorAudio`（新增 `setVolume(v)` 与 `setMode(m)`，关闭时释放 AudioContext）。
- 放映态电平条继续工作，音量 0 时电平条全暗。
- mock 模式存内存。

### 2. 批量标记（`···` 菜单）

- 新增三项：`把今天 10 秒以下的镜头标为花絮`、`清除今天的全部标记`、`按设置自动标记`（把当前 `autoExtraUnderSec` 立即应用一次，仅对已存在的镜头调用 setMark，不改设置）。
- 前两项用现有 `setMark(date, start, mark)` 逐条调用（镜头多时串行，每次 await，最多 200 条），完成后刷新当日数据并 toast 一条「已标记 N 条」。
- 二次确认：用现有 toast/确认模式即可，不要新造弹窗。
- 菜单项要有 disable 状态（当天无镜头时禁用）。

### 3. 自动花絮的视觉

- 列表行与脊柱对 `markSource === 'auto'` 的花絮加「花絮（自动）」标签（比手动的低一档透明度），hover 的「正片 / 花絮」按钮仍可覆盖成手动。
- 右栏正片/花絮行显示「正片 3 小时 11 分 · 花絮 42 分（含自动 12 分）」，自动部分括号内只在 > 0 时出现。

### 4. 周电影

- 七日叙事弧与周统计只把**正片**镜头算进"主线/最长镜头/剪辑数"，花絮镜头不计入；每幕卡片右下角加一行 10px 银灰「花絮 X 分」（有才显示）。
- 周评语里加一句：若本周花絮占比 > 10%，追加"其中花絮占 X%"。
- 本周精选不选花絮镜头。

### 5. 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

不要跑 `npm run dev`。改完写状态文件并结束本轮。
