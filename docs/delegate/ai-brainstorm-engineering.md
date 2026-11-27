# Dayfilm AI 落地的工程可行性

约束前提：Windows Electron 33、无生产依赖、两个渲染进程 `sandbox:true` + CSP 只允许本地资源、数据只在本机、便携版单 exe **78.3 MB**（实测，`dist/Dayfilm-2.6.0-portable.exe`）、常驻 RSS 预算 300 MB（实测已用 **249–254 MB**，`docs/operations/perf-report.md`）。

本文数字除标注「实测」外均为估算（量级）。实测值一律引自仓库已有记录，不另造数据。

本文只谈"能不能落地、代价多少、怎么收口"，不谈产品愿景。

---

## 0. 结论速览

| # | 路线 | 位置 | 模型来源 | 对"不联网" | 体积增量 | 单次延迟 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 模板 + 槽位评语 | 主进程（纯函数） | 无模型 | 无影响 | 0 | < 1 ms | **先做，必做** |
| R2 | 标题归一化 + TF-IDF/余弦 | 主进程（纯函数） | 无模型 | 无影响 | 0 | 5–20 ms | **做，复用 R1 通道** |
| R3 | 本地 GGUF 侧车（BYO 模型文件） | 独立子进程（stdio 行 JSON） | 用户自备 `.gguf` | 无影响（不开 socket） | exe +15–25 MB，模型不入包 | 冷启 2–4 s + 生成 10–45 s | **可选，默认关，不进默认路径** |
| R4 | 连 Ollama / LM Studio | 主进程 `node:http` → 127.0.0.1 | 用户自装本地服务 | 措辞要改，需评审豁免 | 0 | 3–15 s | **质量最高的廉价出口，默认关** |
| R5 | BYO 云端 API key | 主进程 HTTPS | 云端 | **直接违背，需重写不可让步项** | 0 | 1–3 s | **不做**（或独立发布渠道） |
| R6 | 本地轻量分类器（LR / NB） | 主进程（纯函数） | 无模型，自监督于 `marks.json` | 无影响 | < 200 KB | < 1 ms | **等有 30 天标注再做** |

每条路线按任务书的七问顺序展开：① 运行位置 ② 模型来源 ③ 对「不联网」的影响 ④ 打包与体积 ⑤ 延迟与内存 ⑥ 可测试性 ⑦ 失败模式。表中延迟、内存、体积为估算；模型本身没有实测，只有仓库基线可引（exe 78.3 MB、RSS 249–254 MB、冷启动 630–930 ms、30 天数据 106.9 MB）。

推荐组合：**R1 + R2 立刻交付**（拿到 AI 摘要约 80% 的体感，估算，无用户测试支撑；零体积零风险），**R4 作为可选高质量出口**默认关闭，**R3 只在用户主动指向 `.gguf` 时启用**，R5 从产品里划掉。

---

## 1. 约束基线（代码事实，不是推测）

