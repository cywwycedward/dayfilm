# 任务说明书：v2.1 无边框窗体（df-core）

## 目标

去掉 Electron 的系统标题栏，换成自绘头部；窗口按钮由界面绘制并通过 IPC 控制。规范见 `docs/product/ui-concept-v3-chrome.png` 的 A 块。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main6.md`

不要改 `src/renderer/**`、`src/shared/**`、`package.json`、构建与打包配置。

## 必须实现

### 1. 无边框窗口

- `BrowserWindow` 改为 `frame: false`；Windows 上保留 `thickFrame: true`（保证拖动边缘可缩放）与 `roundedCorners: true`（Win11）。
- 背景色保持 `#0a0b0d`，与界面一致，避免启动白闪。
- 保留现有所有行为：单实例、`--hidden` 启动、关窗进托盘（`close` 事件仍 preventDefault + hide）、HUD 子窗口不受影响。
- 最小尺寸仍 960×640。

### 2. 窗口控制 IPC

- 新增 `window:minimize` / `window:toggle-maximize` / `window:close` 三个 invoke 通道（`window:close` 走与点系统关闭相同的路径：隐藏到托盘，不退出）。
- 新增出站事件 `dayfilm:maximized-changed`（boolean），在 `maximize` / `unmaximize` 时广播给主窗口，界面据此换图标。
- 三个通道登记进受守卫表；`preload` 暴露 `window.dayfilmWindow = { minimize(), toggleMaximize(), close(), onMaximizeChange(cb) }`（与 `dayfilmProjection` 同样的独立 bridge 写法）。
- `src/shared/ipc.ts` 的类型我随后补；你先写桥接，缺类型就在本地声明，并在状态文件里告诉我需要往 shared 加什么。

### 3. 双击标题栏

- 主窗口收到 `window:toggle-maximize` 就切换最大化；界面会把双击转成这个调用，主进程不需要额外处理。

### 4. 单测

- 最大化状态广播：监听 `maximize`/`unmaximize` 时向主窗口发送事件（sender 可注入）。
- 三个通道的转交（假 BrowserWindow）。
- `window:close` 不触发 `app.quit`（用可注入 deps 断言）。

## 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

不要跑 `npm run dev`。完成后写状态文件并结束本轮。
