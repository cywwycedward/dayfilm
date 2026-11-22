# v1.3 视觉重做状态（df-ui5）

任务来源：[brief-ui5.md](brief-ui5.md)，视觉权威：[visual-language.md](../product/visual-language.md)。
四步按顺序落地：令牌与字体 → 剧照重写 → 放映模式 → 版式重排，每步都跑过一次 build。

## 1. 改动的文件

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/style.css` | 整份重写：`@font-face`（5 个 woff2）、颜色/字号/间距令牌、三套字体、发丝线分区、无卡片无阴影、放映样式、周视图与抽屉同步换装 |
| `src/renderer/src/lib/still-frame.ts` | 新增：场记板剧照的纯参数（三档形态、字号、边距、齿孔、元素可见性、颗粒种子、镜次表） |
| `src/renderer/src/paint-still.ts` | 新增：按参数绘制剧照（完整帧 / 紧凑帧 / 细缝）、字体就绪门控、空档卡、data URL 缓存 |
| `src/renderer/src/paint.ts` | 去掉旧的程序化图案绘制；胶片、周条、海报改用同一套剧照绘制 |
| `src/renderer/src/lib/still.ts` | 只保留进程族色带（`exeBand`/`exeHue`）；删除"随机图案"时代的 `stillSpec` 与形状类型 |
| `src/renderer/src/lib/projection.ts` | 新增：放映状态机（进入/推进/切速/退出、剪辑计数、每秒剪辑数） |
| `src/renderer/src/projection-audio.ts` | 新增：WebAudio 放映机底噪 + 剪辑咔哒，不依赖音频文件 |
| `src/renderer/src/lib/poster.ts` | 海报排版换字体与色令牌；缩略帧带镜次 |
| `src/renderer/src/app.ts` | 剧照接入（胶片/缩略图/放大帧/海报共用）、放映模式、字体就绪后重绘 |
| `src/renderer/index.html` | 放映遮罩 `#projection`（大画面 `#projectionFrame`、`#shotCounter`、`#projectionClock`、`#projectionCuts`、`#projectionStrip`、`#soundToggle`） |
| `tests/renderer/still-frame.test.ts` | 新增，17 例（档位边界、字号、元素可见性、确定性种子、镜次） |
| `tests/renderer/projection.test.ts` | 新增，16 例（进入/推进/切速/退出、剪辑计数、读数、声音开关） |
| `tests/renderer/still.test.ts` | 随 `stillSpec` 删除改写为 3 例（只测族色带） |

未改动 `src/main/**`、`src/shared/**`、`package.json`、`src/renderer/src/assets/fonts/**`、打包配置。

## 2. 设计令牌与字体

- 颜色：`--ink / --charcoal / --graphite / --paper / --paper-dim / --silver / --amber / --red`，另有
  `--hairline`（.07）与 `--hairline-strong`（.14）。暖色只用在"正在拍摄 / 焦点 / 播放 / 选中 / 换戏"。
- 字号阶梯只用 10/11/12/14/18/24/32/56：小标签 10px Plex Mono 大写 `.18em` 半透明，数字 24px Plex Mono。
- 间距阶梯 4/8/12/16/24/32/48，分区之间一律 `1px rgba(236,231,220,.07)` 发丝线，没有卡片边框、圆角面板和阴影
  （设置抽屉是唯一保留侧栏形态的地方）。
- 字体：`@font-face` 引入 Bebas / Inter 400·700 / Plex Mono 400·500，`font-display: swap`，
  中文回落 `"Microsoft YaHei UI"`。全站只出现 400 与 700 两个字重（实测 `fontWeight` 集合 = `["400","700"]`），
  不会触发伪加粗。
- 载体色（进程族）：`exeBand`/`exeHue` 保留，`hsl(h 24% 38%)` 只出现在剧照边条、顶部细条与放映细带。

## 3. 剧照（visual-language §4）

- `stillParams({ exe, title, kind, index, date, width, height })` 返回一次绘制所需的全部参数：
  档位、字号、边距、齿孔位置、边条、颗粒种子、文字行（含 maxWidth 与可见性）。
