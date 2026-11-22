# v1.4 界面（导演工具箱）状态

范围：`src/renderer/**`、`tests/renderer/**`。未改 `src/main`、`src/shared`、`package.json`、`electron.vite.config.ts`。

## 1. 文件

| 文件 | 作用 |
| --- | --- |
| `src/renderer/hud.html` | HUD 多入口（build 必需），CSP 与主界面一致 |
| `src/renderer/src/hud.css` | HUD 专属样式（自带 @font-face 与色令牌） |
| `src/renderer/src/hud.ts` | HUD 页面：`live()` + `onTick`，无 preload 时退到 mock |
| `src/renderer/src/lib/hud.ts` | HUD 纯参数：状态、秒表、今日三组、30 根节奏柱、柱几何 |
| `src/renderer/src/lib/narration.ts` | 字幕旁白选句（五条优先级） |
| `src/renderer/src/lib/title-card.ts` | 片头卡：是否播放 + 三元素时间轴 |
| `src/renderer/src/lib/edl.ts` | CMX3600 EDL 文本（24fps），供 mock 下载用 |
| `src/renderer/src/data.ts` | `DayfilmSource` 新增 `exportEdl` / `setHud`（live + mock） |
| `src/renderer/index.html` | 字幕、片头卡、导出 EDL、导演 HUD 开关 |
| `src/renderer/src/style.css` | 字幕淡入、片头卡四层动画 |
| `src/renderer/src/app.ts` | 上述 UI 的接线 |
| `tests/renderer/hud.test.ts` | 17 条 |
| `tests/renderer/narration.test.ts` | 9 条 |
| `tests/renderer/title-card.test.ts` | 8 条 |
| `tests/renderer/edl.test.ts` | 8 条 |

## 2. R40 导演 HUD

- 360×148 透明卡片：1px 边框 + 墨色 94% + 纸色 8% 叠层；整窗 `-webkit-app-region: drag`。
- 版式（自上而下）：状态行（9px mono：`REC` 琥珀 / `空闲` 银 / `已暂停` / `错误`）→ 应用名（Bebas 20）与已持续时长（Plex Mono 28，秒级）→ 窗口标题（Inter 10 单行省略）→ 30 根 2px 节奏柱（纸色 18%，空分钟 1px 底线）→ 今日三组（镜头/剪辑/题材）。
- 状态优先级：采集出错 > 暂停 > 空闲（`scene === null`）> 拍摄。`LiveState` 没有 `idleMs`，空闲以主进程不给 scene 为准（已在此注明）。
- 暂停整窗银灰（应用名、秒表、数字都显式换成 silver——只改变量不够，继承的 `color` 不会重算）。
- 单击**状态点**打开主窗口（`openMain`，未暴露时退回 `setHud(true)` 占位）；之所以不是“单击整窗”：拖拽区域会吞掉点击事件。
- 数据：`window.dayfilm.live()` + `onTick`；没有 preload 时用 `buildMockLive` 每 2 秒刷新。秒表由页面自己每秒重绘，不依赖 2 秒 tick。

## 3. R41 字幕旁白

- 放映态字幕在画面内、下沿上方 24px：`第 N 镜`（mono 10）+ 主句（Inter 12），160ms 淡入，减弱动效时直接出现。
- 选句优先级：最长镜头 → 密集窗口前 10 镜（30 分钟里切出去 N 次，N ≥ 2 才算密集）→ 第一镜 → 最后一镜 → `停留 X 分钟。`（最少 1 分钟）；中场休息无字幕。
- 只在镜头变化时更新 DOM（`subtitleKey`），不随每帧重建。
- 半透明底板会盖住画面底部 1px 时长尺的一段——这是 24px 位置的必然取舍；时间码在左、时长标签在右，都露在外面。

## 4. R43 片头卡

