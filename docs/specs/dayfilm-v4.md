# Dayfilm v4 功能规格：故事的连续性

v4 不增加记录维度，只把已经落盘的数据读得更深：修掉两个统计缺陷，新增四条"关系"事实，让历史第一次服务于"接着昨天"。
方向裁决见 [eval-verdict.md](../delegate/eval-verdict.md)，执行计划见 [gpt-answer-14.md](../delegate/gpt-answer-14.md)。

## 范围与总原则

- 六项能力分成三批交付：**数据口径**（S1、S2）、**跨天查询**（S3、S6）、**当日叙事**（S4、S5）。
- 不新增依赖、不改 JSONL 格式、不迁移历史数据、不新增主导航与仪表盘、不接入模型通道。
- 渲染确定性：所有新函数只吃传入数据，不读系统当前时间、不用随机。
- 新字段一律**不参与镜头切分**；`Scene.id`、镜头边界、题材四档边界保持现状。
- 同一份数据在三处（全量 `groupRuns`、增量 `aggregate.append`、实时 `liveScene`）必须得出同一个结果；窗口身份与切换判定只能有一份实现。

## S1 无前台窗口不再算错误

**现状**：`resources/capture.ps1` 在 `GetForegroundWindow()` 返回 0 时输出 `{"ok":false,...}`，`parseCaptureLine` 当采样错误，`captureError` 非空 → `hudMood()` 与 `trayMood()` 都变 `error`。锁屏离开时 HUD 在报错。

**行为**：

1. 无前台窗口时脚本输出**合法采样**：`{"ok":true,"title":"","exe":"","idleMs":<实际值>}`。
2. 落盘格式不变（空串是合法字符串，`isSample` 已允许）。
3. `exe` 与 `title` 同时为空 = away：**直接算中场休息**，不看 60 秒空闲门槛；不生成 `shot`；不参与剪辑计数；不把它前后的镜头连成一条。真机锁屏时 Windows 报的是前台进程 `LockApp`（标题本地化为「Windows 默认锁屏界面」），所以 `LockApp` 同样按 away 处理——否则 Win+L 之后那几十秒会被记成一个假镜头。
4. away 采样到达时清掉 `captureError`；真正的脚本异常（非 JSON、字段缺失、字段类型不符）仍按采样错误处理。
5. 实时状态：away 时 `LiveState.scene = null`（HUD 显示空闲，不显示错误）。

**判定位置**：`src/main/reel/transition.ts` 导出 `isAway(sample)` 与 `sceneKindOf(sample)`，`groupRuns`（`src/main/reel/index.ts`）、`append`（`src/main/reel/aggregate.ts`）、`liveScene`（`src/main/index.ts`）统一调用。

**边界**：away 与 60 秒空闲休息之间不产生额外剪辑；away 期间不累计 `activeMs`。

## S2 剪辑拆成两个子计数

**现状**：`cuts` 把"换应用"和"同应用换文档"算成同一个数，一个下午在三份文件间来回改会被判成跳切风暴。

**行为**：

- 相邻两个有效 `shot`：`exe` 不同 → 跨应用（`appCuts`）；`exe` 相同但 `title` 不同 → 应用内（`withinAppCuts`）；窗口身份相同 → 不计数。
- `cuts = appCuts + withinAppCuts`，**总数语义与今天完全一致**；`judge()` 的 3 / 8 / 20 三档边界不动，题材判定继续只用 `cuts`。
- `DayRollup` 增加 `appCuts` / `withinAppCuts`；中场休息不参与任何计数。
- 界面：右栏统计在「剪辑数」下加一行 `跨应用 X · 应用内 Y`，不新增卡片、不加图表。

**窗口身份**：`sameWindow(a, b) = a.exe === b.exe && a.title === b.title`；`transitionOf(prev, next) = 'app' | 'within-app' | 'none'`。两者只在 `transition.ts` 里实现一次。

## S3 检索：范围对齐与命中理由

