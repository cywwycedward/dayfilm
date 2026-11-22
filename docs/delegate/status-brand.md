# df-brand 状态记录（应用图标 + 托盘三态）

- **当前结论** 图标与托盘按 `docs/product/visual-language.md` §7 重做完毕：一条命令产出六个文件，12 条自检断言全过，连续两次运行产出字节完全一致。打包链路（`electron-builder.yml`）与 `src/**` 未动，因此**三态托盘的入包与切换仍待接线**（见文末接续事项）。
- **交接对象** 主 Agent（打包与托盘接线）。
- **工作区与版本** `D:\core\workspace\mine\github_mine\not-my-app`，当前工作区未提交改动；本轮只碰 `build/**`、`resources/tray*.png`、`scripts/pack/make-icon.cjs`、本文件。

## 文件清单

修改：

| 文件 | 改动 |
| --- | --- |
| `scripts/pack/make-icon.cjs` | 重写绘制部分：造型改成"细边框 + 上下齿孔 + 中央亮缝"；一次页面加载内原生绘制全部尺寸，用 `canvas.toDataURL` 取 PNG（取代 `capturePage`，顺带删掉高 DPI 下的 `resize` 兜底分支）；新增托盘三态产出与逐尺寸自检；ICO 封装（头部 + 目录 + PNG 条目）沿用原实现 |

新增：

| 文件 | 内容 |
| --- | --- |
| `build/icon.png` | 512×512，透明圆角深底 + 胶片框 + 曝光缝 |
| `build/icon.ico` | 六条目（256/128/64/48/32/16），每条目 PNG 压缩 |
| `build/icon-16-preview.png` | 16px 渲染按 8 倍最近邻放大到 128×128，供人眼判断 |
| `resources/tray-paused.png` | 32×32，`#8d939e` |
| `resources/tray-error.png` | 32×32，`#b8524a` |

覆写：`resources/tray.png`（32×32 暖白 `#ece7dc`，原文件是 180 B 的旧图形）。

未改：`src/**`、`package.json`、`electron-builder.yml`、`docs/product/visual-language.md` 及其他文档。

## 造型决策

### 1) 为什么是"细边框 + 齿孔 + 中央亮缝"

先试了四种母题，各自渲染 512/128/64/32/16 与托盘 32 对比（临时对比脚本已删除）：

| 方向 | 结果 |
| --- | --- |
| 粗边框 + 贯穿内窗的胶囊亮条 | 512 下像"电池/进度条"，32 下像被分成两行的表格 |
| 细边框 + 贯穿线 | 32 下明确是"两行表格/窗口图标"，没有胶片信息 |
| 细边框 + 上下各三个齿孔 + 贯穿线 | 512/128/64 有胶片感，32 下齿孔消失后又退回"表格" |
| 暖白整条胶片带（暗齿孔 + 暗窗） | 512 下最像胶片，但违反 §3 "颜色是索引，不是装饰"（大面积暖白填充），32 下糊成一块 |

最终取第三种，并把亮缝从"贯穿内窗"改成"内窗居中、两侧留白"——贯穿线正是"表格感"的来源。齿孔是唯一能把"一帧胶片"和"一个方框"区分开的信号，所以它在能画出来的尺寸上必须存在；16px 下它和边框一起消失，正好落到 §7 允许的"深底 + 一条亮缝"。

### 2) 精确几何（512×512 设计稿单位，按目标尺寸整体缩放）

| 元素 | 数值 |
| --- | --- |
| 底色圆角块 | 满画布，圆角 112，`#0a0b0d` → `#12141a` 纵向微渐变 |
| 胶片框 | `x=64 y=124 w=384 h=264`，外圆角 22，边框厚 16（≈3.1% 画布） |
| 齿孔 | 上下各 4 个，44×22，圆角 5，距边框内侧 12，居中均分内窗宽度 |
| 曝光缝 | 268×28，垂直居中（`cy=256`），两端半圆，`#ece7dc` |

### 3) 尺寸分层（每个尺寸都原生绘制，不缩放大图）

| 目标尺寸 | 保留元素 |
| --- | --- |
| ≥ 48 | 边框 + 齿孔 + 亮缝（齿孔 48px 下约 4.1×2.1px，仍可辨） |
| 24 – 47 | 边框 + 亮缝（齿孔贴成一排噪点，去掉） |
| < 24（只出现在 16） | 只剩亮缝：去掉边框 |

厚度用"目标像素最小厚度"钳制，而不是写死单位值：边框 ≥1.6px、亮缝 ≥2.2px。因此 32px 的边框按 25.6 单位（1.6px）画，512px 按 16 单位（16px）画——小图标略粗，避免细线被反锯齿吃掉。

### 4) 托盘为什么没有深底

托盘要跟任务栏共存：深底方块在浅色任务栏上是一块脏色，而托盘图标按平台惯例是单色透明底图形。所以托盘共用同一套几何（边框 + 亮缝，32px 下不画齿孔），只是去掉底色、换单色：`#ece7dc` / `#8d939e` / `#b8524a`（取 §3 的 `--paper` / `--silver` / `--red`）。三态同形同位置，只有色相不同。

托盘的厚度钳制比应用图标大一档（边框 ≥2.4px、亮缝 ≥2.8px）：32px 的托盘图标会被 Windows 缩到 16–20px 显示，按 1.6px 画缩下去只剩一条虚影。实测 2.4/2.8 在 32/20/16px 都还能看出"框 + 缝"。

没有文字、阴影、发光描边；线宽与留白是唯一的层次手段（§1）。

## 脚本用法

```powershell
npx electron scripts/pack/make-icon.cjs
```

