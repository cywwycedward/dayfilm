# 运行与使用

## 环境

- Windows 10/11 x64。
- Node.js 22 或更新版本（仅开发与打包需要；便携版不需要）。

## 启动

```powershell
cd D:\core\workspace\mine\github_mine\dayfilm
npm install
npm run dev
```

开发模式会打开 Dayfilm 窗口，并自动开始采样当前前台窗口。

生产式启动：

```powershell
npm run build
npm start
```

## 免安装版

```powershell
npm run dist
```

产出 `dist\Dayfilm-<版本>-portable.exe`（版本取 `package.json`）。双击即可运行，不需要安装 Node.js；首次启动会自解压到 `%TEMP%` 下的临时目录，数据仍写入 `%APPDATA%\dayfilm`。未做代码签名，首次运行 Windows 会提示"未知发布者"，选择"更多信息 → 仍要运行"。

## 常驻与退出

- 关闭窗口只是收进托盘，采样继续；托盘菜单可打开窗口、暂停采样/继续采样、开关导演 HUD、退出。
- 托盘悬停提示会显示当前状态与当日已记录时长；图标三态（采集中 / 已暂停 / 出错）。
- 全局快捷键：`Ctrl+Alt+D` 开关导演 HUD，`Ctrl+Alt+P` 打开主窗口并进出放映；被其它程序占用时只在托盘提示一次。
- 设置面板里可以改保留期（默认 30 天）、脱敏关键词、项目规则、自动花絮阈值、HUD 开关、放映音效、开机自启、暂停采样，以及真正退出程序。

## 使用要点

- 镜头行 hover 出现"正片 / 花絮"按钮；再点一次同一按钮即清除标记。
- 顶栏「···」菜单里有批量标记：把今天 10 秒以下的镜头标为花絮、按设置自动标记、清除今天的全部标记（4 秒内二次确认）。
- 顶栏导出菜单含 Markdown 剧本、EDL、PDF 与三种主题的海报；都走系统保存对话框。
- 放映态可以开关声音；音量与模式在设置里调。

## 数据位置

- 采样与历史：`%APPDATA%\dayfilm\days\`，每个日期一个 `.jsonl` 文件。
- 设置：`settings.json`；手记：`notes.json`；正片/花絮标记：`marks.json`，都在同目录。
- 删除 `days\` 只清空历史影像；要完全重置就连同三个 JSON 一起删。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 顶部提示采集错误 | 确认 PowerShell 可用：`powershell -NoProfile -Command "$PSVersionTable.PSVersion"`，然后重启程序。 |
| 长时间没有新镜头 | 确认前台窗口有焦点；Dayfilm 自身窗口的时段不计入胶片，表现为无采样空隙。 |
| 时间轴长时间不动 | 主进程每 2 秒推送一次状态；若持续不动，检查是否已暂停采样或采集已中断。 |
| 导出的 EDL 少了几个镜头 | 当天有镜头被标成花絮或按阈值自动算花絮；EDL 只导出正片，头部会写明漏了几个。 |
| HUD 跑到屏幕外 | 拖动到目标显示器即会夹回工作区；重启后回到上次位置。 |

## 验证记录

- 两个里程碑的逐条验收：[MVP 验证记录](mvp-verification.md) · [可交付版本验证记录](delivery-verification.md)
- 性能数字与测量方法：[性能与容量实测](perf-report.md)
