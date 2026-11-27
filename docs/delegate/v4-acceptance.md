# v4 独立验收（P4）

## 1. 结论

**有条件就绪**：S1–S6 的行为与规格文字一致、713 项测试与类型检查全绿；但 S2 的界面口径有两处偏离（子计数不在「剪辑数」下、文案不是 `跨应用 X · 应用内 Y`，mock 演示源恒显示 `0 / 0`），且规格点名的两条验收测试（晚到请求不覆盖、渲染层观察行）缺席。

## 2. 命令结果

- `git status --porcelain` + `git diff --stat` → 35 个已跟踪文件被改（+2124 / −228）、53 个未跟踪文件、0 个已暂存；`HEAD` 仍是 `4369124`，**无 git 提交**。
- `npm test` → **55 文件 / 713 用例全过**，失败清单：无。
- `npm run typecheck` → `tsc -p tsconfig.node.json` 与 `-p tsconfig.web.json` 均 exit 0，**0 错误**。
- 附带只读检查：`resources/capture.ps1` PowerShell 解析 0 错误、非 ASCII 字节 0；`npx vitest run` 复跑本轮 10 个相关测试文件（145 用例）全过。

## 3. 改动范围核对

工作区是「v2.6.0 提交 + v3 未提交 + v4 未提交」叠在一起的一堆未暂存改动，git 无法按轮次切分；下表按 v4 规格的文件归属逐项对账。

| 分类 | 文件 |
| --- | --- |
| 归属表内（P1） | `resources/capture.ps1`、`src/main/reel/transition.ts`（新）、`src/main/reel/index.ts`、`src/main/reel/aggregate.ts`、`src/main/index.ts`、`src/shared/types.ts`、`src/renderer/src/app.ts`、`tests/main/{capture,reel,aggregate,pipeline}.test.ts`、`tests/renderer/hud.test.ts` |
| 归属表内（P2） | `src/main/reel/search.ts`（新）、`src/main/reel/previous-episode.ts`（新）、`src/shared/{types,ipc}.ts`、`src/main/ipc/index.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/{data,app}.ts`、`src/renderer/index.html`、`tests/main/{search,ipc,previous-episode,cache,store}.test.ts` |
| 归属表内（P3） | `src/renderer/src/lib/day-insights.ts`（新）、`src/renderer/src/app.ts`、`src/renderer/index.html`、`tests/renderer/{day-insights,discover}.test.ts` |
| **越界（属本轮）** | `src/renderer/src/style.css:5252-5276`：v4 的 `.hero__episode` / `.hero__intermission` 样式；`style.css` 不在 v4 文件归属表里。良性，但需确认（P2 原本把这两条样式写在 `index.html` 内联，现已迁走）。 |
| 越界（不属本轮，v3 未提交遗留） | `package.json`（3.0.0 + `openai@^7.62.0`）、`package-lock.json`、`src/main/ai/**`、`src/main/settings/index.ts`、`src/shared/{settings,stories}.ts`、`src/renderer/src/lib/discover.ts`、`tests/main/settings.test.ts`、`tests/main/suggest.test.ts`、`tests/renderer/discover.test.ts`、`docs/agents/adr/0005-model-channel.md`、`docs/specs/dayfilm-v3.md`、`scripts/probe-{design,v3,v3-model}.mjs`、`docs/product/assets/*-v3*.png`、`DESIGN.md`、`PRODUCT.md`、`README.md`、`docs/{architecture/dayfilm,product/dayfilm}.md`、`docs/specs/INDEX.md`、`docs/data/store-format.md`（仅 `settings.ai`） |
| 文档同步（与实现一致） | `docs/api/ipc-contract.md`：已补 `SearchOutcome` 与 `dayfilm:previous-episode`（P2 遗留 #4 已补齐） |
| 未改动 | `src/main/capture/**`、`src/main/store/**`、`src/main/edl/**`、`src/main/reel/rules.ts`、`src/renderer/src/mock.ts`、`src/renderer/src/lib/{discover,projection,week-film,poster}.ts`、`src/main/pdf/**` |

## 4. 规格逐条核对

