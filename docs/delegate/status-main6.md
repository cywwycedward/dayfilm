# df-core 状态记录（v2.1 无边框窗体）

v2.1 主进程侧完成：无边框主窗口、窗口按钮 IPC、最大化状态广播。三条自检通过：`tsc` exit=0、`tests/main` 23 文件 / 243 例、`npm run build` 成功。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/window-chrome/index.ts` | `createWindowActions(target)`（最小化 / 切换最大化 / 关闭）+ `bindMaximizeEvents(win, send)`；纯编排，窗口与发送函数可注入 |
| `tests/main/window-chrome.test.ts` | 8 例：三个动作的转发、`toggleMaximize` 双向与返回值、窗口为 null 时静默、`close` 不碰 quit、`maximize/unmaximize` 广播、解绑后不发送、三通道转交 |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/index.ts` | `createWindow` 改无边框（`frame:false` + `thickFrame:true` + `roundedCorners:true` + 背景 `#0a0b0d`）；绑定最大化事件（窗口 `closed` 时解绑）；注册三个窗口通道；`handleIpc` 放宽为 `GuardedChannel \| WindowChannel`（守卫逻辑不变） |
| `src/main/ipc/index.ts` | 新增 `WINDOW_CHANNELS`（`window:minimize` / `window:toggle-maximize` / `window:close`）、`WindowChannel`、`createWindowHandlers`；`OUTBOUND_CHANNELS` 加 `MAXIMIZED_CHANGED_CHANNEL = 'dayfilm:maximized-changed'` |
| `src/preload/index.ts` | 新增 `window.dayfilmWindow = { minimize, toggleMaximize, close, onMaximizeChange }`（独立 bridge，与 `dayfilmProjection` 同一写法） |
| `tests/main/ipc.test.ts` | 出站通道断言改为两项；新增“无边框窗口通道”登记与撞名断言 |

未改：`src/renderer/**`、`src/shared/**`、`package.json`、构建与打包配置。

## 关键取舍

### 无边框窗口

- `frame: false` 去掉系统标题栏；显式写 `thickFrame: true`（Windows 上保留 Aero 边框的缩放热区，否则 `frame:false` 后拖边缘缩放会失效）与 `roundedCorners: true`（Win11 圆角）。
- 背景色从 `#08090c` 调成 `#0a0b0d`，与界面一致，避免启动/重载白闪。
- 其它行为一律没动：单实例锁与 `second-instance` 聚焦、`--hidden` 启动（`show:false` + `ready-to-show` 判断）、`close` 事件 `preventDefault()` + `hide()`、托盘常驻、HUD 子窗口（自己的 `BrowserWindow`，不受主窗口 `frame` 影响）。
- 最小尺寸仍 960×640。

### 窗口按钮

- 三个通道都是 invoke：`window:minimize` / `window:toggle-maximize` / `window:close`，全部经 `handleIpc` 的来源守卫（与其它通道同一套 `senderFrame` 校验），并且由 `createWindowHandlers` 逐个登记——漏一个通道会编译失败，`tests/main/ipc.test.ts` 也有登记与撞名断言。
- `window:close` 走 `mainWindow.close()`，也就是**和点系统关闭按钮完全同一条路径**：主进程的 `close` 监听里 `preventDefault()` + `hide()`，应用不退出。单测用一个多出 `quit` 的依赖对象断言 `quit` 从未被调用。
- `window:toggle-maximize` 返回 `{ maximized: boolean }`，同时 `maximize`/`unmaximize` 事件会广播 `dayfilm:maximized-changed`（boolean）。界面的图标可以只用事件，也可以顺手用返回值。
- 双击标题栏由界面转成 `toggleMaximize()` 调用，主进程不需要额外处理（brief 明确）。

### 通道与桥接（契约还没收录）

- `src/shared/ipc.ts` 还没有窗口控制相关的类型，所以按 brief 的“缺类型就在本地声明”：通道名在 `src/main/ipc/index.ts` 的 `WINDOW_CHANNELS` 里，出站事件在 `OUTBOUND_CHANNELS` 里，`preload` 本地声明 `WindowBridge` 并用 `satisfies` 约束。
- 桥接名固定 `window.dayfilmWindow`，方法与 brief 一致：`minimize()`、`toggleMaximize()`、`close()`、`onMaximizeChange(cb)`（返回取消订阅）。
- **需要主 Agent 往 `src/shared/ipc.ts` 补的东西**（按优先级）：
  1. `DayfilmWindowApi`（或 `WindowBridge`）接口 + `declare global { interface Window { dayfilmWindow: DayfilmWindowApi } }`，方法签名与上面一致；
  2. 三个通道名进 `IPC`（例如 `IPC.windowMinimize` / `windowToggleMaximize` / `windowClose`）——一旦进 `IPC`，`GUARDED_CHANNELS` 的“IPC 去 tick 全量覆盖”断言会要求它们同时登记，届时把 `WINDOW_CHANNELS` 合并进去即可（`createWindowHandlers` 已经在用同一套 `GuardedHandler`）；
  3. `maximizedChanged` 出站通道名（如果希望界面侧从 shared 引用，而不是只用 preload 里的订阅方法）。
- 在 shared 补好之前，preload 与主进程都直接引用 `src/main/ipc` 的常量（和你之前接受的 `dayfilm:hud-open` / `dayfilm:projection-toggle` 同一模式）。

### 最大化状态

- 不推送初始状态：主窗口从不以最大化启动（没有状态恢复逻辑），界面把“未最大化”当默认图标即可；之后全靠 `maximize`/`unmaximize` 事件。
- 监听在 `createWindow` 里绑定，窗口 `closed` 时解绑（`bindMaximizeEvents` 返回的解绑函数），重开窗口不会累积监听。

## 验证输出

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0）

=== 2) npx vitest run tests/main ===
 Test Files  23 passed (23)
      Tests  243 passed (243)
   Duration  2.36s

=== 3) npm run build ===
out/main/index.js        78.34 kB  ✓ built in 226ms
out/preload/index.js      3.08 kB  ✓ built in 14ms
```

## 未完成项 / 需要主 Agent 处理

1. **真机外观没看**：无边框窗口的圆角、拖边缘缩放、拖标题栏移动（界面用 `-webkit-app-region: drag`）、双击最大化都只有代码与单测，没有开窗口目视。建议在构建产物上点一遍三个按钮 + 双击标题栏。特别值得确认的是：`frame:false` + `thickFrame:true` 在 Win11 下边缘缩放热区是否还在（Electron 的已知差异）。
2. **界面侧要接的**：头部按钮调 `window.dayfilmWindow.minimize/toggleMaximize/close`，图标订阅 `onMaximizeChange`；标题栏区域需要 `-webkit-app-region: drag`，按钮区域 `no-drag`（这属界面范围，我没动）。
3. **契约补齐**见上“需要主 Agent 往 `src/shared/ipc.ts` 补的东西”。补完之后可以删掉 `WINDOW_CHANNELS` 里重复的字符串，改成引用 `IPC.*`。
4. **`window:close` 与真正退出**：现在只隐藏。如果产品希望“关闭按钮退出应用”（而不是收托盘），需要改 `window:close` 的实现或加一个设置项——目前按 brief 保持收托盘。
