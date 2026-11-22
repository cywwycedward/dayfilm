# Issue 分诊标签

工程 Skill 使用下表把分诊角色映射为本项目的 GitHub 标签。执行分诊时，每条已分诊的 Issue 具有一个状态和一个分类。标签的读取和更新方式见 [Issue 跟踪配置](issue-tracker.md)。

| 类型 | Skill 角色 | GitHub 标签 | 含义 |
| --- | --- | --- | --- |
| 状态 | `needs-triage` | `needs-triage` | 等待维护者分诊。 |
| 状态 | `needs-info` | `needs-info` | 等待补充复现步骤、需求或其他必要信息。 |
| 状态 | `ready-for-agent` | `ready-for-agent` | 需求、范围和验收条件已清楚，可以交给 Agent 实施。 |
| 状态 | `ready-for-human` | `ready-for-human` | 需要由人实施。 |
| 状态 | `wontfix` | `wontfix` | 已决定不继续处理。 |
| 分类 | `bug` | `bug` | 现有功能出现故障或行为有误。 |
| 分类 | `enhancement` | `enhancement` | 请求新增或改进能力。 |

状态发生变化时替换旧状态标签。发现多个状态标签时，按 `triage` 提出冲突，由维护者确认。发布已就绪的规格或实施票时，按所调用的 Skill 使用 `ready-for-agent`。Wayfinding 决策议题使用 [Wayfinding 标签](issue-tracker.md#wayfinding-operations)。
