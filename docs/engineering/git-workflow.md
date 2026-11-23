# Git 分支与 worktree 规范

开始变更、并行实施、集成或收尾时，先确定目标分支和任务基线。任务分支围绕同一个验收目标组织改动。需要续做时，沿用任务已有的分支和 worktree。

## 分支与基线

| 分支 | 起点与用途 | 集成目标 |
| --- | --- | --- |
| `develop` | 日常集成，验收功能、缺陷修复和工程文档。 | 发布时将已验证的版本合入 `main`。 |
| `main` | 稳定分支，接收已验证的发布内容和已发布版本的紧急修复。 | 发布修复同步到 `develop`。 |
| `feature/<name>`、`fix/<name>`、`docs/<name>` | 通常从 `develop` 开始，分别承载功能、修复和纯文档任务。用简短的连字符名称描述任务，例如 `fix/test-encoding`。 | 默认 `develop`。依赖尚未合入的改动时，经协调从对应任务分支的明确提交开始，并确认集成顺序和目标。 |
| `release/<version>` | 发布准备需要与继续开发隔离时，从已验证的 `develop` 提交开始。 | 合入 `main`，并把发布期间新增的修复同步到 `develop`。 |
| `hotfix/<name>` | 已发布版本需要紧急修复时，从 `main` 的对应发布基线开始。 | 合入 `main`，并把修复同步到 `develop`。 |

1. 开工前用 `git status --short --branch`、`git branch -vv` 和 `git worktree list` 确认当前分支、上游、已有改动及分支所在的 worktree。继续已有任务时，核对交接中的分支、提交和未提交改动。保留工作区内其他任务的修改。新分支名与现有分支存在路径前缀冲突时，选可用的名称。例如本地已有 `docs` 时，新建 `docs/<name>` 会被 Git 拒绝。
2. 需要以远端最新版本为基线时，先运行 `git fetch origin`，再核对本地目标分支与 `origin/<目标分支>`。例如 `git log --left-right --oneline develop...origin/develop` 会显示各自独有的提交。以远端为准时使用刚获取的远端引用，以待集成的本地提交为准时使用明确的提交 ID。若双方已分叉，先核对各自改动和目标再选择基线。
3. 只有对方可以访问的提交或交接材料才能用作跨 worktree 的实现依赖。基线尚有未提交改动时，先确认如何交接。任务分支已发布或被他人依赖时，保留其提交历史。

