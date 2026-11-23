# 任务说明书：v2.1 无边框头部与控件细节（df-ui2）

## 目标

按概念图 `docs/product/ui-concept-v3-chrome.png` 落地两件事：自绘窗体头部（含窗口按钮）与控件细节（自绘下拉框、输入框三态、字体规范）。

## 可写范围

- `src/renderer/**`、`tests/renderer/**`
- `docs/delegate/status-ui10.md`

不要改 `src/main/**`、`src/shared/**`、`package.json`、构建配置。主进程正在并行改无边框窗口，桥接是 `window.dayfilmWindow = { minimize, toggleMaximize, close, onMaximizeChange }`；还没就绪时用可选调用（`window.dayfilmWindow?.minimize()`），不要报错。

## A. 头部（56px，自绘）

- 布局：左 `DAYFILM` 字标（Bebas 20）+ 日期触发器；中间拖动区；右侧依次 记录状态点 + 搜索 + 导出 + 设置 + `···` + 三个窗口按钮。
- 整条 `-webkit-app-region: drag`；所有可交互元素与按钮 `-webkit-app-region: no-drag`。
- 窗口按钮：命中区 32×32、图标 10px、1.5px 描边（内联 SVG：min = 一条横线，max = 方框，restore = 双框，close = 叉）；默认图标 `--paper-dim`；悬停背景 `rgba(236,231,220,.06)`、图标 `--paper`；**关闭按钮悬停时背景 `--red`、图标近黑**。
- 双击拖动区 → `window.dayfilmWindow?.toggleMaximize()`；最大化状态变化时把 max 图标换成 restore。
- 高度严格 56px，底部 1px 发丝线；不要给原生标题栏留空隙。

## B. 自绘下拉框（替换全部原生 select）

现在 `#date`、保留期、对比与日历里的日期都是原生 select，弹层是系统白底，必须换掉。

- 新建 `lib/select.ts`（纯逻辑）+ DOM 结构：触发器（高 32、仅底部 1px 线、右侧 8px 细箭头）+ 面板（宽 240、`#14161c`、1px 发丝线、2px 圆角、8px 内边距、最大高 260 可滚动）。
- 行高 32；选中行左侧 2px 琥珀竖条 + 4% 亮底；键盘高亮行 4% 亮底；悬停 4% 亮底。
- 键盘：Enter/Space 打开，↑↓ 移动，Home/End，Enter 选中，Esc 关闭。
- 无障碍：触发器 `role="combobox" aria-expanded`，面板 `role="listbox"`，行 `role="option" aria-selected`；关闭后焦点回到触发器。
- 点击面板外关闭；面板靠近窗口底部时向上翻。
- 纯逻辑（选中索引移动、打开态、面板朝向）写测试。

## C. 输入框三态

- 统一高度 32、左内边距 12、只有底部 1px 线：默认 `rgba(255,255,255,.16)`；聚焦 `--amber` + 下方 1px 20% 琥珀微光；错误 `#e06c6c`（文字同步变红）。
- placeholder 颜色 `#8e8a80`（56%）；插入符 1px 琥珀。
- 搜索框、手记、脱敏关键词、设置里的输入全部套用；手记是多行，保留底线与聚焦微光。

## D. 字体规范

- 中文只用 400/700（避免伪粗体）；中文大标题字距 0.02em，拉丁展示字 0.08em。
- 字号阶梯按概念图：10 / 11 / 13 / 16 / 28 / 128；时间码与数字 `font-variant-numeric: tabular-nums`。
- 全局 `-webkit-font-smoothing: antialiased`；正文行高 1.5。

## 自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

不要跑 `npm run dev`。用 `npx vite src/renderer --port 5182` 配 mock 自查：头部两种状态（默认/悬停关闭）、下拉展开与键盘、输入三态、1280×820 截图对照概念图 A–D 四块。

## 交付

`docs/delegate/status-ui10.md`：完成项、与概念图 A–D 的对应、刻意偏离及理由、验证输出、未完成项。完成后结束本轮。
