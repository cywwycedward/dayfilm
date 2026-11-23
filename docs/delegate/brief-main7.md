# 任务说明书：v2.4 导演剪辑版（df-core）

## 目标

实现"导演剪辑版"：用户可以把某个镜头标成**花絮（extra）**或**正片（feature）**，未标记按正片算；当日汇总给出「正片时长 / 花絮占位」，EDL 与 PDF 导出按标记处理。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main7.md`

不要改 `src/renderer/**`、`src/shared/**`、`package.json`、打包配置。

## 已更新的契约

- `src/shared/types.ts`：新增 `SceneMark = 'feature' | 'extra'`；`Scene.mark?: SceneMark`；`DayRollup` 新增 `featureMs` 与 `extraMs`（毫秒）。
- `src/shared/ipc.ts`：新增 `setMark` 通道与 `DayfilmApi.setMark(date, startMs, mark | null): Promise<DayRollup>`。

## 必须实现

### 1. 标记存储（`src/main/marks/index.ts`）

- 文件 `<userData>/marks.json`，结构 `{ version: 1, days: Record<string, Record<string, SceneMark>> }`，键是**镜头开始时刻的毫秒字符串**（不要用镜号，镜号会随当天新数据变动）。
- 写入用 tmp + rename；损坏文件按空集合处理并把原文件保留成 `marks.corrupt-<时间戳>.json`。
- `set(date, startMs, mark)`：`mark === null` 删除该键；空日期键顺手删掉。
- 单测：往返、清除、坏文件、原子写、非法日期/非法 mark。

### 2. 应用到汇总

- `buildDayRollup` 增加可选参数 `marks?: Record<string, SceneMark>`（第三个 `now` 之后追加第四参，保持向后兼容）。
- 命中 `scene.start` 的标记写进 `scene.mark`；`featureMs` = 未标记 + feature 的镜头时长之和，`extraMs` = extra 之和。
- 增量聚合（`DayAggregator`）与缓存（`DayCache`）也要接受标记：标记变化后对应日期的缓存必须失效重算。最简单的做法：`setMark` 之后把该日期从缓存剔除并重算一次，返回新的 `DayRollup`。
- 单测：有标记/无标记、featureMs + extraMs 与 activeMs 的关系、标记变化后重算一致。

### 3. 导出

- **EDL**：只导出**非花絮**（未标记与 feature）的镜头；`TITLE` 行改为 `Dayfilm <date>`；若当天存在花絮，追加一行注释 `* NOTE: <n> extra scenes omitted`。
- **PDF/剧本**：汇总段增加「正片 8 小时 41 分 · 花絮 42 分」；镜头表每行前加一列「标记」，取值「正片 / 花絮 / 」（未标记留空或写正片，自行决定并写进状态文件）。

### 4. 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

不要跑 `npm run dev`。完成后写状态文件并结束本轮。