- 三档：完整帧（≥120×64）、紧凑帧（≥56 宽）、细缝（<56 宽）。
  - 完整帧：`--charcoal` 底 + 6% 暗渐变 + 1px 内描边；左缘族色竖条；上下齿孔带（5px 带、6×3 圆孔、14px 间距）；
    应用名 Bebas、标题 Inter 10px、左下时间码与镜次、右上镜次号；确定性颗粒（种子 = 日期+镜次+进程+标题）。
  - 紧凑帧：底 + 顶部 2px 族色条 + 应用名（Bebas 12–16px 按宽度）+ 右下镜次。
  - 细缝：族色 35% 填充 + 顶部 2px 暖白条，无文字。
  - 中场休息：不画族色条与齿孔，45° 细斜纹，应用名位置写"中场休息"。
- **尺寸规则**：完整帧以 288px 高为基准等比缩放（名字 24px × h/288，下限 18px；标题 10px、时间码 9px 同样有下限，
  齿孔随帧高放大），所以同一帧在 128×72 的放大帧里是紧凑版式、在 998×562 的放映画面里是"放大的一帧"（名字约 47px）。
- 字体就绪：`document.fonts.ready` 之前画无字版本，就绪后清缓存并重绘胶片与列表一次。
- 胶片、列表缩略图、放大帧、放映、海报全部走同一个 `drawStill` / `stillDataUrl`，没有第二套排版。

## 4. 放映（visual-language §5）

- 按 `播放` 进入放映：全屏 `#projection`，中间 16:9 大画面（`#projectionFrame`），上下滚动的齿孔带，
  右上 `SHOT 07 / 36` 与"每秒 N 次剪辑"（仅 600x/3600x），右下的时钟，画面下方一行镜次 / 标题 / 时长，
  底部族色细带 + 1px 暖白播放头 + 声音开关与退出按钮。
- 场景切换：120ms 交叉淡入 + 4px 走片位移（`is-cutting` 动画）；每次剪辑左缘闪 2px 暖色 80ms（`is-cut`）。
- 空隙（没有镜头、也没有中场休息）：不交黑屏，画"空档 · 下一镜 HH:MM"。
- `Esc` 或"退出放映"回到日视图，指针停在放映结束的位置；切日会先退出放映。
- 声音：`#soundToggle` 默认关；开启后用 WebAudio 生成带通噪声（320Hz）+ 每次剪辑一声短促咔哒（2.4kHz），
  关闭或退出时停止并 `close()` AudioContext，不读任何音频文件。
- 放映状态机是纯函数：`enterProjection / advanceProjection / setProjectionSpeed / setProjectionSound /
  exitProjection / cutsPerSecond / projectionFinished`，时间由 rAF 帧喂进来。

## 5. 版式重排（visual-language §6）

- 顶栏：`DAYFILM`（Bebas 18px，`.16em`）+ 副标题（Inter 10px，`--paper-dim`）；日期、检索、导出、设置、采集状态靠右。
- 实时条：族点 + "正在拍摄：进程 · 标题"（进程用 700 字重暖色）+ 右侧 Plex Mono 计时。
- 胶片区：标题行（小标签 + 日/周切换 + 缩放工具）、周视图迷你条（今天/选中用琥珀下划线）、刻度、胶片、回放条。
  胶片段用同一份剧照，1x 下多数段窄于 56px，按文档落成细缝（族色 + 顶条），所以整条读起来是"按应用分色的胶片"。
- 汇总：题材 44px 系统粗体 + 12px 点评；五项指标是"10px 标签 + 24px Plex Mono 数字"；进程/项目排行是 104px 名称 + 1px 横条 + 右对齐数值；
  手记是下划线输入；高光是三个"小标签 + 24px 数字"。
- 列表：43px 行高、发丝线下边、左侧 64×36 剧照缩略（真·场记板）、等宽时间码与时长。
- 周视图与设置抽屉只换字体、颜色与分隔方式（信息结构不变）：七幕变成发丝线分栏、故事线矩阵保留主角描边与切/回标记、
  精选卡片改成左发丝线 + 琥珀色入选理由。
