# status-ui12：右栏铺满 / 脊柱吸附 / 空状态 / 设置抽屉

范围：`src/renderer/**`、`tests/renderer/**`、本文件。`src/main/**`、`src/shared/**`、`package.json`、构建配置未改。

## 1. 五项

### 1) 右栏「最近镜头」不再留固定空白

- `.rail` 保持纵向 flex；`.rail__block--grow` 改为 `display:flex; flex:1 1 auto; flex-direction:column; min-height:0`，
  最后一个面板吃满右栏剩余高度。
- `fitRecentList()` 改成按**面板内高**算行数：`available = block.clientHeight − 上下内边距 − 表头高 − 列头高 − 2×8px 间隔 − 8px 底部内距`，
  `rows = max(1, floor(available / 32))`，列表视口 = `rows × 32 + 8`，表格 `overflow-y:auto`。
  右栏块内边距 16→12px，给表格多让出 8px。

### 2) 日期触发器自适应

- 去掉固定 168px：`min-width: 150px; width: auto`，`font-variant-numeric: tabular-nums; white-space: nowrap`，
  `.select__value { flex: 0 1 auto }`，箭头 `margin-left: 8px` 紧跟文字。
  mock 的两种日期标签（「今天 · 11月23日 周一」/「11月11日 周三」）都落在 150px 内，切换时头部不抖动。

### 3) 脊柱滚动吸附

- 滚轮：`onSpineWheel` 拦截默认滚动，按 `32px`（一帧）整数倍 `scrollTo({ behavior: 'smooth' })`。
- 键盘：`PageUp/PageDown` 按 `floor(视口高 / 32) × 32` 翻页，`Home/End` 到首/尾（End 先吸附到帧边界）。
- CSS：`.spine__viewport { scroll-behavior: smooth; scroll-snap-type: y proximity }`；
  「现在」标记的 y 由 `scrollTop` 实时换算（滚动 rAF 里重画），吸附后位置正确。

### 4) 空状态重排

- 题材：无镜头时 `renderHero` 给「未开镜」+ `data-empty`，CSS 为 64px。
- 剧照区：`#heroFrameEmpty` 增加 `#heroFrameEmptyTitle`；无镜头时主行「摄影机还没开」+ 小字
  「Dayfilm 在后台记录，第一个镜头出现后会出现在这里」；有素材但落在空档时仍显示「空档 / 摄影机未运行 · 下一镜 …」。
- 脊柱：空的一天 144 帧全是斜纹空卷，`00:00`/`24:00` 两个 DOM 标签照旧。
- 右栏三项数字：`day.scenes.length === 0` 时显示 `—`（不再显示 00:00/0/0）。
- 最近镜头：`#empty` 显示空表提示（今天「还没有拍摄任何素材」）。

### 5) 设置抽屉跟新视觉

- 遮罩 `rgba(10,11,13,.92)`；面板仍 420px（`min(420px, 92vw)`）。
- 正文 13px、行高 1.5；分区标签 10px mono 大写 `.18em` 半透明；`fieldset` 之间 1px 发丝线。
- 输入与下拉继续用 v2.1 的自绘控件（保留期是自绘下拉，页面上没有原生 select）。
- 开关改成 28×16 滑轨：`input[type=checkbox]` 去默认外观、圆角胶囊、12px 圆钮，选中时琥珀底 + 墨色钮，
  `:focus-visible` 2px 琥珀环。
- 「退出 Dayfilm」= 次按钮样式 + 暖红文字（`#e5b3ad`，悬停加深 + 下划线）。

## 2. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run                          49 files / 589 passed（renderer 25 / 345）
npm run build                           css 73.06 kB / js 170.96 kB
```

界面自查：`npx vite src/renderer --port 5182` + 自建 BrowserWindow（`%TEMP%\ui12\`）：
抽屉截图 `07-retention-open.png` 可见新遮罩、13px 正文、mono 分区标签、28×16 滑轨开关、自绘保留期下拉。

## 3. 未完成 / 已知问题

1. **`node scripts/probe-v20.mjs` 没跑成**：打包版 Dayfilm 正在运行（5 个进程、单实例锁），probe 启的第二个实例直接退出、
   拿不到 CDP 页面。`%TEMP%\ui12\01-header.png`、`05-input-focus.png` 是 0 字节（窗口还没画完就截图），
   可用的只有抽屉两张。需要关掉运行中的 Dayfilm 后补跑三张正式图。
2. **空数据日的截图没拿到**：mock 的日期列表每天都有数据，切不到「无镜头的一天」；空状态只按代码路径与文案实现，
   没有真机截图证据（需要主进程造一个空日文件，或用 `?mock=` 钩子扩展）。
3. **脊柱吸附用 `y proximity` 而不是 `mandatory`**：wheel 已按整帧步进 + smooth，`mandatory` 会和 smooth 滚动在
   快速连滚时打架；如果需要严格强制吸附，下一轮改 `mandatory` 并去掉 smooth 再试。
4. **旧版遗留 CSS 仍未清理**（status-ui9 记的约 700 行 + v2.1 前的 select/input 死规则）。
5. **设置抽屉的开关没有做 `prefers-reduced-motion` 之外的无障碍增强**（例如 role=switch）；当前仍是原生 checkbox 语义。
