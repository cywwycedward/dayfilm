# 任务说明书：v1.1 主进程（df-core）

## 目标

给 v1.1 提供主进程侧能力：项目规则归一、导演手记存储、海报/图片保存、剧本增强。权威要求见 `docs/specs/dayfilm-v1.1.md`（R22、R23、R24、R26）。

## 可写范围

- `src/main/**`、`src/preload/**`、`tests/main/**`
- `docs/delegate/status-main3.md`

不要改：`src/renderer/**`、`src/shared/**`（主 Agent 已改好）、`package.json`、打包配置、其他文档。

## 已更新的契约（直接实现，不要改）

- `src/shared/settings.ts`：`Settings` 新增 `projects: ProjectRule[]`（`{ name, terms }[]`），`DEFAULT_SETTINGS.projects = []`。
- `src/shared/ipc.ts`：新增 `getNote` / `setNote` / `saveImage` 三个通道与对应 `DayfilmApi` 方法。
- `src/shared/projects.ts`：`matchProject(scene, rules)` 与 `totalByProject(scenes, rules)` 纯函数（界面也用它，务必复用，不要另写一套）。

## 必须实现

### 1. 项目规则归一（`src/main/settings/index.ts`）

- `projects` 最多 20 条；`name` trim 后 1–32 字符；`terms` 去空、trim、去重（大小写不敏感）、单条 ≤ 64 字符、最多 20 条；`terms` 为空的规则丢弃。
- 名称重复时保留第一条。
- 归一逻辑与现有字段保持同一风格，坏值回落到上一份合法值（不是清空全部）。
- 单测覆盖：超长名称、空关键词、重复项目名、超过 20 条、类型错误。

### 2. 导演手记（`src/main/notes/index.ts`）

- 文件 `<userData>/notes.json`，结构 `{ version: 1, notes: Record<string, string> }`；构造可注入根目录。
- 写入：`notes.json.tmp` + rename；失败抛出可读错误。
- `get(date)`：非法日期返回空串；没有记录返回空串。
- `set(date, text)`：trim、去掉 `\r`、按 200 字符截断（按 Unicode 码点计，不要切坏 emoji）；空文本删除该键；返回落盘后的内容。
- 读损坏文件按空集合处理，并把原文件保留成 `notes.corrupt-<时间戳>.json`。
- 单测覆盖：往返、截断、空文本删除、坏文件、原子写、非法日期。

### 3. 图片保存（`src/main/index.ts` 或 `src/main/save-image.ts`）

- `saveImage(defaultName, pngBase64)`：
  - 只接受 base64 字符串；解码后必须以 PNG magic（`89 50 4E 47`）开头，否则返回 `{ path: '' }`。
  - 解码后大小 ≤ 20 MB，超出返回 `{ path: '' }`。
  - `defaultName` 只取文件名部分（去掉目录分隔符与非法字符），扩展名固定 `.png`。
  - `dialog.showSaveDialog` 过滤 PNG；取消返回 `{ path: '' }`；写盘失败抛出可读错误。
- 单测覆盖：合法 PNG 成功、非法 base64、非 PNG 内容、超限、名称清洗（用假 dialog 或把纯逻辑抽成可测函数）。

### 4. 剧本增强（`src/main/reel/index.ts` + 导出路径）

- `renderScreenplay(day, options)` 扩展为可选第二参数 `{ note?: string; projects?: ProjectRule[] }`（保持向后兼容，老调用不用改）。
- 有手记时，在标题行之后加：
  ```text
  > 导演手记：<text>
  ```
- 有项目命中时，在题材段落之后加一行：`项目：A 12 分钟 · B 5 分钟`（前 3，用 `totalByProject`）。
- 镜头行格式不变。
- 导出时主进程读取当天手记与当前设置的项目规则。
- 单测覆盖：无手记/有手记、无项目/有项目、顺序与格式。

### 5. IPC 与安全

- 新通道全部走现有 `handleIpc` 守卫，并把它们加进受守卫通道表（现有测试会断言"每个通道都被包装"，漏加会失败）。
- 入参校验：日期正则、`text` 必须是字符串、`pngBase64` 必须是字符串且长度 ≤ 40 MB（base64 体积）。

## 自检

```powershell
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/main
npm run build
```

全量 `npm run typecheck` 会连带界面侧（另一位实现者正在改），失败时先确认不是你的文件。不要跑 `npm run dev`。

## 交付

`docs/delegate/status-main3.md` 写清改动、取舍、验证输出与未完成项，然后结束本轮。
