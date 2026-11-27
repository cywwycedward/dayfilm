# 任务书 P4：独立验证（Dayfilm v4）

仓库：`D:/core/workspace/mine/github_mine/dayfilm`。P1–P3 已完成，需要对整份改动做独立验收。

## 身份与铁律

你是验证者，不是实现者：

- **只读代码**。不准改实现、不准改测试来"消除失败"、不准 git commit / checkout / stash。
- 发现问题就写进报告，给出文件与行号；由人来决定退回哪个阶段。
- 允许跑命令：`npm test`、`npm run typecheck`、`git diff --stat`、`git status --porcelain`、只读的 grep/read。
- 不要跑 `npm run build`、`npm run dist`、`npm install`（耗时且会动产物）。

## 验收步骤

1. **基线**：`git status --porcelain` 与 `git diff --stat`。列出本轮实际被改动的文件，与本轮范围（`docs/specs/dayfilm-v4.md` 的「文件归属」）比对；指出任何越界修改（本轮之外的文件）。
2. **全量测试**：`npm test`。记录通过/失败数量与失败用例名。
3. **类型检查**：`npm run typecheck`。记录错误数与文件。
4. **规格对照**：逐条核对 S1–S6 的实现位置与规格文字是否一致，重点这几处：
   - away 是否真的不进 `shot`、不计数、清掉 `captureError`；三处入口是否共用 `transition.ts`。
   - `cuts === appCuts + withinAppCuts` 是否在代码里成立；`judge()` 是否仍只用总数。
   - search 是否已按"时间词目标日期 ∩ 保留范围"取数（不是固定 7 天）；`coverage` 三种状态与 `retainedFrom` 是否可达。
   - 上一集是否严格排除所查看日期及更晚的日期。
   - 15 分钟区间是否半开、是否按镜头条数计数。
   - 中场休息是否 `exe` + `title` 一起比较。
5. **回归风险**：找 3 个最可能被这轮改动弄坏但测试没覆盖的地方（例如放映态读取 `cuts` 的地方、周电影、海报、EDL、导出），逐个说明为什么安全或为什么不安全。
6. **交付纪律**：确认没有新增依赖（`package.json` 无变化）、没有改 JSONL 格式（`docs/data/store-format.md` 与 `src/main/capture` 的字段集未变）、没有 git 提交。

## 交付

写 `docs/delegate/v4-acceptance.md`，结构固定：

1. 一句话结论：能不能算 v4 就绪（`就绪` / `有条件就绪` / `未就绪`）。
2. 命令结果（三段，各一行 + 失败清单）。
3. 改动范围核对：越界文件（如有）。
4. 规格逐条核对：S1–S6 各一行 `通过 / 偏离（文件:行）/ 未实现`。
5. 回归风险三条。
6. 必须修的问题（按严重度排序，每条给文件与行号）；没有就写「无」。

只写结论与证据，不写过程日记、不写免责声明。
