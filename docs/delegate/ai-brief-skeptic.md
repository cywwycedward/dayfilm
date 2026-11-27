# 任务书：Dayfilm × AI 头脑风暴（怀疑论 / 品牌守门人视角）

你在 `D:/core/workspace/mine/github_mine/dayfilm` 仓库里工作。只做分析和写作：不要改任何源代码、不要新增依赖、不要提交。

## 目标

站在这款产品的对立面：哪些"AI 功能"是噱头、是把规则换个说法、会毁掉产品性格或隐私承诺。你的产出要能当场否决一个提案。

## 先读（必须，别猜）

`PRODUCT.md`、`DESIGN.md`、`docs/product/dayfilm.md`、`docs/specs/dayfilm-v2.md`、`docs/agents/adr/0004-week-film-direction.md`、`docs/delegate/gpt-answer-1.md`、`docs/delegate/gpt-answer-2.md`、`README.md`、`src/renderer/src/lib/narration.ts`、`src/renderer/src/lib/week-film.ts`、`src/renderer/src/lib/title-card.ts`、`src/renderer/src/lib/poster.ts`（结构即可）、`src/main/reel/rules.ts`、`src/shared/projects.ts`。

## 已核实的事实

- 产品性格：冷静、克制、有电影感，像剪辑台与放映室，不是效率仪表盘；允许一个视觉重点，其余让位。
- 硬承诺：不联网、不截屏、不记键盘、数据只在本机、确定性渲染（同一份数据任何时间结果一致）。
- 已有功能几乎全是确定性规则：题材判定、旁白、周评语、精选、海报、EDL/PDF、HUD、音效。
- 历史外部裁决明确否决过"周报式"与"KPI 仪表盘"方向（`docs/delegate/gpt-answer-1.md` 里对 B/C/D/E 逐条给了否决理由）。

## 交付

写 `docs/delegate/ai-brainstorm-skeptic.md`（Markdown，中文，直接给结论，不要免责声明），包含：

1. **AI 功能反面清单**：6–10 个听起来很酷但应当拒绝的方向，每个写清拒绝理由（违背哪条产品真相、为什么用户三天后就不用了、为什么它其实是另一个产品）。
2. **区分判据**：最多 4 条，能拿来当场否决一个提案，不能是空话。每条判据给一个"用它否决某个具体提案"的例子。
3. 对下面 6 个提案逐个裁决（值得做 / 有价值但形态要改 / 拒绝），并说形态应该怎么改：
   - A. AI 给每天写一段导演评语/影评（替代现有模板 `verdict.note`）
   - B. AI 从窗口标题识别"正在做什么任务"（如"修登录 bug"）并把镜头归到任务
   - C. 自然语言检索（"上周三我在改哪个 PDF 那件事" → 定位到镜头）
   - D. AI 自动生成项目规则/故事线（从标题归纳项目名与关键词，替用户写 `projects` 配置）
   - E. AI 生成海报文案/片名/字幕卡
   - F. AI 周报/月度回顾长文（可导出分享）
4. **最危险的信任破裂点**：一旦发生用户会卸载。按严重度排序，给每条的最小防护要求。
5. **不可让渡的底线**：一句话。
6. 补充：这 6 个提案之外，你认为被忽略的真机会是什么（如果有），一句话说清为什么它不违反上面的判据。

## 风格要求

- 结论先行，表格优先，不要写"这取决于"式两端都对的句子。
- 引用具体文件与函数作为证据。
