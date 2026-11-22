# 运行与使用

## 环境

- Windows 10/11 x64。
- Node.js 22 或更新版本。

## 启动

```powershell
cd D:\core\workspace\mine\github_mine\not-my-app
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

产出 `dist\Dayfilm-1.0.0-portable.exe`（约 76 MB）。双击即可运行，不需要安装 Node.js；首次启动会自解压到 `%TEMP%` 下的临时目录，数据仍写入 `%APPDATA%\dayfilm`。未做代码签名，首次运行 Windows 会提示"未知发布者"，选择"更多信息 → 仍要运行"。

## 常驻与退出

- 关闭窗口只是收进托盘，采样继续；托盘菜单可打开窗口、暂停采样、退出。
- 托盘悬停提示会显示当前状态与当日已记录时长。
- 设置面板里可以改保留期（默认 30 天）、脱敏关键词、开机自启、暂停采样，以及真正退出程序。

## 数据位置

采样与历史保存在 `%APPDATA%\dayfilm\days\`，每个日期一个 `.jsonl` 文件。删除该目录即清空全部记录。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 顶部提示采集错误 | 确认 PowerShell 可用：`powershell -NoProfile -Command "$PSVersionTable.PSVersion"`，然后重启程序。 |
| 长时间没有新镜头 | 确认前台窗口有焦点；Dayfilm 自身窗口的时段不计入胶片，表现为无采样空隙。 |
| 时间轴长时间不动 | 主进程每 2 秒推送一次状态；若持续不动，检查是否已关掉采集（顶栏显示“采集中断”）。 |

## 验证记录

- 两个里程碑的逐条验收：[MVP 验证记录](mvp-verification.md) · [可交付版本验证记录](delivery-verification.md)
- 性能数字与测量方法：[性能与容量实测](perf-report.md)
