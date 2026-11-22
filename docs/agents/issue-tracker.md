# Issue 跟踪配置

本项目使用 [cywwycedward/not-my-app 的 GitHub Issues](https://github.com/cywwycedward/not-my-app/issues) 跟踪任务、缺陷和已发布的功能规格。工程 Skill 用 `gh` 读取或发布 Issue。功能的已生效规格从[功能规格索引](../specs/INDEX.md)定位，分诊角色使用[标签映射](triage-labels.md)。

## 读取与发布

执行写操作前，按[人类注意力规范](policies/attention.md)核对授权，并用 `gh repo view --json nameWithOwner` 确认目标。Issue 命令显式加上 `--repo cywwycedward/not-my-app`，避免 fork 或多 remote 的默认目标指向其他仓库。

| 操作 | 命令与约定 |
| --- | --- |
| 读取 Issue 或已发布规格 | `gh issue view <编号> --json number,title,body,state,labels,comments,url` |
| 列出 Issue | `gh issue list --state open --json number,title,state,labels,assignees,url`，按任务补充 `--state`、`--label`、`--search` 或 `--limit`。 |
| 发布到跟踪器 | 创建 GitHub Issue。将多行正文保存到文件，再用 `gh issue create --title "<标题>" --body-file "<正文文件>"` 发布。 |
| 评论 | `gh issue comment <编号> --body-file "<正文文件>"` |
| 更新标签 | 用 `gh issue edit <编号> --add-label "<标签>"` 或 `--remove-label "<标签>"`，标签取自项目映射。 |
| 关闭 Issue | 先用评论记录处理结论，再运行 `gh issue close <编号>`。 |

## 子议题与阻塞关系

- **父子关系。** 创建时加 `--parent <父编号>`。为已有 Issue 建立父子关系时，用 `gh issue edit <父编号> --add-sub-issue <子编号>`。跟踪器不支持原生子议题时，在子项正文写 `Part of #<父编号>`。[GitHub 子议题接口](https://docs.github.com/en/rest/issues/sub-issues?apiVersion=2022-11-28)
- **阻塞关系。** 创建时加 `--blocked-by <阻塞项编号>`。为已有 Issue 增加阻塞关系时，用 `gh issue edit <被阻塞项编号> --add-blocked-by <阻塞项编号>`。跟踪器不支持原生阻塞关系时，在正文写 `Blocked by: #<阻塞项编号>`。[GitHub 议题依赖接口](https://docs.github.com/en/rest/issues/issue-dependencies?apiVersion=2022-11-28)
- **查找可开始的任务。** 用 `gh api --paginate "repos/cywwycedward/not-my-app/issues/<编号>/dependencies/blocked_by"` 读取阻塞项，只将 `state` 为 `open` 的项计作未解决阻塞。使用正文记录依赖时，逐项核对所列 Issue 的状态。全部阻塞项关闭后，任务才处于无阻塞状态。

## Pull requests as a triage surface

**PRs as a request surface: no.**

启用该入口时，PR 按同一[分诊标签映射](triage-labels.md)处理。用 `gh pr view <编号>` 查看详情，另加 `--comments` 读取评论，用 `gh pr diff <编号>` 核对差异。查询分诊队列时，只把外部贡献者提交的开放 PR 纳入候选。仅有编号时，先确认它对应的条目类型，再选用 `gh pr` 或 `gh issue`。

## Wayfinding operations

调用 `wayfinder` 时，先核对仓库的 `wayfinder:` 标签，再按以下约定管理决策议题。

- 路线图是一张带 `wayfinder:map` 标签的 Issue。每张决策票作为其子议题，使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。
- 用 `gh api --paginate "repos/cywwycedward/not-my-app/issues/<路线图编号>/sub_issues"` 列出子议题。按路线图顺序选择开放、尚未分派且没有开放阻塞项的票。使用正文记录父子关系时，从路线图的任务清单定位子项。
- 领取时使用 `gh issue edit <编号> --add-assignee @me`。完成后将结论写入评论，关闭议题，并在路线图的 `Decisions so far` 中留下摘要和链接。
