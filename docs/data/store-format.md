# 本地数据格式

## 目录

```text
%APPDATA%\dayfilm\
  days\
    2026-11-22.jsonl
    2026-11-21.jsonl
  settings.json
  window-state.json
```

## 日文件

- 编码 UTF-8，每行一个 JSON 对象，行尾 `\n`。
- 行内字段与 `Sample` 一致：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `t` | number | 采样时刻，Unix 毫秒；由主进程在收到采样行时打点，不由采集脚本输出 |
| `exe` | string | 前台进程名，去除 `.exe` |
| `title` | string | 前台窗口标题原文，最长保留 512 字符 |
| `idleMs` | number | 距最后一次用户输入的毫秒数 |

示例：

```json
{"t":1763779200000,"exe":"Code","title":"dayfilm - Visual Studio Code","idleMs":1200}
```

## 规则

- 日文件只追加；进程重启后继续追加到同一文件。
- 读取时跳过无法解析的行，不中断整日加载。
- 日期取采样时刻的本地日期（本地时区，不用 `toISOString()`）；跨天时自动写入新文件。
- 镜头是派生数据，不落盘。

## 设置文件

`settings.json` 保存用户设置，字段与 `Settings`（`src/shared/settings.ts`）一致：

```json
{ "retentionDays": 30, "redactTerms": ["招行"], "autoStart": false, "paused": false }
```

- 文件缺失或损坏时使用 `DEFAULT_SETTINGS`，并重建文件；单字段类型不符时按字段回落默认值。
- 写入采用"写临时文件 + 重命名"，避免半截文件。

## 手记文件

`notes.json` 保存每天的导演手记：

```json
{ "version": 1, "notes": { "2026-11-22": "今天的长镜头很好。" } }
```

- 键为本地日期 `YYYY-MM-DD`，值为不超过 200 字的纯文本。
- 写入采用"写临时文件 + 重命名"；文件损坏时按空集合处理，不阻塞启动。

## 变更

字段只增不删。读取方对未知字段忽略，对缺失的可选字段使用默认值。