- 焦点环 2px `--amber`、hover 只改透明度/边框色、`prefers-reduced-motion` 下所有动画与过渡降到 1ms。

## 6. 与文档不一致的地方（附理由）

1. **剧照按目标尺寸计算，而不是"一份位图到处缩绘"。** 文档的硬要求是"同一次绘制结果缓存位图、按目标尺寸缩绘"，
   但同文又规定"帧高 < 90px 时应用名 18px""紧凑帧按宽度 12–16px 自动缩放"——这两条只有在按目标尺寸排版时才成立。
   实测按 512×288 画一张再缩到 128×72，文字只有 4.5px，完全读不出（v1.2 的"随机图"问题会变成"糊字"问题）。
   现在的做法：**同一套 `stillParams` 规则**在每个尺寸上计算，完整帧以 288px 高为基准等比缩放并设下限，
   于是"小图清楚、大图是一帧放大"，视觉上仍是同一张场记板。
2. **放映是整屏遮罩，而不是"把胶片压成底部 64px 细带"。** 应用是固定一屏的 flex 布局，放映时要的是
   "只有一帧"的沉浸感；遮罩里自带 26px 的族色细带与播放头，退出后回到原来的日视图（指针位置保留）。
3. **齿孔滚动速度做了上限。** 文档写"每秒 14px × 倍速系数"，3600x 下会变成频闪；实现取
   `14px/s × clamp(倍速/60, 1, 20)`，`prefers-reduced-motion` 直接停。
4. **海报的标题区用系统粗体中文（56px），Bebas 只用于 DAYFILM 字标。** 题材是中文，Bebas 没有中文字形；
   日期/标签/数字分别用 Plex Mono 与 Inter。
5. **细缝顶部的暖白高亮用 55% 不透明度**（文档只说"暖白"），因为 1x 下几十条细缝的纯白顶条会变成全屏最亮的一条虚线，
   与"一屏最多一个视觉重点"冲突。

## 7. 验证

### 7.1 自检命令（全部通过）

```powershell
PS> npx tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

PS> npx vitest run tests/renderer
 Test Files  15 passed (15)
      Tests  202 passed (202)
   Duration  2.51s

PS> npm run build
out/renderer/index.html                      11.59 kB
out/renderer/assets/plex-mono-400-*.woff2    13.36 kB
out/renderer/assets/bebas-400-*.woff2        13.77 kB
out/renderer/assets/plex-mono-500-*.woff2    14.90 kB
out/renderer/assets/inter-700-*.woff2        48.26 kB
out/renderer/assets/inter-400-*.woff2        85.07 kB
out/renderer/assets/index-*.css              37.45 kB
out/renderer/assets/index-*.js              128.39 kB
```

v1.2 的 185 例里删掉了 `stillSpec` 的 4 例（随机图案已退役），新增 still-frame 17 例与 projection 16 例，合计 202 例。

### 7.2 浏览器核对（headless Edge + CDP，1280×820）

```text
=== 字体与字重
{"families":["Bebas","Inter","Plex Mono"],"status":"loaded",
 "title":"Inter, \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif",
 "number":"\"Plex Mono\", \"Cascadia Mono\", Consolas, monospace",
 "brand":"Bebas, Inter, \"Microsoft YaHei UI\", sans-serif","weights":["400","700"]}

=== 1280×820 无横向溢出
{"docSW":1280,"docCW":1280,"appSW":1280,"appCW":1280}

=== 进入放映（60x，停在一个镜头上）
{"shot":"SHOT 01 / 36","clock":"09:14","title":"Dayfilm 设计笔记",
 "brightSamples":5556,"canvas":[998,562]}

=== 3600x：读数与剪辑
{"clock":"10:09","title":"中场休息","rate":"每秒 1.1 次剪辑"}

=== 声音开关 / Esc / 周视图
{"first":"true","second":"false","label":"声音：关"}
{"hidden":true,"playState":"paused","time":"10:59 / 24:00"}
{"arcs":7,"lines":3,"cells":21}

=== 海报导出
poster: %TEMP%\dayfilm9-poster.png (80968 bytes, image/png)
```

