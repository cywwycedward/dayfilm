# 任务说明书：v2.6 自动花絮规则与导出适配（df-core）

## 目标

给"导演剪辑版"补上自动规则：短于阈值的镜头在汇总里自动算花絮（不写进 marks.json，属于派生规则），并让 EDL/PDF、周数据沿用同一口径。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main8.md`

不要改 `src/renderer/**`、`src/shared/**`、`package.json`、打包配置。

## 已更新的契约

- `src/shared/settings.ts`：`Settings` 新增 `autoExtraUnderSec: number`（默认 0 = 关闭）与 `sound: { mode: 'projector' | 'cuts'; volume: number }`（默认 `{ mode: 'projector', volume: 0.35 }`）；新增 `AUTO_EXTRA_OPTIONS`。
- `src/shared/types.ts`：`Scene.markSource?: 'manual' | 'auto'`。

## 必须实现

### 1. 设置归一

- `autoExtraUnderSec` 只接受 `0 / 3 / 10 / 30`，其它值回落到上一份合法值。
- `sound.mode` 只接受 `'projector' | 'cuts'`；`sound.volume` 夹到 `0..1`（两位小数）。
- 单测覆盖：非法值回落、音量夹紧、模式非法。

### 2. 自动花絮规则

- `buildDayRollup` 增加选项参数（保持现有位置参数兼容）：`{ marks?, autoExtraUnderSec? }`。
- 规则：非空闲镜头中，**没有手动标记**且 `seconds < autoExtraUnderSec` 时，视为 `mark: 'extra'`、`markSource: 'auto'`；手动标记优先（`markSource: 'manual'`）。
- `featureMs` / `extraMs` 按同一口径计算。
- `DayAggregator` / `DayCache` 要能带上这个规则；`setSettings` 修改 `autoExtraUnderSec` 后当日缓存必须失效。
- 单测：阈值边界（3 秒正好、3.1 秒）、手动标记优先于自动、关闭时行为不变。

### 3. 导出适配

- EDL：自动花絮同样不导出（与手动一致），注释行说明 `N extra scenes omitted`。
- PDF：正片/花絮汇总按同口径；镜头表标记列对自动花絮写「花絮（自动）」。

### 4. 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

不要跑 `npm run dev`。完成后写状态文件并结束本轮。
