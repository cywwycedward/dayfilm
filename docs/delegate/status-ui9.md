# status-ui9：v2.0 主界面重构（胶片脊柱）+ 首轮截图修正

任务来源：[brief-ui9.md](brief-ui9.md)，设计系统 [DESIGN.md](../../DESIGN.md)，概念图
[ui-concept-v2.png](../product/ui-concept-v2.png)。本轮把 v1.6 的竖排主界面**替换**成
「顶栏 56 / hero 7 栏 / 脊柱 88px / 右栏 4 栏」，并按 supervisor 的三张真机截图（`%TEMP%\dfv20\`）做了四处修正。

## 1. 完成到第几步

| 步骤 | 状态 |
| --- | --- |
| 1 骨架：顶栏 + 三列容器 + 右栏（放映/统计/最近镜头）接现有数据 | ✅ |
| 2 hero：素材条、题材、当前窗口、三指标、剧照、手记、高光 | ✅ |
| 3 脊柱：canvas + 虚拟化 + 点击/滚轮/键盘 | ✅ |
| 4 菜单收敛：导出▾ / ··· / 设置 | 🟡 行为都换了；旧版被替换的 CSS 约 700 行死规则没删 |
| 5 回归：放映态、片头卡、周视图、三个浮层、HUD | 🟡 放映/周视图/对比/日历/设置都点过；片头卡与 HUD 未逐张截图 |

## 2. 第一轮截图后的四处修正（dfv20）

1. **hero 太高、高光被切**：`.hero__frame` 从 `flex: 1 1 auto; min-height: 160` 改成固定 `150px`；
   `.hero` 间距 8→6px（标题/三指标上下各少约 4px）；手记输入 28→32px，`.hero__note` 用 `margin-top: auto`
   把「手记 + 高光」压在 hero 底部。820 高下三张高光完整可见，页面无纵向滚动。
2. **标题被横线穿过**：横线是 `.hero__window` 的 `border-top: 1px`，在 128px 题材下方视觉上压进字形。
   按 supervisor 的选项**移到标题上方**——去掉 `.hero__window` 的 border，改到 `.hero__head`
   （`padding-bottom: 8px; border-bottom: 1px solid var(--hairline)`），现在是「今天像什么」与大字之间的一条发丝线。
3. **脊柱太弱**：帧高 24→32px（全条 4608px）；canvas 撑满 88px：胶片 60（左右各 2px 族色边 + 中间用
   `drawStill` 画的该 10 分钟最长镜头剧照，紧凑帧档）+ 齿孔 2px + 密度柱 24px；密度改成每帧 6 根
   2px 小柱（100 秒一格，`rgba(236,231,220,.35)`，平方根映射）；`现在` 改成 2px 琥珀横线 + 右侧 mono 10 的
   「现在 13:37」；`.spine__viewport` 与 `#spineCanvas` 都加 `mask-image` 上下各 24px 渐隐，并隐藏脊柱滚动条。
4. **最近镜头最后一行被切**：块的 `padding-bottom: 12px`；`fitRecentList()` 按右栏剩余高度算整行数
   （`max(6, floor(room / 32))`，房间 = 栏高 − 其他两块 − 间距 − 块的固定开销），把列表高度设成
   `rows × 32`，配合虚拟列表的 spacer 多留 12px，最后一行不再被面板底边切掉。

## 3. 结构（1280×820 实测）

```text
顶栏 56：DAYFILM │ 日期 │ ● 实时记录中 │ 搜索 │ 导出 设置 ···
主区 697 / 88 / 399：
  hero  clapper 120 · 今天像什么 + 正在拍摄 + 日/周 · 题材 128px · 点评 · 当前窗口 ·
        三指标（28px mono，1px 竖线）· 剧照 150px · 手记 32px · 高光三卡
  脊柱  144 帧 × 32px，可见帧虚拟化，剧照缩略 + 族色边 + 齿孔 + 24px 密度柱 + 现在线，上下 24px 渐隐
  右栏  放映（40×40 ▶ / 倍速 / 28px 时间码 / 2px 进度条）· 今日统计（HH:MM + 镜头数 + 剪辑数 + 最长镜头/最长休息 + 项目行）· 最近镜头（表头 + 整行 32px）
```