| 项 | 结论 |
| --- | --- |
| S1 无前台窗口 | **通过**。`capture.ps1:85-108` 无前台窗口时输出 `ok:true` + 空 `title`/`exe`；`transition.ts:15-22` 的 `isAway`/`sceneKindOf` 让 away 直接算中场休息；`reel/index.ts:52`、`aggregate.ts:60`、`reel/index.ts:77` 三处（`groupRuns` / `append` / `liveScene`）共用同一判断，`main/index.ts:163` 转调 `liveScene`；合法采样照旧清 `captureError`（`capture/index.ts:172-173`），真脚本异常仍是错误（`capture.ps1:147`）。away 不生成 shot、不进 `topApps`、不计 `activeMs`、不把前后镜头连成一条（`reel.test.ts` 两条用例 + `pipeline.test.ts` 一条）。 |
| S2 剪辑子计数 | **偏离（`src/renderer/index.html:224-226`、`src/renderer/src/app.ts:881-883`、`src/shared/types.ts:62-65`）**。计数本身正确：`reel/index.ts:185-192` 与 `aggregate.ts:85-99` 都写成 `cuts = appCuts + withinAppCuts`，`judge()`（`rules.ts:31-38`）仍只吃 `cuts`，3/8/20 档未动，中场休息不参与。偏离在界面与类型：新行落在三列 `.stats` 网格之后（不是「剪辑数」正下方），文案是 `跨应用 / 应用内` + `X / Y` 而非规格的 `跨应用 X · 应用内 Y`；且两个字段在类型上可选、mock 源不产出（见第 6 节 1、2）。 |
| S3 检索 | **通过**。`main/index.ts:346` 已改为 `searchOutcome(query, { retained: keptDays, day: rollupFor })`，`SEARCH_DAYS` 截断已删除；`search.ts:233-249` 以「时间词目标日期」或「最近 7 天」与保留范围下界取交后逐日读，`coverage` 三态（`full`/`partial`/`expired`）与 `retainedFrom`（无数据 `null`）都可达且被 `search.test.ts`、`ipc.test.ts` 覆盖；`reason.tokens`/`reason.dates` 与匹配同一趟算出，多词 AND、排序、200 上限、空查询 `full` 均保持。口径说明：保留范围按「最早一天往后」的范围取交（保留期内无日文件的日期算 `full` + 0 命中），与 S3.5「保留范围内最早的日期」一致，`ipc.test.ts` 用 11-20 固定了这一取法。 |
| S4 上一集 | **通过**。`previous-episode.ts:45-58` 以 `longestShot` 为锚点、`filter((item) => item < date)` 严格排除当天及更晚、从近到远命中即停；`lastEpisodeOf`（同文件 18-40）按原始 `title` 完全相同或 `matchProject` 同名，同一天取最后一条；`previous-episode.test.ts` 7 条覆盖了「更晚一天同标题不命中」「同日多条取最后一条」「同名不同窗口不命中」。IPC 全链登记（`shared/ipc.ts:11,36`、`main/ipc/index.ts:15,90,114`、`preload/index.ts:11`、`data.ts:22,69`），渲染行在 `#verdict` 之后（`index.html:103-104`），`app.ts:1684-1697` 用请求令牌丢弃晚到响应，且不在 2 秒 tick 链上。 |
| S5 镜头之后 15 分钟 | **通过**。`day-insights.ts:35-63`：窗口 `start >= anchor.end && start < anchor.end + 15 分钟`（半开，边界镜头不计），只收 `kind === 'shot'`（排除中场休息），按归一化标题分组、按镜头条数计数、次数降序 → 首次出现升序、最多 3 组；无后续镜头返回 `null`。渲染在 `app.ts:1213-1263`，`#discoveries` 末尾固定追加一行，原有 3 条发现（`DISCOVERY_LIMIT`）不动，总数 ≤ 4。 |
| S6 中场休息的形状 | **通过**。`day-insights.ts:66-91` 取最长一般中场休息（等长取更早），`before.exe === after.exe && before.title === after.title` 两者都比才 `returned`，`exe` 同 `title` 不同判 `changed` 并取后一条 `exe`，其后无镜头为 `unknown` / `nextExe: null`；三种文案见 `app.ts:802-813`，`#intermission` 在 `#episode` 之后、只读无监听（`index.html:104-106`）。 |

补充（不影响上表结论的书面差异）：S1 判定位置写的 `liveScene`（`src/main/index.ts`）实际落在 `src/main/reel/index.ts:77` 并由 `main/index.ts:36` 导入，行为与签名一致；`isAway` 只被 `sceneKindOf` 调用，没有直接调用方。

## 5. 回归风险（三条）

