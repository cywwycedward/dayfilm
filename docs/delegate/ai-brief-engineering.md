# 任务书：Dayfilm × AI 头脑风暴（工程可行性视角）

你在 `D:/core/workspace/mine/github_mine/dayfilm` 仓库里工作。只做分析和写作：不要改任何源代码、不要新增依赖、不要提交。

## 目标

在"不联网、CSP 只允许本地资源、数据只在本机"这条产品硬约束下，判断 AI 到底怎么落地、代价多大、现有架构哪些地方会直接冲突。

## 先读（必须，别猜）

`README.md`、`PRODUCT.md`、`docs/architecture/dayfilm.md`、`docs/specs/dayfilm-delivery.md`、`docs/operations/perf-report.md`、`package.json`、`electron.vite.config.ts`、`electron-builder.yml`、`src/main/security/index.ts`、`src/main/index.ts`（窗口创建、CSP、生命周期、IPC 接线）、`src/main/ipc/index.ts`、`src/preload/index.ts`、`src/shared/ipc.ts`、`src/main/reel/cache.ts`、`src/main/pdf/render.ts`、`src/main/export/index.ts`、`tests/perf/bench.test.ts`、`scripts/probe-ui.mjs`、`scripts/probe-packaged.mjs`。

## 已核实的事实

- Electron 33 + electron-vite + TypeScript；`package.json` 里**没有生产依赖**，全部在 devDependencies（electron / electron-builder / vitest / typescript / vite）。
- 主进程 = Node；两个渲染进程 `sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`，只通过 preload 白名单暴露方法；类型来源 `src/shared/*`；IPC 通道用 `Record<Channel, Handler>` 登记，漏一个编译不过；`isLocalRequest` 打包后只放行 `file:`/`data:`/`blob:`，回环 http 只开发模式放行。
- 打包目标 `portable` 单 exe（electron-builder），未签名；`files` 只入 `out/**` + `package.json`；`extraResources` 放 capture.ps1 与托盘图。
- 数据：`%APPDATA%\dayfilm\days\<date>.jsonl` + `settings.json` / `notes.json` / `marks.json`；切分层是纯函数 + 增量聚合，`tests/main/aggregate.test.ts` 用随机序列守"增量 == 全量"；有性能基准 `tests/perf/bench.test.ts`。
- 约 40 个测试文件、600+ 例，`npm test` = vitest run；`npm run typecheck` 两套 tsconfig。

## 交付

写 `docs/delegate/ai-brainstorm-engineering.md`（Markdown，中文，直接给结论，不要免责声明），包含：

1. **5–7 条落地路线**，逐条写清 (a) 运行位置（主进程 / 独立子进程 / 渲染层 / 外部程序）；(b) 模型来源（本地 GGUF、本地服务 HTTP、用户自带云端 key、纯本地统计与 embedding、完全无模型）；(c) 对"不联网"承诺的影响（本地模型算不算破坏承诺；BYO key 要改哪些文档、UI 措辞、`security/index.ts` 与 CSP；启动时的站外请求禁令怎么保持）；(d) 打包与体积（量化档位大小、要不要首启下载、便携版 exe 多大）；(e) 延迟与内存（冷启动、每次生成耗时、常驻采样程序的资源预算）；(f) 可测试性（怎么在没有模型的环境里跑 vitest；生成怎么抽成可注入接口；性能基准会不会被拖慢）；(g) 失败模式（模型缺失、OOM、超时、输出不合 schema、断网）。
2. 专题回答：
   - (a) 只做"AI 摘要/评语"，最小可信的推理方案是什么（模型规模、量化档位、期望 tok/s、内存占用），4–8 GB 内存办公机可行吗。
   - (b) 有没有"不需要生成式模型、也不需要联网"的手段能拿到 80% 价值（标题实体抽取、字符 n-gram TF-IDF 余弦、聚类、本地轻量分类器、模板 + 槽位填充），各自能做到什么、做不到什么。
   - (c) 一个能塞进现有架构的最小接口形状（类型放哪、IPC 通道怎么加、失败怎么降级），只描述形状，不写实现代码。
   - (d) 现有架构里哪些约束会直接和 AI 冲突（确定性渲染、纯函数可测、sandbox、无生产依赖、便携版体积），冲突怎么收。
3. **明确说"不建议做"的路线**，一条一句理由，别只说风险不说结论。

## 风格要求

- 所有数字要标明是估算还是实测；实测请引用仓库里已有的数据（`docs/operations/perf-report.md`）。
- 不要列一堆"可选方案"了事：每条路线给出可执行与否的判断。
