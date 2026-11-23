# 术语表

| 术语 | 含义 | 权威来源 |
| --- | --- | --- |
| 采样（sample） | 一次前台窗口观测记录，含时刻、进程名、标题、空闲时长。 | [数据格式](../data/store-format.md) |
| 镜头（shot） | 同一前台窗口连续停留形成的时间段，>= 3 秒才成镜头。 | [功能规格](../specs/dayfilm-v1.md) |
| 剪辑（cut） | 相邻两个非空闲镜头之间的切换。 | [功能规格](../specs/dayfilm-v1.md) |
| 中场休息（intermission） | 空闲超过 60 秒时切分出的空白镜头。 | [功能规格](../specs/dayfilm-v1.md) |
| 胶片（reel） | 一天中所有镜头按时间排列的整体。 | [产品说明](../product/dayfilm.md) |
| 题材（genre） | 由剪辑密度推导出的当日风格标签：长镜头 / 标准剪辑 / 快切 / 跳切风暴。 | [功能规格](../specs/dayfilm-v1.md) |
| 剪辑中 | Dayfilm 自身窗口获得焦点时记录的镜头状态，不计入专注。 | [功能规格](../specs/dayfilm-v1.md) |
| 正片（feature） | 镜头的手动标记之一，计入专注时长；未标记的镜头按正片算。 | [v2 功能规格](../specs/dayfilm-v2.md) |
| 花絮（extra） | 镜头的手动标记之一，只作参考，不进 EDL，周电影也不计。 | [v2 功能规格](../specs/dayfilm-v2.md) |
| 自动花絮 | 短于设置阈值的未标记镜头自动算花絮（`markSource: 'auto'`），手动标记优先。 | [v2 功能规格](../specs/dayfilm-v2.md) |
| 标记（mark） | 镜头开始时刻 → 正片/花絮的叠加层，存 `marks.json`。 | [数据格式](../data/store-format.md) |
| 项目（project） | 用户定义的"故事线"：标题或进程名命中关键词的镜头归入同一项目。 | [功能规格](../specs/dayfilm-v1.1.md) |
| 导演手记（note） | 用户给某一天写的一句评语，存 `notes.json`，进剧本与海报。 | [功能规格](../specs/dayfilm-v1.1.md) |
| 放映（projection） | 单日时间轴的 16:9 大画面回放，带旁白字幕与音效。 | [功能规格](../specs/dayfilm-v1.4.md) |
| 放映音效 | 放映时实时合成的放映机底噪与剪辑咔哒，模式与音量来自设置。 | [v2 功能规格](../specs/dayfilm-v2.md) |
| 导演 HUD | 360×148 的置顶小窗：正在拍什么、这一条拍了多久、今天的节奏柱。 | [功能规格](../specs/dayfilm-v1.4.md) |
| 周电影 | 七天排成七幕的视图：故事线、剧情标记、周评语与本周精选，只计正片。 | [功能规格](../specs/dayfilm-v1.2.md) |
| 片场日历 | 近 12 周的活跃度日历，按当天题材的色相上色。 | [v2 功能规格](../specs/dayfilm-v2.md) |
| EDL | 一天的 CMX3600 剪辑表，只导出正片镜头。 | [v2 功能规格](../specs/dayfilm-v2.md) |