四张验收截图（临时目录）：
`%TEMP%\dayfilm9-day.png`（日视图）、`%TEMP%\dayfilm9-projection.png`（放映中）、
`%TEMP%\dayfilm9-week.png`（周视图）、`%TEMP%\dayfilm9-poster.png`（海报导出结果）。

### 7.3 一次事故与善后（需要知情）

在给 `stillDataUrl` 改签名时，我用 PowerShell `Get-Content -Raw | Set-Content -Encoding UTF8` 改 `app.ts`，
默认按 ANSI 读 UTF-8 把整份文件的中文注释与字符串打碎（约 300 处），并吞掉了 21 个换行。
善后：先用 cp936→UTF-8 反向还原，再用脚本把被吞的换行拆开，然后按行号逐条恢复了 60 处被截断的中文文案与 8 处注释，
删除全部 U+FFFD。现在 `tsc`、`vitest`、`build` 全绿，且扫描确认没有残留的"中文旁边带问号"或 U+FFFD。
影响评估：代码逻辑没有任何改动，只有文案恢复；后续不再用 PowerShell 改源码文件。

## 8. 未完成项与需要主 Agent 处理的事项

1. **真实 Electron 下没跑**（按要求不启 `npm run dev`）：字体在 asar/`file:` 下能否加载、放映的 WebAudio 在真机上的
   输出音量、以及打包产物的 CSP 是否允许 `@font-face` 的本地 woff2（理论允许，`default-src 'self'`）。
   建议在构建产物上跑一次 `scripts/probe-v11.mjs` 一类脚本并截四张图对照。
2. **放映没有"把胶片压成 64px 细带"的过渡**：现在是整屏遮罩 + 自带细带；若要文档字面的"同一屏收细带"，
   需要把日视图与放映合成一个布局，改动较大。
3. **剧照的可读性下限**：完整帧低于 120px 宽会降到紧凑帧，再低就只剩细缝（1x 的胶片条基本是细缝）。
   如果希望 1x 胶片也"看得出应用"，需要放宽档位阈值或给胶片单独一档——但会偏离文档的阈值。
4. **声音没有音量控制**，底噪固定很低（0.014 增益）；若主进程要考虑"静音跟随系统"，那是新需求。
5. **海报只换了字体与色令牌**，没有按 §7 重排信息结构（DATE/Bebas 64 标题等），因为 brief 要求"不改信息结构"。
6. **注释里可能仍有零星被事故吃掉的虚词**（只影响注释可读性，不影响代码与界面文案）；如需要我可以再通读一遍注释。

## 9. v1.3 视觉评审九项修改（round 2）

四张验收图（`node scripts/probe-visual.mjs %TEMP%\dfv4`）：`1-day.png`、`2-frame.png`、`3-projection.png`、`4-week.png`。

### 9.1 逐项结果