- 一次页面加载内画完全部资产：`window.__draw(jobs)` 返回 dataURL 数组，主进程写盘。相比原来的 `capturePage`，不再依赖窗口尺寸与设备缩放因子。
- 产出：`build/icon.png`、`build/icon.ico`、`build/icon-16-preview.png`、`resources/tray.png`、`resources/tray-paused.png`、`resources/tray-error.png`。
- 自检失败 `exit=2`（尺寸、四角 alpha、中心像素颜色任一不符），绘制异常 `exit=1`；成功时 stdout 是一份可直接引用的 JSON 报告。
- 幂等：无字体、无随机数、无时间戳，两次运行产出字节一致（见下）。

## 自检输出

`npx electron scripts/pack/make-icon.cjs`（本次实跑，`ok: true`）：

| 检查 | 尺寸 | 字节 | 四角 alpha | 中心像素 |
| --- | --- | --- | --- | --- |
| `icon.png` | 512×512 | 24335 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@256` | 256×256 | 10513 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@128` | 128×128 | 4936 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@64` | 64×64 | 2256 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@48` | 48×48 | 2129 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@32` | 32×32 | 1123 | 0,0,0,0 | rgb(236,231,220) |
| `icon.ico@16` | 16×16 | 398 | 1,1,12,12 | rgb(236,231,220) |
| `icon-16-preview.png` | 128×128 | 1404 | 1,1,12,12 | rgb(236,231,220) |
| `tray.png` | 32×32 | 375 | 0,0,0,0 | rgb(236,231,220) |
| `tray-paused.png` | 32×32 | 384 | 0,0,0,0 | rgb(141,147,158) |
| `tray-error.png` | 32×32 | 380 | 0,0,0,0 | rgb(184,82,74) |

`build/icon.ico` 合计 21457 B，条目顺序 256/128/64/48/32/16。

- **角 alpha**：512–32 的四角严格为 0；16px 的圆角半径只有 3.5px，角像素带 1–12/255 的反锯齿灰，按 `≤16` 判过（阈值写在 `inspect()` 注释里）。
- **中心像素**：等于亮缝颜色即为"图形真的画出来了"的代理断言——亮缝正好覆盖画布中心，颜色或 alpha 不对就说明这一层没画上。

**16px 可辨性**：`build/icon-16-preview.png`（8 倍最近邻放大）里是"深色圆角块 + 一条居中暖白横条"，条长 8.4px、条高 2.2px，占画布宽 52%。在 16px 工具栏里能认出"暗底上的一道亮缝"，但读不出胶片信息——这是 §7 明确允许的退化。同时它是三态托盘、32px 应用图标、512px 应用图标的同一母题，横向并排能看出是同一件东西。

**第三方解码验证**（不复用脚本自己的解析器）：

```text
System.Drawing.Icon(build/icon.ico)   -> 32x32，解码成功（Windows 的 ICO 解码器接受这个容器）
icon.png 512x512 / icon-16-preview.png 128x128 / tray*.png 32x32，PNG 格式校验全部通过
```

**幂等性**：连续跑两次后 `Get-FileHash` 六个文件全部一致（`icon.png B3EE9520…`、`icon.ico CE195487…`、`icon-16-preview.png 66E3CD67…`、`tray.png B2BDE0A7…`、`tray-paused.png ABCDE7BD…`、`tray-error.png CF0BF59B…`）。

## 验证

| 命令或检查 | 状态 | 覆盖范围 | 证据或限制 |
| --- | --- | --- | --- |
| `npx electron scripts/pack/make-icon.cjs` | 通过（exit 0） | 六个产物的尺寸、四角透明、中心像素；ICO 六条目逐个解回 `nativeImage` | 上文表格 |
| 连跑两次 + `Get-FileHash` | 通过 | 幂等性 | 六个哈希逐一相同 |
| `System.Drawing` 解码 `build/icon.ico` 与五个 PNG | 通过 | 容器/编码被 Windows 侧解码器接受 | `ico: 32x32` |
| `node scripts/pack/verify.cjs dist/win-unpacked` | 通过（`ok: true`） | exe / asar / capture.ps1 / tray.png 仍在包内 | **产物是改动前打的**：`trayIcon` 仍是 180 B 的旧文件，exe 里嵌的也是旧 ICO |
| `npm run pack` 重新打包 | 未执行 | 新 ICO 进 exe、新 tray.png 进 `resources/` | 本轮 `src/**` 正被其他 Agent 改动，重打包会产出混合状态的包；由主 Agent 决定何时打 |

## 接续事项

1. **`electron-builder.yml` 只打了 `resources/tray.png`**（`extraResources` 两条：`capture.ps1`、`tray.png`）。`tray-paused.png` 与 `tray-error.png` 现在**不会进包**。需要补两条 `from/to`——该文件不在本轮授权范围内。
2. **三态切换要 `src/main/tray` 配合**：`createTray` 只接收一个 `iconPath`（`src/main/tray/index.ts:25-28`），暂停/出错要 `tray.setImage(nativeImage.createFromPath(...))`。本轮只交付资产，切换逻辑属 `src/**`。
3. **重新打包后需复验**：exe 里的图标是打包时嵌的，`dist/win-unpacked` 目前是旧图标 + 旧托盘。打一次 `npm run pack` 后重跑 `verify.cjs`，`trayIcon` 的 `bytes` 应从 180 变成 375。
4. **本轮未用 `ask-gpt` 求外部裁决**。理由：§7 与 brief 已把造型、配色、尺寸和 16px 退化规则定死，剩下的是比例微调，属于实现细节而非方案取舍；实际做法是渲染 5 轮对比稿自证（临时脚本与对比图已删除，结论留在上面"造型决策"表）。若主 Agent 认为比例取舍仍需外部裁决，把该节表格发过去即可，不必再复述约束。