**现状**：`parseQuery` 能认出「上周三」「11月19日」，但 `src/main/index.ts` 的 search 通道只把最近 7 天喂给 `searchScenes`，7 天外必然 0 命中；结果也没有"为什么命中"。

**契约**（`src/shared/types.ts`，`search` 返回值由 `Scene[]` 改为 `SearchOutcome`）：

```ts
export interface SearchReason { tokens: string[]; dates: string[] }
export interface SearchHit { scene: Scene; reason: SearchReason }
export type SearchCoverage = 'full' | 'partial' | 'expired'
export interface SearchOutcome { hits: SearchHit[]; coverage: SearchCoverage; retainedFrom: string | null }
```

**范围规则**：

1. 查询里有时间词 → 目标日期 = 解析出的日期集合。
2. 没有时间词 → 目标日期 = 最近 7 天（含今天）。
3. 目标日期与保留范围取交集后再查询；保留范围用存储层实际清理规则（`keptDays()`），不写死 30 天。
4. `coverage`：交集为空且目标日期全都早于保留范围 → `expired`；交集非空但少于目标日期 → `partial`；否则 `full`。
5. `retainedFrom` = 保留范围内最早的日期；没有数据时为 `null`。

**命中理由**：与匹配同一趟算出来——`tokens` 是真正在标题 / 原文 / 进程名里命中的词（小写原文），`dates` 是真正起作用的日期。只有日期没有词时 `tokens` 为空。文案由渲染层拼。

**边界**：多词仍为 AND；排序不变（命中词数降序 → 开始时刻降序）；上限仍为 200；空查询返回空 `hits` 且 `coverage: 'full'`。

**空状态文案**：

| 情况 | 文案 |
| --- | --- |
| `hits` 为空 + `expired` | 所选日期已超出保留范围；当前仅保留 `<retainedFrom>` 及之后的记录 |
| `hits` 为空 + 其他 | 没有找到匹配的镜头 |
| `hits` 非空 + `partial` | 列表顶部一行：部分日期已超出保留范围，仅检索仍保留的记录 |

## S4 上一集（跨天续接）

**行为**：查看某一天时，找出"上次停在这里"——同一天里最长镜头所在的窗口，上一次出现在哪一天。

- 锚点：所查看日期的 `longestShot`；当天没有镜头 → 不显示。
- 匹配：**原始 `title` 完全相同**，或与该锚点属于同一个项目（`matchProject` 同名）。
- 范围：只看严格早于所查看日期的保留日期，从近到远逐日查，命中第一天就停；同一天有多条命中取最后一条。
- 返回（`EpisodeRef`）：`date`、`start`、`exe`、`title`、`seconds`、`match: 'title' | 'project'`、`project: string | null`；无命中返回 `null`。
- 展示：hero 在 `#verdict` 之后新增一行 `#episode`，整行可点，复用现有切日与选镜头逻辑；无命中整行隐藏。
- 重查时机：切换日期、项目规则变化时；**不跟随 2 秒采样刷新**。快速切日时，晚到的旧请求不得覆盖新日期的结果。

**IPC**：新增 `dayfilm:previous-episode`，入参 `date: string`，返回 `EpisodeRef | null`；同时登记进 `GUARDED_CHANNELS`、`IpcDeps`、`createHandlers`、preload 与 `DayfilmApi`。

**边界**：不参与匹配当天及更晚的日期；同名不同项目不合并；不做模糊匹配。

## S5 镜头之后 15 分钟

**行为**：以当天 `longestShot` 的结束时刻为起点，取 `[end, end + 15 分钟)` 内**开始**的有效镜头（不含中场休息），按归一化标题分组，按镜头条数计数（不按采样条数），次数降序、首次出现升序，最多 3 组。