| 项 | 做法 | 证据 |
| --- | --- | --- |
| A 素材密度 | 新增 `lib/density.ts`：整日 144 桶（10 分钟/桶），桶高 = 非空闲镜头秒数占比；`paintDensity` 画 48px 条，填充 `rgba(236,231,220,.22)`，空桶 2px 底纹；坐标与胶片共用 `state.view` | 144 桶、48px 高、缩放后重绘（1x 覆盖 4018 像素 → 11x 覆盖 20612）；11 条单测 |
| B 适配素材 | `lib/zoom.ts` 新增 `fitView`（首镜开始 −10 分钟 到 末镜结束 +10 分钟，无镜头回全天），按钮在“回到全天”左边 | 点击后视窗 11x，直方图随视窗展开；5 条单测 |
| C 列表第一行 | 根因不是滚动容器：`#app` 内容比视口高 48px 且 `overflow: hidden`，第一行被窗口裁掉。改为低窗口媒体查询收紧纵向节奏（gap 12→8、底部内边距 16→8、轨道 96→78、列表最小高 88px），并在重绘后钳住越界的 `scrollTop` | 实测列表底 779 ≤ 视口 781，第一行 727–771 完整可见，`scrollTop = 0`；换日期、换检索仍走 `resetListScroll()` |
| D 进程排行 | 横条从 1px 改成 4px 实心、族色 60% 不透明度，五行等距（gap 5px） | `1-day.png` 排行区 |
| E 高光三列 | 三等分列 + 列间发丝线；行网格固定 12/28/12，标签在上、Plex Mono 24px 数字在中、时间在下，数字基线对齐 | 原先数字与时间重叠已消失（`hlValue` 456–484，`hlSub` 484–496 不重叠） |
| F 手记计数 | 计数移到输入下划线的同一行右端（绝对定位在 `0/200` 位置），输入框右侧留 72px | `noteCount` 479–508，落在 484px 宽的输入框内、下划线上方 |
| G “现在”标签 | 量一次标签宽度，新增纯函数 `nowLabelSide`：`nowX + 宽 > 轨道宽 − 2` 时翻到左侧 | 白天位置标签 1136–1165 在轨道（右 1223）内；4 条单测覆盖边界与非法输入 |
| H 放映版式 | 新增 `lib/projection-frame.ts` + `paintProjectionBoard`：顶部发丝线 + `日期 · SHOT 26 / 61`，中部 Bebas 28–40 应用名 + Inter 11 标题，底部左时间码区间、右时长；左侧族色条（中场休息不画）、整块 6% 暗角 | `3-projection.png`：`2026-11-22 · SHOT 26 / 61`、`WINDOWSTERMINAL`、`20:45–20:48`、`2 分 42 秒`；8 条单测 |
| I 周视图卡片 | 三列等宽等高（`repeat(3, minmax(0,1fr))` + `grid-auto-rows: 1fr`），标题单行省略，卡片 `min-width: 0; overflow: hidden` | `4-week.png` 长标题不再压到相邻卡片 |

### 9.2 放映信息去处（H 的副作用）

- `#shotCounter` 不再浮在画面右上角（信息移进画面顶部发丝线），元素保留但 `display: none`，不影响探针读取文本。
- `#projectionClock` 从画面右下角移到下方说明行右端；`#projectionDuration` 删除，因为时长已在画面底部右端。

### 9.3 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 230 tests passed
npm run build                            css 38.13 kB, js 136.98 kB, 5 woff2
```

### 9.4 偏离与未做

1. **轨道高度在低窗口从 96px 收到 78px**：48px 密度条必须有地方放；不压缩轨道，781px 高的窗口里列表第一行必然被裁。
   高度 ≥ 841px 的窗口仍是 `clamp(78px, 10vh, 128px)`。
2. **更矮的窗口（< 700px）会整页滚动**：`#app` 从 `overflow: hidden` 改为 `overflow-y: auto`，宁可滚动也不硬裁内容。
3. **周视图顶部七日弧与故事线矩阵的表头列宽仍不一致**（弧是满宽七列，矩阵是 168px 标签列 + 七列），这是 v1.2 的结构，不在本次九项里；要合并需重排周视图。
4. **密度按镜头秒数统计**（中场休息不算），与“非空闲镜头秒数”一致；若要把中场休息也算成“有素材”，改 `dayDensity` 的 `kind` 过滤即可。

## 10. 第二轮验收三项 + 播放起点（round 3）

四张图：`node scripts/probe-visual.mjs %TEMP%\dfv6`。

### 10.1 周视图漏出的密度条

`#app[data-mode='week'] #densityWrap { display: none }` 加进周模式隐藏列表（与 `#ruler`、`#track` 同一组），不再靠视觉移出屏幕。
实测：周模式下 `#densityWrap` 与 `#track` 的 `display` 都是 `none`，占位 `0×0`；`4-week.png` 右下角灰柱消失。

