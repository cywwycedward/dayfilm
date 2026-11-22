# 开发约定

## 技术栈

- Electron + TypeScript，构建工具 `electron-vite`。
- 渲染层不引入 UI 框架，使用原生 DOM + CSS + Canvas。
- 测试使用 `vitest`，测试文件放在 `tests/`，与被测模块同构命名。

## 目录

```text
src/main/      主进程：采集、存储、切分、IPC
src/preload/   渲染进程与主进程之间的桥
src/renderer/  界面
src/shared/    共享类型与通道名
resources/     随应用分发的脚本与静态资源
tests/         单元与集成测试
docs/          项目文档
```

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 开发模式启动，界面热更新 |
| `npm start` | 以构建产物启动（先 `npm run build`） |
| `npm run build` | 构建主进程、preload、界面 |
| `npm run typecheck` | 类型检查 |
| `npm test` | 运行测试（含 `tests/perf` 的基准，约 2 秒） |
| `npm run pack` | 打解包产物到 `dist/win-unpacked`（`electron-builder --dir`） |
| `npm run dist` | 打便携版 `dist/Dayfilm-<版本>-portable.exe` |

`npm run pack` / `npm run dist` 需要联网下载 Electron 与 NSIS 资源；electron-builder 不读 npm 的 proxy 配置，必要时先设置 `HTTP_PROXY`/`HTTPS_PROXY`。

## 写入归属

- `src/main/**`、`resources/**`、`tests/main/**`：主进程实现者。
- `src/renderer/**`、`tests/renderer/**`：界面实现者。
- `src/shared/**`、`package.json`、`electron.vite.config.ts`、`tsconfig*.json`、`electron-builder.yml`、`docs/**`：主 Agent 维护。需要改动契约或依赖时先向主 Agent 提出。

两个里程碑的实现者交接记录在 `docs/delegate/`（`status-*.md`、`review-delivery.md`），仅作过程证据，不构成长期约定。

## 验证工具

`scripts/` 下是监督验收用的探针，不属于产品代码，不参与构建：

| 脚本 | 用途 |
| --- | --- |
| `probe-app.mjs` | 启动构建产物，读真实 IPC 返回并截图 |
| `probe-settings.mjs` | 走一遍设置面板、暂停与恢复、错误字段 |
| `probe-ui.mjs` | 造一份历史日数据，验证日期切换与检索 |
| `probe-recovery.mjs` | 杀掉采集子进程，验证自恢复与无孤儿进程 |
| `probe-metrics.mjs` | 启动耗时、空闲 CPU、RSS 与收进托盘后的状态 |
| `probe-mock.cjs` | mock 数据下的版式与回放帧率 |
| `probe-packaged.mjs` | 打包产物启动并验证 IPC |
| `pack/make-icon.cjs`、`pack/verify.cjs` | 生成图标、校验解包产物 |

## 代码风格

- TypeScript 严格模式；不使用 `any`，确需放宽时写明原因。
- 模块边界内的函数保持纯函数优先，IO 集中在少数入口。
- 注释只写代码无法表达的取舍与前提，用中文。
