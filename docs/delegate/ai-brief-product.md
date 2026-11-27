# 任务书：Dayfilm × AI 头脑风暴（产品价值视角）

你在 `D:/core/workspace/mine/github_mine/dayfilm` 仓库里工作。只做分析和写作：不要改任何源代码、不要新增依赖、不要提交。

## 目标

给 Dayfilm 找出**值得做的 AI 功能**，只从"产品价值 / 叙事能力"这一条线看：哪些 AI 能力是现有确定性规则做不到的，而不是规则换了说法。

## 先读（必须，别猜）

`README.md`、`PRODUCT.md`、`DESIGN.md`、`docs/product/dayfilm.md`、`docs/specs/dayfilm-v2.md`、`docs/agents/adr/0004-week-film-direction.md`、`docs/delegate/gpt-answer-1.md`、`docs/delegate/gpt-answer-2.md`、`src/shared/types.ts`、`src/shared/settings.ts`、`src/shared/projects.ts`、`src/main/reel/aggregate.ts`、`src/main/reel/rules.ts`、`src/main/reel/index.ts`、`src/renderer/src/lib/narration.ts`、`src/renderer/src/lib/highlights.ts`、`src/renderer/src/lib/week-film.ts`（前 200 行）、`src/main/notes/index.ts`、`src/main/marks/index.ts`。

## 已核实的事实

- 采样只有 4 个字段：时间戳、前台进程名 `exe`、窗口标题 `title`（截断 512 字）、距最后一次输入的空闲毫秒 `idleMs`；每 2 秒一次。
- 镜头 = 连续同窗口、≥3 秒；剪辑 = 相邻非空闲镜头切换；空闲 ≥60 秒 = 中场休息；题材按每小时剪辑率分 4 档。
- 项目 = 标题/进程名的子串关键词规则（`src/shared/projects.ts`），要用户手写。
- 已有：导演手记（每天一句，200 字上限）、正片/花絮标记、Markdown 剧本、CMX3600 EDL、PDF、1600×1000 海报（三主题）、周电影（七日叙事弧 + 周评语 + 精选）、放映态旁白（规则生成）、HUD、片场日历、双日对比、近 7 天标题/进程检索（`includes()` 子串）。
- 硬约束：不联网、不截屏、不记键盘、数据只在本机、确定性（同一份数据任何时间渲染一致）、品牌是冷静克制的"剪辑台/放映室"而不是效率仪表盘。历史外部裁决明确否决过"周报式"和"效率管理工具"方向。
- 现状：所有"智能"文字都是模板——`judge()` 只有 4 档 label + 一句 note；`narration.ts` 是 5 条优先级规则拼固定句式；周评语同模板。

## 交付

写 `docs/delegate/ai-brainstorm-product.md`（Markdown，中文，直接给结论，不要免责声明、不要防御性套话），包含：

1. **8–12 个候选**，每个写清：(a) 一句话用户价值（用户因此多知道什么，必须一句话说得出来）；(b) 为什么现有确定性规则做不到（引用具体函数与文件路径）；(c) 输入数据（必须来自已采集数据，或可选的小量用户输入）；(d) 输出落到 UI 哪个位置（hero / 脊柱 / 右栏 / 列表 / 放映 / 周电影 / 海报 / 导出 / HUD / 设置 / 检索）；(e) 最小可用形态，不是愿景；(f) 幻觉与失败风险，怎么让错误无害；(g) 工作量粗估 S/M/L。
2. **推荐先做的 2 个**，说明为什么是这两个、为什么不是别的；以及"如果只能做一个"的答案。
3. **明确不建议做的**，一句话一个理由。
4. 专题回答：窗口标题里的语义（文件名、issue 号、PR 标题、文档名、会议名、聊天对象名）能不能被用来做"活动类型分类 / 项目归一化 / 意图摘要 / 语义检索 / 自动命名故事线"；"AI 导演评语/手记草稿"到底是 AI 还是模板。

## 风格要求

- 每个结论后面带证据（文件路径 + 函数名 + 行号可选）。
- 拒绝空话："提升用户体验"这类句子不写。
- 承认不确定：能算出确定答案的地方就不要说"AI 可以"。
