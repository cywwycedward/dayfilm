# status-ui10：v2.1 无边框头部与控件细节

任务来源：[brief-ui10.md](brief-ui10.md)，概念图 [ui-concept-v3-chrome.png](../product/ui-concept-v3-chrome.png)（A–D）。
范围：`src/renderer/**`、`tests/renderer/**`、本文件。`src/main/**`、`src/shared/**`、`package.json`、构建配置未改。

## 1. 真机验收后的三处修正

1. **下拉触发条的焦点环**：打开时那条 2px 琥珀矩形是全局 `:focus-visible`（点击后我们调 `trigger.focus()`，Chromium 也判为可见）。
   现在 `select.ts` 用 `element.dataset.input = 'pointer' | 'keyboard'` 记录输入方式，CSS：`.select__trigger:focus-visible { outline: none }`，
   只有 `[data-input='keyboard']` 且面板未展开时才画 2px 琥珀描边。打开时只剩底部 1px 琥珀线 + 面板。
2. **最近镜头最后一行**：`.recent` 加 12px 底部内边距；`fitRecentList()` 按右栏可用高度算整行
   （`max(6, floor((room-12)/32))`，装不下时容器取可用高度、超出滚动），右栏块间距 12→8px、块底部 padding 回归 16px，
   让 6 × 32 + 12 的视口在 820 高下正好装进面板。
3. **脊柱「现在」标签**：画布加宽 96px（只给脊柱本身铺墨色，多出的区域透明），标签移到密度柱右侧 +6px，
   背底 `rgba(10,11,13,.4)`；琥珀横线只跨 88px 脊柱；`.spine` / canvas 加 `z-index` 让标签压在右栅之上。

## 2. 与概念图 A–D 的对应

### A. 头部（56px，自绘）

- 结构：`DAYFILM`（Bebas 20 / 0.08em）→ 日期触发器 → `● 实时记录中` chip → 拖动区（`#dragRegion`，撑满中间）
  → 搜索 → `导出` / `设置` / `···` → 三个窗口按钮（32×32，图标 10px、描边 1.5，内联 SVG：横线 / 方框 / 双框 / 叉）。
- 整条 `.topbar { -webkit-app-region: drag }`；品牌、日期、搜索、chip、按钮组、窗口按钮都 `no-drag`。
- 窗口按钮：默认 `--paper-dim`，悬停背景 `rgba(236,231,220,.06)` + 图标 `--paper`；关闭按钮悬停 `--red` 底 + 近黑图标
  （实测 `rgb(184,82,74)` / `rgb(10,11,13)`）。
- 双击拖动区 → `window.dayfilmWindow?.toggleMaximize()`；`onMaximizeChange` 到达时把方框图标换成双框（`#winMaxIcon` / `#winRestoreIcon`
  互斥 hidden，`aria-label` 同步「最大化 / 还原窗口」）。桥接缺席时全部可选调用，不报错。
- 高度固定 56 + 底部 1px 发丝线；没有给原生标题栏留空隙。

### B. 自绘下拉框（替换全部原生 select）

- `lib/select.ts`：`initialHighlight` / `moveHighlight` / `panelPlacement` 三个纯函数 + 单测 8 例
  （循环移动、Home/End、空列表、上下翻、边距临界）。
- `src/renderer/src/select.ts`：`createSelect({ label, options, value, onChange })` → 触发器（高 32、只留底线、右侧 8px 箭头）
  + 面板（`#lift`、1px 发丝线、2px 圆角、8px 内边距、宽 ≥240、最高 260 可滚、靠底部时向上翻）。
  行高 32；选中行左侧 2px 琥珀竖条 + 4% 亮底；键盘高亮行 4% 亮底；悬停 4% 亮底。
- 键盘：Enter/Space 开合、↑↓ 循环、Home/End、Enter 选中、Esc 关闭、Tab 移出关面板；关闭后焦点回触发器。
- ARIA：触发器 `role="combobox" aria-haspopup="listbox" aria-expanded aria-controls aria-activedescendant`，
  面板 `role="listbox"`，行 `role="option" aria-selected`。
- 替换位置：顶栏日期、设置里的保留期、对比浮层左右日期 —— 页面上 `document.querySelectorAll('select').length === 0`（实测）。

### C. 输入框三态

- 统一高 32、左内边距 12、只留底部 1px 线：默认 `rgba(255,255,255,.16)`；聚焦 `--amber` + `0 1px 0 rgba(232,180,90,.2)` 微光；
  错误 `#e06c6c`（底线与文字），`aria-invalid` 同步。placeholder `#8e8a80`（56%），插入符 `--amber`。
- 套用范围：搜索、手记（多行，保留底线与聚焦微光）、脱敏关键词、项目名/关键词。
- 错误态接到现有的校验上：空关键词 / 重复关键词 / 空项目名 / 无关键词 / 同名项目，输入时自动清掉错误态。

### D. 字体与字号