菜单：`导出 ▾` = 剧本 Markdown / 剧本 PDF / CMX3600 EDL + 海报经典/黑色电影/极简；`···` = 对比两天 / 片场日历。

## 4. 文件

| 文件 | 改动 |
| --- | --- |
| `src/renderer/index.html` | 主窗口整体重写（顶栏 / hero / 脊柱 / 右栏 / 两个菜单）；浮层与设置抽屉保持原 markup |
| `src/renderer/src/assets/clapper-strip.png` | 复制自 `docs/product/assets/`（1.7 MB，未压缩） |
| `src/renderer/src/lib/spine.ts` | 帧 32px、每帧 6 个 100 秒密度小格、`densityLevel` 按 100 秒满档 |
| `src/renderer/src/paint.ts` | `paintSpine` 重写：剧照缩略 + 2px 族色边 + 齿孔 + 2px 密度小柱 + 2px 现在线 |
| `src/renderer/src/app.ts` | 日视图渲染重写；脊柱点击/滚轮/键盘；`fitRecentList`；`HH:MM` 统计数字 |
| `src/renderer/src/style.css` | v2 布局段 + 本轮 hero/脊柱/最近镜头修正 |
| `tests/renderer/spine.test.ts` | 10 例：144 帧 × 32px、跨帧切片、中场休息不算素材、6 个密度小格、定位夹取、可见范围、滚动居中、平方根映射 |

## 5. 刻意偏离

1. **脊柱帧里的剧照是「紧凑帧」档**（56×30）：24px 高的帧在剧照渲染里只能是细缝（纯色），
   所以帧高提到 32、胶片带 60px，让 `drawStill` 走到紧凑帧（应用名 + 镜次）。再宽会挤掉密度柱。
2. **今日统计的活跃时长用 `HH:MM`**（概念图是 08:41），hero 的当前镜头时长仍用 `HH:MM:SS`。
3. **`最长休息` 现算**（镜头间隙 + 中场休息取最大），旧汇总里没有这个指标。
4. **删掉缩放/平移/刻度尺/密度直方图/7 天迷你条/进程排行**：不在 brief「必须保留」清单里，
   时间轴职责由脊柱承担；`lib/zoom.ts`、`lib/density.ts`、`lib/week.ts` 仍在仓库里但主界面不再引用。
5. **窄窗（<1100px）用显式行高**：`grid-auto-rows: auto` 在实测里把两行均分成视口高度（hero 内容压到右栏），
   所以固定 `680px auto`，右栏落到 hero 下方、脊柱保留右侧。

## 6. 未完成 / 已知问题

1. **旧版 CSS 未清**：`.reel/.track/.ruler/.density/.transport/.frame/.summary/.shots/.week/.tip/.rank`
   等约 700 行死规则还在 `style.css`。
2. **最近镜头最后一行在打包版里仍会露出几像素**：`fitRecentList()` 把视口设成 6×32=192px，
   但 `probe-v20` 截图里第 7 行仍有一条边可见（列表容器实际高度比设置值大一点，未定位到原因）；
   需要下一轮量一次 `#listScroll` 的 computed height 与 `--row-stride` 再定。
3. **片头卡与 HUD 页面未逐张复核**：markup/逻辑没改；HUD 在 v1.6 已换成发丝线 + 5% 底色。
4. **空状态没有真机截图**：mock 的日期列表每天都有数据，切不到「无采样的一天」。
5. **场记板素材 1.7 MB 原样进包**，未压缩。

## 7. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run tests/renderer            24 files / 337 tests passed（spine 10 例）
npx vitest run（全量）                    47 files / 573 tests passed
npm run build                            assets/index-*.css 66.4 kB / index-*.js 156.9 kB
node scripts/probe-v20.mjs               %TEMP%\dfv20\{1-day,2-week,3-projection}.png
```

三张图核对：日视图高光三卡完整、标题无横线、脊柱 88px 带剧照缩略与密度柱、`现在` 琥珀线、
最近镜头表头与整行；周视图与放映态未受影响（`main` 隐藏、`#weekFilm` 占满；放映 `SHOT 01 / 07`）。
