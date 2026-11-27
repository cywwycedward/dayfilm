# v4 P1 状态记录（S1 无前台窗口、S2 剪辑子计数）

## 文件清单

| 文件 | 改动 |
| --- | --- |
| `resources/capture.ps1` | `GetForegroundWindow()` 为 0 时输出合法采样 `{"ok":true,"title":"","exe":"","idleMs":<实际值>}`；仍为 ASCII-only |
| `src/main/reel/transition.ts`（新建） | `sameWindow`、`isAway`、`sceneKindOf`、`transitionOf`，窗口身份与切换判定的唯一实现 |
| `src/main/reel/index.ts` | `groupRuns` 改用 `sceneKindOf` / `sameWindow`；剪辑拆成 `appCuts` / `withinAppCuts`；`liveScene` 从 `main/index.ts` 移入并导出 |
| `src/main/reel/aggregate.ts` | `append` 改用 `sceneKindOf` / `sameWindow`；封存与尾部推演都用 `transitionOf` 记两个子计数 |
| `src/main/index.ts` | 删除本地 `liveScene`，改从 `./reel` 导入；采样状态逻辑未改（合法采样本来就会清 `captureError`） |
| `src/shared/types.ts` | `DayRollup` 增加 `appCuts` / `withinAppCuts`（可选，见下） |
| `src/renderer/src/app.ts` | 右栏统计加一行「跨应用 / 应用内」→ `X / Y` |
| `tests/main/capture.test.ts` | 空窗口解析、合法 away 采样清错误；错误用例改用现在真实存在的 `snapshot failed` |
| `tests/main/reel.test.ts` | away 不成镜头/不进 `topApps`/不计 `activeMs`；子计数与和；既有题材边界加 `appCuts`/`withinAppCuts` 断言 |
| `tests/main/aggregate.test.ts` | 固定序列的全量与增量深度相等（含 away 与两个子计数） |
| `tests/main/pipeline.test.ts` | `liveScene` 与尾部 rollup 镜头深度相等；away 时实时镜头为 null、rollup 只多一段中场休息 |
| `tests/renderer/hud.test.ts` | away 状态（`scene: null`、`captureError: null`）是 `idle`，不是 `error` |

没有改动列表之外的实现文件；工作区里原有的 v3 未提交改动保持原样，未执行 git commit。

## 测试结果

```text
npx --no-install vitest run tests/main/capture.test.ts tests/main/reel.test.ts tests/main/aggregate.test.ts tests/main/pipeline.test.ts tests/renderer/hud.test.ts
→ 5 files / 87 tests passed

npm test
→ 53 files / 680 tests passed（基线 672，新增 8 例）

npm run typecheck
→ tsconfig.node.json + tsconfig.web.json 均通过（exit 0）
```

`resources/capture.ps1` 未执行（常驻循环），只做了 PowerShell 解析器语法检查与 ASCII-only 字节检查，均通过。

## 契约变更

- 采集协议：无前台窗口由 `{"ok":false,"error":"no foreground window"}` 改为合法采样（`title`、`exe` 为空串），JSONL 字段集与格式不变；真正的脚本异常仍走 `{"ok":false,...}`。
- `DayRollup` 增加 `appCuts`、`withinAppCuts`；`cuts` 仍等于两者之和，`judge()` 的三档边界继续只用 `cuts`。
- `liveScene` 从 `src/main/index.ts` 移到 `src/main/reel/index.ts` 并导出，便于整链测试；签名与返回形状不变。
- 渲染层右栏统计多一行子计数，不加卡片/图表。

## 遗留

- `appCuts` / `withinAppCuts` 在类型上是可选的：13 个范围外的 `DayRollup` 字面量夹具（含 `src/renderer/src/mock.ts`）在必填时会令 `npm run typecheck` 失败；三个生产出口始终写满字段，渲染层按 0 兜底。副作用是 mock 模式这一行显示 `0 / 0`。
- 新统计项落在现有 3 列 `.stats` 网格的第 2 行第 1 格，不在「剪辑数」正下方；调整需要改 `style.css`（不在本轮文件清单内）。
- capture 脚本只做了静态检查，锁屏/安全桌面下的真实输出未在真机验证。
- 既有夹具的 `cuts` 总数与改前完全一致：`reel.test.ts` 的 0/2/3/7/8/20/21 次剪辑题材边界及其它原有 `cuts` 断言全部未改且通过，拆分只发生在 `appCuts` / `withinAppCuts`。
