# 任务书 P3：当日叙事增强（Dayfilm v4）

仓库：`D:/core/workspace/mine/github_mine/dayfilm`。规格权威：`docs/specs/dayfilm-v4.md` 的 **S5、S6**。P1、P2 已完成（away 采样、两个剪辑子计数、检索契约、上一集）。

## 铁律

- 只改下面列出的文件。**不要改 `src/main/**`**（采集、IPC、聚合、存储本轮已冻结），不动 `src/renderer/src/lib/discover.ts`（原有四类发现保持原样）。
- 不新增依赖、不改 JSONL 格式、**不要 git commit**。
- 纯函数只吃传入数据：不读系统当前时间、不用随机、不排序不稳定。
- 完成时 `npm test` 与 `npm run typecheck` 都要绿。

## 允许修改的文件

- `src/renderer/src/lib/day-insights.ts`（新建）
- `src/renderer/src/app.ts`（只加渲染与调用）
- `src/renderer/index.html`（中场休息那一行 + 必要注释）
- `tests/renderer/day-insights.test.ts`（新建）、`tests/renderer/discover.test.ts`（只加回归断言）

## S5 镜头之后 15 分钟

`day-insights.ts` 导出 `afterLongestShot(day: DayRollup): AfterShot | null`：

```ts
interface AfterShotGroup { name: string; count: number }
interface AfterShot { endAt: number; groups: AfterShotGroup[] }
```

- 锚点 = `day.longestShot`；没有就返回 `null`。
- 区间 `[endAt, endAt + 15 * 60_000)`：只收**开始时刻**落在里面、`kind === 'shot'` 的镜头；中场休息不计。
- 按归一化标题（`src/shared/stories.ts` 的 `normalizeTitle`）分组，`count` 是**镜头条数**，不是采样条数。
- 排序：`count` 降序 → 首次出现时刻升序；最多 3 组；没有镜头返回 `null`。
- 边界：恰好等于 `endAt + 15 分钟` 的镜头不算；一个持续 10 分钟的镜头只计 1 次。

## S6 中场休息的形状

`day-insights.ts` 导出 `longestIntermission(day: DayRollup): IntermissionShape | null`：

```ts
interface IntermissionShape {
  start: number
  ms: number
  outcome: 'returned' | 'changed' | 'unknown'
  nextExe: string | null
}
```

- 取当天最长的一段 `kind === 'intermission'`；等长取更早的一段；没有就返回 `null`。
- 前一条有效镜头 = 开始时刻早于休息开始、最近的 `shot`；后一条 = 结束时刻晚于休息结束、最早的 `shot`。
- 比较 `exe` 与 `title` 都相同 → `returned`；不同 → `changed`（`nextExe` 取后一条的 `exe`）；没有后一条 → `unknown`、`nextExe: null`。
- **`exe` 相同但 `title` 不同必须判 `changed`。**

## 界面

- `index.html`：在 `#episode` 之后加 `<p class="hero__intermission" id="intermission" hidden></p>`（若 P2 没建 `#episode`，就放在 `#verdict` 之后）。
- `app.ts`：
  - `#discoveries` 渲染里，原有发现（最多 3 条）之后**固定追加**一条「镜头之后」；总条数上限 4；原有发现为空但镜头之后有时仍要显示。
  - 文案示例：`14:18 之后的 15 分钟：浏览器 × 4 · 终端 × 2`（用现有时间格式化函数与本文件的 `node()` 风格）。
  - `#intermission` 单行：`12:06 离开 48 分钟，回来还是同一个窗口` / `回来换成了 Chrome` / `还没有记录到回来`；没有休息则 `hidden`。
  - 两种文案都只用时长、次数、窗口名，不出现「专注 / 应该 / 建议 / 打断」这类评价词。
  - 切日、切文本模式时与现有 render 流程一起刷新。

## 测试

新增 `tests/renderer/day-insights.test.ts`，至少覆盖：

1. 15 分钟窗口：区间内 3 组正确计数与排序；恰好落在边界上的镜头不计；一个长镜头只计一次；只有中场休息时返回 `null`。
2. 中场休息：`returned` / `changed`（exe 同 title 不同）/ `unknown` 三种；等长取更早；没有休息返回 `null`。
3. 确定性：同一份输入连续调用两次结果深度相等。

`tests/renderer/discover.test.ts` 只加一条回归断言：`findDiscoveries` 的条数上限、顺序与 evidence 不因新功能改变。

## 交付

1. 跑 `npx --no-install vitest run tests/renderer/day-insights.test.ts tests/renderer/discover.test.ts`。
2. 再跑 `npm test` 与 `npm run typecheck`。
3. 写 `docs/delegate/v4-status-p3.md`：改了哪些文件、测试结果、UI 落点、没解决的问题。
4. 明确一句：原有「剪辑发现」最多三条的语义是否保持不变（新增的只是并存的一行）。
