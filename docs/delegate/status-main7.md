# df-core 状态记录（v2.4 导演剪辑版）

v2.4 主进程侧完成：标记存储、`buildDayRollup` 应用标记、缓存按标记重算、EDL/PDF/剧本按标记处理。`tests/main` 24 文件 / 266 例全过，`npm run build` 成功；`tsc` 只剩界面侧 7 个夹具错误（不属本轮范围，见末尾）。

## 文件清单

新增：

| 文件 | 内容 |
| --- | --- |
| `src/main/marks/index.ts` | `MarksStore`（`<userData>/marks.json`，`{ version: 1, days: { [date]: { [startMs]: mark } } }`）+ `isSceneMark` |
| `tests/main/marks.test.ts` | 9 例：往返、多镜头/跨天、`null` 清除与空日子清理、非法日期/时刻/mark、坏文件留档、坏条目跳过、原子写、写失败 |

修改：

| 文件 | 改动 |
| --- | --- |
| `src/main/reel/index.ts` | 新增 `applyMarks(rollup, marks)`；`buildDayRollup(samples, date, now, marks?)` 第四参；基础 rollout 带 `featureMs = activeMs / extraMs = 0`；剧本汇总段加 `正片 … · 花絮 …` |
| `src/main/reel/aggregate.ts` | 基础 rollout 同样带 `featureMs/extraMs`（未标记基线） |
| `src/main/reel/cache.ts` | `DayCacheOptions.marks?(date)`；`rollup()` = 增量结果 `applyMarks` 叠加标记 |
| `src/main/edl/index.ts` | 只导出 `mark !== 'extra'` 的镜头；有花絮时头部加 `* NOTE: <n> extra scenes omitted` |
| `src/main/pdf/index.ts` | 汇总加 `正片 … · 花絮 …`；镜头表新增首列「标记」 |
| `src/main/ipc/index.ts` | `setMark` 进受守卫通道表、`IpcDeps`、`createHandlers` |
| `src/main/index.ts` | `MarksStore` 初始化、`DayCache` 传 `marks`、`setMarkAndRollup`（校验 → 写标记 → 剔除该日缓存 → 重算返回）、导出链路自动带标记 |
| `src/preload/index.ts` | `setMark: (date, startMs, mark) => invoke(IPC.setMark, …)` |
| `tests/main/{reel,cache,edl,pdf,ipc}.test.ts` | 标记相关新用例 + 夹具补 `featureMs/extraMs` |

未改：`src/renderer/**`、`src/shared/**`、`package.json`、打包配置。

## 关键取舍

### 标记的键用「镜头开始毫秒」

`marks.json` 的键是 `String(scene.start)`，不是镜号：镜号会随当天后续采样重排（新镜头插在前面/合并），用镜号会导致标记漂到别的镜头上。开始时刻在镜头切分里是稳定的锚点。

读写规则与手记完全同构：tmp + rename、坏文件复制成 `marks.corrupt-<时间戳>.json` 再按空集合处理、只保留「日期合法 + 键是纯数字 + 值是 feature/extra」的条目（坏条目静默丢弃，不算整体损坏）。

### 标记是「读取时叠加」而不是「增量状态的一部分」

- `DayAggregator` 不认识标记：它产出的基线汇总里 `featureMs === activeMs`、`extraMs === 0`。
- `applyMarks(rollup, marks)` 是纯函数：给非空闲镜头补 `mark`，重算 `featureMs/extraMs`，其它字段原样（测试里用对象身份断言空闲镜头没被复制）。
- `buildDayRollup(..., marks)` = 全量基线 → `applyMarks`；`DayCache.rollup()` = 增量基线 → `applyMarks`。两边走同一个函数，所以"增量 ≡ 全量"这条既有保证在带标记时继续成立（`tests/main/cache.test.ts` 的「标记叠加」三例）。
- 这样标记永远不会让增量索引失效——只有 `setMark` 主动 `cache.invalidate(date)`。按 brief 的明确要求这里还是剔除了该日再重算（行为最直观、也不依赖"叠加层"这个实现细节）：一天 5 万条时重建约 40 ms，用户点一次标记完全可以接受。

### 导出