- 中文只用 400/700（没有新增 500/600）；题材 128px、`letter-spacing: .02em`；`DAYFILM` / Bebas 用 `.08em`。
- 字号阶梯：界面标签 10、次要 11、正文/按钮/下拉 13、重点 16、场景数字 28、题材 128。
- 数字与时间码 `font-variant-numeric: tabular-nums`（时间码、统计、表头、窗口时长）；`body` 仍是 `-webkit-font-smoothing: antialiased`、行高 1.5。

## 3. 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/renderer/index.html` | 头部重写（拖动区、窗口按钮 SVG、日期容器）；`#settingRetention` 从 `<select>` 换成容器 div |
| `src/renderer/src/select.ts` | 新增：自绘下拉框组件（触发器 / 面板 / 键盘 / ARIA / 上下翻 / 外点关闭） |
| `src/renderer/src/lib/select.ts` | 新增：高亮与朝向的纯函数 |
| `tests/renderer/select.test.ts` | 新增 8 例 |
| `src/renderer/src/app.ts` | 日期/保留期/对比日期改用自绘下拉；窗口按钮 + 双击最大化 + 可选桥接；输入错误态；`setInputError` |
| `src/renderer/src/style.css` | v2.1 段：拖动区 / 窗口按钮 / 自绘下拉 / 输入三态 / 字号与字距 |

## 4. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run tests/renderer            25 files / 345 tests passed（select 8 例）
npx vitest run（全量）                    49 files / 589 tests passed
npm run build                            index-*.css 67.38 kB / index-*.js 168.04 kB
node scripts/probe-v20.mjs               %TEMP%\dfv20\{1-day,2-week,3-projection}.png（第二轮修正后复跑）
```

第二轮复核（probe-v20，真实构建）：发条焦点环已消失（只剩底部 1px 琥珀线）；脊柱「现在 14:10」标签在密度柱外、
带 40% 墨底，画布多出的 96px 不再给右栅铺黑底；最近镜头的可见行数按可用高度重算。
**注意**：probe 的窗口是带边框的 1280×820（页面内容只有 781px），所以它的截图最底部可能仍压到一行；
产品壳是无边框 820 内容，`6 × 32 + 12` 的视口在那里正好装下（下一轮真机再确认一次）。

自检（`npx vite src/renderer --port 5182` + mock，Electron 1280×820，截图在 `%TEMP%\ui10\`）：

```text
窗口按钮   32×32 命中区、10px 图标、1.5px 描边；关闭悬停 bg rgb(184,82,74) / color rgb(10,11,13)
日期下拉   点开 aria-expanded=true、面板 240×260、14 个 option、面板在触发器下方（y=50）
键盘       ↓↓ 后高亮「11月11日 周三」，Enter 选中并关闭、焦点回触发器；日期切到 11 日（hero 剧照走空档分支）
保留期     自绘下拉 5 个选项、选中 30 天带琥珀竖条；页面上 native <select> 数量 = 0
输入三态   空关键词提交后 #termInput 变 input--error、底线与文字 rgb(224,108,108)、aria-invalid=true；输入即清除
```

截图：`01-header`、`02-header-close-hover`、`03-date-open`、`04-date-picked`、`05-input-focus`、`06-input-error`、`07-retention-open`。

## 5. 刻意偏离

1. **日期列表沿用 `listDays()` 的顺序**（mock 是最旧→最新），没有为了「今天在最上面」重排；自绘下拉只负责呈现。
2. **错误态只接在设置里的关键词/项目输入上**：搜索与手记没有「错误」语义（空搜索=清空筛选、手记只读回显失败），
   所以 `.input--error` 是通用样式，但只在有校验的地方触发。
3. **字号阶梯是「按组件对齐」而非全局替换**：按钮/下拉/正文到 13，标签保持 10/11，统计和题材保持 28/128；
   旧版遗留的 12px 规则仍在（见 §5）。
4. **拖动区在浏览器/无边框壳之外是惰性的**：`-webkit-app-region` 只有 Electron 无边框窗口生效；本轮没有主进程可验证。

## 6. 未完成 / 已知问题

1. **真实无边框窗口未联调**：主进程并行改造中，`window.dayfilmWindow` 的 `minimize / toggleMaximize / close / onMaximizeChange`
   只按可选调用写了，未在打包产物上点过；最大化图标切换未验证（桥接未就绪）。
2. **旧版 CSS 仍有一批 `select`/`input`/`.topbar__date select` 死规则**（约 40 行），与 v2.1 新规则并存但不再命中；
   连同 status-ui9 里记的约 700 行旧布局规则都还没有清理。
3. **HUD 页面没有跟着换**：`hud.css` 仍是 v1.6 的发丝线 + 5% 底色；本轮范围是主窗口。
4. **下拉面板没有做虚拟滚动**：选项多到几百条时会一次性建行（当前最多 14 个日期 / 5 个保留期，够用）。
5. **深浅色/高对比系统主题未适配**：仍是唯一的深色影院主题。
6. **最近镜头在 820 以下窗口仍可能只剩 4–5 行**：`fitRecentList()` 的下界是 4 行（可用高度太小时就滚动），
   “至少 6 行”只在 820 内容高度以上成立；probe 的 781px 内容窗口里会少一行。
