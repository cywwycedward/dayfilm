# 任务说明书：v1.3 视觉重做（df-ui）

## 目标

用户反馈"品味太差，镜头就是随机图片，播放看不出效果"。这次不是加功能，是**重做视觉语言**：剧照变成有信息的场记板，播放变成放映。权威文档是 `docs/product/visual-language.md`，这一版所有视觉决策都在里面，照它执行；文档没写到的细节按文档的原则自行判断。

## 可写范围

- `src/renderer/**`、`tests/renderer/**`
- `docs/delegate/status-ui5.md`

不要改 `src/main/**`、`src/shared/**`、`package.json`、`src/renderer/src/assets/fonts/**`（字体文件已就位，直接用）、打包配置。

## 已就位的资产

`src/renderer/src/assets/fonts/` 下有四套 woff2（OFL，随包）：`inter-400.woff2`、`inter-700.woff2`、`plex-mono-400.woff2`、`plex-mono-500.woff2`、`bebas-400.woff2` 与 `OFL.txt`。用 CSS `@font-face` + 相对路径引入，让 Vite 打包；CSP 是 `default-src 'self'`，本地字体可用。

## 必须实现

### 1. 设计令牌与字体（visual-language §2 §3 §6）

- `style.css` 顶部换成令牌：颜色变量、字号阶梯 10/11/12/14/18/24/32/56、间距阶梯 4/8/12/16/24/32/48、字体族三套。
- 移除所有卡片阴影/彩色渐变；分区改用发丝线 `rgba(236,231,220,.07)`。
- 中文回落到 `"Microsoft YaHei UI"`；不要用 Inter 500/600。

### 2. 剧照重写（visual-language §4）

- 新增 `lib/still-frame.ts`：给定 `{ scene, date, index, width, height }` 返回一次绘制所需的**纯参数**（形态档位、字号、边距、齿孔位置、元素可见性），可测试。
- 新增 `paint-still.ts`（或改造现有 `paint.ts`）：按参数绘制 canvas，三档形态（完整帧 / 紧凑帧 / 细缝），规则见文档。
- 缓存：同一 `exe|title|kind|index|形态档位` 只绘制一次，按目标尺寸缩绘；`document.fonts.ready` 之后再绘制，未就绪时先画无字版本并在 ready 后重绘。
- 颗粒噪声用确定性种子（日期 + 镜次），只画一次到离屏 canvas 复用。
- 中场休息按文档的斜纹处理，不画族色条与齿孔。
- 海报、列表缩略图、胶片条、放映大画面**必须共用同一份绘制结果**（缩绘），不能各自排版。

### 3. 放映模式（visual-language §5）

- `#play` 进入放映：出现全屏遮罩 `#projection`，内含大画面 canvas `#projectionFrame`、`#shotCounter`（SHOT 07 / 33）、`#projectionClock`、`#projectionTitle`、滚动齿孔带、底部细带 `#projectionStrip`。
- 场景切换 120ms 交叉淡入 + 4px 走片位移；倍速沿用现有 60x/600x/3600x。
- 600x/3600x 时显示"每秒 N 次剪辑"，每次剪辑左缘闪 2px 暖色 80ms。
- `Esc` 退出；退出后回到日视图原状态。
- 声音开关 `#soundToggle`：默认关；开启后用 WebAudio 生成放映机底噪 + 剪辑咔哒，不用任何音频文件；关闭时立即静音并释放 AudioContext。

### 4. 版式重排（visual-language §6）

- 顶栏、实时条、胶片区、汇总区、镜头列表按文档重排：大标题用系统粗体 44px，数据用"小标签 + Plex Mono 数字"上下结构，去掉现在的卡片框。
- 周视图、设置抽屉、海报同步换字体与颜色（不改信息结构）。
- 焦点环、hover、`prefers-reduced-motion` 全部保留。

### 5. 测试

新增 `tests/renderer/still-frame.test.ts`（形态档位边界、字号选择、元素可见性、确定性种子）与 `tests/renderer/projection.test.ts`（放映状态机：进入/推进/切速/退出、剪辑计数、声音开关不崩）。保持既有 100+ 例不回归。

### 6. 验收（必须自己做过）

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

用 mock 起静态服务自查，并**在 1280×820 下逐字检查**：标题不溢出、不换行错位、字号不糊。不要跑 `npm run dev`（主 Agent 要用构建产物截图）。

## 交付

`docs/delegate/status-ui5.md`：改动的文件、视觉决策、与文档不一致处的理由、验证输出。完成后结束本轮。