[Git 分支工作流](https://git-scm.com/docs/gitworkflows) · [git-fetch](https://git-scm.com/docs/git-fetch)

## 创建或复用 worktree

- 当前 checkout 已服务于同一任务时直接复用。并行写入、保留其他工作区的改动，或需要在不同提交上运行验证时，使用独立 worktree 或等效隔离。分支已在某个 worktree 检出时，到该目录继续。如需另外检出同一提交做只读检查，使用 detached HEAD。[多 Agent 协作规范](../agents/policies/collaboration.md)
- 手动创建时，在主 checkout 外选可写且未占用的目录。下面的 PowerShell 示例从主 checkout 根目录运行，使用已核对的本地 `develop`。已有且未检出的本地任务分支用 `git worktree add <路径> <分支>`。按提交临时检查用 `git worktree add --detach <路径> <提交>`。工具托管的 worktree 沿用其路径和生命周期管理。

```powershell
$taskWorktree = '..\dayfilm-fix-test-encoding'
git worktree add --no-track -b fix/test-encoding $taskWorktree develop
git -C $taskWorktree status --short --branch
```

worktree 有各自的工作目录、`HEAD` 和暂存区，分支、标签及默认仓库配置在各 worktree 间共享。创建后在实际任务目录核对当前分支与提交，并按需配置本地依赖。`node_modules`、`dist/` 打包产物和本机采样数据目录 `%APPDATA%\dayfilm` 可能是共享资源；部署、打包或写入前核对实际路径，避免多个任务同时写同一目标。[git-worktree](https://git-scm.com/docs/git-worktree) · [运行与使用](../operations/run.md)

## 提交与集成

1. **提交任务改动。** 按路径暂存本任务的文件，用 `git diff --cached` 核对内容。运行适用的检查，保留已验证的提交 ID 和结果。[测试工作流](../agents/workflows/testing.md)
2. **核对合并方向。** 在用于集成的干净 worktree，用 `git branch --show-current` 确认当前分支就是目标分支。核对待合入的提交与已验证版本相同，用 `git log --oneline <目标>..<来源>` 和 `git diff <目标>...<来源>` 查看来源独有提交和从共同祖先开始的改动。正常发布只将已验证的版本从 `develop` 推进到 `main`。发布修复需要同步时，核对同步范围所带入的全部改动。
3. **保留合并边界。** 任务集成默认使用合并提交。本地合并用 `git merge --no-ff <已验证的来源提交>`。采用 GitHub PR 时，确认 base 是预期目标，head 是已验证的提交，检查结果满足目标分支规则，允许时选 `Create a merge commit`。发布和长期分支之间的集成保留来源提交的祖先关系，便于后续再次同步。如果实际分支规则要求 squash 或 rebase，按适用规则集成，并记录目标提交及来源版本。发生影响实现的冲突时，由变更责任人处理并复验。
4. **验证实际结果。** 在目标 worktree 核对实际合并结果并运行适用检查。交付时说明目标分支、集成提交和验证结果。Agent 在委托范围内操作，推送、开 PR、远端合并或删除远端分支前核对授权和目标仓库。[人类注意力规范](../agents/policies/attention.md)

[git-merge](https://git-scm.com/docs/git-merge) · [GitHub 合并方式](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)

## 标签与发布

发布版本用 annotated tag 标在 `main` 的发布提交上。标签只在验收通过并留有记录后创建，`develop` 和任务分支不打标签。

1. **在发布提交里定版本。** 同一个提交修改 `package.json` 的 `version`，提交信息以 `v<版本>：<改动摘要>` 开头。v1.5.0 起统一用这个写法；v1.2.0 的 `Dayfilm v1.2.0：…` 和 v1.3.0/v1.4.0 的 `v<版本> <主题>：…`（版本后空格）不再沿用。打包产物名直接取 `package.json` 的版本（`Dayfilm-${version}-portable.${ext}`），版本没改就用旧版本号发包。
2. **同一提交补齐该版本的验收材料。** 在 `docs/operations/delivery-verification.md` 增加 `## v<版本> <主题>` 一节，需要界面或交互验收时同时新增 `scripts/probe-v<XY>.mjs`。没有验收节的版本不打标签。
3. **核对标签与版本一致。** `git show <tag>:package.json` 的 `version` 必须等于标签去掉 `v` 的部分；`git merge-base --is-ancestor <tag> main` 返回 `0`，确认标签落在 `main` 历史上。
4. **用 annotated tag，信息对齐提交主题。** `git tag -a v<版本> -m "v<版本> <主题>（交付版）"`。主题可缩写为改动要点，例如 v2.6.0 的提交主题是四段改动，标签写“音效可调/批量标记/周正片口径”。基线类发布可省 `（交付版）`。发布不使用轻量标签。
5. **推送标签需单独授权。** 提交和分支推送不会带上标签，用 `git push origin v<版本>` 或 `git push --follow-tags` 显式推送。标签一旦到远端即对外可见，按[人类注意力规范](../agents/policies/attention.md)核对授权。
6. **发现打错。** 先用 `git ls-remote --tags origin <标签>` 确认远端没有该标签，再 `git tag -d <标签>` 重打，并重新核对版本一致。已在远端的标签不改指向，用新版本号另发。
7. **缺号不补。** 版本号只增不回溯，跳过的号在验收记录里说明去向。例如 `v2.3.0` 之后直接是 `v2.5.0`，v2.4 导演剪辑版的规划留在 `docs/delegate/brief-main7.md`，实际随 v2.5.0 交付。

[git-tag](https://git-scm.com/docs/git-tag) · [git-push](https://git-scm.com/docs/git-push)

## 清理 worktree 和任务分支

1. **确认改动有去处。** 用 `git -C <路径> status --short --untracked-files=all --ignored=matching` 检查暂存、未暂存、未跟踪和被忽略的文件，先保全要留存的改动、配置和测试产物。临时 detached worktree 里如有要保留的提交，先用分支保存。[git-status](https://git-scm.com/docs/git-status)
2. **确认已进入实际目标。** 用 `git merge-base --is-ancestor <任务提交> <目标引用>` 检查任务分支尖端是否可从目标到达。远端集成用刚获取的目标引用，例如 `origin/develop`。退出码 `0` 表示可达，`1` 表示不可达，其他非零值表示命令出错。squash 或 rebase 时，通过已合并 PR 或目标提交的差异核对已纳入的来源版本，确认分支尖端的改动已完整集成。尚未集成或仍被其他任务依赖的分支继续保留。[git-merge-base](https://git-scm.com/docs/git-merge-base)
3. **移除 worktree。** 先退出占用目录的终端和进程，从仍保留的 checkout 运行 `git worktree remove <路径>`，或通过创建它的管理工具移除。Windows 上若目录含 NTFS junction，使用含 2.54.0 junction 清理修复的 Git for Windows，或先安全移除链接本身。操作后核对 `git worktree list` 和磁盘目录。确认目录已删除但登记仍在时，用 `git worktree prune --dry-run --verbose --expire now` 预览。`prune` 检查整个仓库，确认列出的登记均可移除后，再去掉 `--dry-run` 执行。工作目录被搬迁时用 `git worktree repair <新路径>` 修复登记。[Git for Windows 2.54.0 发布说明](https://github.com/git-for-windows/git/releases/tag/v2.54.0.windows.1) · [git-worktree](https://git-scm.com/docs/git-worktree)
4. **删除任务分支。** 确认该分支已完成集成、无人依赖且未被任何 worktree 检出后，优先用 `git branch -d <分支>`。`-d` 优先检查可解析的分支上游，找不到上游时检查当前 `HEAD`，所以先按第 2 步核对实际目标。若因 squash 或 rebase 被拒绝，保留分支，待核实目标提交和留存需要后由获授权的责任人处理。远端分支按仓库规则和授权单独清理。[git-branch](https://git-scm.com/docs/git-branch)

## 仓库依据

当前只有 `main` 一个分支（`git branch -a` 只列出 `main` 与 `origin/main`），历史线性、没有合并提交（`git rev-list --merges --count HEAD` 为 `0`），也只有仓库根目录一个 checkout（`git worktree list` 只列出一条）。版本以 `v1.2.0`–`v2.6.0` 共 11 个标签打在 `main` 上（`git tag --list`）。因此上表是目标状态：`develop`、`release/*` 与任务分支尚未建立。

建立 `develop` 之前，任务分支从 `main` 切出、合回 `main`，其余规则不变；建立之后可用 `git log --first-parent --oneline develop` 核对功能、修复与文档各自的合并提交，用 `git show --no-patch <提交>` 核对 `--no-ff` 留下的合并边界。

标签的现状：11 个 annotated tag 全部落在 `main` 的历史上（`git merge-base --is-ancestor` 逐个返回 `0`）；除 `v1.2.0` 外每个标签的 `package.json` `version` 都与标签一致，`v1.2.0` 处仍是 `1.0.0`。`v2.3.0` 之后直接是 `v2.5.0`，`v2.4.0` 未发布。远端 `origin` 没有任何标签（`git ls-remote --tags origin` 为空），发布标签目前只存在于本地。发布提交的构成可用 `git show --stat b2d47e3` 核对：`package.json` 版本号、`docs/operations/delivery-verification.md` 的 v2.6 节与 `scripts/probe-v26.mjs` 在同一提交内；标签对象用 `git cat-file -p v2.6.0` 查看。
