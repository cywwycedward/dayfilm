# df-core 状态记录（v1.4 主进程）

v1.4 主进程侧完成：导演 HUD 窗口、EDL 导出、HUD 设置持久化与托盘开关。三条自检通过（`tsc` exit=0、`tests/main` 19 文件 / 194 例、`npm run build` 成功且产物里已有 `hud.html`）。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/edl/index.ts` | `renderEdl(day)`（CMX3600）、`timecode(ms)`、`parseEdlDate(unknown)`；纯函数 |
| `src/main/hud/position.ts` | `defaultHudPosition` / `isHudPositionVisible` / `resolveHudPosition`，显示器信息由调用方注入 |
| `src/main/hud/index.ts` | `createHud`（懒创建、显隐、拖动写回位置、加载失败只告警一次）+ `hudPagePath` |
| `tests/main/edl.test.ts` | 9 例：时间码与帧取整、跨小时、事件编号与记录轨间隔、跳过中场休息、空标题、非法日期 |
| `tests/main/hud.test.ts` | 7 例：默认位置、多显示器、越界回落、只露一条边不算可见、单坐标缺失 |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/settings/index.ts` | `hud` 归一（`visible` 用 `Boolean()`，`x`/`y` 只收有限数，缺省字段保留上一份） |
| `src/main/ipc/index.ts` | 受守卫 invoke 表加 `exportEdl` / `setHud`；新增 `HUD_OPEN_CHANNEL`、`SEND_CHANNELS`、`createSendHandlers` |
| `src/main/tray/tooltip.ts` | `TrayState` 加 `hudVisible` |
| `src/main/tray/index.ts` | 菜单加"导演 HUD"勾选项与 `toggleHud` 动作；菜单签名包含 `hudVisible` |
| `src/main/index.ts` | `exportEdl` / `setHudVisible` / `setupHud`、send 通道守卫 `listenIpc`、`applySettings` 同步 HUD、托盘动作、退出时销毁 HUD、`isTrustedSender` 支持 send 事件 |
| `src/preload/index.ts` | `exportEdl` / `setHud`，以及给 HUD 页面用的 `window.dayfilmHud.open()` |
| `tests/main/{ipc,tray,settings}.test.ts` | 新通道转交与 send 表断言、`hudVisible` 夹具、hud 归一与补丁语义 |

未改：`src/renderer/**`（HUD 页面由 df-ui 提供）、`src/shared/**`、`package.json`、`electron.vite.config.ts`、打包配置。

## 关键取舍

### EDL（R42）

- 时间码：`frames = ceil(ms * 24 / 1000)`。整数毫秒乘 24 是精确整数，除以 1000 只有在整除时才是整数值，因此 ceil 不会因为浮点误差多进一帧；帧号自然落在 0–23。
- 源时间码用镜头当天的**本地墙上时间**（与规格示例 `20:21:30:00` 一致）；记录轨从 `01:00:00:00` 起，`recIn = 01:00:00:00 + (start - 第一镜 start)`，`recOut = recIn + 时长`，所以中场休息与空档自然体现为记录轨上的间隔，不需要额外写事件。
- 事件行列宽按 CMX3600 固定（`001` + 2 空格 + `AX` 补到 9 + `V` 补到 6 + `C` 补到 9），与规格示例逐字符一致，单测直接比整行字符串。
- clip name 用 `exe — title`（em dash）；标题为空写"未命名窗口"；标题里的换行压成空格，否则会把一条记录拆成两行。
- 跨零点按 brief 不做特殊处理（`23:59:30` → `00:00:30` 的源出点会小于入点），单测把这个"已知不处理"的口径钉住，避免以后被当成 bug 改掉。
- 空的一天只输出 `TITLE` / `FCM` 两行 + 空行。

### HUD（R40）

- 懒创建：第一次 `setVisible(true)` 才建窗口，`settings.hud.visible=false` 的用户不会白起一个窗口。
- 位置：`resolveHudPosition(saved, size, workAreas, primaryWorkArea)`；至少 40×40 落在某个工作区里才算"看得见"，否则回到主显示器右上角（距边缘 24px）。分辨率变化、拔显示器、多屏挪位都走同一条判定。
- 拖动：监听 `moved`，300 ms 防抖后 `getPosition()` 写回设置。`place()` 里的 `setPosition` 也会触发一次 `moved`，所以"没拖过（null）"在第一次显示后会变成实际坐标——这是有意的，位置从此固定下来。
- `showInactive()` 而不是 `show()`：不抢用户正在打字的窗口焦点；`focusable: false` 保证键盘焦点不落到 HUD 上。
- `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces(true)`：全屏应用也盖不住。
- 页面来源：开发模式 `<devUrl>/hud.html`，打包/预览 `join(__dirname,'../renderer/hud.html')`。文件不存在时只告警一次并保持隐藏；`did-fail-load` 同样只告警一次。这样 HUD 页面还没交付时主程序照常运行。
- 退出时 `hud.destroy()`，防抖计时器一并清掉。

