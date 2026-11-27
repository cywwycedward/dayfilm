# 渐进式视觉层级案例

## GitHub 网页端 Pull Request 的 Files changed

- **可直接读取。** 页面顶部的进度条显示已查看的文件数，文件树用于定位变更文件。新版文件树用标记提示哪些文件有评论、错误或警告，主区域展示代码差异。[GitHub 审查指南](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request#about-reviewing-pull-requests) · [新版页面截图与说明](https://github.blog/changelog/2026-01-22-improved-pull-request-files-changed-page-on-by-default/)
- **按任务展开或收起。** 审查者可展开 diff 的全部或一部分以查看额外的未改动行。将某个文件标为 `Viewed` 后，该文件的差异折叠，页首进度仍可读取。文件再次变更时，已查看状态会清除。[GitHub 展开差异说明](https://github.blog/changelog/2025-09-25-pull-request-files-changed-public-preview-now-supports-commenting-on-unchanged-lines/) · [GitHub 已查看状态说明](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request#marking-a-file-as-viewed) · [折叠演示与进度说明](https://github.blog/news-insights/product-news/mark-files-as-viewed/)

## YouTube 桌面网页播放器的精确定位

- **控制条显示时可直接读取。** 进度条上的红色滑块表示播放位置。有章节的视频还会在轨道上用竖线标出章节边界，拖动到相应区段时显示章节标题。这个可见范围以控制条已打开为前提，帮助文档也给出了点击画面打开控制条的步骤。[YouTube 桌面版观看与定位帮助](https://support.google.com/youtube/answer/12825599?co=GENIE.Platform%3DDesktop&hl=en)
- **精确定位时展开。** 从红色滑块向上拖动，进度条下方出现一排缩略图。用户可以拖动缩略图或滑块调整位置，再从所选位置播放，或取消这次定位。YouTube 在 2022 年宣布向所有用户推出精确定位，桌面帮助文档记录了操作路径。[YouTube 桌面版精确定位帮助](https://support.google.com/youtube/answer/12825599?co=GENIE.Platform%3DDesktop&hl=en) · [YouTube 发布说明](https://blog.youtube/news-and-events/an-updated-look-and-feel-for-youtube/)

**对 Dayfilm 的启示。** GitHub 的文件树标记和 YouTube 的章节刻度让用户可以快速扫读状态。额外的代码上下文和定位缩略图有明确的使用时机，随任务展开。由此推断，放映工作区的当前播放位置和复盘总数适合留在主视图，定位预览和统计细分适合在需要时展开。[复盘工作台案例与规格](ui-workspace-research.md)

查阅于 2026-11-27。证据来自产品方公开文档、发布说明及其配图。交互行为依据官方说明。