- 输出：`{ endAt: number; groups: { name: string; count: number }[] }`；没有后续镜头返回 `null`。
- 展示：`#discoveries` 内固定追加一行，标签「镜头之后」，与原有三类发现并存，总条数上限从 3 提到 4；原有发现算法、排序、上限保持不变。
- 边界：恰好落在 15 分钟边界上的镜头不算；一个持续 10 分钟的镜头只计一次；最长镜头之后只有中场休息则不显示。

## S6 中场休息的形状

**行为**：取当天最长的一般中场休息（等长取更早的一段），比较休息前最后一条有效镜头与休息后第一条有效镜头的窗口身份：

- `returned`：`exe` 与 `title` 都相同 → 「`12:06` 离开 48 分钟，回来还是同一个窗口」
- `changed`：窗口身份不同 → 「`12:06` 离开 48 分钟，回来换成了 `Chrome`」（用后一条的 exe）
- `unknown`：后面没有记录到镜头 → 「`12:06` 离开 48 分钟，还没有记录到回来」

输出 `{ start: number; ms: number; outcome: 'returned' | 'changed' | 'unknown'; nextExe: string | null }`；当天没有中场休息返回 `null`。
展示：hero 在 `#episode` 之后新增一行 `#intermission`，只读，无点击。`exe` 相同但 `title` 不同判为 `changed`。

## 文件归属

| 阶段 | 文件 |
| --- | --- |
| P1 | `resources/capture.ps1`、`src/main/reel/transition.ts`（新增）、`src/main/reel/index.ts`、`src/main/reel/aggregate.ts`、`src/main/index.ts`（`liveScene` 与采样状态）、`src/shared/types.ts`、`src/renderer/src/app.ts`（统计一行）、对应测试 |
| P2 | `src/main/reel/search.ts`、`src/main/reel/previous-episode.ts`（新增）、`src/shared/types.ts`、`src/shared/ipc.ts`、`src/main/ipc/index.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/data.ts`、`src/renderer/src/app.ts`、`src/renderer/src/mock.ts`、`src/renderer/index.html`、`src/renderer/src/style.css`、对应测试 |
| P3 | `src/renderer/src/lib/day-insights.ts`（新增）、`src/renderer/src/app.ts`、`src/renderer/index.html`、`src/renderer/src/style.css`、对应测试 |

复用规则：归一化用 `src/shared/stories.ts` 的 `normalizeTitle`，项目匹配用 `src/shared/projects.ts` 的 `matchProject`，**不新建同义模块**。

## 测试与验收

| 阶段 | 测试 | 判据 |
| --- | --- | --- |
| P1 | `tests/main/capture.test.ts`、`reel.test.ts`、`aggregate.test.ts`、`pipeline.test.ts`、`tests/renderer/hud.test.ts` | away 合法且不成镜头；三处入口结果一致；两个子计数之和等于 `cuts`；题材边界不变；锁屏不报错 |
| P2 | `tests/main/search.test.ts`、`ipc.test.ts`、`previous-episode.test.ts`、`cache.test.ts`、`store.test.ts` | 7 天外、保留期内可检索；理由与真实匹配一致；三种覆盖状态正确；上一集不命中当天及更晚；晚到请求不覆盖新结果 |
| P3 | 新增 `tests/renderer/day-insights.test.ts` + `discover.test.ts` 回归 | 两个观察可独立出现/隐藏；不挤掉原有发现；边界镜头不计入；`exe` 同 `title` 不同判 changed；重复执行输出一致 |

每阶段结束都要 `npm test` 与 `npm run typecheck` 通过，再移交共享文件修改权。

## 明确不做

- 不拆分 `app.ts`、不重构 `DayCache`、不加持久化派生字段、不改采样频率、不改题材边界。
- 不做模糊匹配、不做模型调用、不做截图/像素、不做专注分或趋势。

## 变更

- `DayRollup` 只增不删（`appCuts`、`withinAppCuts`）；旧日文件无需迁移。
- `search` 返回类型变更；preload、mock source 与 `ipc.test.ts` 同步修改，不保留兼容层。
