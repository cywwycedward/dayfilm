# 任务说明书：品牌资产（df-brand）

## 目标

重做应用图标与托盘图标，让 Dayfilm 在任务栏、桌面、托盘里像一个有品味的工具，而不是随手生成的色块。规范见 `docs/product/visual-language.md` §7。

## 可写范围

- `build/**`（icon.png / icon.ico）
- `resources/tray*.png`（三个状态）
- `scripts/pack/make-icon.cjs`
- `docs/delegate/status-brand.md`

不要改 `src/**`、`package.json`、`electron-builder.yml`、其他文档。

## 必须交付

### 1. 应用图标

- 现有 `scripts/pack/make-icon.cjs` 已经是"Electron 离屏 canvas → 各尺寸 PNG → 手拼 ICO"，沿用这个管线重画，不要引入新依赖。
- 造型：深色圆角底（`#0a0b0d` → `#12141a` 微渐变）+ 一帧胶片 + 中央一条暖白曝光缝（`#ece7dc`）；不要文字、不要阴影、不要描边发光。
- 必须原生渲染 256/128/64/48/32/16 六个尺寸（16px 下允许只保留"深底 + 一条暖缝"）。
- 生成 `build/icon.png`（512×512，透明圆角）与 `build/icon.ico`（六个条目，PNG 压缩）。
- 自检：每个尺寸解回 `nativeImage` 断言尺寸与角像素 alpha；把 16px 放大 8 倍另存 `build/icon-16-preview.png` 供人眼确认。

### 2. 托盘三态图标

- 同形不同色，32×32（透明背景）：`resources/tray.png`（暖白 `#ece7dc`）、`resources/tray-paused.png`（银灰 `#8d939e`）、`resources/tray-error.png`（暖红 `#b8524a`）。
- 造型与主图标同源（一帧胶片 + 曝光缝），保证三态并排时一眼看出是同一件东西。
- 生成脚本并入 `scripts/pack/make-icon.cjs`，同一命令产出全部。

### 3. 验收

```powershell
npx electron scripts/pack/make-icon.cjs
node scripts/pack/verify.cjs dist/win-unpacked   # 若产物存在，确认图标仍进包
```

报告：六个托盘/图标文件的实际尺寸字节、16px 可辨性判断、脚本幂等性（连续跑两次结果一致）。

## 交付

`docs/delegate/status-brand.md` 写清造型决策、脚本用法、自检输出。完成后结束本轮。
