# 任务说明书：v1.6 界面铬重做 + 双日叠片（df-ui2）

## 目标

两件事：

1. **界面铬（chrome）重做**——用户反馈"边框和滑动框太丑"。规范见 `docs/product/visual-language.md` §八，那六条来自一张外部概念图，照着做，不要自由发挥。
2. **双日对比改成"上下叠片"**——现在是对比浮层左右两栏，改成两卷胶片共享一条时间轴上下叠放。

## 可写范围

`src/renderer/**`、`tests/renderer/**`、`docs/delegate/status-ui8.md`。不要改 `src/main/**`、`src/shared/**`、`package.json`、构建与打包配置。不要启动子 Agent。

## 一、界面铬（按 visual-language §八 逐条落实）

- **滚动条**：给所有可滚动容器（`#listScroll`、设置抽屉、对比/日历浮层、搜索结果）加统一的 `::-webkit-scrollbar` 样式：宽 6px、轨道透明、滑块 `rgba(236,231,220,.16)`、悬停 `.34`、圆角 3px；未悬停时接近隐形。页面主体不要再出现系统灰条。
- **滑块**：把 `#scrub` 与任何 `input[type=range]` 改造成：轨道 2px、已播放段 `--amber` 55%、拇指 6px `--paper`、拖动时 8px 且变 `--amber`。用 `::-webkit-slider-runnable-track` / `::-webkit-slider-thumb` 实现，Firefox 分支可忽略。
- **输入框**：`#search`、脱敏关键词输入、手记、设置里的文本输入——去掉四边框，只留底部 1px 发丝线；聚焦底线变琥珀。
- **下拉框**：`#date`、保留期、对比/日历里的日期选择——`appearance: none` + 自绘指示符 + 只有底线。
- **按钮**：统一三级——主按钮琥珀实底黑字、次按钮纯文字（悬停下划线）、图标按钮无边框（悬停 4% 底）；所有按钮去掉 1px 边框，圆角收到 2px。
- **面板/浮层**：`#compare`、`#calendar`、设置抽屉、海报主题菜单——1px 发丝线 + `#14161c` 底色，不画圆角大框；只有真正浮起的层加 `0 24px 64px rgba(0,0,0,.55)` 阴影。
- **焦点环**：`:focus-visible` 统一 `outline: 2px solid var(--amber); outline-offset: 2px`。
- **剧照卡片**：去掉外框，改 `box-shadow: inset 0 0 0 1px rgba(236,231,220,.06)`；选中态才有 1px 暖白内描边。
- **HUD 窗口**：同样的发丝线 + 5% 底色，不要圆角大方框。

## 二、双日叠片（R51 的改版）

- 对比浮层改成：顶部日期选择（两行，每行一个日期 + 该天题材），中间**两卷胶片共享一条时间轴**上下叠放——两条带的水平范围用两天的并集（最早起点到最晚终点），各自按自己的镜头铺在对应时间段；两条带之间留 8px，共用底部一条时刻刻度（00:00–24:00 比例）。
- 带高 44px，比现在的 36px 高；每条左侧 2px 族色条保留。
- 下方差异区：活跃时长、镜头数、每小时剪辑三个数字左右并列，中间用 `→` 连接，正负用 `--amber`/`--silver`。
- 点任一条带 → 关闭浮层并切到该天日视图。
- 纯函数 `lib/compare-days.ts` 扩展：`unionRange(a, b)` 返回两条带共享的时间范围（任一侧为空时用另一侧；都空时返回 null）；`axisTicks(range)` 返回 5 个刻度时刻。补测试：并集范围、单侧为空、两侧同一天。

## 三、自检

```powershell
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/renderer
npm run build
```

不要跑 `npm run dev`。改完用 `npx vite src/renderer --port 5180` 配 mock 自查一遍：滚动条、滑块、输入框、下拉框、按钮、两处浮层、HUD 页面。

## 交付

`docs/delegate/status-ui8.md`：改了哪些选择器/组件、与 §八 的对应关系、双日叠片的实现要点、验证输出、未完成项。完成后结束本轮。