| 事实 | 证据 | 对 AI 的含义 |
| --- | --- | --- |
| 渲染层 CSP 没有 `connect-src`，由 `default-src 'self'` 兜底 | `src/renderer/index.html:6`、`src/renderer/hud.html:6` | 渲染层连 `http://127.0.0.1:11434` 也会被拒。**"界面直连本地模型"这条路直接出局**，任何模型都只能挂在主进程或子进程 |
| 网络守卫是 session 级 | `src/main/index.ts` `installNetworkGuard()`：`session.defaultSession.webRequest.onBeforeRequest`，打包后 `allowLoopback=false` | 它只管渲染进程的 Chromium 网络栈；主进程的 Node `fetch`/`node:http` 不受它约束。所以"守卫还在就等于不联网"是错觉，**R4/R5 必须另立可审计点** |
| 本地判定是纯函数 | `src/main/security/index.ts` `isLocalRequest()` | 若要放行回环，改这一个函数 + 它的两条测试就够，`security-paths.test.ts` 已有路径展开用例 |
| 已有"子进程 + 行 JSON + 退避重启 + 杀进程树"的完整范式 | `src/main/capture/index.ts`（`createCapture`，注入 `spawnChild` / `now` / `schedule` / `killTree`） | AI 侧车照抄这个形状即可，不必发明新机制 |
| 已有"模板生成文本"的先例 | `reel/rules.ts` `judge()`、`renderer/src/lib/narration.ts`、`renderer/src/lib/week-film.ts` 周导演评语 | **"AI 摘要"在这个产品里已经存在，只是没这么叫**；R1 是升格与抽象，不是新功能 |
| 检索是子串匹配 | `reel/index.ts` `searchScenes()`：`title.toLowerCase().includes(needle)` | 语义检索的空白在这里；归一化是收益/成本比最高的一刀 |
| 便携版每次启动解压到 `%TEMP%`，当前 exe 78.3 MB（实测；v1.0.0 为 76.3 MB，见 `delivery-verification.md`） | `security/index.ts` 注释（8.3 短名问题）、`electron-builder.yml` `target: portable` | **模型打进 exe 是不可行的**：+1 GB 意味着每次启动解压 1 GB |
| 常驻 RSS 已用 249–254 MB / 预算 300 MB（实测） | `docs/operations/perf-report.md` | 只剩约 50 MB 余量。**任何常驻模型都在预算外**：0.6B Q4 也要再吃 0.8–0.9 GB（估算） |
| 无生产依赖 | `package.json` 只有 devDependencies | `onnxruntime-node` / `node-llama-cpp` 会同时引入三条新负担：生产依赖、原生 ABI（需 `electron-rebuild` 对 Electron 33）、asar unpack |

---

## 2. 六条路线与不建议做的边界

### R1 · 模板 + 槽位评语（无模型）

1. **位置**：主进程，纯函数；渲染层只显示结果。
2. **模型来源**：无。模板库 + 槽位（最长镜头、最忙 30 分钟、正片/花絮占比、项目分布、与上周对比）+ 按 `inputHash` 选模板（确定性变体，不是随机）。
3. **不联网**：完全无影响。不需要改 CSP、不改 `security/index.ts`、不需要豁免。
4. **打包体积**：+0。
5. **延迟/内存**：< 1 ms，几十 KB 常量字符串。
6. **可测试性**：最好。同输入同输出，`tests/renderer/narration.test.ts`、`week-film.test.ts` 已经把这类断言写透了，照抄。
7. **失败模式**：只有"槽位缺数据"（无镜头、无上周、无项目）→ 各有固定退路句，与 `judge()` 的 `'今天还没有形成长镜头。'` 同构。

> 现在 `verdict.note` 是一句话，周评语是另一种口径，放映字幕又是第三种。R1 的实际工作是**把这三种收成一个 `src/shared/comment.ts` 的模板 + 槽位引擎**，让"日评语 / 周评语 / 字幕"共用同一套槽位。这是重构收益，不是新功能。

### R2 · 标题归一化 + 本地统计检索（无模型、无神经网络）

1. **位置**：主进程纯函数，进 `searchScenes` 之前先归一化。
2. **模型来源**：无。规则归一化（去 `— app` / `- app` 后缀、去路径前缀、去未读计数 `(3)`、数字→`#`、全半角与大小写统一、去 `*` 脏标记）+ 字符 2-gram TF-IDF（标题没有空格，中文按 bigram 切）+ 余弦。
3. **不联网**：无影响。
4. **体积**：0（词表从当次查询的 7 天镜头现算，`DayCache` 已有这 7 天）。
5. **延迟/内存**：7 天 × 数千镜头做一次 TF-IDF，10–20 ms；热路径不进。内存几 MB，随 LRU 一起释放。
6. **可测试性**：极好，纯函数。归一化是纯字符串变换，用例好写（`dayfilm — src/main/reel/index.ts` 与 `dayfilm - ARCHITECTURE.md` 应归到同一"作品名"）。
7. **失败模式**：意图外的过度归并（把 `Bank` 和 `bank` 归并是想要的，把两个不同项目归并是坏的）→ 归一化只用于**召回排序**，不改写存储里的原文；用户仍可用子串搜索。

### R3 · 本地 GGUF 侧车（用户自备模型文件，stdio）

