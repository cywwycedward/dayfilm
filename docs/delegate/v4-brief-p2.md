# 任务书 P2：跨天查询与 IPC（Dayfilm v4）

仓库：`D:/core/workspace/mine/github_mine/dayfilm`。规格权威：`docs/specs/dayfilm-v4.md` 的 **S3、S4**。P1 已完成（`transition.ts`、两个剪辑子计数、away 采样）。只做 S3、S4。

## 铁律

- 只改下面列出的文件；别重构 `app.ts`、别动 P1 的采集与聚合逻辑、别加依赖、别改 JSONL 格式、**不要 git commit**。
- **先做 S3 再做 S4**：两者共享保留日期枚举与 IPC 改动，但业务函数分开。
- 归一化用 `src/shared/stories.ts` 的 `normalizeTitle`，项目匹配用 `src/shared/projects.ts` 的 `matchProject`——不要新建同义模块。
- 完成时 `npm test` 与 `npm run typecheck` 都要绿。

## 允许修改的文件

- `src/main/reel/search.ts`、`src/main/reel/previous-episode.ts`（新建）
- `src/shared/types.ts`、`src/shared/ipc.ts`
- `src/main/ipc/index.ts`、`src/main/index.ts`
- `src/preload/index.ts`、`src/renderer/src/data.ts`
- `src/renderer/src/app.ts`（搜索渲染、空状态、上一集请求与跳转）
- `src/renderer/index.html`（上一集那一行）
- `tests/main/search.test.ts`、`tests/main/ipc.test.ts`、`tests/main/previous-episode.test.ts`（新建）、`tests/main/cache.test.ts`、`tests/main/store.test.ts`

## S3 检索：范围对齐与命中理由

把 `search` 的返回从 `Scene[]` 改成 `SearchOutcome`：

```ts
interface SearchReason { tokens: string[]; dates: string[] }
interface SearchHit { scene: Scene; reason: SearchReason }
type SearchCoverage = 'full' | 'partial' | 'expired'
interface SearchOutcome { hits: SearchHit[]; coverage: SearchCoverage; retainedFrom: string | null }
```

- 有 时间词 → 查解析出的日期；没有 → 最近 7 天（含今天）。
- 与保留范围取交集后再查；保留范围用 `keptDays()` 的实际结果，不写死 30 天。
- `coverage`：交集为空且目标日期全早于保留范围 → `expired`；交集少于目标日期 → `partial`；否则 `full`。`retainedFrom` = 保留范围最早日期，无数据为 `null`。
- `reason` 与匹配同一趟算出：真正命中的词（标题 / 原文 / 进程名，小写）与真正起作用的日期；只有日期时 `tokens` 为空。
- 多词 AND、排序、200 条上限、`parseQuery` 现有语义都不变。
- `src/main/index.ts` 的 search 处理里删掉"固定 7 天"这一层截断，改为按目标日期集取日文件（逐日 `rollupFor`，不要一次性全量预热）。
- 渲染层：结果列表每条加一行命中理由（`标题含 edl` / `命中 11-19`），列表顶部在 `partial` 时加一行提示；空结果用规格里那两句文案区分 `expired` 与普通空。
- `src/renderer/src/data.ts` 的 mock source 同步返回新形状（保持 `?mock=` 的现有行为）。

## S4 上一集

新增 `src/main/reel/previous-episode.ts`，纯函数 + 一个主进程查询入口：

- 锚点 = 所查看日期的 `longestShot`；没有镜头 → `null`。
- 匹配：原始 `title` 完全相同，或与锚点属于同一项目（`matchProject` 同名）。
- 范围：严格早于所查看日期的保留日期，从近到远，命中第一天即停；同一天多条取最后一条。
- 返回 `EpisodeRef { date, start, exe, title, seconds, match: 'title'|'project', project: string|null }`，无命中 `null`。
- 新增 IPC `dayfilm:previous-episode`：`previousEpisode(date) => EpisodeRef | null`。必须同时改 `src/shared/ipc.ts`（通道 + `DayfilmApi`）、`src/main/ipc/index.ts`（`GUARDED_CHANNELS` + `IpcDeps` + `createHandlers`）、`src/preload/index.ts`、`src/renderer/src/data.ts`。
- 逐日读 `DayCache`，不批量预热、不扩缓存。
- 渲染层：`index.html` 在 `#verdict` 之后、`#discoveries` 之前加 `<p class="hero__episode" id="episode" hidden></p>`；`app.ts` 在切日与设置变化时请求（**不要**挂在 2 秒 tick 上），整行可点→切到那天并选中该镜头；快速切日时用请求令牌丢弃晚到的旧响应。
- 文案：`上一集 · <MM-DD>` 换行 `<title>` + `<HH:MM> · <N 分钟>`；`match === 'project'` 时补项目名。

## 测试

- `search.test.ts`：时间词范围、多词 AND、理由内容、只有日期没有词的查询。
- `ipc.test.ts`：固定"今天"为 2026-11-27、保留 30 天，覆盖 11-26 / 11-19 / 10-29 / 10-28 / 保留期内无文件五种情况；断言 `coverage` 与 `retainedFrom`。通过真正的 search handler 入口测，不只测纯函数。
- `previous-episode.test.ts`：查看 11-20 不许命中 11-21；同名不同项目不命中；同一天多条取最后一条；未命中返回 `null`。
- `cache.test.ts`：逐日读取、命中即停。
- `store.test.ts`：保留边界与"保留期内但没有文件"两种情况的区分。

## 交付

1. 跑 `npx --no-install vitest run tests/main/search.test.ts tests/main/ipc.test.ts tests/main/previous-episode.test.ts tests/main/cache.test.ts tests/main/store.test.ts`。
2. 再跑 `npm test` 与 `npm run typecheck`。
3. 写 `docs/delegate/v4-status-p2.md`：改了哪些文件、测试结果、IPC 契约变更、没解决的问题。
4. 明确一句：S3 的窗口截断是否已从"固定 7 天"改为"按目标日期集"，并指出改动所在函数。
