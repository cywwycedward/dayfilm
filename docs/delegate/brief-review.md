# 任务说明书：交付前独立评审（df-review）

## 你的位置

你是未参与实现的独立评审者。请以怀疑的态度核对"声明"与"证据"，不要相信状态文件里的结论，要回到代码、测试和运行结果自己判断。只写一个文件：`docs/delegate/review-delivery.md`。**不要修改任何源码、测试、配置或文档**。

## 评审对象

- 预期行为：[可交付版本要求](../specs/dayfilm-delivery.md)（R10–R18）与 [v1 功能规格](../specs/dayfilm-v1.md)。
- 架构与契约：[架构](../architecture/dayfilm.md)、[IPC 契约](../api/ipc-contract.md)、[数据格式](../data/store-format.md)。
- 实现：`src/main/**`、`src/preload/**`、`src/renderer/**`、`resources/**`、`electron-builder.yml`、`scripts/pack/**`。
- 实现者的自述（只作线索）：`docs/delegate/status-main2.md`、`status-ui2.md`、`status-release.md`。
- 验证记录：[MVP 验证记录](../operations/mvp-verification.md)。

## 评审要求

1. **按需求逐条对照。** 对 R10–R18 每一条，判断：实现了 / 部分实现 / 未实现 / 无法从代码判断。写清依据（文件+行号或函数名）。
2. **找真实缺陷，不找风格问题。** 重点看：
   - 隐私：脱敏是否真的在写入前生效；日志、错误信息、导出文件里是否会漏出标题原文；`settings.json` 损坏时是否会泄露或重置。
   - 边界：日期字符串校验、跨天、时钟回拨、LRU 淘汰后 `lastT` 是否还正确、缓冲重试是否会重复写入同一条采样（重试导致重复行会不会影响切分结果）。
   - 并发与生命周期：暂停/恢复与休眠事件交叉、托盘退出时缓冲里未落盘的采样会不会丢、单实例与 `--hidden` 启动。
   - 安全边界：`isTrustedFrameUrl` 的绕过可能（大小写、端口、路径前缀、`ELECTRON_RENDERER_URL` 环境变量注入）、网络白名单是否真的挡住远程请求（`file://` 页面里的 `http://` 图片、`fetch`、`WebSocket`）。
   - 增量聚合：与全量 `buildDayRollup` 的等价性是否覆盖了"镜头超过 90 秒空档被打断""同一毫秒两条采样""首个镜头不足 3 秒"等情形。
   - 打包：`electron-builder.yml` 的 `files` 是否会漏掉运行必需文件（例如 `resources/tray.png` 未在 `extraResources` 里）。
3. **检查测试的可信度。** 找出"看起来通过但其实没断言到关键行为"的测试，特别是属性测试与安全检查。
4. 自己动手跑：`npm run typecheck`、`npm test`、`node scripts/pack/verify.cjs dist/win-unpacked`（若产物存在）。可以写临时脚本到 `%TEMP%` 下验证猜想，但不要留在仓库里。

## 输出格式

写进 `docs/delegate/review-delivery.md`：

1. **结论**：可以交付 / 有条件交付 / 不可交付，一句话说明条件。
2. **需求对照表**：R10–R18，状态 + 依据。
3. **发现**：按严重度排序（阻断 / 重要 / 次要），每条包含：现象、复现或依据（文件:行号、命令输出）、影响、建议修法（一句话，不要贴大段代码）。
4. **无法验证项**：明确写出你为什么判断不了。

## 边界

- 只读。不修代码、不改配置、不删文件。
- 不启动子 Agent。
- 不要运行 `npm run dev`、`npm run dist`，也不要在真实数据目录里做破坏性实验（用 `%TEMP%` 下的临时目录）。
- 完成后结束本轮。