### HUD 的"单击打开主窗口"通道

- 契约（`src/shared/ipc.ts`）由主 Agent 维护，没有这个通道，所以通道名放在 `src/main/ipc/index.ts`（`HUD_OPEN_CHANNEL = 'dayfilm:hud-open'`），登记进 `SEND_CHANNELS`，用 `createSendHandlers` + `listenIpc` 注册——和 invoke 一样过 `isTrustedSender`，伪造来源直接丢弃。
- 渲染进程侧：preload 额外暴露 `window.dayfilmHud.open()`（不属于 `DayfilmApi`，只发这一条 send）。**df-ui 需要把 HUD 页面的单击接到它**，否则 R40.7 不成立。
- 测试：`SEND_CHANNELS` 与 `createSendHandlers` 的键必须一致、send 通道不与 invoke 通道撞名、`tick` 不被当成 invoke 包装。

### 设置与托盘

- `hud` 归一按字段：`visible` 缺省保留上一份、传了就用 `Boolean()`；`x`/`y` 缺省保留上一份、传了但不是有限数就当没拖过（`null`）。所以 `setHud(false)` 只改开关，不会把位置清掉。
- `setHudVisible` 是界面 `setHud` 与托盘"导演 HUD"的唯一实现：先 `applySettings` 落盘，再让 HUD 生效，最后 `broadcast()` 刷新托盘与界面状态。
- `applySettings` 里也监听 `hud.visible` 变化：通过设置面板改 HUD 开关同样即时生效。
- 托盘菜单变成四项：打开 / 暂停-继续 / 导演 HUD（勾选态）/ 退出；菜单重建信号里加了 `hudVisible`，否则勾选态不会刷新。

## 验证

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0；另用 --incremental false 复核一次，同样 exit=0）

=== 2) npx vitest run tests/main ===
 Test Files  19 passed (19)
      Tests  194 passed (194)
   Duration  2.99s