1. **位置**：独立子进程。`resources/` 里放一个 llama.cpp 的静态构建（`llama-cli` 或自带 `--json` 模式的极简 server 二进制，`extraResources`），主进程用 `spawn` + stdin/stdout 行 JSON 通信。**不用 `node-llama-cpp`**：原生 `.node` 要匹配 Electron ABI、要 asar unpack、便携版在 `%TEMP%`（8.3 短名已踩过坑），三个坑换 `capture.ps1` 那套已验证的子进程治理。
2. **模型来源**：用户在设置里指向一个本机已有的 `.gguf`。**不做首启下载**——那与"不联网"直接冲突。
3. **不联网**：不破坏。子进程只读本地文件、只说 stdio，全进程零 socket。承诺原文是"不发起网络请求"，不是"不跑模型"；但 UI 必须写清"模型在你自己的机器上跑，与联网无关"，否则用户会把"AI"直接等同于联网。CSP 与 `security/index.ts` 一个字不改，"启动时零站外请求"这条审计可以整条保留。
4. **打包体积**（估算）：exe 78.3 MB（实测）→ 约 95–105 MB（llama.cpp Windows 静态构建 15–25 MB，多架构变体更大，只留 AVX2）。模型不入包：0.6B Q4_K_M 约 0.40 GB、1.5B Q4_K_M 约 1.0 GB（估算），留在用户磁盘上。
5. **延迟/内存**：见第 3 节 (a)。关键设计是**不常驻**：点"生成评语"才起，空闲 60 秒退出，`before-quit` 里 `taskkill /T /F` 收进程树（`capture` 已有这个函数）。
6. **可测试性**：`CommentEngine` 接口注入；侧车传输层用 `spawnChild` 假实现（`createCapture` 的做法）；CI 里没有 `.gguf`，测试覆盖的是"模型缺失 → 降级到模板"这条路径。`tests/perf/bench.test.ts` 完全不受影响（AI 不在 `rollup`/`broadcast`/`DayCache` 路径上）。
7. **失败模式**：
   - 模型缺失 / 路径失效 → `AiState.state='unavailable'`，返回模板评语，UI 一行灰字，不弹窗。
   - OOM → 子进程被杀 / 无输出 → 8 s 超时 → 降级；连续失败两次后本次会话不再自动尝试。
   - 超时 → `AbortController` 8–20 s（按 token 数算预算），同上降级。
   - 输出不合 schema → 长度不在 20–400 字、或含 `\n\n` 多段、或含原始标题片段 → 丢弃取模板。
   - 用户断网 → 无影响（本来不用网）。但**杀软可能拦**：未签名 exe 从 `%TEMP%` spawn 另一个未签名 exe，Defender 有概率隔离。这是 R3 最现实的落地风险，需要在验收里实测。

### R4 · 本地推理服务 HTTP（Ollama / LM Studio，默认关）

1. **位置**：主进程 `node:http`，目标写死 `127.0.0.1` / `[::1]` 字面量（不做 DNS、不跟 redirect）。渲染层不参与（CSP 也不允许）。
2. **模型来源**：用户自己装的服务，7B/8B 随便跑，质量是六条里最好的。
3. **不联网**：**不算破坏，但措辞必须改**。
   - 不用改 CSP。
   - `security/index.ts` 的 `isLocalRequest` 也不一定要改——它守的是渲染 session，主进程直连绕开它。但"绕开"必须写成明文豁免，否则 `R15.5`（"可用进程级网络禁用或代码评审确认"）就失效了。做法：`src/main/ai/transport.ts` 里只允许 `hostname ∈ {'127.0.0.1','[::1]'}`、`port` 白名单、`node:http`（不用 `fetch`，避免 env 代理）、无重定向；加一条单测钉死这三条。
   - `PRODUCT.md`「无网络请求」→「不访问互联网；AI 只在本机，可选对接 `127.0.0.1` 上的本地推理服务（默认关闭）」。README 首段与"数据"段同步。
   - "启动时零站外请求"如何保持：默认关闭 → 启动路径上不构造任何客户端；只有用户显式点"生成"且设置里有可用端点时才建连接。加一条测试：默认设置下 `createAiEngine()` 不产生任何 transport 实例。
