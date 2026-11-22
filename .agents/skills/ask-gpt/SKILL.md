---
name: ask-gpt
description: "向 ChatGPT 要外部裁决。agent 遇到需要决策、本地证据又定不下来的问题（方案取舍、架构选型、规范分歧、值不值得做、陌生报错怎么排查）时，用 agent-desktop 在 Edge 的指定 ChatGPT 项目里新建会话，发一条自包含提问，再用回答指导后续工作；也可以让它生成示意图。首次运行先问用户把提问放进哪个 ChatGPT 项目。"
---

# ask-gpt

需要外部裁决时，把问题自包含地发给 ChatGPT，按回答继续任务。全程用 `agent-desktop` 驱动 Edge：读无障碍树定位控件，不调接口、不传附件。先查本地证据（代码、契约、测试输出）；剩下的不确定再去问——一次提问要消耗额度、覆盖剪贴板、占用一个会话。

## 提问规范

一条消息说完。GPT 只能看到你写进正文的内容。

- **自包含。** 把裁决需要的材料直接写进消息：相关代码片段、报错原文、测试输出、约定与约束、已排除的候选。任何「详见某文件」「见上文」都不成立。
- **一个决策点。** 给 2–3 个候选和你的倾向，问它选哪个、为什么、下一步做什么。
- **固定结尾，原话写进消息末尾：** `只给结论、理由和下一步；不要过度工程设计，不要防御性免责表述。`
- **要图时** 在同一条消息里说清图种、元素和标注，别让它猜。

## 操作步骤

PowerShell。ref 一律加引号（`'@s8f3k2p9:e1'`）。

### 0. 读配置

```powershell
$cfg = Get-Content .agents/skills/ask-gpt/config.json -Raw | ConvertFrom-Json
```

记住 `project`、`project_url`、`window_id`、`edge`。缺 `project` → 先做首次配置，再回到第 1 步。

**首次配置**

1. 问用户一个问题：这次问 GPT 放进哪个 ChatGPT 项目？拿到项目名后继续。
2. 开一个干净的窗口到 ChatGPT 首页（首次配置还没有 `project_url`）：
   ```powershell
   $before = ((agent-desktop list-windows | ConvertFrom-Json).data | Where-Object { $_.app_name -eq 'msedge.exe' }).id
   Start-Process -FilePath $cfg.edge -ArgumentList '--new-window', 'https://chatgpt.com/'
   Start-Sleep 6
   $cfg.window_id = ((agent-desktop list-windows | ConvertFrom-Json).data | Where-Object { $_.app_name -eq 'msedge.exe' -and $before -notcontains $_.id }).id
   ```
3. 在侧边栏点进该项目：`find --role option --limit 0` 里名字以项目名开头的那一行，点它。点不动（`ACTION_FAILED`）就加 `--headed`——物理点击会移走真实鼠标，先征得用户同意。
4. 项目内的面包屑链接就是项目地址，把 `value` 存成 `project_url`：
   ```powershell
   (agent-desktop find --window-id $cfg.window_id --role link --exact --name "<项目名>" --first | ConvertFrom-Json).data.match.value
   ```
5. 把 `project`、`project_url`、`window_id`、`edge` 写回 `config.json`。

### 1. 找到 agent 的标签页

```powershell
agent-desktop find --window-id $cfg.window_id --role document --limit 0
```

`window_id` 就是那张标签页的标识：这个窗口只放 agent 的 ChatGPT 页面，窗口活着标签页就在。

- 有 `value` 以 `https://chatgpt.com` 开头 → 复用它，进第 2 步。
- `WINDOW_NOT_FOUND` → 新开窗口，把新 id 写回配置：
  ```powershell
  $before = ((agent-desktop list-windows | ConvertFrom-Json).data | Where-Object { $_.app_name -eq 'msedge.exe' }).id
  Start-Process -FilePath $cfg.edge -ArgumentList '--new-window', $cfg.project_url
  Start-Sleep 6
  $cfg.window_id = ((agent-desktop list-windows | ConvertFrom-Json).data | Where-Object { $_.app_name -eq 'msedge.exe' -and $before -notcontains $_.id }).id
  ```
- 窗口在但没有 chatgpt 文档（标签页被关掉或跳走）→ 在原窗口新建标签页：`find --role button --exact --name "新建标签页" --first` 点它，再按参考表「地址栏跳转」打开 `project_url`。

### 2. 进入项目的新会话

```powershell
(agent-desktop find --window-id $cfg.window_id --role textfield --exact --name "地址和搜索栏" --first | ConvertFrom-Json).data.match.value
```

- 地址以 `/project` 结尾 → 已经是项目新会话，进第 3 步。只用地址判断：输入框为空时它的值才是 `在“<项目名>”中新建聊天`，有草稿就变成草稿内容。
- 在项目内的某个会话里 → 点面包屑回项目新会话：`find --role link --exact --name $cfg.project --first`。
- 其他页面 → 按参考表「地址栏跳转」打开 `project_url`。

### 3. 写入并发送

```powershell
$tf = ((agent-desktop find --window-id $cfg.window_id --role textfield --limit 0 | ConvertFrom-Json).data.matches |
  Where-Object { $_.name -and $_.name -ne '地址和搜索栏' } | Select-Object -First 1).ref_id
agent-desktop set-value $tf @'
<自包含提问全文>
'@
```

`set-value` 会整体替换输入框内容，草稿残留不用先清。返回 `delivered_verified` 且 `post_state.value` 是全文 → 提问已就位。文本接近 30 KB（Windows 命令行上限）时改成写 UTF-8 文件再 `cmd /c "agent-desktop set-value <ref> --stdin < 文件"`。

