# 任务说明书：第二阶段主进程（df-main，接续 df-core）

## 目标

把 MVP 主进程补成可交付版本：隐私脱敏、保留期、托盘常驻、休眠与时钟处理、存储可靠性、IPC 安全、性能达标。权威要求见 `docs/specs/dayfilm-delivery.md`（R10–R16）。

## 可写范围

- `src/main/**`、`src/preload/**`、`resources/**`
- `tests/main/**`、`tests/perf/**`
- `docs/delegate/status-main2.md`

不要改：`src/renderer/**`（df-ui 负责）、`src/shared/**`（主 Agent 已更新，见下）、`package.json`、`electron-builder.yml`、`build/**`、其他文档。

## 已由主 Agent 更新的契约（不要改动，直接实现）

`src/shared/settings.ts`：`Settings`（`retentionDays` / `redactTerms` / `autoStart` / `paused`）、`DEFAULT_SETTINGS`、`RETENTION_OPTIONS`、`BUILTIN_REDACT_TERMS`、`REDACTED_TITLE`。

`src/shared/ipc.ts`：新增 `getSettings` / `setSettings` / `quit` 三个通道，以及 `DayfilmApi` 上的 `getSettings()` / `setSettings(patch)` / `quit()`。

`src/shared/types.ts`：`LiveState` 新增 `storageError: string | null` 与 `paused: boolean`。

## 必须实现

### 1. 设置（`src/main/settings/index.ts`）

- 文件 `<userData>/settings.json`，构造时可注入根目录。
- 读取：文件缺失/损坏/字段类型不符时按字段回落 `DEFAULT_SETTINGS`；写回修复后的文件。
- 保存：写 `settings.json.tmp` 后 rename 覆盖；失败抛出可读错误，调用方决定是否暴露。
- `update(patch)`：只接受白名单字段并归一——`retentionDays` ∈ {0,7,30,90,365}，`redactTerms` 去空、trim、去重、单条 ≤64 字符、最多 100 条，布尔按 `Boolean()`；返回完整设置。
- 单测覆盖：坏文件、单字段坏、白名单归一、原子写。

### 2. 脱敏（`src/main/redact/index.ts`）

- 纯函数 `redactSample(sample, terms)`：标题或进程名（不区分大小写）命中 `BUILTIN_REDACT_TERMS` 或 `terms` 任一关键词时，`title` 替换为 `REDACTED_TITLE`，`exe` 保留。
- 在写入**之前**调用：磁盘上不得出现被隐藏的原文。
- 保留 MVP 的 512 字符截断。
- 单测覆盖：内置词、自定义词、大小写、中文、无命中。

### 3. 保留期（`src/main/retention/index.ts`）

- `cleanupExpired(store, retentionDays, now)`：`retentionDays === 0` 时不动；否则删除文件名日期早于 `now - retentionDays` 的日文件，返回 `{ removed: string[], errors: { date: string; message: string }[] }`。
- 启动时执行一次，失败只记录到状态，不阻塞启动、不崩溃。
- 单测用临时目录覆盖：删旧留新、0 表示不清理、删不掉的错误被收集。

### 4. 托盘、暂停、自启、退出（`src/main/tray/index.ts` + `src/main/index.ts`）

- 托盘图标：`resources/tray.png`（32×32，暖白胶片齿孔造型，自己生成，不依赖其他 Agent 的文件；用内联 base64 亦可）。
- 托盘菜单：`打开 Dayfilm` / `暂停采样` 或 `继续采样`（勾选项）/ `退出`。
- 关闭主窗口默认拦截并隐藏（`win.on('close', e => { if (!isQuitting) { e.preventDefault(); win.hide() } })`），保留"真正退出"路径：托盘退出与界面 `quit` 通道。
- 托盘悬停提示：`Dayfilm · 采集中/已暂停/出错`（可附当日已记录时长）。
- `paused` 设置：暂停时停止采集子进程、界面 `LiveState.paused = true`；继续时重启。首次启动读设置决定。
- 开机自启：`app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--hidden'] })`；带 `--hidden` 启动时不显示窗口（托盘仍在）。
- 退出时：停止采集、清理计时器、销毁托盘、确保子进程树被终止。

### 5. 休眠与时钟（`src/main/index.ts`）

- `powerMonitor.on('suspend')` 停止采集，`resume` 后重启；休眠期间不补数据。
- 时钟守卫：新采样 `t` 小于等于该日已存最后一条 `t` 时丢弃，不写入；计数但不把标题写进日志。
- 跨本地零点：新采样写入新日文件。

### 6. 存储可靠性（`src/main/store/index.ts`、`src/main/index.ts`）

- 追加失败：采样进内存缓冲（上限 1000 条，超出丢最旧并计数），置 `storageError`，每 5 秒重试；成功后清空缓冲与错误。
- 读取容错：尾部半行、坏行、字段类型不符的行跳过（已有，确认仍成立）。
- 单日文件 > 64 MB 时在 `storageError` 里给出提示文案（不含标题）。

### 7. 性能（`src/main/reel/index.ts` + 新缓存模块）

- 保留 `buildDayRollup` 作为全量参考实现。
- 新增增量聚合：当日新增采样只更新尾部，不重算整天；历史日期按需全量计算并缓存。
- 跨日缓存用 LRU，最多驻留 8 天。
- 硬要求：增量结果与 `buildDayRollup` 深度相等——随机序列属性测试（≥200 组，含乱序、重复时间戳、空闲切换、跨天边界）。
- tick 推送复用缓存，不重复全量计算。

### 8. 安全边界（`src/main/index.ts`）

- IPC：只接受来自本应用窗口的调用（校验 `event.senderFrame` 属于当前窗口且 URL 为应用自身页面；开发模式放行 devserver 地址）。
- 网络：`session.defaultSession.webRequest.onBeforeRequest` 拒绝非本地来源请求（放行 devserver 与 file://），返回 `{ cancel: true }`。
- 日志：不输出窗口标题原文；错误信息只含进程名、时间与错误类型。

### 9. 测试与基准

- `tests/main/**` 补齐上述单测。
- `tests/perf/bench.test.ts`：生成 30 天 × 5 万条采样（临时目录），测量并打印：全量 `buildDayRollup` 单日耗时、增量追加 1000 条的均摊耗时、跨 7 天检索耗时、`process.memoryUsage().heapUsed`。断言放宽到机器抖动可接受的上限，真实数字写进状态文件。
- 把实测数字写进 `docs/delegate/status-main2.md`。

## 协作注意

- 契约改动只由主 Agent 做；需要新增字段时写进状态文件并停下等待。
- 类型检查只看自己那侧：`npx tsc --noEmit -p tsconfig.node.json`。全量 `npm run typecheck` 会连带界面侧，界面正在被另一位实现者改动，失败时先确认不是你的文件。
- `npm test` 全量跑会带上界面的测试；用 `npx vitest run tests/main tests/perf` 自测，收尾时再跑一次全量并把结果写进状态文件。
- 不要运行 `npm run dev`（会与验证冲突）；需要真机验证时先 `npm run build`，再说明你怎么跑的。

## 验收命令

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main tests/perf
npm run build
```

## 交付

代码落在可写范围；`docs/delegate/status-main2.md` 写清改动、取舍、验证输出、性能数字、未完成项与需要裁决的问题。
