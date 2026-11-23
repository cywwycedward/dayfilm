# df-core 状态记录（v1.5 主进程）

v1.5 主进程侧完成：剧本 PDF 导出、全局快捷键（HUD 开关 / 放映切换）。三条自检通过：`tsc` exit=0、`tests/main` 22 文件 / 223 例、`npm run build` 成功。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/pdf/index.ts` | `escapeHtml` + `buildScriptHtml(day, options)`：自包含 HTML（内联 CSS、无外部资源），纯函数 |
| `src/main/pdf/render.ts` | `writePdf(html, target)`：隐藏 `BrowserWindow` → data URL → `printToPDF(A4, printBackground)` → 写盘 → 保证销毁 |
| `src/main/shortcuts/index.ts` | `SHORTCUT_ACCELERATORS`（唯一清单）、`registerShortcuts(host, actions)`（宿主可注入） |
| `tests/main/pdf.test.ts` | 13 例：转义与注入、自包含、分节顺序、无手记/无项目分支、镜头表行数与时间格式、25 行分组、前 3 项目、扩展名 |
| `tests/main/shortcuts.test.ts` | 7 例：加速器表、全部成功、被占用、register 抛错、两个都失败、unregisterAll 透传 |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/ipc/index.ts` | `exportPdf` 进受守卫 invoke 表与 `IpcDeps`；新增 `PROJECTION_TOGGLE_CHANNEL` 与 `OUTBOUND_CHANNELS`（主进程 → 渲染进程的通道登记表） |
| `src/main/tray/tooltip.ts` | `TrayState` 加 `shortcutWarning`，提示末尾接一句 |
| `src/main/index.ts` | `exportPdf`（对话框 → 强制 `.pdf` → `buildScriptHtml` → `writePdf`）、`setupShortcuts`、托盘状态带上快捷键提示、退出时注销全部快捷键 |
| `src/preload/index.ts` | 补 `exportPdf`；另暴露 `window.dayfilmProjection.onToggle`（放映切换的订阅入口，沙箱渲染进程拿不到裸 `ipcRenderer`） |
| `tests/main/{ipc,tray}.test.ts` | `exportPdf` 的转交断言、出站通道登记断言、快捷键提示的提示文案断言 |

未改：`src/renderer/**`、`src/shared/**`、`package.json`、构建与打包配置。

## 关键取舍

### 剧本 PDF（R53）

- 拆成两层：`pdf/index.ts` 只拼 HTML（纯函数、可单测），`pdf/render.ts` 只做"隐藏窗口 → 打印 → 写盘"（Electron 相关，无单测）。
- 自包含：所有样式内联在 `<style>`，不引用字体/图片/脚本；单测断言没有 `<link`、`<script`、`http(s)://`。
- 转义：`escapeHtml` 覆盖 `& < > " '`，先转 `&` 再转其余（不会二次转义）；标题、进程名、窗口标题、手记、项目名、题材点评全部过一遍。单测用 `<script>`、`<img onerror>`、引号、`&` 做注入用例。
- 分节顺序：标题（`日期 · Dayfilm 剧本`）→ 手记（有则显示）→ 题材与点评 → 三项数字（活跃时长 / 镜头 / 剪辑）→ 项目（有则显示，取 `totalByProject` 前 3）→ 镜头表。
- 镜头表**只列非空闲镜头**：中场休息没有进程名与标题，放在"应用/标题"表里是空行；规格 R53.2 也只写"镜头表"。这条取舍写在这里，避免以后被当成漏数据。
- 分页：`thead { display: table-header-group }` 保证跨页重复表头，`tr { break-inside: avoid }` 不把一行切开，另把行按 25 条分进多个 `<tbody>` 作为明确的切点提示（不强制分页，A4 高度决定实际断点）。
- 失败文案分阶段：`PDF 渲染失败：…` / `PDF 打印失败：…` / `PDF 写盘失败：没有写入权限（EACCES）`。带 fs 错误码的走 `describeWriteError`（中文原因 + 原码），其余走 `describeError`；文案不含标题原文。`finally` 里一定销毁隐藏窗口。
- 取消/非法日期返回 `{ path: '' }`；扩展名用既有的 `ensureExtension(path, 'pdf')` 强制。

