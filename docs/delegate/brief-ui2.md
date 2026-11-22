# 任务说明书：第二阶段界面（df-ui，接续上一轮）

## 目标

界面补上可交付版本需要的控制面与状态表达：设置面板、暂停状态、写入异常提示、长列表性能。权威要求见 `docs/specs/dayfilm-delivery.md`。

## 可写范围

- `src/renderer/**`
- `tests/renderer/**`
- `docs/delegate/status-ui2.md`

不要改：`src/main/**`、`src/preload/**`、`src/shared/**`、`package.json`、`electron-builder.yml`、其他文档。

## 已由主 Agent 更新的契约（直接使用）

- `src/shared/settings.ts`：`Settings`、`DEFAULT_SETTINGS`、`RETENTION_OPTIONS`、`BUILTIN_REDACT_TERMS`。
- `src/shared/ipc.ts`：`DayfilmApi` 新增 `getSettings()`、`setSettings(patch)`、`quit()`。
- `src/shared/types.ts`：`LiveState` 新增 `storageError: string | null` 与 `paused: boolean`。

## 必须实现

### 1. 设置面板

- 顶栏加一个 `设置` 按钮，打开右侧抽屉或居中对话框；Esc 关闭，焦点进入面板并在关闭后回到触发按钮，面板内 Tab 循环。
- 内容：
  - **保留期**：下拉，选项来自 `RETENTION_OPTIONS`；改动立即 `setSettings` 并显示已保存。
  - **脱敏关键词**：已有关键词以 chip 展示可删除，输入框回车添加；下方只读展示 `BUILTIN_REDACT_TERMS`；说明"命中后标题显示为 [已隐藏]，只影响之后的新记录"。
  - **开机自启**：开关，调用 `setSettings({ autoStart })`。
  - **暂停采样**：开关，调用 `setSettings({ paused })`；与托盘行为一致。
  - **退出 Dayfilm**：按钮，调 `quit()`；旁注"关闭窗口会收到托盘继续采样"。
  - **数据位置**：展示 `%APPDATA%\dayfilm\days\` 文本。
- 保存失败（IPC 抛错）时在面板内显示可读错误，不崩溃、不假装成功。
- mock 模式下（`window.dayfilm` 不存在）设置保存在内存，界面表现一致。

### 2. 状态表达

- `paused === true`：实时条显示"已暂停"，顶栏 chip 变黄（新增状态）；与采集错误同时出现时优先显示错误。
- `storageError !== null`：顶栏下方新增一条 `role="alert"` 的写入异常横幅，文案清晰，与采集错误横幅视觉区分（暖红 vs 暖黄）。两者可同时存在。
- 关闭窗口收到托盘的提示只在设置面板里说明，不做弹窗。

### 3. 长列表性能

- 镜头列表与检索结果改为窗口化渲染：可视区外只保留上下各 5 行缓冲；固定行高 + transform 偏移实现。
- 500+ 行时滚动不卡顿；保持现有键盘选中、`scrollIntoView`、点击定位行为。
- 纯函数（计算可见区间、行偏移）单独成模块并测试边界（空列表、只有 1 行、滚动到底、行高变化）。

### 4. 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

全量 `npm run typecheck` 会连带主进程侧（另一位实现者正在改），失败时先确认不是你的文件。不要运行 `npm run dev`。用 mock 数据自查可以继续用 `npx vite src/renderer --port 5176`。

## 交付

代码落在 `src/renderer/**`；`docs/delegate/status-ui2.md` 写清文件、交互决策、验证输出、未完成项。
