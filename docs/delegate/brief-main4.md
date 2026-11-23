# 任务说明书：v1.4 主进程（df-core）

## 目标

给 v1.4 提供主进程能力：导演 HUD 窗口、EDL 导出、HUD 设置持久化、托盘开关。规格见 `docs/specs/dayfilm-v1.4.md`（R40、R42）。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main4.md`

不要改 `src/renderer/**`（另一位实现者会创建 `src/renderer/hud.html`）、`src/shared/**`、`package.json`、`electron.vite.config.ts`、打包配置。

## 已更新的契约（直接实现）

- `src/shared/settings.ts`：`Settings` 新增 `hud: { visible: boolean; x: number | null; y: number | null }`，默认 `{ visible: true, x: null, y: null }`。
- `src/shared/ipc.ts`：新增 `exportEdl` 与 `setHud` 通道，`DayfilmApi` 增加 `exportEdl(date)` 与 `setHud(visible)`。
- `electron.vite.config.ts`：渲染层已改成多入口（`index.html` 与 `hud.html`），HUD 页面由另一位实现者创建；你的窗口用 `loadFile(join(__dirname, '../renderer/hud.html'))` 加载，文件不存在时不要抛，记录一次错误即可。

## 必须实现

### 1. 导演 HUD 窗口（`src/main/hud/index.ts`）

- `BrowserWindow`：宽 360、高 148、`frame: false`、`transparent: true`、`alwaysOnTop: true`、`skipTaskbar: true`、`resizable: false`、`show: false`、`focusable: false`（点击仍能触发，见下）、`hasShadow: true`。
- 位置：设置里的 `hud.x/y`；为 null 时放在工作区右上角（距边缘 24px）；落在任何显示器工作区之外时回到默认位置。
- `setAlwaysOnTop(true, 'screen-saver')` 以免被全屏应用盖住；`setVisibleOnAllWorkspaces(true)`。
- 拖动：窗口用 `-webkit-app-region: drag`（界面实现），主进程监听 `moved` 事件把位置写回设置（防抖 300ms，避免拖动时频繁写盘）。
- 单击 HUD：界面通过 IPC 调 `setHud` 之外，需要一个"打开主窗口"的动作——复用现有 `quit` 之外的通道不合适，请新增一个内部处理：`ipcMain.on('dayfilm:hud-open')`（`ipcRenderer.send`，不走 `DayfilmApi`），收到后 `showWindow()`。把它加进受守卫通道表（现有测试会断言通道被覆盖，注意 `send` 类通道的断言方式）。
- 开关：`setHud(visible)` 显示/隐藏并写回设置；托盘菜单加一项"导演 HUD"（勾选态），与 `setHud` 同一实现。
- 应用启动时按 `settings.hud.visible` 决定是否显示。

### 2. EDL 导出（`src/main/edl/index.ts`）

- `renderEdl(day: DayRollup): string` 纯函数，按规格 R42 生成 CMX3600（24fps，记录时间从 01:00:00:00 起，连续排布）。
- 时间码换算：毫秒 → HH:MM:SS:FF，帧向上取整；跨天不做特殊处理。
- 跳过 `kind: 'intermission'` 的镜头；空标题用"未命名窗口"；clip name 形如 `WindowsTerminal — LZD-20250906UAB: dayfilm`。
- `exportEdl(date)`：日期校验 → 保存对话框（默认名 `dayfilm-<date>.edl`，过滤 `.edl`）→ 强制扩展名 → 写盘；取消或非法日期返回 `{ path: '' }`，写失败抛可读错误。
- 单测：事件编号与时间码、跨小时、跳过中场休息、空标题、帧取整边界（999ms、59.999s）、非法日期。

### 3. 设置归一与测试

- `hud` 字段归一：`visible` 用 `Boolean()`；`x/y` 必须是有限数否则 `null`（越界由运行时位置检查处理）。
- 单测覆盖 HUD 版式相关的主进程侧逻辑：默认位置计算、越界回调默认位置（纯函数，显示器信息可注入）。
- IPC 通道守卫断言仍要通过（新增通道都要走 `handleIpc` 或明确登记）。

### 4. 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

HUD 页面可能还不存在（另一位实现者并行做），`npm run build` 若因缺 `hud.html` 失败属于预期，把结果写进状态文件即可。不要跑 `npm run dev`。

## 交付

`docs/delegate/status-main4.md`：改动、取舍、验证输出、未完成项。完成后结束本轮。
