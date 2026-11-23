# 本地数据格式

## 目录

```text
%APPDATA%\dayfilm\
  days\
    2026-11-22.jsonl
    2026-11-21.jsonl
  settings.json
  notes.json
  marks.json
```

四类文件职责不同：日文件是**事实**（采样），其余三个是**观点与偏好**（设置、手记、标记）。删除 `days\` 目录只丢历史影像，设置与标记还在。

## 日文件

- 编码 UTF-8，每行一个 JSON 对象，行尾 `\n`。
- 行内字段与 `Sample` 一致：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `t` | number | 采样时刻，Unix 毫秒；由主进程在收到采样行时打点，不由采集脚本输出 |
| `exe` | string | 前台进程名，去除 `.exe` |
| `title` | string | 前台窗口标题原文，最长保留 512 字符；命中脱敏词时为 `[已隐藏]` |
| `idleMs` | number | 距最后一次用户输入的毫秒数 |

示例：

```json
{"t":1763779200000,"exe":"Code","title":"dayfilm - Visual Studio Code","idleMs":1200}
```

## 规则

- 日文件只追加；进程重启后继续追加到同一文件。
- 追加前先确认文件以换行结尾：崩溃留下的半行会和下一条粘成一条坏 JSON，补一个换行就能保住恢复后的第一条。
- 读取时跳过无法解析的行，不中断整日加载。
- 日期取采样时刻的本地日期（本地时区，不用 `toISOString()`）；跨天时自动写入新文件。
- 镜头是派生数据，不落盘。
- 保留期清理只删日文件，不动设置、手记与标记。

## 设置文件

`settings.json` 保存用户设置，字段与 `Settings`（`src/shared/settings.ts`）一致：

```json
{
  "retentionDays": 30,
  "redactTerms": ["招行"],
  "autoStart": false,
  "paused": false,
  "projects": [{ "name": "Dayfilm", "terms": ["dayfilm"] }],
  "hud": { "visible": true, "x": 1536, "y": 24 },
  "autoExtraUnderSec": 0,
  "sound": { "mode": "projector", "volume": 0.35 }
}
```

- 文件缺失或损坏时使用 `DEFAULT_SETTINGS`，并把修复后的结果写回。
- 单字段类型或不合法取默认值（或上一份合法值）；损坏的原文件先复制成 `settings.corrupt-<时间戳>.json`。
- 读取时剥掉 UTF-8 BOM：PowerShell 5.1 的 `Set-Content -Encoding utf8` 会带 BOM。
- 写入采用"写临时文件 + 重命名"，避免半截文件；内容按当前定义重建，因此多出来的字段不会保留。

## 手记文件

`notes.json` 保存每天的导演手记：

```json
{ "version": 1, "notes": { "2026-11-22": "今天的长镜头很好。" } }
```

- 键为本地日期 `YYYY-MM-DD`，值为不超过 200 字的纯文本；写入时去首尾空白、去掉 `\r`、按码点截断。
- 写成空文本等于删除该天的键。
- 写入采用"写临时文件 + 重命名"；文件损坏时按空集合处理，先把原文件复制成 `notes.corrupt-<时间戳>.json`，不阻塞启动。

## 标记文件

`marks.json` 保存导演剪辑版标记：

```json
{ "version": 1, "days": { "2026-11-22": { "1763779200000": "extra" } } }
```

- 键是日期 `YYYY-MM-DD`，值是"镜头开始时刻（毫秒字符串）→ `feature` / `extra`"。
- 用开始时刻而不是镜号：镜号会随新数据变动，开始时刻不会。
- 一天标完又全部清除时，该日的键整体删掉，文件不会越滚越大。
- 未标记的镜头按正片算；标记为空、日期不合法或值不是 `feature`/`extra` 的条目在读取时跳过。
- 写入采用"写临时文件 + 重命名"；文件损坏时按空集合处理，先把原文件复制成 `marks.corrupt-<时间戳>.json`。

## 变更

字段只增不删。读取方对未知字段忽略，对缺失的可选字段使用默认值；设置与两个状态文件在写入时按当前定义重建。