=== 3) npm run build ===
out/main/index.js        64.22 kB  ✓ built in 223ms
out/preload/index.js      1.89 kB  ✓ built in 14ms
out/renderer/hud.html     1.78 kB
out/renderer/index.html  12.07 kB
out/renderer/assets/hud-JCZN5OoP.js    4.94 kB
out/renderer/assets/hud-C9hrPMJ_.css   4.18 kB
out/renderer/assets/index-uiB2jB3E.js 140.76 kB
```

构建这次成功且产物里已经有 `hud.html`（df-ui 的 HUD 页面已交付），所以 brief 里"缺 hud.html 导致构建失败属预期"的情况没有发生。

期间工具链反复报过 4 条 `src/main/index.ts` 的编译错误（`IpcMainInvokeEvent` 未使用、`setupHud` 未定义、`createHud`/`hudPagePath` 未使用）。逐条核对后确认是**过期的静态缓存误报**：源码里 `IpcMainInvokeEvent` 出现 0 次、`setupHud` 定义与调用各 1 处、`createHud`/`hudPagePath` 均在用；`tsc --noEmit -p tsconfig.node.json`（含 `--incremental false`）都是 exit=0，仓库里也没有项目级 `.tsbuildinfo`。

## 未完成项 / 需要主 Agent 处理

1. **HUD 窗口没有真机目视验证**：窗口外观（透明、无边框、置顶、不抢焦点）需要人看或走 DevTools 协议。构建产物里 `hud.html` 已存在，`hudPagePath(__dirname)` 指向 `out/renderer/hud.html`，路径是对的。上一轮遇到过的坑仍在：打包版实例持着单实例锁时，`npm run start` 会立刻退出（属预期），验收前请确认没有别的 Dayfilm 在跑。
2. **HUD 单击打开主窗口依赖 df-ui 接线**：页面里需要 `window.dayfilmHud.open()`（单击事件）。主进程侧通道与守卫已就绪。
3. **HUD 的"已暂停/出错/空闲"视觉**是页面用 `tick` 里的 `paused`/`captureError`/`scene` 渲染的，主进程只负责推数据；HUD 与主窗口共用同一个 preload 与 `onTick`。
4. **EDL 跨零点不特殊处理**（brief 明确要求）：跨零点的镜头源出点会小于源入点，导入剪辑软件时该条记录可能异常。需要的话下一版再定口径。
5. **打包**：`hud.html` 走 renderer 入口进 asar（electron-builder `files: out/**` 已覆盖），`tray*.png` 与 `capture.ps1` 仍走 `extraResources`；这些属打包配置，我没改。
6. `hud.x/y` 存的是物理像素绝对坐标；显示器缩放变化后可能落在"看起来偏移"的位置（仍在工作区内就不会回落），暂不换算 DPI。

---

## 追加：两处小修（clip name 分隔符 / 导出失败不静默）

### 1) clip name 改用 ASCII 分隔符

- `src/main/edl/index.ts` 的 `clipName`：`exe — title` → `exe - title`（空格-连字符-空格）。**其余文本不动**，仍是 UTF-8 写盘（中文标题照样原样输出，只是分隔符用 ASCII，旧剪辑软件不会因为全角破折号变乱码）。
- 单测：整行断言 `* FROM CLIP NAME: WindowsTerminal - LZD-20250906UAB: dayfilm`，并额外断言整份 EDL 里不含全角破折号 `—`（防止以后被改回去）。

### 2) 写盘失败给可读错误，且不静默

- `src/main/errors.ts` 新增 `describeWriteError`：把常见写盘错误码翻成一句人话并保留原码 —— `EACCES/EPERM → 没有写入权限`、`EISDIR → 目标是一个文件夹`、`EROFS → 目标位置是只读的`、`ENOSPC → 磁盘空间不足`、`ENOENT → 目标目录不存在`、`EBUSY → 文件被其他程序占用`、`ENAMETOOLONG → 文件名太长`。未收录的码仍回落到 `describeError`（只给码/类型名）。文案不带路径与标题。
- `src/main/edl/index.ts` 新增 `writeEdlFile(target, day)`：负责写盘，失败掋 `EDL 保存失败：<可读原因>`；`exportEdl` 改用它。顺带把剧本与海报两条保存路径也换成 `describeWriteError`，同类错误给同样的中文原因。
- **不静默的链路**：handler 返回的 Promise reject → `ipcMain.handle` 把异常回给渲染进程 → `ipcRenderer.invoke` 的 Promise reject → 界面 catch 后显示可读文案。单测在两层钉住了这个行为：
  - handler 层：注入一个 reject 的 `exportEdl`，断言 `handlers[IPC.exportEdl]` 返回的 Promise 确实 reject（不会被 guard 或包装吞掉）。
  - 写盘层：把**目录本身**当目标文件，断言 reject 文案以 `EDL 保存失败：` 开头、带可读原因、不带目标路径，且目录里没有留下半成品文件；再补一个"目标目录不存在"的例子。

### 本轮验证

```text
=== npx tsc --noEmit -p tsconfig.node.json ===
tests/renderer/hud.test.ts(11,3): error TS6133: 'hudLeaveMs' is declared but its value is never read.
exit=2

=== 我的范围（src/main + src/preload + tests/main，46 个文件，等价编译参数） ===
exit=0

=== npx vitest run tests/main ===
 Test Files  20 passed (20)
      Tests  202 passed (202)
   Duration  1.98s

=== npm run build ===
out/main/index.js        64.76 kB  ✓ built in 201ms
out/preload/index.js      1.89 kB  ✓ built in 13ms
out/renderer/hud.html     1.86 kB
```

**关于那条 exit=2**：`tsconfig.node.json` 的 `include` 覆盖 `tests/**/*`，所以界面侧的测试文件也会被这条命令检查。本轮唯一的失败是 `tests/renderer/hud.test.ts`（df-ui 的文件，mtime 23:08）里未使用的 `hudLeaveMs`，与主进程无关；我的三个目录用同样的编译开关单独跑是 exit=0。对方修掉那一行后，这条验收命令就会恢复 exit=0。

新增用例：`tests/main/errors.test.ts` 4 例（错误码映射、未知码回落、文案不带路径/标题），`edl.test.ts` 加 3 例（写盘成功、目录当目标、目录不存在），`ipc.test.ts` 加 1 例（导出 rejection 不被吞）。
