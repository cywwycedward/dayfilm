# df-core 状态记录（v1.1 主进程）

v1.1 主进程侧完成：项目规则归一、导演手记存储、海报 PNG 保存、剧本增强（手记 + 项目段），三个新通道全部走现有守卫。三条自检命令通过，主进程侧 164 例测试全过。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/notes/index.ts` | `NotesStore`（`<userData>/notes.json`）+ `clampNote`；tmp+rename 原子写、坏文件留档 |
| `src/main/save-image.ts` | `decodePngBase64`（magic + 体积校验）、`sanitizeImageName`、上限常量 |
| `tests/main/notes.test.ts` | 11 例：往返、trim/`\r`、按码点截断、空文本删除、非法日期、坏文件留档、原子写、写失败 |
| `tests/main/save-image.test.ts` | 10 例：PNG 解码、非 base64/非 PNG/超限、名称清洗、`ensureExtension` |
| `docs/delegate/status-main3.md` | 本文件 |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/settings/index.ts` | `projects` 归一（≤20 条、名称 1–32 字、同名保留第一条、关键词 ≤20 且单条 ≤64、空关键词丢弃、全坏值回落）；`normalizeTerms` 支持传入上限 |
| `src/main/reel/index.ts` | `renderScreenplay(day, options?)`：`> 导演手记：<text>` 与 `项目：A 12 分钟 · B 5 分钟`（复用 `shared/projects.ts` 的 `totalByProject`） |
| `src/main/export/index.ts` | 抽出 `ensureExtension(path, ext)`，`ensureMarkdownPath` 改为它的薄包装 |
| `src/main/ipc/index.ts` | 受守卫通道表与 `IpcDeps` 增加 `getNote` / `setNote` / `saveImage` |
| `src/main/index.ts` | 接线三个新通道、`NotesStore` 初始化、导出剧本带上手记与项目 |
| `src/preload/index.ts` | 暴露 `getNote` / `setNote` / `saveImage` |
| `tests/main/{settings,reel,ipc,pipeline}.test.ts` | 补 projects 归一、剧本增强、新通道转交、整链带手记/项目 |

未改：`src/shared/**`、`src/renderer/**`、`package.json`、打包配置、其他文档。

## 关键取舍

### 1) 项目规则

- 复用现有的 `normalizeTerms`（加一个 `limit` 参数），关键词口径与脱敏词完全一致：trim、去空、大小写不敏感去重、单条 ≤64。
- 名称按**码元**截到 32 字（与关键词同风格），并大小写不敏感去重，保留第一条。
- “坏值回落”的判定：`projects` 不是数组 → 回落上一份；数组里一条都没活下来（例如 `[{name: 42}]`）→ 也回落，因为这与用户显式清空在语义上不同。显式传 `[]` 才是清空。
- 单测覆盖：超长名称、空/全空白关键词、重复项目名、25 条截成 20、30+ 关键词截成 20、单条 100 字截成 64、类型错误回落（含“缺失时保留原值”与“空数组可清空”）。

### 2) 导演手记

- 结构固定 `{ version: 1, notes: { 'YYYY-MM-DD': string } }`；只保留合法日期键与字符串值，其余静默丢弃（不算损坏）。
- `clampNote`：先去 `\r`、trim，再按 **Unicode 码点**截 200（`Array.from`），emoji 不会被切半。
- 空文本删除键；`set` 返回落盘后的内容，界面可以拿它覆盖编辑框。
- `get` 非法日期返回空串（不抛）；`set` 非法日期抛 `手记日期不合法`——但 IPC 层先校验，渲染进程拿不到这个异常。
- 损坏文件：复制成 `notes.corrupt-<ISO 时间戳>.json` 后按空集合处理，下一次 `set` 会写出干净文件。
- 写失败抛 `手记保存失败：<code>`，并通过 IPC 拒绝传回界面（R23.2 的“显示可读错误并保留编辑内容”由界面侧消费）。

### 3) 海报保存

- 纯逻辑全在 `src/main/save-image.ts`，Electron 只负责对话框与写盘；单测不启动 Electron。
- 校验顺序：非字符串 → 空串 → 按 base64 长度粗判体积（避免为超大输入分配内存）→ 解码 → 解码后 ≤20 MB → PNG magic（`89 50 4E 47`）。任一步不过返回 `{ path: '' }`。
- IPC 入参另有一道 `pngBase64.length ≤ 40 MB`（契约要求的 base64 体积上限），在去重成本更低的地方先挡掉。
- `defaultName` 只取最后一段文件名、去掉 Windows 非法字符（`<>:"/\|?*` 与控制字符）、去掉重复 `.png`、路径穿越（`../..`）自然消失、空值兜底 `dayfilm`、超过 80 字截断；保存对话框的默认名与最终落盘扩展名都固定 `.png`（`ensureExtension(path, 'png')`）。
- 写盘失败抛 `海报保存失败：<code>`；取消返回 `{ path: '' }`。