4. **体积**：+0。
5. **延迟/内存**：空闲 0（模型在别人进程里）；生成 3–15 s（7B Q4 在 8 GB 机器上大约 6–10 tok/s，200 字约 25–35 s，所以 200 字要按 30 s 预算，或者只生成 60–80 字）。这暴露一件事：**别指望"点一下立刻出字"**，UI 必须是异步"放到后台生成、好了通知"。
6. **可测试性**：注入 `transport` 假实现即可；真实链路不测（需要用户环境）。降级测试同 R3。
7. **失败模式**：服务没装 → 连接 `ECONNREFUSED` → 模板降级；服务在但没拉模型 → 4xx → 模板降级；用户改了端口 → 设置里可填，连不上就继续降级。全都不阻塞 UI。

### R5 · BYO 云端 API key（不建议）

1. **位置**：主进程 HTTPS。
2. **模型来源**：用户 key。
3. **不联网**：**直接违背**，不是措辞问题。
   - `PRODUCT.md` 的"不可让步的产品真相：隐私——不截屏、不联网、标题可脱敏"要改写或删条。
   - README 首段"不联网"、数据段"数据只在本机"要重写。
   - CSP 不用改（主进程发）；`installNetworkGuard` 管不到主进程，等于**今天唯一的技术防线对这条路线完全无效**——只剩代码评审。
   - 脱敏只是标题关键词替换，**送去云端的仍是完整的进程名 + 时间序列 + 项目名**，这与"数据只在本机"是同一句话的反面。
   - UI 措辞：设置页必须逐项列出「会发送：日期、镜头起止、进程名、标题、项目名」，首次启用做二次确认，并给「删除 key」入口；按钮旁写明目标 host。三样缺一，就是拿「不联网」的旧文案骗用户。
   - 启动禁令：即便已存 key，启动路径也不探测、不预热、不发请求；只有用户显式点「生成」才建连接。
4. **体积**：+0。
5. **延迟/内存**：最好（1–3 s）。
6. **可测试性**：注入 client 即可，但"合规"无法用测试证明。
7. **失败模式**：断网 / 额度耗尽 / key 失效 / 供应商改 schema；每一项都要 UI 解释，且用户会认为"你说了不联网"。

> 结论：R5 不是工程问题，是产品定位问题。要做就做成独立发布渠道或编译期开关（`__AI_CLOUD__`），不进 portable exe 的默认路径。

### R6 · 本地轻量分类器（纯 TS，自监督）

1. **位置**：主进程纯函数。
2. **模型来源**：无预训练模型。特征 = 进程名 one-hot + 标题归一化 token + 时长桶 + 时段桶；标签来自 `marks.json`（正片/花絮）与 `projects` 规则命中。逻辑回归 / 朴素贝叶斯，权重是 JSON，几百 KB。
3. **不联网**：无影响。
4. **体积**：权重 < 200 KB。
5. **延迟/内存**：< 1 ms / 几 MB。30 天 × 数千镜头，20 维，秒级训练（可放主进程空闲时算）。
6. **可测试性**：极好。固定训练集 → 固定权重 → 固定预测，纯函数。
7. **失败模式**：冷启动无标签（< 50 个镜头）→ 不启用，退回现有 `autoExtraUnderSec` 阈值；标注少导致过拟合 → 只在置信度 > 0.8 时给"建议"，不自动改标记。**注意：这会和"自动花絮"设置打架，需要明确"建议"与"规则"的优先级。**

### 不建议做（一条一句，结论在前）

- **用户自带云端 key（R5）**：把进程名、标题时间线与项目名送出机器，与「数据只在本机」是同一句话的反面 —— 不做，除非另开一个不叫 Dayfilm 的发布渠道。
- **视觉理解（截图 / 多模态）**：产品第一句就是「不采集屏幕内容」，且截图会把刚脱敏的标题重新变成原文 —— 不做。
- **渲染层 WebGPU 跑模型**：`default-src 'self'` 加 `sandbox:true` 没有模型加载路径，显存与驱动也不可控 —— 不做。
- **首启下载模型**：与「不联网」直接冲突，便携版还每次把整包解压到 `%TEMP%` —— 不做。
- **`node-llama-cpp` / `onnxruntime-node` 这类 npm 原生绑定**：生产依赖 + Electron 33 ABI + asar unpack 三笔债，只为省掉一个子进程 —— 不做，要侧车就用 `extraResources` 里的静态二进制。
- **embedding 语义检索（bge-small + ONNX）**：25–95 MB 模型 + 30–40 MB 运行时（估算），换来「检索稍微聪明一点」，不如先做归一化 + TF-IDF —— 暂不做，除非有用户明确抱怨检索。

