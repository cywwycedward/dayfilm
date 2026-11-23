# 任务说明书：v1.5 主进程（df-core）

## 目标

v1.5 的主进程工作：剧本 PDF 导出、全局快捷键。规格见 `docs/specs/dayfilm-v1.5.md`（R53、R54）。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main5.md`

不要改 `src/renderer/**`、`src/shared/**`、`package.json`、构建与打包配置。

## 契约变化

`src/shared/ipc.ts` 新增 `exportPdf` 通道与 `DayfilmApi.exportPdf(date)`；`src/preload/index.ts` 需要补上（现在缺它会类型报错，这是你这轮的活）。

## 必须实现

### 1. 剧本 PDF（R53）

- `src/main/pdf/index.ts`：
  - `buildScriptHtml(day, options: { note?: string; projects?: ProjectRule[]; theme?: 'classic' }): string` 纯函数，输出一份自包含 HTML（内联 CSS，不引用外部资源）。必须转义所有插值（标题、进程名、手记、项目名），写一个 `escapeHtml` 并测试注入用例（`<script>`、引号、`&`）。
  - A4 纵向，经典主题：近黑底、暖白字、字号阶梯（标题 28px / 小标签 10px uppercase / 正文 11px / 表格 10px Plex Mono 风格用 `ui-monospace` 兜底）。
  - 分节：标题（日期 + Dayfilm 剧本）→ 手记（有则显示）→ 题材与点评 → 三项数字（活跃时长/镜头/剪辑）→ 项目时长（有则显示，前 3）→ 镜头表（时间区间 / 应用 / 标题 / 时长），表头重复、每 25 行分页友好。
- `exportPdf(date)`：日期校验 → 保存对话框（`dayfilm-<date>.pdf`，过滤 `.pdf`，强制扩展名）→ 用一个 `show: false` 的 `BrowserWindow` 加载 `data:text/html;charset=utf-8,<encodeURIComponent(html)>` → `webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } })` → 写盘 → 销毁窗口。
- 失败路径：窗口创建/加载/printToPDF/写盘任一失败都要抛可读错误（不含标题原文），并确保窗口被销毁。
- 单测：HTML 转义、分节顺序、无手记/无项目的分支、镜头表行数与时间格式、扩展名归一。

### 2. 全局快捷键（R54）

- `src/main/shortcuts/index.ts`：注册 `CommandOrControl+Alt+D`（切换 HUD）与 `CommandOrControl+Alt+P`（打开主窗口并切换放映）。
- 切换放映：主窗口需要收到一个"进入/退出放映"的通知——用 `webContents.send('dayfilm:projection-toggle')`，通道名加入受守卫/登记表；界面侧由另一位实现者监听（你只管发）。
- 注册失败（被占用）时：不阻塞启动，记录一次并在托盘提示里加一句"快捷键被占用"，不反复重试。
- `before-quit` 注销全部快捷键。
- 单测：快捷键常量表、注册失败时不影响启动的决策逻辑（把 `globalShortcut.register` 抽成可注入）。

### 3. 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

不要跑 `npm run dev`。

## 交付

`docs/delegate/status-main5.md`：改动、取舍、验证输出、未完成项。完成后结束本轮。
