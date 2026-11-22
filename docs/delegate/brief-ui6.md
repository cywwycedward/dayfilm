# 任务说明书：v1.4 界面（df-ui）

## 目标

实现 v1.4 的四件事：导演 HUD 页面、放映字幕旁白、片头卡、设置面板里的 HUD 开关。规格见 `docs/specs/dayfilm-v1.4.md`（R40–R43），视觉规则见 `docs/product/visual-language.md`。

## 可写范围

- `src/renderer/**`、`tests/renderer/**`
- `docs/delegate/status-ui6.md`

不要改 `src/main/**`、`src/shared/**`、`package.json`、`electron.vite.config.ts`、打包配置。

## 已就位

- `electron.vite.config.ts` 已把渲染层改成多入口，需要 `src/renderer/hud.html` 存在（你创建）。
- `src/shared/settings.ts` 有 `hud: { visible, x, y }`；`src/shared/ipc.ts` 有 `setHud(visible)` 与 `exportEdl(date)`。
- HUD 窗口由主进程按 360×148 的无边框透明置顶窗加载 `hud.html`，拖动靠 CSS `-webkit-app-region: drag`。

## 必须实现

### 1. HUD 页面（R40）

- 新建 `src/renderer/hud.html`、`src/renderer/src/hud.ts`、`src/renderer/src/hud.css`（或并入主样式但只被 hud.html 引用）。
- 版式按规格：顶部状态行、应用名（Bebas 20）、标题（Inter 10 单行省略）、已持续时长（Plex Mono 28）、今日三组数字、最近 30 分钟 30 根 2px 节奏柱。
- 数据：`window.dayfilm.live()` 初始化 + `onTick` 更新；空闲/暂停/出错三种状态按规格换色。
- 整窗 `-webkit-app-region: drag`；除状态点外没有可点控件；单击窗口调 `window.dayfilm.setHud` 之外，需要"打开主窗口"——用 `window.dayfilm.openMain()`（主进程会新增，若还没就先用 `setHud(true)` 占位并在状态文件里注明）。
- 不显示滚动条、不显示选择、字体用自托管字体；窗口透明，卡片自身有 1px 边框与 8% 背景。

### 2. 字幕旁白（R41）

- 放映态画面下沿上方 24px 显示字幕：`第 N 镜` + 主句，按规格的优先级选句。
- 纯函数 `narration.ts`：`pickNarration(day, scene, index)`，覆盖五条规则与回退；测试覆盖最长镜头、密集镜头、首尾镜头、普通镜头。

### 3. 片头卡（R43）

- 切日（日视图有镜头）时播放 1.4 秒片头：日期、题材、`DAYFILM` 依次亮起再淡出；同一次运行同一天只播一次；`prefers-reduced-motion` 不播；Esc 跳过；期间吞掉键盘输入。
- 纯函数 `title-card.ts`：`shouldPlayTitleCard(seenDates, date, reducedMotion)` 与时间轴关键帧（每个元素出现/消失的进度区间），可测试。

### 4. 设置面板与导出入口

- 设置面板"常驻"分区加"导演 HUD"开关，调 `setHud`。
- 顶栏"导出剧本"旁加"导出 EDL"（次要样式），调 `window.dayfilm.exportEdl(date)`；取消时提示"已取消"，成功提示路径（复用现有 toast）。
- mock 模式下 `exportEdl` 用浏览器下载兜底，`setHud` 存内存。

### 5. 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

`npm run build` 需要 `hud.html` 存在，先建好再跑。不要跑 `npm run dev`。用 mock 静态服务自查 HUD 页面（`http://localhost:5178/hud.html`）。

## 交付

`docs/delegate/status-ui6.md`：文件、交互与视觉决策、验证输出、未完成项。完成后结束本轮。