### 10.2 放映画面改成场记板构图

`lib/projection-frame.ts` 新增四块纯参数：

- `bigNumber`：镜次大数字，Bebas，`size = round(height × 0.55)`，paper 4% 不透明度，右对齐在 92% 宽处、垂直居中；绘制时 `clip` 到帧内，超出部分裁掉。
- 文本块：`x = round(width × 0.08)`，应用名基线在 `height × 0.52`；顶部镜次行与底部时间码同步到这条基线。
- `ruler`：整幅宽 `1px` 基线（paper 8%）+ 族色填充，填充宽 = `本镜秒数 / 当天最长镜头秒数 × 帧宽`；右端标签 `2 分 42 秒 / 4 分 14 秒`，Plex Mono 9px 右对齐（取代原来的右下角时长）。
- `grain`：`count = round(width × height × 0.03)`，点表复用剧照的 `grainPoints`，种子 = `hashString(scene.id)`，同一天同一镜颗粒固定。

同时统一镜次：帧内大数字、顶部 `SHOT n / total`、说明行 `#n` 与隐藏的 `#shotCounter` 现在都用 `shotOrdinalFor(filmMs)`，空隙/中场休息时指向刚结束的那一镜，不再出现“画面写 26、计数器写 01”。
`projection-frame.test.ts` 从 8 条扩到 12 条：大数字尺寸/位置/不透明度、文本 8%/52%、时长尺比例与封顶、标签文案、颗粒 3% 与种子、小画面下限。

### 10.3 设置抽屉与海报的字体/分隔线核查

- 字体：运行中 `document.fonts` 只加载 Bebas 400、Inter 400/700、Plex Mono 400；抽屉内无任何元素计算出的 `font-weight` 是 500/600（除 Plex 外），即没有伪粗体。Plex Mono 500 声明了但未被任何样式使用（`status: unloaded`），不存在合成加粗。
- 分隔线：`.fieldset` 只有 `border-bottom: 1px solid rgba(236,231,220,.07)`（发丝线），顶边 0；面板只有左侧 1px 边，`box-shadow: none`。按钮/输入框的 1px 边是控件本身，不是卡片。

### 10.4 播放从素材开始

- `lib/projection.ts` 新增 `playbackStart(selected, scenes)`：有选中用选中（中场休息也算），否则用当天第一个镜头，没有镜头返回 `null`；
  以及 `playbackRange(scenes)`：首镜开始到末镜结束，尾部中场休息不计。新增 9 条测试（含前置中场休息、空日、尾部长休息）。
- `startProjection` 改用 `playbackStart`；返回 `null` 时只弹 `toast('这一天没有素材，无法放映')` 并播报，不打开遮罩。
- 停片条件加上 `filmMs >= playbackRange.end`，即使当天最后一条是中场休息也在最后一镜结束时停，不循环。
- 进度条 `min/max` 改成素材区间的分钟数，值仍是“当天第几分钟”，右侧时间码仍显示真实时刻。实测 `min=1222`、`max=1325`（20:22–22:05），提示为 `22:16 / 24:00`。
- 探针：无选中直接按播放，700ms 后时钟 `20:30`、`SHOT 06 / 61`（从 20:22 的首镜起播），不是 `00:00`。