---

## 3. 特别回答

### (a) "AI 摘要/评语"的最小可信推理方案

**方案**：R3 + 用户提供的 GGUF，`Qwen3-0.6B-Instruct` 或 `Qwen2.5-1.5B-Instruct`，`Q4_K_M` 量化；输入不是原始采样，而是 R1 槽位引擎算好的**聚合 JSON（≤ 300 token）**；输出 60–150 字。

| 模型 | 文件 | 进程 RSS（4k ctx） | 8 线程 tok/s | 4 核 tok/s | 150 字输出（≈180 tok） |
| --- | --- | --- | --- | --- | --- |
| Qwen3-0.6B Q4_K_M | 0.40 GB | 0.8–0.9 GB | 40–60 | 20–30 | 3–9 s |
| Qwen2.5-1.5B Q4_K_M | 1.0 GB | 1.4–1.6 GB | 20–30 | 8–14 | 13–23 s |
| Qwen2.5-3B Q4_K_M | 1.9 GB | 2.5–2.7 GB | 10–14 | 4–7 | 26–45 s |

（上表 RSS、tok/s、耗时**全是估算**，仓库里没有模型实测。能引的实测只有周边基线：exe 78.3 MB、常驻 RSS 249–254 MB、冷启动 630–930 ms、30 天数据 106.9 MB、堆 66–68 MB（`docs/operations/perf-report.md`）。落地前必须在目标机器上用 `llama-bench` 跑一次 prefill/decode，别按上表做对外承诺。prompt prefill 另算：400 token 在 1.5B 上约 1.5–4 s，同为估算。）

**4–8 GB 普通办公机可行性**：

- **8 GB / 4 核以上：1.5B 可行**（估算：模型 RSS 1.4–1.6 GB + Electron 常驻 249–254 MB 实测），前提是异步后台生成（用户点按钮，切走干别的，好了通知），并且**不常驻**。质量勉强能写出"像人话的评语"，但会定期说空话。
- **4 GB：不可行**。Windows 11 自己吃 2.5–3.5 GB（估算），Electron 常驻 250 MB（实测），再叠 1.5 GB 模型必然触发换页；而且这类机器通常是 2 核，tok/s 再减半，150 字要 60 s 以上（估算）。4 GB 上唯一能跑的是 0.6B，但 0.6B 的中文评语质量**达不到"可信"**——它会正确复述数字，然后接一句放之四海皆准的套话。花 0.8–0.9 GB（估算）换一句套话，不如 R1 的模板。
- **"最小可信"的真实答案**：可信度来自**槽位提供的证据**，不来自模型。R1 的模板已经能写出"最长的一个镜头是 Code 的 47 分钟"，模型的价值只在**把证据组织成不像模板的句子**。所以 1.5B 是下限，0.6B 是"能跑但别宣传"。

**量化档位**：`Q4_K_M` 是拐点，`Q5_K_M` 对 1.5B 只提升一点点但 +15% 体积，`Q8` 不值得。KV cache 用默认 F16、ctx 锁 4096（评语场景 2048 就够）。

**确定性**：`temperature 0.3 + 固定 seed` 只能让**同一台机器同一次运行内**稳定，跨 llama.cpp 版本 / 跨 CPU 优化路径不保证逐字一致。所以：**不承诺"生成可复现"，只承诺"生成后不再变"**——评语落盘，带 `inputHash`，数据没变就不重生成。这与 `PRODUCT.md` 的"不引入随机"不冲突：渲染永远是确定的，生成是显式的一次性动作。

### (b) 不要生成模型、不要联网，能不能拿到 80% 价值

能，前提是把"AI 摘要"的目标从"像 ChatGPT 那样说话"降级成"说人话地把数据讲清楚"。**这个产品现在已经在做这件事**（`judge()` 的题材点评、`week-film.ts` 的周导演评语、`narration.ts` 的放映字幕），只是分散在三处、口径不一、没说这是 AI。

下表的"能做到/做不到"与百分比都是判断与估算，没有用户测试；唯一可实测的是耗时量级与零体积。

