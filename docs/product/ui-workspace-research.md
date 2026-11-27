# Dayfilm 复盘工作台：案例与设计规格

## 从案例到设计决策

| 案例 | 图像或界面证据 | 迁移到 Dayfilm |
| --- | --- | --- |
| [Minimal Gallery](https://minimal.gallery/) · [提交展示图](https://www.awwwards.com/sites/minimal-gallery) | 作品缩略图承载主要信息，搜索与分类是入口，不是主画面。 | 降低标志、日期和开关的视觉重量。借层级，不照搬网格营销布局。 |
| [Kage：Clips by Plastic](https://kage.design/designs/clips-by-plastic-landing-page) | 页面明确区分面向内容的预览与高密度控制；Kage 提供该案例的截图和结构分析。 | 将剧照和放映工具做成一个连续的操作面，不继承荧光绿、大标题或营销留白。 |
| [Refero Styles：Linear](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) | 截图及样式拆解并列展示暗层级、细边界、受限的强调色。该页 CSS 为设计参考，不是 Linear 生产源码。 | 让背景、舞台和设置抽屉有明确层差；把琥珀色留给放映、选中和焦点。 |
| [The Component Gallery：Tabs](https://component.gallery/components/tabs/) · [Radix Tabs 示例](https://www.radix-ui.com/primitives/docs/components/tabs) | 对照不同系统的选中态；Radix 公共实现示例把触发器、选中值和内容关联。 | Dayfilm 沿用已有原生按钮与 `aria-pressed`，视觉选中与键盘焦点独立。不在没有完整键盘模型时冒用 tab 语义。 |
| [Appshot Gallery](https://www.appshot.gallery/) | 商店图按单个画面聚焦一件事；不是桌面软件交互规范。 | 用整屏与三个真实裁片分别验证视觉和可操作性，不照搬设备框、标语或图片展示比例。 |
| [Frame.io：Player and Commenting](https://blog.frame.io/2024/05/28/frame-io-v4-features-player-and-commenting/) | 产品方展示定位时间、画面及当刻上下文在同一工作区。 | 播放、进度、时间码、倍速紧邻剧照，仍保留 Dayfilm 原生 range 和竖向胶片。 |

## 设计规格：一个画面，一组播放控件

两张概念图使用内置 ImageGen，以 `aa696f8` Electron 构建的模拟数据截图为参考：[整屏](assets/ui-concept-v44-workspace.png)（日视图），[组件](assets/ui-concept-v44-components.png)（放映、镜头行、设置裁片）。整屏图中类似真实窗口的画面只是生成误读，不采用；不会引入屏幕采集或占位图片。组件实现可参照[公开源码调研](ui-component-research.md)。

- **日视图**：顶栏常驻日/周切换。左侧 40px 题材和判词回答“今天像什么”；唯一强调模块是剧照与放映条。窗口信息在舞台顶部，手记和复盘证据在下方。主视图移除写实场记板条，保留首启引导的品牌素材。
- **紧凑窗口**：960×640 仍保持剧照和放映可见，右侧最近镜头不落到全部证据之后。胶片与镜头索引在同一侧，原有点击、滚轮和键盘操作不改。宽度不足时缩减装饰和间距，不把控件降成不可辨认的微型元素。
- **周视图**：把本周结论置于各日和项目矩阵之前；证据可展开。日期范围保留前后周切换。精选和矩阵不是等权的装饰卡片。
- **组件**：石墨底、低饱和暖白、三档表面；主按钮 38px、弱控件 28–34px、圆角 6–8px。等宽字只用在时间和数字；中文界面用现有 Plex Sans 与 Windows 中文字体。选中行使用暖底和 1px 边标；虚拟列表的真实行高与步长一致。
- **设置**：对项目名、关键词使用持久标签，字段与添加键底部对齐，编辑与删除文字可辨。危险色仅在相应交互中显示。动效只用于状态过渡，尊重减少动态效果的偏好。
- **交付约束**：概念图是参考，不把任何操作控件或数据烘焙成图片。保持本地数据、导出、采集与放映行为。用同一组模拟记录检查 1280×820、960×640、周切换、设置、放映和空态，并用独立测试数据启动真实构建。

## ImageGen 提示词

> Use case: ui-mockup. One impeccable high-fidelity 1280×820 Windows desktop screenshot for Dayfilm, an offline timeline of window activity, based on the supplied current app screenshot. Keep display in Chinese. Organize this as a quiet editorial review workspace, inspired by Frame.io's proximity of timeline and player, the restrained surfaces of Linear as documented by Refero Styles, and Minimal Gallery’s content-first hierarchy. Use matte graphite #111315 canvas, raised #1a1d21, muted warm #f0ece2 text, #abaeb3 secondary, thin neutral lines and amber #edbb76 only for play/current state. Top application toolbar contains DAYFILM, segmented 日视图 / 周视图, date, search, export/settings and native window controls. Left two-thirds: generous but compact 40px “长镜头” daily conclusion and verdict at top, then one bordered rounded stage: visible selected window “Figma · Dayfilm — 胶片视觉”, purpose-built generated scene still with metadata (not actual screen photography), and directly under it one integrated transport row with amber Play button labeled 放映, 09:38:00 / 24:00:00, progress, and quiet 60x / 600x / 3600x. Below stage are the note and evidence. Right third: clearly labeled 最近镜头 index; the existing narrow vertical filmstrip sits beside the index (not between title and stage); row selection with subtle warm tint and timecodes. Today summary as a quieter stacked group. No unnecessary cards, headings, gradients, decorations, illustrations, mock monitor, or nonexistent features. Show real density with legible Windows CJK typography and precise row rhythm. Main viewing anchor is stage/transport, not logo or large marketing text.

> Use case: ui-mockup. High fidelity component study sheet for Dayfilm Windows desktop UI, based on the supplied cropped project settings, player and shot list screenshots. Show three large readable component crops, not device frames: a unified player control strip with labeled amber play, high contrast mono time, scrub range and subtle pressed speed segment; recent shots rows with aligned 12px timecode/labels, comfortable ~34px row height and warm tinted selected row with 1px marker; project settings with charcoal panel, quiet selected navigation, separate rule table, persistent Chinese labels above 36px dark bordered inputs, neutral 编辑 / 删除 and amber 添加. Inset keyboard focus ring distinct from selected state. Matte graphite #111315 and #1a1d21, warm #f0ece2, muted #abaeb3, amber #edbb76, 6-8px radii on controls, simple one-pixel separators. Use typographic and spacing discipline of Linear/Primer, no copied brands or fake controls. Use actual Chinese text from screenshots.

## 文本与层级打磨

- 日视图首屏只突出题材结论、当前镜头标题和放映。预览内镜头标题只显示一次，应用名降为元数据；序号、时段、时长、已匹配项目按位置分组。没有匹配项目时不显示占位标签。采集状态与回看时长不混在同一行。
- 手记与高光常驻；「上一集」是跨日定位入口，按标签、标题、时间排成常驻按钮；中场休息结论为紧凑事实行。只把剪辑发现收进「剪辑发现」，展开以后固定标签列、全文可换行。右栏常驻三项总数与最长休息；最长镜头已有可点击高光，不再重复出现在统计明细。明细按项目与数值整理，空列表不显示空白滚动区域或无用的列名。
- 视觉层级按角色区分：镜头标题 28px，区域标题 16px，交互正文 13px，标注 11–12px。次要文字保留可读对比度；按键、选中、焦点使用琥珀，普通项目标记不再使用醒目金色。
- 周视图保留可点击的七日导航；日期、主线、矩阵和精选按组读取，用明确的区域标题取代无上下文的数据堆。标签、进程与时间不使用与正文相同的视觉权重。
- 验收覆盖 1280×820、960×640，首屏核心控件和列表可见，原生展开可用，空态不留空名单；历史镜头访问、搜索与放映行为不变。

### 依据与转译

另见[真实产品案例：GitHub 与 YouTube](ui-hierarchy-case-notes.md)，区分任务定位和可按需查看的补充材料。

- [GOV.UK Summary List](https://design-system.service.gov.uk/components/summary-list/) 的示例以标签和值形成两个扫读方向；这里用于统计明细和项目时长，而不是把发现的长描述硬塞成数值表。
- [Primer DataTable](https://primer.style/product/components/data-table/guidelines/) 的图片把识别对象的标题和其余字段分开；[Carbon Data Table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/specifications) 把区块标题、列头、行正文赋予不同字号与字重。不照搬表格密度，采用稳定列宽、轻分隔和自然换行。
- [Frame.io Player and Commenting](https://blog.frame.io/2024/05/28/frame-io-v4-features-player-and-commenting/) 展示带时刻的注释与播放器之间的联系。Dayfilm 直接常显可跳转的上一集，把日期与标题分开，不把入口放在展开按钮后面。
- 整屏概念图中「今日统计」的数字与后续事实有明确层级，组件图中「镜头标题」是每行识别对象。落实为粗体主要数值与标题、较轻但清楚的标签、仅用于动作反馈的琥珀色；不复刻概念图的截图式预览。

### Windows 实机回归

- 展开和收起统计明细时，右栏列表让出空间；列表区域由 flex 分配，虚拟列表只读取实际视口，不再给区域写死高度。列表至少保留一个滚动区，统计不能覆盖镜头行。
- 在周视图输入非空搜索词时，切到能展示镜头结果的日视图，保留输入焦点；结果栏题头改为「搜索结果」。检索失败不得保留上一次匹配结果。
- 浏览过去日期的统计标题使用「当日统计」；取消 Markdown 导出不得显示导出成功。
- 「上一集」定位后，预览和镜头列表一起跳到目标镜头；列表不应停留在第一屏。

Windows Computer Use 用独立合成记录走查了周转日、镜头选择、放映及 Esc 退出、对比、片场日历、手记写入、五个设置分区、HUD 开关，以及原生保存对话框的取消路径。用 `scripts/probe-hierarchy.cjs` 量化展开前后的布局，用 `scripts/probe-v4.mjs` 验证历史日期、三种搜索和较晚位置的上一集跳转。没有用真实账号测试模型连接，也没有执行批量清除、修改开机自启或逐一保存所有导出格式。
