# status-ui14：放映音效电平 / 正片花絮行 / sort 比较器

范围：`src/renderer/**`、`tests/renderer/**`、本文件。run 完 `tsc / vitest / build` 全绿。

## 1. 放映音效可验证（`projection-audio.ts` + 放映控制条）

- `projection-audio.ts`：底噪链路改成 `source → bandpass → gain → AnalyserNode → destination`；
  `AnalyserNode.fftSize = 8192`（48kHz 下约 170ms，接近“最近 200ms”），`smoothingTimeConstant = 0.4`；
  新增 `level(): number`：读时域样本算 RMS，`min(1, rms × 350)`（底噪 gain 0.014 时约 0.45，剪辑咔哒顶到 1）；
  未开声音 / 无 AudioContext 时返回 0，关闭与 `dispose()` 时清掉 analyser 与样本缓冲。
- 放映态 `#soundToggle` 左侧新增 `#audioMeter`：3 格电平条，每格 12×3px、间距 2px、`--amber`，未点亮时 `rgba(236,231,220,.14)`。
- `app.ts`：`startAudioMeter()` 每 100ms 读一次 `projectorAudio.level()`，同步写
  `<html data-audio-level>`（两位小数，如 `0.53`）并点亮超过阈值（0.08 / 0.35 / 0.65）的格子；
  开启声音/进入放映时启动，关声音/退出放映时停止并把电平归零。
- 端到端自查（dev server + 自建 BrowserWindow）：
  `{"first":{"level":"0.53","bars":[true,true,false],"sound":"声音：开"},"second":{"level":"0.47",...}}`，
  Esc 退出后 `{"level":"0.00","bars":[false,false,false]}`。

## 2. 「正片 / 花絮」单独一行

- 结构：`#statMarks` 里 `剪辑版`（10px mono 大写、0.18em 字距、dim）+ `正片 X`（16px `--paper`）+ ` · ` + `花絮 Y`（12px `#9aa0a6`）。
- 间距：`.stats__marks { margin: var(--s1) 0 0 }`，`.stats__line--project { margin-top: 0 }`，与「项目：…」之间只剩右栏块的 8px gap
  （实测 `gap: 8`，之前是 24）。
- 自查：`{"label":{"text":"剪辑版","size":"10px"},"feature":"16px","extra":"12px","gap":8}`。

## 3. `.sort()` 比较器

- `previousDataDate()` 里的 `.sort()` 补成 `.sort((a, b) => a.localeCompare(b))`（日期是 `YYYY-MM-DD`，字典序即时间序）。

## 4. 验证

```text
npx tsc --noEmit -p tsconfig.web.json   TSC=0
npx vitest run                          50 files / 615 passed（renderer 26 / 348）
npm run build                           css 79.14 kB / js 177.99 kB
```

## 5. 未完成 / 已知问题

1. **电平条的“200ms”是近似**：`fftSize 8192`（≈170ms @48k）取一次时域快照，不是滑动窗口平均；
   剪辑咔哒是瞬态，100ms 采样可能错过峰值（不影响“能看见声音在响”）。
2. **`data-audio-level` 只在放映且声音开启时更新**，退出或静音后固定 `0.00`；自动化验收要在这两个条件下读。
3. **截图仍然不可靠**：本轮 `capturePage()` 产出的 `%TEMP%\ui14\01-projection-audio.png` 未确认非空（前几轮出现过 0 字节）；
   视觉证据以上面的 DOM 断言为准。
4. **音效电平没有单测**：WebAudio 在 Node 里不可用，`level()` 只能在渲染进程里验证；`projection-audio.ts` 仍无 `tests/`。

## 6. 真机回归后的两处修正（v25 截图）

1. **首次引导不再依赖“当天零镜头”**：改成 `localStorage['dayfilm.onboarded']` 缺失 **且** `day.featureMs < 120_000`（头两分钟）时显示；
   卡片从“替换三指标”改成 **hero 的覆盖层**（`position:absolute; inset:0; z-index:6`，背景 `rgba(10,11,13,.94)` + 1px 发丝线），
   三指标仍在 DOM 里；两个按钮行为不变（主按钮写 `dayfilm.onboarded=1` 并隐藏，次按钮打开设置）。
   另加 `?mock=fresh` 自查钩子：当天返回空卷，方便稳定复现引导（mock 默认每天都有数据）。
   实测（dev server + `?mock=fresh`，清掉 localStorage）：`{hidden:false, position:"absolute", bg:"rgba(10,11,13,.94)", border:"1px rgba(236,231,220,.07)", covers:true, metrics:3}`，
   点「知道了，开始拍摄」后 `{hidden:true, mark:"1"}`（截图 `%TEMP%\ui14b\01-onboarding.png`）。
2. **正片/花絮行与项目行挤在一起**：`.stats__marks { margin: 4px 0 0 }`（叠加块 gap 8 → 与上一行 12px），
   `.stats__line--project { margin-top: 4px }`（叠加 gap → 与项目行 12px）；行内仍是标签 10px mono 大写 dim +
   正片 16px 暖白 + 花絮 12px 银灰。实测 `{label:10px, feature:16px, extra:12px, gapToProject:12}`。

复跑 `node scripts/probe-v20.mjs`（用户实例已退出，本次跑通）：`%TEMP%\dfv20\{1-day,2-week,3-projection}.png`。
日视图里「剪辑版 正片 3 小时 12 分 · 花絮 0 分」独立成行，与「项目：…」之间有明显留白；引导卡片因为当天 featureMs > 120s 正常隐藏。

## 7. 再修两处（v25-onboarding2 截图）

1. **引导卡不再透底**：`.onboarding` 背景从 `rgba(10,11,13,.94)` 改成不透明渐变 `linear-gradient(#0f1114, #131518)`（概念图 C 块），
   保留 1px 发丝线；卡片仍是 hero 覆盖层（`position:absolute; inset:0; z-index:6`），下面的「跳切风暴」不再透出。
   实测：`{cardBg:"linear-gradient(rgb(15,17,20), rgb(19,21,24))", cardColor:"rgba(0,0,0,0)", cardHidden:false}`
   （截图 `%TEMP%\ui14c\01-onboarding.png`，卡面完全盖住 hero）。
2. **正片/花絮改成三列网格外的通栏一行**：`#statMarks` 从「最长休息」之后移到 `#metrics` 紧跟其后（仍不在 `dl.stats` 里），
   渲染成左「正片」10px mono 大写 + 16px 暖白数值、右「花絮 X 分」12px 银灰，`justify-content: space-between`、整行通栏；
   `margin-top: 4px` + 右栏块 gap 8 = 与三列数字 12px。
   实测：`{marksBelowNumbers:12, marksWidth:373, metricsWidth:373, label:"10px", feature:"16px"(rgb(236,231,220)), extra:"12px"(rgb(154,160,166))}`，
   下一行（最长镜头）距离 8px。

复跑 `node scripts/probe-v20.mjs`（用户实例已退出）：`%TEMP%\dfv20\1-day.png` 里「正片 3 小时 12 分 … 花絮 0 分」是独立通栏一行，
位于三列数字下方、最长镜头行上方，与「项目：…」彻底分开；引导卡因当天 featureMs > 120s 正常隐藏。
