# 任务书：Dayfilm 评委 B —— 截图与隐私

你在 `D:/core/workspace/mine/github_mine/dayfilm` 仓库工作。**只读分析 + 写一份报告**：不改源代码、不改配置、不加依赖、不跑构建和测试、不提交。

## 你的评审身份与唯一问题

你是「像素 / 隐私」评委。只回答一个问题：

> Dayfilm 现在用标题 + 进程名合成一帧"剧照"（不是真截图）。**要不要升级成真实截图？** 如果要，隐私问题到底怎么解决、代价是多少；如果不要，用哪条替代路线能得到 80% 的收益。

不要评价 AI 文案质量、不要评价记录字段扩展（那是另外两位评委）。

## 必须先读（别猜，读完再写）

- `PRODUCT.md`（"不可让步的产品真相"一节）、`docs/product/dayfilm.md`、`DESIGN.md`（视觉语言与"剧照"的定义）
- `docs/specs/dayfilm-delivery.md`（隐私、脱敏、保留期、存储可靠性、安全边界）
- `src/renderer/src/lib/still-frame.ts`、`src/renderer/src/paint-still.ts`、`src/renderer/src/lib/poster.ts`、`src/main/save-image.ts`
- `src/main/redact/index.ts`、`src/main/settings/index.ts`（脱敏词如何生效）
- `src/main/security/index.ts`（CSP / 网络守卫）、`docs/agents/adr/0002-jsonl-day-files.md`、`docs/agents/adr/0003-powershell-capture-helper.md`
- `tests/` 下与 capture / redact / save-image 相关的测试文件名（不用读全部内容）

## 已核实的事实

- 当前一帧是**合成的**：应用族色相 + 齿孔 + 颗粒 + `title` / `exe` / 时长 / 镜号，全部由纯函数算出（`still-frame.ts` 明确写"只算画什么、画多大、放在哪，不碰 canvas"）。
- 采样每 2 秒，只存 4 个字段：`t`、`exe`、`title`、`idleMs`。**没有任何像素数据**。
- 硬约束：不截屏、不联网、不记键盘、数据只在本机、渲染确定性、常驻开销可忽略、默认无网络请求（唯一出口是默认关闭的模型通道）。
- 存储现状：JSONL 一天一个文件，保留期默认 30 天，`retentionDays: 0` 表示不清理。

## 交付

写 `docs/delegate/eval-screen.md`，中文，结论先行，每个结论带证据（文件路径 + 函数/字段名）。

1. **总评（≤6 句）**：给一个明确判断——**该不该做截图**（"做 / 不做 / 只做局部"三选一），并说明它和"不截屏"这条产品真相的关系：是推翻原则，还是能被一个更窄的原则容纳。
2. **如果做，代价算清楚**（用数字，不要形容词）：
   - Windows 上三条可行路径的实际差异：`Windows.Graphics.Capture`（WGC）/ Desktop Duplication API（`IDXGIOutputDuplication`）/ `PrintWindow` + `PW_RENDERFULLCONTENT`。各自：能否只抓单个窗口、能否抓被遮挡/最小化窗口、是否受 DRM 黑屏影响、需要什么会话权限、Electron 里的接入方式。
   - 成本表：不同采样策略（每 60 秒 / 每 5 分钟 / 只在切窗口时 / 画面变化超过阈值时）在**一天 8 小时**下的张数、单张体积（缩略到 480×270 WebP/JPEG 的真实量级）、每天/30 天占用、CPU 增量、电池影响。
   - 去重：感知哈希（dHash/pHash）与"同一镜头只留首帧 + 变化帧"能把张数压到多少。
3. **隐私方案（这一节是本次评审的重点，要能直接照做）**。至少覆盖并逐条给结论：
   - **只在本地**：截图是否可能离开本机？现有 `installNetworkGuard` / CSP 能挡住什么、挡不住什么（Electron 主进程里 `fetch`、shell.openExternal、崩溃上报、`save-image` 用户主动导出）。
   - **加密落盘**：Windows 上 `DPAPI`（`ProtectedData.Protect`，CurrentUser 范围）加密缩略图；密钥与数据同机时真实防护边界在哪（防"另一台机器读走文件"、不防"同一用户态恶意进程"），要诚实写清楚。
   - **不进备份/不进云**：图片文件放在哪里、如何避免被 OneDrive 同步（`%APPDATA%` 也会被 Known Folder Move 同步）。
   - **黑名单 / 白名单**：进程级（密码管理器、银行、聊天、邮件）与系统级（UAC、锁屏、远程桌面、DRM）。
   - **脱敏**：像素上如何遮蔽（区域模糊不现实——窗口布局未知；可行的是整窗不抓、或抓完立刻在内存里降采样到不可读、或只存 OCR 文本不留图）。
   - **保留期与"一键抹掉"**：现有 `retentionDays` 如何扩展到图片；`days\` 删除是否足够。
   - **可见性**：用户如何知道"正在被截图"（托盘/HUD/首次引导），默认值该是开还是关。
4. **如果做，最小可用形态（MVP）**：只写一条路，写清改动落在哪些文件、新增什么设置项、第一版砍掉什么。
5. **如果不做，替代路线（给 3 条，按性价比排序）**：必须都是**不碰像素**的方案，例如标题归一化 + 更强的实体抽取、单窗口 UIA 文本（`Windows.UI.Xaml.Automation` 的 `Name`/`ControlType` 只读，不截屏）、本地 OCR（`Windows.Media.Ocr`）在**内存里**处理且不落图。每条写：能得到什么、放弃什么、隐私等级、工作量 S/M/L。
6. **明确不建议做**：一句话一条。
7. **一句话回答**：如果用户坚持要"真实的画面感"但拒绝截图，最接近的确定性能做的替代是什么。

## 风格

- 中文，直接给结论。数字要能算给人看（写出算式）。
- 不写"需要注意隐私"这种废话；写"哪条路会泄漏什么给谁"。
- 不允许用"视情况而定"结案：给倾向。