| 手段 | 能做到 | 做不到 |
| --- | --- | --- |
| **模板 + 槽位**（30–50 模板 × 10 槽位，按 `inputHash` 选模板） | 日评语、周评语、字幕、导出剧本里的一句话结论；覆盖现有三处口径并统一；**体感的 60–70%** | 开放问题（"我下午到底在干嘛"）、真正的概括与因果、用户没见过的句式 |
| **标题归一化 + 实体抽取**（去 `— app` 后缀、去路径、数字占位、大小写/全半角；用分隔符与后缀规则抽应用名/文件名/分支名） | 检索召回大幅提升；"同一件事"的多个标题归并；为一周的故事线提供干净的题材名 | 语义相似（"修 bug" vs "改缺陷"）、跨语言；抽错的实体没有回退信号 |
| **TF-IDF / 余弦**（字符 2-gram，纯 TS，现算 7 天） | "找相似的一天"、"这一天像上周三"、按主题给镜头分组；10–20 ms | 句子生成；短标题（2–5 词）上 TF-IDF 信号很弱 |
| **聚类**（标题 token 共现 + 时间邻接，纯 TS 层次聚类） | 把一天自动切成 3–5 个"幕"、把一周镜头归成故事线；不需要模型，界面上就是分组的框 | 不会给幕起名（还得回到模板）；短会话会聚成噪声；必须限到镜头级（几百条），不能对 5 万条采样做 O(n²) |
| **本地轻量分类器**（LR/NB，自监督于 marks/projects） | 自动花絮建议、项目归属猜测、"这条像不像正片"；可解释（权重可展示） | 冷启动（< 50 标签不可用）；不能写评语 |
| **embedding**（bge-small-zh ONNX，25–95 MB + 30–40 MB 原生运行时） | 真语义相似、"按意思找" | **工程代价不对**：引入生产依赖 + 原生 ABI + 便携版解压路径三个坑，换来的是"检索稍微聪明一点"。先做归一化 + TF-IDF |

**结论**：R1 + R2 组合 ≈ AI 摘要的约 80% 体感（估算，无用户测试），+0 MB、+0 ms 常驻、100% 可断言、100% 确定。剩下 20%（真的会组织语言）才需要模型，而那 20% 的价格是"用户自己准备 1 GB 模型文件 + 20 秒等待"（估算，按 1.5B / 8 线程）。

### (c) 最小接口形状（只描述形状）

**类型放哪**：新建 `src/shared/ai.ts`，不动 `types.ts`（减少爆炸半径），照 `src/shared/projects.ts` 的先例（v1.1 取舍里"主进程与界面都要用同一组纯函数"那条）。

```text
src/shared/ai.ts
  CommentSource = 'template' | 'model'
  DayComment   { date; text; source; inputHash; generatedAt }
  AiState      { engine: 'off' | 'template' | 'model'
                 state: 'idle' | 'running' | 'unavailable' | 'error'
                 detail: string | null; model: string | null }
  Settings 追加 ai: { mode: 'off' | 'template' | 'model'; modelPath: string }
    默认 { mode: 'template', modelPath: '' }   // 默认 template：零成本，且不是"AI 未启用"
```

**IPC 一个通道就够**：

```text
IPC.aiComment = 'dayfilm:ai-comment'   // invoke(date) → DayComment
```

落地要改的 5 处（这是这个仓库的契约扇出，`tests/main/ipc.test.ts` 会一个个钉住）：

| 文件 | 改动 |
| --- | --- |
| `src/shared/ipc.ts` | `IPC` 加通道名；`DayfilmApi` 加 `aiComment(date): Promise<DayComment>` |
| `src/main/ipc/index.ts` | `GUARDED_CHANNELS` 加一项；`IpcDeps` 加 `aiComment`；`createHandlers` 加一行 |
| `src/main/index.ts` | `registerIpc` 里接线：取 `rollupFor(date)` → 查缓存 → 命中返回 / 未命中调 engine → 落盘 → 返回 |
| `src/preload/index.ts` | 一行 `ipcRenderer.invoke` |
| `tests/main/ipc.test.ts` | `fakeDeps()` 加一个 `track('aiComment', …)` |

**推送**：不要塞进 `LiveState`/tick（每 2 秒一推，且会让 `LiveState` 的改动扩散到渲染层全部 24 个测试文件）。只在 `running` 变化时发一条 outbound `dayfilm:ai-state`，preload 加 `onAiState(cb)`（与 `dayfilmProjection.onToggle` 同构）。

