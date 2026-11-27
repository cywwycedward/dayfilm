# 任务书 P1：数据口径与缺陷修复（Dayfilm v4）

仓库：`D:/core/workspace/mine/github_mine/dayfilm`。规格权威：`docs/specs/dayfilm-v4.md` 的 **S1、S2**。只做这两项，不做别的。

## 铁律

- **只改下面列出的文件**。别顺手重构 `app.ts`、别动 `DayCache`、别改采样频率、别加依赖、别改 JSONL 格式、**不要 git commit**（工作区里有 v3 的未提交改动，混在一起会毁掉历史）。
- 新字段不参与镜头切分；`Scene.id`、镜头边界、`judge()` 的四档边界保持现状。
- 窗口身份与切换判定只能有一份实现，放在新文件 `src/main/reel/transition.ts`。
- 完成后必须让 `npm test` 与 `npm run typecheck` 都通过；有测试改了就必须说明为什么。

## 允许修改的文件

- `resources/capture.ps1`
- `src/main/reel/transition.ts`（新建）
- `src/main/reel/index.ts`
- `src/main/reel/aggregate.ts`
- `src/main/index.ts`（只改 `liveScene` 与采样错误状态相关处）
- `src/shared/types.ts`
- `src/renderer/src/app.ts`（只加右栏那一行子计数）
- `tests/main/capture.test.ts`、`tests/main/reel.test.ts`、`tests/main/aggregate.test.ts`、`tests/main/pipeline.test.ts`、`tests/renderer/hud.test.ts`

## S1 无前台窗口不再算错误

1. `resources/capture.ps1`：`GetForegroundWindow()` 返回 0 时输出合法采样 `{"ok":true,"title":"","exe":"","idleMs":<实际值>}`（保持 ASCII-only 源文件约束）。
2. `src/main/capture/index.ts` 的解析不需要放宽——空串本就是合法 string；**不要**改这个文件。
3. `transition.ts` 导出：
   - `sameWindow(a, b)`：`exe` 与 `title` 都相等
   - `isAway(sample)`：`exe === '' && title === ''`
   - `sceneKindOf(sample)`：away 或 `idleMs >= IDLE_MS` → `'intermission'`，否则 `'shot'`
   - `transitionOf(prev, next)`：`'app' | 'within-app' | 'none'`（`exe` 不同 → app；`exe` 同、`title` 不同 → within-app；否则 none）
4. `groupRuns`（`src/main/reel/index.ts`）、`append`（`aggregate.ts`）、`liveScene`（`src/main/index.ts`）三处统一改用上面的函数：away 直接进中场休息分支、不生成 shot、不参与剪辑计数、不把前后镜头连起来；实时状态下 `scene = null`。
5. away 采样到达时清掉 `captureError`（`capturing: true, error: null`）；真正的解析失败仍走原来的错误路径。

## S2 剪辑拆成两个子计数

- `DayRollup` 加 `appCuts: number`、`withinAppCuts: number`；`cuts` 保留为两者之和，语义与今天一致。
- 全量、增量、实时三处都必须算出同样两个数。
- 界面：`src/renderer/src/app.ts` 的右栏统计（现在有三行「活跃时长 / 镜头数 / 剪辑数」，约在 820–835 行）在「剪辑数」下面加一行「跨应用 / 应用内」→ `X / Y`。不加卡片、不加图表、不改 hero。

## 测试

- `capture.test.ts`：空前台窗口解析为合法采样；真实异常仍报错；恢复后错误被清空。
- `reel.test.ts`：away 不成镜头、不进 `topApps`、不影响 `activeMs`；两个子计数正确且之和等于 `cuts`；题材四档结果与改前一致（用既有夹具断言）。
- `aggregate.test.ts`：同一份采样序列，全量与增量结果深度相等（含两个子计数）。
- `pipeline.test.ts`：`liveScene` 与最终 rollup 的镜头/计数一致。
- `hud.test.ts`：away 时 mood 不是 `error`。

## 交付

1. 跑 `npx --no-install vitest run tests/main/capture.test.ts tests/main/reel.test.ts tests/main/aggregate.test.ts tests/main/pipeline.test.ts tests/renderer/hud.test.ts`。
2. 再跑 `npm test` 与 `npm run typecheck`（全绿才算完）。
3. 写 `docs/delegate/v4-status-p1.md`：改了哪些文件、每项测试结果、契约变更、没解决的问题（各一行）。不要写过程日记。
4. 报告里明确一句：`cuts` 总数在既有夹具上是否与改前完全一致。