### 4) 剧本增强

- `renderScreenplay(day, options?)` 第二参数可选，老调用行为一字不变（现有断言全部保留）。
- 手记行紧跟标题行：`> 导演手记：<text>`，与后文空一行；空白手记不产生该行。
- 项目行紧跟在题材段之后：`项目：A 12 分钟 · B 5 分钟`，取 `totalByProject` 的前 3（该函数来自 `shared/projects.ts`，与界面同一套口径，没有另写一套）。
- 导出时主进程自己读当天手记与当前设置的项目规则，界面不需要额外传参。

### 5) IPC 与安全

- 三个新通道都加进 `GUARDED_CHANNELS`（`src/main/ipc/index.ts`），`registerIpc` 遍历它注册，因此必然经过 `handleIpc` 的来源校验；`tests/main/ipc.test.ts` 里“IPC 去掉 tick 后每个通道都在守卫表里”“每个通道都有实现”“每个通道把入参原样转交”三条断言现在覆盖 11 个通道。
- 入参校验在主进程侧：`getNote`/`setNote` 校验日期正则与 `text` 类型（不合法返回 `''`，不抛）；`saveImage` 校验 `pngBase64` 类型与长度、PNG magic 与解码体积。

## 验证输出

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
（无输出，exit=0）

=== 2) npx vitest run tests/main ===
 Test Files  17 passed (17)
      Tests  164 passed (164)
   Duration  2.50s

=== 3) npm run build ===
out/main/index.js       53.27 kB  ✓ built in 358ms
out/preload/index.js     1.52 kB  ✓ built in 16ms
out/renderer/index.html  7.09 kB
out/renderer/assets/index-BMkQ0lL2.css 21.09 kB
out/renderer/assets/index-eaQ2rmTO.js  54.22 kB
```

`tests/main` 的 164 例分布：reel 27、settings 24、capture 15、notes 11、save-image 10、ipc 6、store 10、cache 8、buffer 6、retention 5、security 9、aggregate 5、tray 6、pipeline 2（合计 164）。

全量 `npm run typecheck`（含界面侧）当前 exit=2，错误**全部在 `src/renderer/src/app.ts`**（df-ui 正在改：`pickHighlights`/`computePoster`/`fractionOfDay`/`layoutReel` 等未定义或未使用，以及 `State`/`Ui` 缺字段）。主进程侧 `tsconfig.node.json` 单独跑是 0 错误，与 brief 的“失败时先确认不是你的文件”一致。

## 真机验证：本轮未做（被单实例锁挡回，属预期行为）

按流程 `npm run build` 后跑了一次 `npm run start` 想验证新通道，结果窗口没起来、探针没有记录。查下来是**主 Agent 的打包版 `Dayfilm.exe`（PID 41304）正在运行**，它持着同一 `%APPDATA%\dayfilm` 的单实例锁，我的实例调 `app.requestSingleInstanceLock()` 拿到 false 后立刻 `app.quit()`——这正是 R12.5“再次启动时聚焦已有窗口”的实现。另外那个 `%TEMP%\3MS…\resources\capture.ps1` 采集进程属于该打包实例（父进程 41304 仍在），不是我这轮留下的。

因此新通道的运行时证据缺一环，只有单测与代码审查。要补真机证据有两种办法（都该由主 Agent 决定）：先退出打包实例再跑 `npm run start`；或给打包版加 `--user-data-dir` 起一个独立实例，避免与正在验收的实例抢锁。

## 未完成项 / 需要主 Agent 处理

1. **真机 IPC 证据缺失**（见上一节）。新通道的正确性目前由 `tests/main/ipc.test.ts`（转交与覆盖）与 `notes`/`save-image` 单测保证。
2. **`notes.json` 没有上限**：每天最多 200 字，但日期数量无上限（一年 365 条约 30 KB，可接受）。若产品要限制，需要定个口径。
3. **手记不做脱敏**：手记是用户主动输入的一句总结，不经过 `redactSample`，也不写入日文件；如果产品认为手记里可能粘贴敏感内容，需要单独策略。
4. **`saveImage` 不校验 PNG 完整性**，只看 magic 与体积（契约只要求这两条）；写坏图的责任在界面侧渲染。
5. **导出剧本时手记/项目是现读的**：导出瞬间的设置与手记，与界面当时展示的可能是不同快照（用户改了设置但还没刷新）。这是“以落盘为准”的取舍，没有额外做一致性快照。
6. 界面侧 `src/renderer/src/data.ts` 还缺 `getNote`/`setNote`/`saveImage` 三个方法（全量 typecheck 会报），按分工由 df-ui 修。