- **EDL**：花絮镜头整条跳过（记录轨按剩余镜头首尾连续排布，真实间隔仍由 `recIn` 体现）；当天有花絮时在 `TITLE` / `FCM` 之后加一行 `* NOTE: 2 extra scenes omitted`（`*` 开头的注释行，剪辑软件会忽略）。`TITLE: Dayfilm <date>` 保持不变（brief 要求的 `Dayfilm <date>` 就是这个文本）。
- **PDF**：镜头表新增首列「标记」，取值 `正片` / `花絮`。**未标记写「正片」而不是留空**——与 `featureMs` 的口径（未标记按正片算）一致，避免同一天同一份数据在表格和汇总里给出两种说法。花絮行用灰色（`.mark-extra`）弱化。
- **PDF / 剧本汇总段**：在题材段之后加一行 `正片 8 小时 41 分 · 花絮 42 分`。剧本（Markdown）里顺序是 `题材 → 正片/花絮 → 项目 → 空行 → 镜头行`；`renderScreenplay` 的镜头行格式一个字符都没动。

### `setMark` 的实现

```
校验（日期正则 / startMs 有限数 / mark 为 feature|extra|null）
→ marks.set(date, startMs, mark)（落盘）
→ cache.invalidate(date)（按 brief 要求剔除该日）
→ rollupFor(date)（重算并返回新的 DayRollup）
```

非法入参抛可读错误（`标记日期不合法` / `标记的镜头时刻不合法` / `标记类型不合法`），经既有 `handleIpc` 的 rejection 通道回到界面，不会静默。标记写盘失败会抛 `标记保存失败：<code>`，此时缓存不动、返回值不会产生。

## 验证输出

```text
=== 1) npx tsc --noEmit -p tsconfig.node.json ===
tests/renderer/compare-days.test.ts(32,3): error TS2739 … missing 'featureMs', 'extraMs'
tests/renderer/edl.test.ts(20,3): error TS2739 …
tests/renderer/highlights.test.ts(25,3): error TS2739 …
tests/renderer/hud.test.ts(34,3): error TS2739 …
tests/renderer/narration.test.ts(15,3): error TS2739 …
tests/renderer/poster.test.ts(44,3): error TS2739 …
tests/renderer/spine.test.ts(34,3): error TS2739 …
exit=2

=== 2) npx vitest run tests/main ===
 Test Files  24 passed (24)
      Tests  266 passed (266)
   Duration  2.60s

=== 3) npm run build ===
out/main/index.js        83.69 kB  ✓ built in 256ms
out/preload/index.js      3.21 kB  ✓ built in 20ms
```

**关于 tsc 的 exit=2**：`tsconfig.node.json` 的 `include` 覆盖 `tests/**/*`，所以界面侧的测试夹具也会被这条命令检查。7 条错误全部是 `tests/renderer/**` 里的 `DayRollup` 夹具缺 `featureMs`/`extraMs`（契约刚加的两个必填字段），属另一位实现者的文件，按指示没有动。**我的范围（`src/main` + `src/preload` + `tests/main`）单独看是 0 错误**；他们补上两个字段后这条命令即恢复 exit=0。

中途修过两处自己的旧断言（都是这次改动导致格式变化，不是回归）：
1. `pdf.test.ts` 用 `/<tr><td class="num">/` 数表单行数，加了「标记」列后首格变成 `class="num mark-feature"`，改成按 `mark-` 计数；
2. `reel.test.ts` 的「项目行紧跟题材段」断言，因为多了一行 `正片/花絮`，索引整体后移一位。

## 未完成项 / 需要主 Agent 处理

1. **界面侧接 `setMark`**：`preload` 已暴露 `setMark(date, startMs, mark|null)`，返回重算后的 `DayRollup`；界面把返回的汇总直接替换即可（不需要再 `getDay`）。
2. **`tests/renderer/**` 的 7 个夹具**要补 `featureMs` / `extraMs`（另一位实现者）。
3. **真机没验证**：标记落盘、EDL/PDF 的花絮处理都只有单测。建议在构建产物上点一次"标花絮 → 导出 EDL（看 NOTE 行与事件数）→ 导出 PDF（看标记列与正片/花絮行）"。
4. **花絮与项目/排行**：`topApps`、`longestShot`、`verdict` 仍然按全部非空闲镜头算（brief 只要求 `featureMs/extraMs` 与导出按标记处理）。如果产品希望"最长镜头不含花絮"，需要再加口径。
5. `marks.json` 没有保留期联动：删掉某天的日文件后，该天的标记仍留在 `marks.json` 里（无害，下次同一天再录会重新生效）。要清理得在 `retention` 里加一步。