**引擎接口**（主进程内部，不进 shared，不进 IPC）：

```text
interface CommentEngine {
  id: 'template' | 'model'
  comment(day: DayRollup, ctx: { note?: string; projects: ProjectRule[]; previous?: DayRollup[] }): Promise<string>
}
```

两个实现：`templateEngine`（纯函数、同步、永远成功）+ `modelEngine`（包 sidecar/HTTP，带 `AbortSignal`）。
`createHandlers` 只依赖一个 `aiComment(date)`，所以 `ipc.test.ts` 里给它一个 `async () => ({...})` 就行——**测试永远不碰模型**。

**失败怎么降级**：`aiComment` 永不 reject。

1. `engine.comment()` 抛错 / 超时（默认 20 s，`AbortController`）/ 返回不合 schema（长度 20–400、无换行、无原始标题片段）→ 返回 `templateEngine` 的结果，`source: 'template'`，`AiState.detail` 记原因。
2. UI：正文照常显示，旁边一行灰字"模板评语 · 模型不可用"，不弹窗、不 toast、不阻塞导出。
3. 同一会话连续失败 2 次 → `AiState.state='unavailable'`，不再自动重试，只有用户再点按钮才试。

**缓存**：`%APPDATA%\dayfilm\comments.json`，`Record<date, DayComment>`，tmp + rename 写（照 `notes.json`），损坏按空集合处理，`inputHash ≠ 当前 rollup 指纹`视为过期。**过期不自动重生成**（否则模型一装好就会在用户没点的时候跑 30 秒）。

### (d) 现有架构里会直接和 AI 打架的约束，以及怎么收

| 冲突 | 为什么冲突 | 收法 |
| --- | --- | --- |
| **确定性渲染**（"同一份数据任何时候渲染结果一致，不引入随机"） | LLM 输出不保证可复现（跨版本、跨 CPU 优化路径） | 生成**只发生在用户显式动作**时，一次落盘；渲染只读已存文本。测试只断言模板引擎；模型输出永不进测试断言。`temperature 0.3 + seed` 只是"尽量稳"，不作为承诺 |
| **纯函数可测**（切分层是纯函数，不读文件不看时钟） | 模型是外部状态 + 时间 + 内存 | `CommentEngine` 接口隔离；AI 层只吃 `DayRollup`，不读文件不看时钟；sidecar 的 `spawnChild` / 时钟 / 定时器全部注入（照抄 `createCapture`） |
| **sandbox + CSP** | 沙箱里没有模型加载路径；`default-src 'self'` 连回环都拒 | 模型只在主进程/子进程；CSP **一个字不改**；渲染层只多一个 `invoke` |
| **无生产依赖** | 任何 ONNX / llama 绑定都是生产依赖 + 原生 ABI + asar unpack | R1/R2/R6 零新依赖；R3 用 `extraResources` 里的静态二进制（不是 npm 包，绕开 ABI 与 unpack）；R4 用内置 `node:http` |
| **便携版单 exe 体积** | 78.3 MB（实测）→ 加 1 GB 模型 = 每次启动解压 1 GB；加 25 MB 二进制 = 每次启动多解压 25 MB | 模型**永不入包**（BYO `.gguf` 路径）；侧车二进制只接受 ≤ 25 MB 的 AVX2 静态构建。首启下载直接否决 |
| **常驻 RSS ≤ 300 MB / 空闲 CPU ≤ 0.5%** | 实测已用 249–254 MB，0.6B Q4 也要再吃 0.8–0.9 GB（估算） | 模型不常驻：按需起、空闲 60 s 退出、`before-quit` 杀进程树；`--threads (cpus-1)`、进程优先级降到 BelowNormal |
| **启动 ≤ 2 s**（实测 630–930 ms） | 任何启动期加载模型都会破 | 启动路径零 AI 代码：`createAiEngine()` 惰性构造，只有 `aiComment` 第一次被调时才实例化 |
| **网络守卫的可审计性**（R15.5） | 守卫是 session 级，主进程 Node 不受约束 | 默认零网络：R1/R2/R3/R6 不开任何 socket；R4 是唯一例外，写成明文豁免 + 三条单测（只 `127.0.0.1`/`[::1]`、无 redirect、无 DNS、默认不构造）+ `PRODUCT.md` 措辞 |
| **性能基准**（`tests/perf/bench.test.ts` 有硬门槛：全量 < 50 ms、追加 < 1 ms、冷检索 < 1500 ms） | AI 一旦进 `rollup` / `broadcast` / `DayCache` 就会拖慢 | AI 不进这三条路径；可选加一条 `tests/perf` 断言"模板评语 < 1 ms"（不进同一进程的重活） |
| **`LiveState` 每 2 秒广播** | 把 AI 状态塞进去会让每 2 秒多传一个大对象，并扩散到全部渲染测试 | 独立 outbound 通道，只在状态变化时发 |
| **脱敏只在落盘前** | 聚合里已经有标题，模型会吃到（本地没关系，云端有关系） | R3/R4 的 prompt 只喂**聚合统计**（进程名、时长、题材），默认不喂标题原文；如果喂标题，必须过一遍 `redact` 并让用户看见"会发送什么" |