- 切到有镜头的一天（`loadDate` 末尾、`state.mode === 'day'`）播一次：日期（mono 12）→ 题材（44px 系统粗体）→ `DAYFILM`（Bebas 18 琥珀），1.4 秒后整层淡出。
- `shouldPlayTitleCard(seen, date, reducedMotion)`：同一次运行同一天只播一次；`prefers-reduced-motion` 不播（CSS 也会直接隐藏）。
- 期间 window 捕获阶段吞掉所有 keydown；Esc 立即跳过；新卡片开始前先收掉上一张，避免两个定时器打架。

## 5. 设置与导出入口

- 顶栏“导出剧本”右侧新增“导出 EDL”（次要样式）；点按调 `source.exportEdl(date)`，成功提示路径，空串提示“已取消导出 EDL”，失败提示错误。
- 设置“常驻”分区新增“导演 HUD”开关，调 `source.setHud(visible)`；失败把开关拨回并在面板里报错。
- `data.ts`：`live` 侧用 `exposed.exportEdl?.(date) ?? missing('exportEdl')` 这类可选成员访问，preload 落后时给出可读错误；mock 侧 EDL 用 `lib/edl.ts` 生成文本并触发浏览器下载，`setHud` 存内存（`?mock=readonly` 时抛错）。

## 6. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 294 tests passed
npm run build                            hud-*.css 4.44 kB, hud-*.js 4.94 kB, index 145.97 kB
```

`npm run build` 产出独立 `hud.html` 入口（`assets/hud-*.css` / `assets/hud-*.js`），确认多入口生效。

浏览器自查（`npx vite src/renderer --port 5178`，无 preload → mock）：

- **HUD**：卡片 360×148、无滚动溢出、30 根柱；`REC / SLACK / #eng — Dayfilm / 16:24 / 镜头 39 · 剪辑 33 · 题材 标准剪辑`。
  四种状态的计算色：拍摄 `rgb(232,180,90)` 实心点；空闲空心银点；暂停整窗 `rgb(141,147,158)`；出错点/状态/标题 `rgb(184,82,74)`。
  截图：`%TEMP%\dfv-v14\hud2.png`、`hud-paused.png`。
- **EDL**：提示 `EDL 已导出：dayfilm-2026-11-22.edl（演示环境：浏览器下载）`。
- **HUD 开关**：开 → 关后提示“已保存”，再次打开设置仍是关。
- **片头卡**：切到 11-09 播放（`11月9日 周一` / `长镜头`），1.4 秒自动消失；切回已看过的日期整段不再出现；`prefers-reduced-motion` 下新日期也不播；
  卡片期间 document 级 keydown 计数为 0，Esc 后恢复。截图：`%TEMP%\dfv-v14\titlecard-play.png`。
- **字幕**：放映中显示 `第 4 镜  停留 7 分钟。`。截图：`%TEMP%\dfv-v14\subtitle.png`。

## 7. 偏离与未完成

1. **`openMain` 不存在于 shared 契约**：HUD 点击先找 `window.dayfilm.openMain`，没有就 `setHud(true)` 占位（HUD 本来就是开着的，所以实际是空操作）。主进程补 `openMain` 后自动生效。
2. **preload 还没暴露 `exportEdl` / `setHud`**：当前真实构建里点这两个入口会看到“当前构建未暴露 … 接口，重启应用后再试”，mock 路径已通；主进程/预加载补齐即通。
3. HUD 的“打开主窗口”放在状态点上（拖拽区域会吞点击），其余区域只拖动；状态点没有额外控件以外的其他控件。
4. `LiveState` 没有 `idleMs`，空闲判定用 `scene === null`；若主进程只在空闲 60s 后才清空 scene，行为与规格一致。
5. 片头卡的键盘吞噬是 window 捕获阶段，鼠标未拦（规格只要求键盘）。
6. 未在真实 Electron 窗口里验证 HUD 的透明/置顶/拖动（不启 `npm run dev`），只验证了页面本身与样式；主进程窗口参数由主 Agent 负责。