再发送：

```powershell
agent-desktop find --window-id $cfg.window_id --role button --exact --name "发送" --first | ConvertFrom-Json   # 取 ref，有输入时才有这个按钮
agent-desktop click '<发送 ref>'
```

地址变成 `/c/<id>` 就算发出去了。

### 4. 等回答完成

```powershell
$i = 0
do {
  $copy = (agent-desktop find --window-id $cfg.window_id --role button --exact --name "复制" --count | ConvertFrom-Json).data.count
  $stop = (agent-desktop find --window-id $cfg.window_id --role button --exact --name "停止" --count | ConvertFrom-Json).data.count
  Start-Sleep -Milliseconds 2500
} while (($copy -lt 1 -or $stop -ne 0) -and (++$i -lt 72))
```

判定标准：`停止` 消失且回答出现（文字回答是 `复制` 出现，纯图回答是 `已生成图像 1` 出现）。文字回答通常 5–30 秒。超时后仍没有 `复制` 也没有 `已生成图像 1` → 重开一次会话再问。

### 5. 取回答

```powershell
agent-desktop click '<复制 ref>'
Start-Sleep -Milliseconds 800
(agent-desktop clipboard-get | ConvertFrom-Json).data.text
```

按取到的内容继续任务。回答是建议不是事实：交付时说明这次判断来自 GPT，以及它改动了原计划的哪一步。

### 6. 有图时取图

```powershell
# 1) 打开查看器
agent-desktop find --window-id $cfg.window_id --role button --text "已生成图像 1" --first | ConvertFrom-Json
# 2) 下载（还要点下文那个 保存）
agent-desktop find --window-id $cfg.window_id --role button --exact --name "下载" --first | ConvertFrom-Json
# 3) 文件落地后再关闭查看器
agent-desktop find --window-id $cfg.window_id --role button --exact --name "关闭查看器" --first | ConvertFrom-Json
```

点 `下载` 后 Edge 弹出下载面板，条目是 `要对 <文件名> 执行什么操作?`，还要再点一次 `保存` 文件才从 `*.crdownload` 变成真文件（落到 `%USERPROFILE%\Downloads`）。这个按钮只认真实指针：语义 `click '<保存 ref>'` 返回 ok，文件仍停在 `.crdownload`。按坐标物理点它：

```powershell
$raw = agent-desktop snapshot --window-id $cfg.window_id --include-bounds --timeout-ms 8000 | Out-String
$m = [regex]::Match($raw, '"bounds":\{"height":([\d.]+),"width":([\d.]+),"x":([-\d.]+),"y":([-\d.]+)\}[^}]*?"name":"保存"')
$cx = [double]$m.Groups[3].Value + [double]$m.Groups[2].Value/2
$cy = [double]$m.Groups[4].Value + [double]$m.Groups[1].Value/2
agent-desktop mouse-click --xy "$cx,$cy" --headed
```

`--headed` 移动真实鼠标并抢占前台，先征得用户同意。别为这一步打开 `edge://downloads`：页面里也有一个 `保存`，两份同名会让 ref 变成重名控件。取图前顺手点掉上一个 `保存`：下载面板里留着待确认条目时，查看器的 `下载` 也会和面板里的重名（`AMBIGUOUS_TARGET`）。文件落地后用 `read` 直接看那张 png。

### 7. 收尾

点面包屑回 `/project`，让标签页停在项目新会话，下次从第 2 步直接开始。第 1 步换过窗口就把新 `window_id` 写回 `config.json`。

## 参考

`find` 输出形状：`--first` → `data.match`，`--limit` → `data.matches[]`，`--count` → `data.count`。

| 用途 | 定位 |
| --- | --- |
| 地址栏 | `--role textfield --exact --name 地址和搜索栏` |
| 输入框 | `--role textfield` 里名字不是地址栏、也不为空的那一个 |
| 发送 | `--role button --exact --name 发送` |
| 生成中 | `--role button --exact --name 停止` |
| 复制回答 | `--role button --exact --name 复制`（提问是 `复制消息`；纯图回答是 `复制图像`，给的是位图，`clipboard-get` 读不到） |
| 面包屑 | `--role link --exact --name <项目名>`，`value` 就是 `project_url` |
| 项目行 | 首页侧边栏 `--role option`，名字以项目名开头 |
| 地址栏跳转 | set-value 地址栏后，`--role option` 里名字以目标 URL 开头且含 `Tab` 的那一项，点它就打开 |

失败处理：

| 症状 | 处理 |
| --- | --- |
| `WINDOW_NOT_FOUND` | 开新窗口，写回 `window_id` |
| `ACTION_FAILED` 点项目行 | 加 `--headed` 重试（物理点击，先征得用户同意） |
| `AMBIGUOUS_TARGET` | 窗口里有重名控件（例如两个 `新聊天`）：换唯一控件，或用地址栏跳转 |
| 点了 `保存` 文件仍是 `*.crdownload` | 语义点击对它无效，按坐标 `mouse-click --xy` 物理点（见第 6 步） |
| `STALE_REF` | 重新 `find` 拿新 ref；ref 只在一次快照内有效 |
| 侧边栏找不到项目行 | 用 `project_url` 走地址栏跳转 |

已知限制：

- `复制` 和 `clipboard-get` 覆盖用户剪贴板，取完就停手。
- 复制出的文本带 `&#x20;` 之类 HTML 实体，当空格读。
- 图片落地必须有一次物理坐标点击，那是技能里唯一会动真实鼠标的地方。
- 一个会话只问一个问题：多条回答会让 `复制` 变成重名控件。新问题先回 `/project`。
- 发送后输入框会清空，别用「输入框空了」判断完成。