---

## 4. 建议的实施顺序

1. **R1**（`src/shared/comment.ts` 模板 + 槽位引擎，把 `judge()` / `narration.ts` / `week-film.ts` 三处口径收敛）+ `src/shared/ai.ts` 类型 + 一个 IPC 通道 + `comments.json`。零新依赖，可独立交付，且**没有模型也能用**。
2. **R2**（归一化进 `searchScenes` 的召回排序）。复用 R1 的通道，不新增契约。
3. **R4** 作为可选高质量出口，默认关，设置里填端点。成本最低、质量最好，唯一代价是 `PRODUCT.md` 一句措辞。
4. **R3** 只在"用户愿意自己准备 `.gguf`"时做，不进默认路径；先用 `logs` 验证杀软不拦。
5. **R6** 等真实用户攒够 30 天 `marks.json` 再说。
6. **R5** 不做。

## 5. 要改的文档清单

- `PRODUCT.md`：「不可让步的产品真相 → 不联网」：采纳 R4 时改为"不访问互联网；AI 只在本机，可选连接 `127.0.0.1` 的本地推理服务（默认关闭）"。只做 R1/R2/R3/R6 则**一个字不用改**。
- `README.md`：数据段加 `comments.json`（若是 R3，加"模型文件由用户提供，不入包"）。
- `docs/data/store-format.md`：新增 `comments.json` 格式（`Record<date, DayComment>`，损坏按空）。
- `docs/api/ipc-contract.md`：新增 `dayfilm:ai-comment` 与 `dayfilm:ai-state`。
- `docs/architecture/dayfilm.md`：分层表加"AI 层：`src/main/ai`，只依赖 `DayRollup` 与 `src/shared/ai.ts`，不依赖 Electron、不读文件、不看时钟"，并补一条"v3 的取舍"。
- `docs/specs/`：加 R70 起的规格（评语口径、降级行为、模型缺失、设置项）。
- `docs/operations/perf-report.md`：加一条"评语生成（模板 < 1 ms / 模型 8–45 s）与 RSS 增量"。
- 若采纳 R5：`README` 首段、`PRODUCT.md` 隐私段、UI 的逐次发送确认，全部重写。**这是我不建议的那条。**

## 6. 失败模式总表

| 场景 | R1/R2 | R3 | R4 | R5 |
| --- | --- | --- | --- | --- |
| 模型/服务缺失 | 不适用 | `unavailable` + 模板 | `ECONNREFUSED` + 模板 | key 缺失 + 模板 |
| OOM | 不适用 | 子进程死 → 超时 → 模板；连败 2 次停用 | 别人进程，自己不受影响 | 无 |
| 生成超时 | 不适用 | 20 s Abort → 模板 | 20 s Abort → 模板 | 20 s Abort → 模板 |
| 输出不合 schema | 不适用（编译期就是类型） | 长度/换行/标题片段校验 → 丢弃取模板 | 同左 | 同左 |
| 用户断网 | 无影响 | 无影响 | 无影响 | **直接失败**，且与"不联网"承诺同时爆炸 |
| 杀软/签名 | 无影响 | 未签名侧车从 `%TEMP%` 起，可能被隔离（需实测） | 无影响 | 无影响 |