### 全局快捷键（R54）

- `SHORTCUT_ACCELERATORS` 是唯一清单：`toggleHud = CommandOrControl+Alt+D`、`toggleProjection = CommandOrControl+Alt+P`；注册与单测都读它，不会出现"文档写了但没注册"。
- `registerShortcuts(host, actions)` 的宿主（`register` / `unregisterAll`）可注入，因此"被占用不影响启动"这件事能单测：`register` 返回 false 或直接抛错都只记进 `failures`，继续注册下一个，不重试、不抛。
- 失败时：主进程 `console.warn` 一次（只报加速器，不含窗口内容），并把 `shortcutWarning = '快捷键被占用'` 放进 `TrayState`，托盘悬停提示末尾多一句；状态字与图标仍是采集中/已暂停/出错，不会被这个提示带偏。
- 放映切换：`showWindow()` 之后 `webContents.send(PROJECTION_TOGGLE_CHANNEL)`。已知边界：如果窗口刚被创建、页面还没加载完，这条 send 会丢（正常使用里窗口只是隐藏，不会重建）。
- 退出时 `shortcuts.unregisterAll()`，与停采集、销毁托盘/HUD 一起在 `before-quit` 里收尾。

### 通道登记

- `exportPdf` 走既有 `handleIpc`，因此来源校验、入参校验、rejection 回到界面这三件事与其它导出通道完全一致。
- `dayfilm:projection-toggle` 是主进程单向发、渲染进程监听，不需要入参守卫，但也要登记：新增 `OUTBOUND_CHANNELS`（与 `SEND_CHANNELS` 对称），单测断言它与 invoke/send/tick 都不撞名、且都以 `dayfilm:` 开头。

## 验证输出

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0）

=== 2) npx vitest run tests/main ===
 Test Files  22 passed (22)
      Tests  223 passed (223)
   Duration  2.50s

=== 3) npm run build ===
out/main/index.js        73.14 kB  ✓ built in 241ms
out/preload/index.js      2.34 kB  ✓ built in 14ms
out/renderer/hud.html     1.86 kB
out/renderer/index.html  12.60 kB
```

中间修过一处自己的测试错误：注入用例里项目规则的关键词是 `code`，但那个 scene 的进程名/标题被换成了 `<img …>` / `<script>…`，项目匹配不上，所以"转义后的项目名"根本没出现在 HTML 里。把关键词改成 `script` 后通过——这也说明"只在命中时才渲染项目"这条逻辑是生效的。

## 未完成项 / 需要主 Agent 处理

1. **PDF 真机未验证**：`printToPDF` 的实际排版（A4、背景色、表头跨页、中文字体）需要人看或走 DevTools 协议。单测只覆盖 HTML 本身。
2. **`writePdf` 没有超时**：如果 `printToPDF` 卡住，IPC 的 Promise 会一直挂着（界面侧转圈），隐藏窗口也还留着。要不要加超时（例如 30 秒后 `PDF 打印失败：超时`）需要产品口径。
3. **快捷键冲突路径只测了决策逻辑**：真实"被其它程序占用"的复现要另开一个程序抢 `Ctrl+Alt+D`，本轮没做。
4. **放映切换事件已由 preload 转出**：沙箱渲染进程不能直接用 `ipcRenderer`，所以 preload 额外暴露了 `window.dayfilmProjection.onToggle(cb)`（返回取消订阅，与 `window.dayfilmHud` 同一模式；不属于 `DayfilmApi`）。df-ui 需要订阅它才能响应 `Ctrl+Alt+P`。契约里没有对应方法，要收进 `DayfilmApi` 得主 Agent 改 `src/shared`。
5. **PDF 主题参数**：`buildScriptHtml` 接受 `theme?: 'classic'` 但目前只有经典一套配色；R50 的三主题是海报的，不属于 PDF。

---

## 追加：PDF 白页修复（R53）

### 排查

先把两份 PDF 的内容流 inflate 出来看：用户报白页的 `Documents\dayfilm-2026-11-23.pdf`（106,401 B）里其实有 10 处深色填充（`rg 0.051 0.059 0.071` = `#0d0f12`）、页面尺寸矩形和 411 个文字算子——内容流不是空的。再用同一台机器的 Edge 重新打开这份旧文件，**现在能正常显示**（截图 `%TEMP%\dayfilm-pdf-probe\edge-old.png`）。