### 10.5 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 242 tests passed
npm run build                            css 38.17 kB, js 139.79 kB, 5 woff2
```

四张图自查：日视图列表首行完整、进度条落在素材区间；放大帧正常；放映为场记板构图；周视图无密度条泄漏。

### 10.6 偏离/遗留

1. 大数字用“镜次序号”而不是“当天第几个有素材的镜头”，与顶部 `SHOT 26 / 61` 保持同一套编号。
2. 时长尺标签替换了原来的右下角时长；时间码区间仍在左下。
3. 颗粒是 3% 面积的 1px 点（复用剧照噪声），不是叠加一张噪声图；若要更明显，只需改 `count` 系数。
4. §9.4 的遗留项不变（周视图弧/矩阵表头列宽不一致、<700px 高整页滚动、未在打包产物上跑）。

## 11. 海报重做（round 4）

### 11.1 版式（全在 `lib/poster.ts` 纯参数）

1600×1000，外边距 96；左栏 `{x:96,w:600}`，右栏 `{x:744,w:760}`（744+760=1504=1600−96）。

左栏自上而下：

| 块 | 参数 |
| --- | --- |
| 日期行 | Plex Mono 14，y=150 |
| 题材 | 中文系统粗体 96（`ui` 700），单行，超宽用 `truncateText` 补省略号，y=270 |
| 点评 | Inter 16，最多两行，y=312/338 |
| 三组数字 | 标签 Mono 12 /y=400，数字 Plex Mono 56 /y=456，x=96·296·496 |
| 手记 | 有才画：Inter 18、行高 28、最多三行，左侧 2px amber 竖线（x=96） |
| 字标 | DAYFILM，Bebas 18，amber，y=832 |

右栏：胶片带 `{744,140,760,150}`（按 `firstAt..lastAt` 映射，不是 00:00–24:00）+ 上下齿孔；下方刻度尺（12 格，首尾对齐不出栏，标签为真实时刻）；三张 300×169 接触印相（2×2 网格，第一行 y=356，第二行 y=593），图下 Plex Mono 11 写「HH:MM–HH:MM · 时长」。
背景：题材词 Bebas 280、paper 5%、右对齐 x=1504、裁在画内，基线 y=760，压在印相后面。
页脚：发丝线 y=868（96→1504）+ Plex Mono 10「DAYFILM · 2026-11-22 · 由 Dayfilm 生成」。

### 11.2 导出验证

真实导出按钮路径（`#exportPoster` → `computePoster` → `paintPoster` → `toDataURL` → `saveImage`）跑通，
在 `toDataURL` 处截下同一张画布的字节并写入 `%TEMP%\dayfilm-poster-r4.png`（1600×1000，132,202 字节）。
本地应用是单实例（`requestSingleInstanceLock`），且主 Agent 已开着一个实例，所以本次用 `--user-data-dir` 指向
从 `%APPDATA%\dayfilm` 复制的临时配置（含当天 2026-11-22.jsonl、settings、notes），数据与海报里的一致。
**未验证的一步是原生保存对话框本身**（headless 无法点它）；交给用户用真实对话框再导一张。

### 11.3 与需求的偏离

1. **“12 小时刻度”按 12 格刻度实现**：胶片带是 `firstAt..lastAt`（当天只有 20:22–22:24），
   若画 12 小时真刻度会与带子对不上；所以取素材区间上 12 个等距刻度，标签写真实时刻。
2. **三张印相不重复**：真实当天三处的“最长镜头”是同一条（ChatGPT 4 分 14 秒），
   三张一模一样像 bug；现在每个槽位若已被占用，就取同一候选集（最密窗口/第一进程）里次长且未用的镜头，没有就不再画。
3. 第三张的主语按需求用“进程”（`topApps[0].exe`）；只有进程数据缺失时才回退到项目规则匹配。
4. 印相用的是 v1.3 的信息型场记板帧（按 300×169 重新排版，不是位图缩小），所以看上去是深色信息卡而不是截图。

