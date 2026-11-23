# Dayfilm

> 把你的一天剪成一部电影。

Dayfilm 是一款本地优先的 Windows 桌面应用。它每 2 秒看一眼你在用哪个窗口，把连续的停留剪成"镜头"，把窗口切换算成"剪辑"，然后把你今天的时间轴摊开成一卷胶片：可以回放、可以检索、可以导出剧本。

不采集屏幕内容，不采集键盘输入，不联网。只记录前台窗口的进程名、标题和时间戳。数据只写在本机 `%APPDATA%\dayfilm`。

## 快速开始

### 直接用打包版

```powershell
npm install
npm run dist
```

双击 `dist\Dayfilm-<版本>-portable.exe`（版本见 `package.json`）。不需要安装 Node.js；首次运行 Windows 会提示"未知发布者"（未做代码签名），选择"更多信息 → 仍要运行"。

### 开发模式

需要 Windows 10/11 与 Node.js 22 或更新版本。

```powershell
npm install
npm run dev
```

## 你会看到什么

- **正在拍摄**：当前前台窗口与已持续时间，空闲超过 60 秒变成"空闲中"。
- **今日胶片**：00:00–24:00 的竖向脊柱，每 5 分钟一帧；有素材的帧显示应用族色与缩略，旁边是每 10 分钟的密度柱。
- **回放**：60x / 600x / 3600x；按播放进入**放映态**：16:9 大画面、场景交叉淡入、走片位移、背景大镜次数字、时长尺、滚动齿孔、每秒剪辑速率，以及随镜头切换的**旁白字幕**；可开**放映音效**（放映机底噪 + 剪辑咔哒，带电平条）。
- **题材**：按剪辑密度把一天判成"长镜头 / 标准剪辑 / 快切 / 跳切风暴"，附一句点评。
- **周电影**：七天排成七幕，故事线矩阵标出延续、换戏与回归，配一句与上周对比的周导演评语，下面是本周精选的 7 个关键镜头；只计正片。
- **导演剪辑版**：镜头可以标成正片或花絮，短于阈值的镜头可按设置自动算花絮；EDL / PDF / 剧本 / 周电影都按这条口径取数。
- **镜头列表与检索**：按时间列出当天镜头，或跨最近 7 天搜标题、进程名。
- **导演 HUD**：360×148 的置顶小窗，实时显示正在拍什么、这一条拍了多久、今天的镜头/剪辑数与最近 30 分钟节奏柱。
- **导出**：Markdown 剧本、**CMX3600 EDL**（可导入 DaVinci Resolve / Premiere 当日志时间线）、剧本 PDF、1600×1000 海报（三种主题）。

## 常驻

关闭窗口只是收进托盘，采样继续；托盘菜单可以打开窗口、暂停采样、开关 HUD、退出。设置面板可以改：

- **保留期**：默认 30 天，启动时清理更早的日文件。
- **脱敏关键词**：命中后标题落盘为 `[已隐藏]`，内置密码管理器、隐私浏览、银行支付等规则。
- **项目规则**：把镜头归到"故事线"上，汇总与周电影都按项目统计。
- **自动花絮**：短于 3 / 10 / 30 秒的镜头自动算花絮，默认关闭。
- **导演 HUD**：置顶小窗开关（也可从托盘切）。
- **放映音效**：模式（放映机 + 剪辑 / 仅剪辑）与音量。
- **开机自启**、**暂停采样**、**退出**。

导演手记在日视图里写：每天一句，进剧本与海报。

## 数据

采样保存在 `%APPDATA%\dayfilm\days\`，每天一个 `.jsonl` 文件，纯文本，删除即清空。同目录还有 `settings.json`（设置）、`notes.json`（手记）与 `marks.json`（正片/花絮标记）。格式见[本地数据格式](docs/data/store-format.md)。

## 文档

从[项目文档索引](docs/INDEX.md)进入。

- 产品目标：[产品说明](docs/product/dayfilm.md) · [产品原则](PRODUCT.md)
- 预期行为：[功能规格索引](docs/specs/INDEX.md)（v1 功能规格、可交付版本要求、v1.1–v1.5、[v2 导演剪辑版](docs/specs/dayfilm-v2.md)）
- 视觉：[设计系统](DESIGN.md) · [视觉语言](docs/product/visual-language.md) · [界面概念图](docs/product/ui-concept-v2.png)
- 结构：[架构](docs/architecture/dayfilm.md) · [架构图索引](docs/architecture/INDEX.md) · [IPC 契约](docs/api/ipc-contract.md) · [数据格式](docs/data/store-format.md)
- 使用与验收：[运行与使用](docs/operations/run.md) · [MVP 验证](docs/operations/mvp-verification.md) · [交付验证](docs/operations/delivery-verification.md) · [性能实测](docs/operations/perf-report.md)

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发模式启动 |
| `npm run build` | 构建主进程、preload 与界面 |
| `npm start` | 以构建产物启动 |
| `npm run pack` | 打解包产物 `dist/win-unpacked` |
| `npm run dist` | 打便携版 exe |
| `npm run typecheck` | 类型检查 |
| `npm test` | 运行测试（含性能基准） |