1. **主进程同步逐日读盘 — 不安全（性能）**：`previousEpisode`（`previous-episode.ts:45-58`）最多读 30 天、`searchOutcome` 对「上上周」等多日期查询（`search.ts:236-249`）最多读 14 天以上，全部在 IPC handler 里同步执行。按 bench 实测（单日 5 万条 78 ms 读 + 14 ms 建索引），冷缓存最坏可到 2 秒量级，期间窗口无响应。这两个入口都不在 `tests/perf/bench.test.ts` 的覆盖内（bench 只测 `searchScenes`），测试用的又都是内存假 source，所以既没有断言也没有实测数据。
2. **`?mock=` 演示面 — 不安全**：`mock.ts:87-125` 生成 `DayRollup` 时没有 `appCuts`/`withinAppCuts`，`app.ts:883` 的 `?? 0` 兜底让它恒显示 `0 / 0`；`data.ts:228-251` 的 mock search 仍是旧子串匹配（恒 `coverage: 'full'`、`reason.dates` 恒空）。设计走查看到的 S2/S3 与生产不符，而渲染层没有测试床，问题不会被测试发现。
3. **既有读 `cuts` 的地方 — 安全**：放映态自己按镜头序号数剪辑（`lib/projection.ts:143-153`，不读 `day.cuts`）；HUD（`lib/hud.ts:149`）、海报（`lib/poster.ts:341`）、PDF（`main/pdf/index.ts:167`）、剧本（`main/reel/index.ts:257`）、周电影（`lib/week-film.ts:218`）都只读总数，而本轮明确保持 `cuts` 总数语义不变（改动只是把它拆开再相加），EDL 只读 `kind`/`mark`（`main/edl/index.ts:74-77`）。唯一的口径裂缝是既有的 `week-film.ts:173-175`：有花絮时用「正片镜头数 − 1」重算剪辑，隔着中场休息的同一窗口会被多算一次——本轮没动它，不是回归，但也没有测试把两套口径钉在一起。

## 6. 必须修的问题

1. **（中）S2 界面口径不符规格**：`src/renderer/index.html:224-226` + `src/renderer/src/app.ts:881-883` 把子计数做成网格之后独立一行、文案 `跨应用 / 应用内` + `X / Y`；规格要求「在「剪辑数」下加一行 `跨应用 X · 应用内 Y`」。
2. **（中）S2 子计数在演示源里缺失**：`src/renderer/src/mock.ts:87-125` 的 `rollup()` 不产出 `appCuts`/`withinAppCuts`，`?mock=` 下这行恒为 `0 / 0`；根因是 `src/shared/types.ts:62-65` 把两字段做成可选（规格与「变更」节要求 `DayRollup` 增加这两个字段）。修法是补 mock 并把字段改为必填、给 13 处范围外夹具补 `0`。
3. **（中）规格点名的验收测试缺席**：S4「晚到请求不覆盖新结果」只有实现（`src/renderer/src/app.ts:1684-1697`），无断言；S5/S6 的「两个观察可独立出现/隐藏」「总条数 ≤ 4」「partial 提示行」也只有纯函数测试，`app.ts` 没有渲染层测试床。
4. **（低）命中理由文案会误报**：`src/renderer/src/app.ts:1005` 恒写 `标题含 <词>`，而 `search.ts:190-201` 允许进程名或原始标题命中，例如搜 `msedge` 时标题里并没有这个词。
5. **（低）越界改动需确认**：`src/renderer/src/style.css:5252-5276` 新增 v4 的 `.hero__episode` / `.hero__intermission`，该文件不在 v4 文件归属表内（样式本身与 `index.html` 的 DOM 匹配，无副作用）。
6. **（低）交付纪律的两条如实记录**：JSONL 字段集确实未变（`src/main/capture/**`、`src/main/store/**` 无改动，`docs/data/store-format.md` 只改了 `settings.ai`）；但工作区的 `package.json` 有变化（`3.0.0` + `openai@^7.62.0`），来自 v3 而非 v4——v4 自身没有新增依赖，需要的人在提交边界上把两轮分开。

## 7. 报告后的修复（主 Agent，2026-11-27 18:5x）

| 报告项 | 处理 |
| --- | --- |
| 6.1 S2 文案与位置 | 改为一格一行：`跨应用 X · 应用内 Y`，落在三列数字正下方（`index.html` 的 `#statCuts`，`.stats__line`） |
| 6.2 mock 缺子计数 | `mock.ts` 的 `rollup()` 按相邻镜头算出 `appCuts` / `withinAppCuts`；`?mock=` 不再恒为 `0 / 0` |
| 6.4 命中理由文案 | `标题含 X` → `命中 X`（进程名或原文命中时不再谎称标题），日期改称 `日期 MM-DD` |
| 6.5 越界改动 | `style.css` 与 `mock.ts` 已补进规格「文件归属」表 |
| 4 回归风险 1（同步逐日读盘） | 未修：规格接受该代价，仅记录 |
| 6.3 渲染层测试缺席 | 未修：`app.ts` 没有 DOM 测试床；纯函数层（`day-insights`）已覆盖 |

复核：`npm test` 55 文件 / 713 用例全过，`npm run typecheck` 零错误。