所以：白页未能从磁盘上的这份文件复现。本轮按清单做了加固，并且把新管线端到端跑通、看过图；不声称"定位到根因再修"。最可能的成因仍是隐藏窗口的首帧/字体未就绪就打印（内容有、但画布没画），以及背景只在 `body` 上（页面画布看的是 `html`）。

### 改动（按清单）

1. `src/main/pdf/render.ts`：窗口加 `webPreferences.backgroundThrottling: false` 与 `paintWhenInitiallyHidden: true`；先等 `did-finish-load`（同时监听 `did-fail-load`），再在页面里 `await document.fonts.ready` + 两帧 `requestAnimationFrame`，然后才 `printToPDF`。等待套了 3 秒上限，隐藏窗口的 rAF 即使被节流也不会挂死。
2. `printToPDF` 参数写全：`pageSize: 'A4'`、`printBackground: true`、`preferCSSPageSize: false`、`landscape: false`、`margins: { marginType: 'default' }`。
3. `src/main/pdf/index.ts` 样式：`html, body` 都带 `background: #0d0f12` 与 `-webkit-print-color-adjust: exact; print-color-adjust: exact`（原来只在 `body` 上）；`@page { size: A4; margin: 16mm; }`。
4. 打印后兜底：新增 `MIN_PDF_BYTES = 2000` 与 `isEmptyPdf(bytes)`，`writePdf` 里小于阈值直接抛 `PDF 生成失败：内容为空`（用哨兵错误，不会被外层包成"打印失败：Error"）。
5. 单测（`tests/main/pdf.test.ts` 新增 3 例）：0 与阈值-1 判空；正好阈值与 106 KB 不判空；`Buffer` / `Uint8Array` 都能直接用。

### 真机验证（走真实渲染链路，不是复制逻辑）

用 esbuild 把 `src/main/pdf/{index,render}.ts` 打成临时 CJS，再用仓库的 Electron 调**真正的 `writePdf`**：30 个镜头 + 1 段中场休息 + 手记 + 两条项目规则。

```text
WROTE dayfilm-probe.pdf 125923 bytes   （PDF-1.4，2 页）
内容流：18 处深色填充（rg 0.051 0.059 0.071）、5 个页面尺寸矩形、1123 个文字算子
```

- Edge 打开截图 `%TEMP%\dayfilm-pdf-probe\edge-new.png`：深色底、`2026-11-23 · Dayfilm 剧本`、导演手记、题材、三项数字（活跃时长 2 小时 0 分钟 / 镜头 30 / 剪辑 30）、项目（编码 32 分钟 · 沟通 28 分钟）、镜头表（时间区间 / 应用 / 标题 / 时长），页脚 `1 / 2`。**不是白页。**
- 空页兜底实测：`writePdf('<html><body></body></html>', …)` → `REJECTED PDF 生成失败：内容为空`，`file written: false`。

探针产物（bundle、PDF、两张截图）留在 `%TEMP%\dayfilm-pdf-probe\`，可直接删。

### 本轮验证

```text
=== npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0）

=== npx vitest run tests/main ===
 Test Files  22 passed (22)
      Tests  226 passed (226)

=== npm run build ===
out/main/index.js        74.53 kB  ✓ built in 217ms
out/preload/index.js      2.34 kB  ✓ built in 14ms
```

### 还需要注意

- **真机导出按钮没点**：本轮用的是同一个 `writePdf` 的探针（完全一样的代码路径），没走 UI 的"导出 PDF"按钮与保存对话框；建议主 Agent 用构建产物点一次确认对话框与最终文件。
- **旧文件的白页没复现**（见上），如果用户再遇到，先让他用 Edge 重新加载一次并回报；若仍复现，需要拿到那份具体文件（路径 + 字节数）再比对内容流。
- 顺带跟着主 Agent 的契约更新：`preload` 里的 `ProjectionBridge` 改为从 `src/shared/ipc.ts` 导入（那份类型已进契约），不再本地声明一份。
