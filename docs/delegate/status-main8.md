# df-core 状态记录（v2.6 自动花絮规则）

v2.6 主进程侧完成：两个新设置字段的归一、自动花絮规则（汇总/缓存/导出同一口径）。`tests/main` 24 文件 / 283 例全过，`npm run build` 成功；`tsc` 我的范围 0 错误。

## 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/main/settings/index.ts` | 新增 `normalizeAutoExtra`（只认 0/3/10/30）与 `normalizeSound`（`mode` 白名单、`volume` 夹到 0..1 并保留两位小数），并接进 `normalizeSettings` / `update` |
| `src/main/reel/index.ts` | 新增 `isAutoExtra(ms, sec)`、`RollupOptions`；`applyMarks(rollup, marks, autoExtraUnderSec)` 支持自动规则与 `markSource`；`buildDayRollup(samples, date, now, options?)` |
| `src/main/reel/cache.ts` | `DayCacheOptions.autoExtraUnderSec?()`；`rollup()` 把标记与阈值一起叠加 |
| `src/main/index.ts` | `DayCache` 传 `autoExtraUnderSec: () => settings.get().autoExtraUnderSec`；`applySettings` 里阈值变化时 `cache.invalidate()` |
| `src/main/pdf/index.ts` | 标记列对自动花絮写「花絮（自动）」，手动写「花絮」，未标记写「正片」；样式 class 按前缀判断 |
| `tests/main/{settings,reel,cache,pdf,edl}.test.ts` | 新字段归一、`isAutoExtra` 边界、自动规则走 `buildDayRollup`/`DayCache`、PDF 自动标签、EDL 自动花絮不导出 |

未改：`src/renderer/**`、`src/shared/**`、`package.json`、打包配置、`src/main/marks`（标记存储不用改，自动规则不落盘）。

## 关键取舍

### 设置归一

- `autoExtraUnderSec` 只认 `AUTO_EXTRA_OPTIONS` 里的 `0/3/10/30`，其它值（含 `'10'`、`NaN`）回落到上一份合法值；`update` 走同一函数，所以补丁里的坏值不会把已有设置洗掉。
- `sound.mode` 只认 `projector/cuts`；`sound.volume` 先夹到 `[0,1]` 再 `round(x*100)/100`（两位小数），非有限数回落。`sound` 不是对象时整体回落，缺字段时逐字段保留（只改音量不会把模式重置）。
- 这两条都在 `normalizeSettings` 与 `SettingsStore.update` 两处生效：读文件时坏值修好写回，补丁时坏值不生效。

### 自动花絮：毫秒比较，不是 `Scene.seconds`

brief 写的是 `seconds < autoExtraUnderSec`，但 `Scene.seconds` 是四舍五入过的（3.4s → 3），拿它比会让 3.4s 在"3 秒以下"里被判成正片。实现用**毫秒严格小于**：`ms < autoExtraUnderSec * 1000`。于是：

- 阈值 3：3.0s 镜头不算（`3000 < 3000` 为假）；而 3s 以下的镜头本来就被 `MIN_SHOT_MS` 丢掉了，所以阈值 3 实际等同于关闭——和 `AUTO_EXTRA_OPTIONS` 里 `3 秒以下` 的文案一致。
- 阈值 10：9999ms 算、10000ms 不算（`isAutoExtra` 的单测直接钉这两个数）。

规则只作用于 `kind === 'shot'` 的镜头；中场休息永远不带标记。

### 手动优先与 `markSource`

- 手动 `extra` → `mark: 'extra', markSource: 'manual'`
- 手动 `feature` → `mark: 'feature', markSource: 'manual'`（显式标正片的短镜头不会被自动规则翻成花絮）
- 没有手动标记且短于阈值 → `mark: 'extra', markSource: 'auto'`
- 其余 → 不带 `mark`（按正片算，与 v2.4 一致）

`featureMs` / `extraMs` 与标记同源计算，所以恒有 `featureMs + extraMs === activeMs`（单测断言）。

### 选项参数：第四参从 marks 记录换成 options 对象

v2.4 里我给的第四参是 `marks?: Record<string, SceneMark>`；这轮 brief 明确要 `{ marks?, autoExtraUnderSec? }`。改成 options 对象后更新了全部调用点（`src/main/index.ts` 一处、`tests/main/{reel,cache}.test.ts` 共 5 处）。前三个位置参数（`samples` / `date` / `now`）没变，其它调用方（如 `bench.test.ts`）不受影响。

### 缓存与失效

- 标记与阈值都以"读取时叠加"的方式进 `DayCache.rollup()`（`applyMarks(aggregator.rollup(now), marks, threshold)`），所以增量状态不需要知道它们；带阈值时"增量 ≡ 全量"仍成立（`tests/main/cache.test.ts` 用同一个函数对比）。
- 按 brief 要求，`setSettings` 改了 `autoExtraUnderSec` 时 `cache.invalidate()` 全清（这是全局规则，所有已加载日期都受影响）；`setMark` 只清那一天（v2.4 遗留行为）。

### 导出

- **EDL**：过滤条件是 `mark !== 'extra'`，所以自动花絮和手动花絮一样被跳过；`* NOTE: N extra scenes omitted` 的 N 也把自动花絮算进去（它数的是 rollup 里 `mark === 'extra'` 的镜头）。
- **PDF**：标记列三档 —— `正片`（未标记/手动正片）、`花絮`（手动）、`花絮（自动）`（规则命中）。未标记仍写「正片」而不是留空（v2.4 定下的口径）。

## 验证输出

```text
=== npx tsc --noEmit -p tsconfig.node.json ===
（我的范围 src/main + src/preload + tests/main：0 错误）
tests/renderer/… 2 条错误（另一位实现者的测试夹具，见下）

=== npx vitest run tests/main ===
 Test Files  24 passed (24)
      Tests  283 passed (283)
   Duration  4.15s

=== npm run build ===
out/main/index.js        86.02 kB  ✓ built in 248ms
out/preload/index.js      3.21 kB  ✓ built in 14ms
```

`tsc` 的 exit 仍是 2，但错误全部落在 `tests/renderer/**`（这轮开始时是 7 条，现在剩 2 条——另外几位在同步改自己的夹具）。按约定没有动他们的文件；他们补齐后这条命令即恢复 exit=0。

## 未完成项 / 需要主 Agent 处理

1. **界面侧要接的两件事**：设置面板加「自动花絮阈值」与「放映音效（模式/音量）」两个控件，通过既有 `setSettings({ autoExtraUnderSec })` / `setSettings({ sound })` 提交即可（主进程没有新增通道）；镜头上的 `markSource` 可用于在界面区分「手动」与「自动」花絮。
2. **真机没验证**：自动规则、缓存失效、EDL/PDF 的「花絮（自动）」都只有单测。建议在构建产物上把阈值设成 10 秒、录一段短切窗口，检查汇总的正片/花絮、导出的 EDL 注释行与 PDF 标记列。
3. **`sound` 只做了存储**：主进程不播放任何声音（放映音效属界面侧 WebAudio），这里只保证归一、落盘、可回读。
4. **自动花絮不改 `topApps` / `longestShot` / `verdict`**：与 v2.4 的口径一致（只影响 `featureMs/extraMs` 与导出）。如果产品要让"最长镜头"也排除花絮，需要另定。