### 11.4 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 250 tests passed（poster 19 条）
npm run build                            css 38.17 kB, js 144.36 kB
```

poster.test.ts 覆盖：两栏位置与 96 外边距、日期/题材/点评/数字/字标字号、数字横排、
胶片带首尾铺满与中间映射、12 刻度首尾真实时刻、三张 300×169 与图注格式、三张选取且不重复、
背景水印、页脚、手记（无手记 / 三行上限 / 2px 竖线）、全矩形在画布内、无项目与无进程分支、无镜头分支。

## 12. 海报收尾（round 5）

### 12.1 四张接触印相

改成正规的 2×2：每张 `340×191`、间距 24，图注 `captionY = y + 191 + 20` 与卡片左缘对齐。
`340×2 + 24 = 704`，在 760 宽右栏里居中（两侧各 28），x = 772 / 1136，行 y = 356 / 605。
四张依次为：最长镜头、最密 30 分钟里最长的镜头、时长第一的进程里最长的镜头、当天最后一个镜头；
若某个槽位的镜头已被占用（真实当天前三处都是同一镜），就取同一候选集里次长未用的；
第四张已占用时往前找未用的镜头，保证四张不重复。

### 12.2 背景水印

降到 4% 不透明度，并只裁在右栏矩形 `{x:744,y:0,w:760,h:1000}` 内；
纯裁切会在 x=744 处把字形切成一条硬边，所以另加 `fade:120`：在右栏左缘 120px 内用线性渐变
从透明过渡到 4%，既不压左栏文字也不出现剪切痕。

### 12.3 左栏下半栏

- 有手记：Inter 18、行高 28、最多三行，左侧 2px amber 竖线（x=96，文字 x=120），基线 y=612。
- 无手记：当日之最两行 Plex Mono 12（y=612/636）：
  `最长镜头 20:26–20:30 · 4 分 14 秒`、`最密 30 分钟 20:25–20:55 · 29 次剪辑`；两行都没有时（无镜头）不画。

### 12.4 导出与验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 251 tests passed（poster 20 条）
npm run build                            css 38.17 kB, js 145.94 kB
```

真实导出按钮路径导出两张：

- 有手记：`%TEMP%\dayfilm-poster-r4.png`，1600×1000，125,408 字节；
- 无手记（当日之最分支）：`%TEMP%\dayfilm-poster-r5-bare.png`，120,955 字节。

两张都逐张看过：2×2 卡片齐整、图注对齐卡片左缘、水印无硬边、左栏不再大片空白。
仍与前轮一样：原生保存对话框本身未在 headless 里点过，由用户用真实对话框再确认。

### 12.5 偏离

1. 卡片 340 宽装不满 760（差 56），所以网格在右栏里居中，没有贴左缘留一条右缝。
2. 第四张在“最后一镜已被占用”时取前一个未用镜头，而不是重复画同一钝镜头。

## 13. 海报印相改用放映版式（round 6，v1.3 最后一轮视觉）

### 13.1 四张接触印相

不再用 `drawStill`（完整场记板帧在 340×191 下只剩一角小字），改成直接复用放映那套纯参数：
`paint.ts` 先 clip/translate 到卡片矩形，再调 `paintProjectionBoard(projectionFrameParams({ ... }))`——
与放映画面完全同源：顶部 `日期 · SHOT n / total`、背景大镜次（Bebas、高 55%、4%）、应用名与标题、
底部时间码与时长尺（族色填充 + `本镜 / 当天最长`）、3% 颇粒、左侧族色条。
`PosterPrint` 因此多了 `start/end/seconds/maxSeconds/hue/grainSeed` 六个字段，`PosterLayout` 多了 `printTotal`；
镜头无标题时回退为 `—`。`paintProjectionBoard` 去掉了 `clearRect`，以免在卡片里裁出透明洞。

### 13.2 左栏位置

手记与当日之最一起上移到数字下方：基线 y=496（数字基线 456），2px 竖线从 y=480 起。

### 13.3 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC-OK
npx vitest run tests/renderer            17 files / 252 tests passed（poster 21 条）
npm run build                            css 38.17 kB, js 146.73 kB
```

真实导出按钮路径再导两张（均 1600×1000）：

- 有手记：`%TEMP%\dayfilm-poster-r6-note.png`，187,520 字节；
- 无手记：`%TEMP%\dayfilm-poster-r6-bare.png`，182,434 字节（当日之最分支）。

两张都逐张看过：四张卡片不再是空暗块，与放映画面同构；当日之最贴在数字下方，不再有 140px 空档；
无窗口标题的镜头回退为 `—`。
新增断言：印相携带放映参数（镜次/起止/秒数/尺分母/族色/颇粒种子）与 `printTotal`；手记与当日之最的 y=496。
仍遗留：原生保存对话框本身未在 headless 里点过。
