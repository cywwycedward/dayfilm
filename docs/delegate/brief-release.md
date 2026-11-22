# 任务说明书：打包与分发（df-release）

## 目标

让 Dayfilm 变成一台没装 Node.js 的 Windows 机器上双击就能跑的程序。要求见 `docs/specs/dayfilm-delivery.md` R17。

## 可写范围

- `electron-builder.yml`（新建）
- `build/**`（图标等打包资源）
- `scripts/pack/**`（打包与产物自检脚本）
- `docs/delegate/status-release.md`

不要改：`src/**`、`package.json`、`tsconfig*.json`、`electron.vite.config.ts`、`tests/**`、其他文档。需要改这些时写进状态文件并停下。

## 已知前提

- `package.json` 已有 `pack`（`electron-builder --dir`）与 `dist`（`electron-builder --win`）脚本，均带 `--config electron-builder.yml`；`electron-builder@26` 已安装。
- `electron-vite` 产物在 `out/`：`out/main/index.js`、`out/preload/index.js`、`out/renderer/**`。
- 采集脚本在 `resources/capture.ps1`，运行时由主进程按 `process.resourcesPath` 定位，必须通过 `extraResources` 进包。
- 托盘图标 `resources/tray.png` 由另一位实现者负责，不要依赖它做打包验证。

## 必须交付

### 1. 应用图标

- 生成 `build/icon.png`（512×512）与 `build/icon.ico`（含 256×256 条目即可）。
- 图形与产品一致：深色底、暖白色胶片齿孔或单帧胶片造型，边缘干净，16×16 下仍可辨。
- 允许脚本化生成：Electron 离屏渲染 canvas 再 `capturePage` 取 PNG；ICO 可直接封装 256×256 PNG（Windows 支持 PNG 压缩的 ICO）。生成脚本放 `scripts/pack/make-icon.cjs`，产物入库。

### 2. `electron-builder.yml`

- `appId: com.dayfilm.app`、`productName: Dayfilm`。
- `files`：只含 `out/**`、`package.json` 与必要 runtime 资源；不含 `src/**`、`tests/**`、`docs/**`、`scripts/**`、`*.map`。
- `extraResources`：`resources/capture.ps1`。
- `win.target: portable`，`win.icon: build/icon.ico`。
- `artifactName: "Dayfilm-${version}-portable.${ext}"`。
- `directories.output: dist`。
- 不加签名配置（无证书），在状态文件里写明未签名的影响。

### 3. 产物自检脚本 `scripts/pack/verify.cjs`

- 入参为解包目录（`dist/win-unpacked`），断言：
  - `Dayfilm.exe` 存在；
  - `resources/app.asar` 存在；
  - capture.ps1 落在预期位置（打印真实路径）；
  - asar 里不含 `src/`、`tests/`、`*.map`。
- 输出 JSON 结果，失败非 0 退出。

### 4. 实际跑一次

```powershell
npm run pack
node scripts/pack/verify.cjs dist/win-unpacked
```

- 报告产物体积（exe 与 asar 大小）、verify 结果。
- 若失败原因是 `src/**` 正在被其他实现者改动导致的构建错误，写进状态文件并停止，不要替他们改代码。

## 不要做

- 不要执行 `npm run dist`（正式出包与验收由主 Agent 做）。
- 不要修改源码来迁就打包。

## 交付

产物与配置就绪；`docs/delegate/status-release.md` 记录：图标生成方式、配置要点、pack 实际输出与体积、verify 结果、未验证项（签名、其他机器、便携 exe 启动）。
