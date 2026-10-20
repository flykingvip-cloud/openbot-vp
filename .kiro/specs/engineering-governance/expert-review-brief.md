# OpenBot 工程治理 — 专家审核与决策请求

**日期**：2026-07-31
**提请方**：kiro-governance（当前持有 `engineering-governance` 与 `loom-workspace-orchestrator` 两个 ownership task）
**审核对象**：`.kiro/specs/engineering-governance/`（requirements / design / tasks）+ 本轮已落地的 4 个提交
**请求性质**：**10 项待决策**，其中 4 项阻塞交付、4 项阻塞治理闭环、2 项可延后。以下每项都给出选项、取舍与我的建议，但**决策权在你们**。

---

## 0. 一句话现状

OpenBot 的治理组件不缺——Loom（工作区治理）、Fabric（运行时执行治理）、3 条 GitHub ruleset、15 个 workflow、52 个 registry task、51 个 spec、`AGENTS.md` 400+ 行。**缺的是执行力**：最关键的一条约束（CI 绿才能合并）失效了约两个月而无人察觉，因为它的失败模式是 `cancelled` 而非 `failure`，在 dashboard 上与绿色无法区分。

本次请求审核的核心判断是：**当前不应新增治理概念，而应把已建成的系统「通电」**。如果专家团队不同意这个判断，请优先指出，因为整份 spec 都建立在它之上。

---

## 1. 可核验的现状数据

全部为 2026-07-31 实测，附复核命令。

> **关于数字漂移**：这是一棵**多 agent 共享的工作树**，其他 agent 在本文档撰写期间仍在并发提交。约 30 分钟内实测到：脏文件 219 → 210、attributed 66 → 57、dead session 25 → 29、registry task 50 → 52。
>
> 因此请区分两类数字：
>
> - **会漂移的**：脏文件数、attributed 数、dirty 相关的一切。复核时对不上是正常的。
> - **结构性的、稳定的**：`ownership-overlap` 46、`impossible-glob` 18、CONFLICT 12、UNATTRIBUTED 141、落后 `origin/main` 1530 commit、`blacksmith` 引用 13 处、`ci.yml` 0 success、ruleset 无 `required_status_checks`。**这些才是决策依据**，它们不随并发编辑变化。
>
> 漂移本身也是一个信号：它说明工作树上有多个 agent 在同时改动而没有隔离——这正是 D4 要处理的问题。

### 1.1 CI 门禁

| 项                                             | 实测                                               | 复核命令                                                              |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `ci.yml` 最近 30 次结论                        | **16 cancelled / 14 悬挂 / 0 success**             | `gh run list --workflow=ci.yml --limit 30 --json conclusion`          |
| `ci.yml` 中 `blacksmith-*` runner 引用         | **13 处**（该仓库从未订阅 Blacksmith）             | `git show origin/main:.github/workflows/ci.yml \| grep -c blacksmith` |
| `ci-gate.yml` 最近 30 次结论                   | 18 failure / 11 success / 1 悬挂（**有真实信号**） | `gh run list --workflow=ci-gate.yml --limit 30`                       |
| ruleset `require-pr-on-trunk`(19808307) 的规则 | **仅 `pull_request`**，无 `required_status_checks` | `gh api /repos/gmood2008/openbot/rulesets/19808307`                   |
| 结论                                           | **红着也能合进 main**                              | —                                                                     |

`ci.yml` 的失败机理（见 `ci-gate.yml` 头部注释）：30/34 个 job 声明在从未订阅的 runner 上，永久 `queued`；推送速度快于队列，`concurrency` 在分配 runner 前取消每次 run。

### 1.2 仓库形态与 GitHub 能力边界

| 项                       | 实测                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `owner.type` / `private` | **User** / true                                                                         |
| `delete_branch_on_merge` | **false**                                                                               |
| `allow_auto_merge`       | **false**                                                                               |
| GitHub Merge Queue       | **不可用**（仅 org 拥有的 public repo，或 org + Enterprise Cloud 的 private repo 提供） |
| ruleset 数               | 3（force-push / deletion / require-PR）                                                 |
| label 数                 | 28（本轮由 14 增至 28）                                                                 |

### 1.3 交付队列

| 项                    | 实测                          |
| --------------------- | ----------------------------- |
| open PR / open issue  | **27 / 3**                    |
| 其中 dependabot PR    | **11**，最老自 **2026-06-01** |
| `CONFLICTING` 状态 PR | 3                             |

工作单元事实上是 PR 而非 issue；需求可追踪性目前完全靠人工纪律。

### 1.4 工作区状态

| 项                    | 实测                                        | 复核命令                                 |
| --------------------- | ------------------------------------------- | ---------------------------------------- |
| 主工作树 HEAD         | `deploy/user-modeling-v92`（**不是 main**） | `git rev-parse --abbrev-ref HEAD`        |
| 与 `origin/main` 分叉 | **落后 1530 / 领先 313**                    | `git rev-list --count HEAD..origin/main` |
| 脏文件                | 约 **210–220**（漂移中）                    | `git status --porcelain \| wc -l`        |
| 分支                  | 本地 108 / 远端 149                         | `git branch -r --list \| wc -l`          |
| worktree              | **39**                                      | `git worktree list \| wc -l`             |
| registry task         | 52（active 37 / landed 10 / abandoned 5）   | `loom status`                            |
| dead session          | **29**                                      | 同上                                     |

分叉的直接后果：`ci-gate.yml`、`delivery-sot-alignment.yml`、`ci-canary.yml` 三个 workflow 在 `origin/main` 上存在，在主工作树里**根本看不到**。

### 1.5 归因与 lint

| 项                               | 实测                                                                                                  | 复核命令                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 归因分布                         | 脏文件 → attributed / **0 shared** / **12 conflict** / **141 unattributed**（前两项漂移，后两项稳定） | `bun scripts/agent-attribution.ts` |
| `impossible-glob`                | **18**（本轮新增规则抓出）                                                                            | `loom lint`                        |
| `active-task-no-issue`           | **37**                                                                                                | 同上                               |
| `ownership-overlap`              | 46                                                                                                    | 同上                               |
| `stream-path-shadowed`           | 22                                                                                                    | 同上                               |
| `loom check --strict`（CI 门禁） | **exit 0**                                                                                            | `loom check --strict`              |
| tsgo 存量债务                    | 68（全部在 `ui/**` 与 `src/gateway/**`，`scripts/**` 为 0）                                           | `pnpm tsgo`                        |

---

## 2. 本轮已落地（供审核，共 4 个提交）

| SHA          | 内容                                                                                                                                                                        | 测试 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `4f1a7aec12` | Loom：registry 新增 `issue` 真实列（intent→code→release 的 join key）；`loom task start` / `register` 接受 `--issue`；`loom derive --codeowners` 三态（render/write/check） | —    |
| `c1cb75d97d` | Spec：engineering governance v2.1（14 条需求 + 条款→机器落点映射表）                                                                                                        | —    |
| `5a164e12b2` | Loom：`sharedPaths` 机制（P2.1–P2.4 + P2.6）——第四种判定 `SHARED`                                                                                                           | —    |
| `4698547461` | Loom：`impossible-glob` 规则（P2.0b）+ P2.0a parity 清单                                                                                                                    | —    |
| 合计         | loom 测试 **201 → 270**                                                                                                                                                     | 全绿 |

`loom check --strict` 全程 exit 0；`.loom/registry.yaml` 全程未提交（多方共享且带他人未提交 WIP）。

### 2.1 `sharedPaths` 机制（请重点审核语义）

问题：`tasks` 是排他分区，两个 task 同时声明的路径一律报 CONFLICT。这对**意外重叠**正确，对**设计使然的共享文件**（`AGENTS.md`、注册中枢、i18n locales）错误——它们产生永不消解的 CONFLICT，而恒亮的信号等于没有信号。当前 12 个 CONFLICT 全属此类。

方案：registry 顶层新增 `sharedPaths: { glob, lander, reason? }[]`。登记**不授予覆盖他人工作的许可**，它指名唯一落地人（lander），而这正是 AGENTS.md 规则 2 已经指向的那个角色。

三条边界判断（请审核是否同意）：

1. **单 owner 命中登记路径 → 仍 `ATTRIBUTED`**。归属本已明确，登记不得稀释既有结论。
2. **零 owner 命中登记路径 → 仍 `UNATTRIBUTED`**。**lander 不是 owner**；提拔它会掩盖「没人签到」这一事实。
3. **parity 门禁只放行 `CONFLICT → SHARED` 一种迁移**，且该路径确有登记；其余 verdict 变化一律报 diff。放行的迁移不静默吞掉，而是逐条列入报告。

临时仓库三阶段实测：未登记 → 2 CONFLICT；登记 `AGENTS.md` → 1 SHARED（打印 lander + reason）+ 1 CONFLICT；两条都登记 → `--fail-on-conflict` 由 1 转 **0**，`ownership-overlap` 由 1 降至 **0**。

---

## 3. 不建议被推翻的既有铁律（每条都有事故或机器背书）

请专家团队在提出方案时先确认是否接受这些约束；若要推翻，请给出比原始证据更强的理由。

| 铁律                                                           | 背书                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`main` 是唯一生产 trunk**，不设 `develop`/`staging` 长期分支 | 2026-07-27 `origin/main` 被两次 force-push，**40 个 commit 失联**（含已合并 PR #90/#91），靠一个 archive-only 分支捞回。多 truth source 已付过学费。见 `deploy/production/RELEASE_RECORD.md`                           |
| **CalVer**（`vYYYY.M.D`），不切 SemVer                         | `openclaw-npm-release.yml` 会拒绝不匹配 `package.json`、非 main、距 CalVer 日期 >2 天的 tag。切换是破坏性变更，收益为零                                                                                                |
| **单一部署事实源**（当前 Fly）                                 | 曾发生 host gateway 抢占 18789 端口打崩容器并静默服务另一 build。仓库内 0 处阿里云部署产物                                                                                                                             |
| **分支命名 `<owner>/<task>`**                                  | 所有 IDE agent 共用同一 git identity，分支名是唯一持久可区分人的 agent 身份。`provision.ts:49` 与 149 个远端分支依赖它                                                                                                 |
| **Loom / Fabric 边界不污染**                                   | Fabric Rule #4：`AOR owns execution structure · Fabric owns permission+transformation+audit · TOL owns execution · Loom owns static governance metadata`。Fabric 不参与 PR/branch/merge/release；Loom 不参与运行时拦截 |
| **path = 硬信号，intent = 软信号**                             | Architecture Rule #1。归因/拦截只用确定性信号                                                                                                                                                                          |
| **共享路径登记必须人工**                                       | 「多个 agent 碰过它」正是需要人判断的**症状**，不是判断的**证据**。绝不从编辑频次反推                                                                                                                                  |

---

## 4. 决策请求

### 第一梯队：阻塞交付（建议本周内定）

---

#### D1 — GitHub Merge Queue 不可用，如何获得串行落地能力

**背景**：`gmood2008/openbot` 是 User 账户下的 private repo。Merge Queue 仅在 org 拥有的 public repo，或 org + Enterprise Cloud 的 private repo 提供。当前 `allow_auto_merge` 也是 false。这意味着「多分支并发下自动串行合并」这一能力当前**完全缺失**，而 27 个 open PR / 39 个 worktree 正是它要解决的场景。

| 选项                                  | 代价                                                                                                                                              | 风险                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A. 迁 Organization + Enterprise Cloud | 组织迁移 + EC 订阅；ruleset / secrets / `production` Environment 需重建                                                                           | 迁移期风险高；为单一功能付组织级订阅            |
| B. Org + 公开仓库                     | 免费获得 Merge Queue                                                                                                                              | 不可行（商业代码）                              |
| **C. 用 Loom 实现 Landing Queue**     | 中等，但**能力已存在**：`loom task land` 已是两阶段落地（gate+rebase → merge/PR），`.pi/prompts/landpr.md` 17 步已在做 rebase→全量门禁→merge→校验 | 本地脚本本身不构成强制；需 ruleset 做服务端保底 |

**我的建议**：C。理由不是省钱，是**它已经建好了**，缺的只是「设为唯一入口 + 自动串行化」，不是缺概念。spec R8 已按此写。

**需要专家判断**：

1. 自建 Landing Queue 与托管 Merge Queue 在**可靠性与可审计性**上的差距，是否可接受？
2. 若未来迁 org，Landing Queue 是平滑替换还是沉没成本？
3. `docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §4 明确推荐「开 Merge Queue」——该建议在本仓库不可执行，是否同意更正该设计文档？

---

#### D2 — Blacksmith runner：订阅、迁移，还是删除引用

**背景**：13 处 `blacksmith-*` 引用，从未订阅，导致 `ci.yml` 最近 30 次 0 success。这是「配置存在但基础设施不存在」的典型，也是本次 spec 提出「**不存在的基础设施不能参与治理**」这条原则的直接来源。

| 选项        | 说明                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A（我倾向） | 需成为门禁的 job 迁 `ubuntu-latest`（`ci-gate.yml` 已承担）；重型矩阵（Windows/macOS/Android/Docker/benchmark）保留 blacksmith 标签，但在 workflow 顶部**显式标注「非门禁 · 待订阅」** |
| B           | 正式接入 Blacksmith                                                                                                                                                                    |
| C           | 删除全部引用，重型矩阵暂时不跑                                                                                                                                                         |

**需要专家判断**：

1. 私有仓 GitHub-hosted minutes 计费下，哪些 job 值得进门禁？（`ci-gate.yml` 头部注释已要求「先跑几次看真实成本再扩范围」）
2. 若选 A，重型矩阵长期不跑的风险如何界定？跨平台回归靠什么兜底？

---

#### D3 — required status checks 上线时机 vs 27 个 open PR

**背景**：把 `check (types, lint, format)` + `delivery guard` 设为必需检查，是「让 CI 成为真实门禁」的唯一动作。副作用是立刻卡住 11 个 dependabot PR（最老自 2026-06-01）与 3 个 `CONFLICTING` PR。

**已准备好的命令**（未执行，等决策）：

```bash
# PATCH 会整体替换 rules 数组，故须带上现有的 pull_request 规则
gh api -X PATCH /repos/gmood2008/openbot/rulesets/19808307 --input ruleset.json
```

**需要专家判断**：

1. `strict_required_status_checks_policy` 设 true 还是 false？设 true（要求分支与 main 同步）在无 Merge Queue 时会让 27 个 PR 陷入持续 rebase。我倾向**先 false，待 Landing Queue 上线后翻 true**。
2. 先清 dependabot 库存再上门禁，还是先上门禁让它们红着排队？
3. `required_approving_review_count` 当前为 0。单人仓库下提到 1 意味着无人可批（不能自批）。保持 0 并明确记录为「单人决策」，还是引入第二个人类审阅者？

---

#### D4 — 主工作树归位（最高风险单次操作）

**背景**：主工作树落后 `origin/main` **1530 commit**、领先 313、**约 210 个脏文件**、39 个 worktree、29 个 dead session。这不是清单上的一行，是整个计划里风险最高的单次操作，且与 2026-07-27 那次 40 commit 失联属**同一操作类别**。

脏文件数在 30 分钟内从 219 变到 210 —— 说明这棵树上有多个 agent 正在无隔离地并发改动，归位操作本身也会在移动的靶子上进行。

**已拟协议**（沿用事故后确立的规则）：

```
1. bun scripts/agent-attribution.ts        → 全部脏文件映射到 owner
2. 各 owner 自行落地或归档                  → 不得代他人提交（AGENTS.md 规则 2）
3. 建备份分支 backup/<topic>-<YYYYMMDD>     → 先备份再动
4. 主工作树切回 main
5. 记录 before/after SHA 与原因
```

**需要专家判断**：

1. 141 个 UNATTRIBUTED 文件中，无法找到责任 agent 的部分如何处置？丢弃、归档到分支、还是强制签到？
2. 313 个领先 commit（在 `deploy/user-modeling-v92` 上）是否需要逐一 triage？该分支已被 `RELEASE_RECORD.md` 声明为「archive/PR source only，非生产部署源」。
3. 是否应先做隔离（每 task 一个 worktree）再归位，避免归位后再次积累？

---

### 第二梯队：阻塞治理闭环

---

#### D5 — 共享路径 lander 名单（P2.5，机制已就绪，唯一剩余阻塞）

**背景**：`sharedPaths` 机制已落地并验证。填入 lander 后，12 个永久 CONFLICT 立即有解，`ownership-overlap` 的 46 条噪声也会下降。按 spec 原文**此项必须人工拍板，agent 不得自行填**，故下表 lander 一栏留空。

| 候选 glob                                                      | 当前共同声明方（实测）                                                                                                                                   | lander |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `.loom/registry.yaml`                                          | 5 方：loom-workspace-orchestrator + enterprise-ui-baseline + platform-pricing-gateway-instability + wecom-bundled-plugin-loading + main-recovery-routing | ?      |
| `deploy/production/RELEASE_RECORD.md`                          | 6 方（含 main-production-deployment、enterprise-ai-model-governance 等）                                                                                 | ?      |
| `AGENTS.md`                                                    | public-web-entry-url（ownership）+ landing stream `ME`；`engineering-governance` 亦需追加条款                                                            | ?      |
| `src/gateway/method-scopes.ts`                                 | development-supervisor + enterprise-ai-model-governance                                                                                                  | ?      |
| `ui/src/styles.css`                                            | daibai-super-steward + employee-ai-archive                                                                                                               | ?      |
| `ui/src/styles/workbench.css`                                  | agent-growth-lifecycle + ops-decommission                                                                                                                | ?      |
| `ui/src/ui/app-render.ts`                                      | builder-decommission + daibai-super-steward                                                                                                              | ?      |
| `ui/src/ui/app-settings.ts`                                    | enterprise-ui-baseline + enterprise-ai-model-governance                                                                                                  | ?      |
| `ui/src/ui/app.ts` / `app-view-state-shell-slices.ts`          | agent-growth-lifecycle + ops-decommission                                                                                                                | ?      |
| `ui/src/ui/ports/employee/collaboration-org-bot-directory*.ts` | ops-decommission + enterprise-startup-stability                                                                                                          | ?      |
| `.kiro/specs/platform-pricing-gateway-instability/tasks.md`    | 同 spec 两个 task                                                                                                                                        | ?      |

**两处需要判断而非照抄**：

1. `.loom/registry.yaml` 的 lander 若定 `kiro-loom`，注意 `loom-workspace-orchestrator` 的 owner 已于 2026-07-31 转为 `kiro-governance`（见 `ownerHistory`）。**填 agent id 还是填「当前 owner」**需要明确语义——前者会随 takeover 失效，后者需要一层间接引用。
2. `deploy/production/RELEASE_RECORD.md` 六方共享且直接关联生产发布记录，按 P2.5 原文需与运行时安全侧确认。

**需要专家判断**：除 lander 名单外，是否应给 `sharedPaths` 增加 `expiresAt` 或定期复核机制？否则登记表本身会成为下一个「登记了就永远不动」的沉淀。

---

#### D6 — 死 glob 的修法：A 还是 B（P2.0a，原定前提已被实测推翻）

**背景**：18 条 active task 的 path 声明形如 `src/gateway/supervisor/`——无通配且以 `/` 结尾。`globToRegExp` 双端锚定，编译成 `^dir\/$`，而 git 只报文件不报目录，**故永不命中**。这些 task 真正碰的文件一直显示为 UNATTRIBUTED，读起来像「agent 没签到」而非「glob 是坏的」。这是 141 个 UNATTRIBUTED 的部分成因。

P2.0a 原文要求「差异方向只允许 `UNATTRIBUTED → ATTRIBUTED/CONFLICT`」。**实测该前提不成立**：

| 迁移                        | 条数  | 说明                                                                                                                                                                                |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNATTRIBUTED → ATTRIBUTED` | 2     | 本该有的归属                                                                                                                                                                        |
| **`ATTRIBUTED → CONFLICT`** | **5** | **越界**。单一成因：`agent-growth-lifecycle:cursor-p0b-growth` 声明失效的 `ui/src/ui/ports/employee/`，而 `ops-decommission:cursor-daniel` 声明生效的 `ui/src/ui/ports/employee/**` |

**关键判断**：这 5 个不是修法引入的缺陷，那个重叠**本就存在**，只是死 glob 让它一直没被看见。修法只是让它显形。

| 选项 | 说明                                         | 风险                                                                                                                                                                    |
| ---- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | 改 `globToRegExp`，读时把 `dir/` 当 `dir/**` | 改动共享函数；`glob.ts` 注释明写「语义不得与 legacy 分叉」，而 `scripts/agent-attribution.ts` 有自己的一份 `globToRegExp` 拷贝——只改一处会让 `loom check --strict` 失败 |
| B    | 逐条迁移 18 条 active 声明                   | 不改共享函数，无分叉风险；但要写 `.loom/registry.yaml`，而该文件当前带多方未提交 WIP                                                                                    |
| A'   | 先做 D5（登记该路径）再上 A                  | 迁移方向落回允许集合内                                                                                                                                                  |

**需要专家判断**：

1. 选 A 还是 B？若选 A，是否接受同时修改 `agent-attribution.ts` 的那份拷贝（否则 parity 必失败）？
2. 「legacy 语义不得分叉」这条约束在 legacy 即将退役的前提下，还有多少约束力？
3. `ATTRIBUTED → CONFLICT` 是否应被重新界定为**可接受**的迁移方向（因为它揭示的是真实重叠）？

---

#### D7 — Issue 回填责任划分（37 个 active task）

**背景**：`issue` 字段已落地，`loom lint` 的 `active-task-no-issue` 已抓出 37 条（当前 `warn`，待 Coverage 100% 后转 `error`）。回填要写 `.loom/registry.yaml`。

| 选项 | 取舍                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| A    | 各 task owner 自填 —— 合规（AGENTS.md 规则 2），但慢，且 29 个 dead session 意味着相当一部分 owner 已不在线 |
| B    | 维护者一次性补齐 —— 快，但违反规则 2                                                                        |
| C    | dead session 的 task 由维护者代填并记录，活跃 task 由 owner 自填                                            | 折中，需定义「dead」阈值 |

**需要专家判断**：37 个 active task 里有多少是真的活的？（29 个 dead session 提示相当比例已僵死）是否应先跑一轮 GC 把僵死 task 关掉，再对剩下的要求 issue 绑定？

---

#### D8 — CODEOWNERS 的 handle 映射（27 个未映射 agent）

**背景**：`loom derive --codeowners` 已落地。但 registry 的 `owner` 是 **agent id**（`kiro-loom`），不是 GitHub 账号——所有 agent 共用同一 git identity。输出 `@kiro-loom` 会被 GitHub 判为 unknown owner 并**静默作废整个文件**（比不生成更糟）。故实现为：未映射时拒绝生成并列出未映射 agent。真实 registry 上实测报出 **27 个**。

已提供 `.loom/config.yaml` 的 `codeowners.handles` / `codeowners.defaultHandle` 映射机制。

**同时请审核我的一个定位判断**：CODEOWNERS 在本仓库**不是门禁**。`require_code_owner_review` 生效需要 reviewer 有 push 权限且非 PR 作者；单人类 owner + `required_approving_review_count: 0` 下它拦不住任何合并。故 spec R11.3 明确**不把它计入「代码进入规则」**，真实的 path 归属门禁是 `loom lint` 的 `ownership-overlap`。

**需要专家判断**：

1. 27 个 agent 全映射到同一个人类 handle，还是只设 `defaultHandle`？前者冗余，后者丢失 agent 粒度（但 agent 粒度已在生成文件的注释里保留）。
2. 是否同意「CODEOWNERS 是信号而非门禁」这一定位？若不同意，需要什么条件才能让它成为真门禁？

---

### 第三梯队：可延后

---

#### D9 — `labeler.yml` 的 48 个缺失 label

`.github/labeler.yml` 引用 **49** 个 label，其中 **48 个不存在**（仅 `docker` 存在）：`channel:*` 22、`extensions:*` 15、`app:*` 4，以及 `agents`/`cli`/`commands`/`docs`/`gateway`/`scripts`/`security` 各 1。labeler 工作流因此一直空转——与 blacksmith 同类问题，只是发生在 label 而非 runner 上。

**需要专家判断**：批量创建 48 个 label（一次性，可逆），还是先精简 `labeler.yml` 到实际需要的子集？我倾向后者——49 个 label 的分类维度是否真的都在用，值得先审一遍。

#### D10 — `loom check --strict` 由 shadow 转必需的时机

`ci.yml:234-237` 该步骤挂着 `continue-on-error: true`，注释称「观察 1–2 周 clean window 后提升」。实测当前 exit 0。**该注释写于数月前，clean window 早已满足**，但一直没做决定。permanent shadow 等于永不生效。

**需要专家判断**：现在转必需，还是等 D2（runner）与 D3（required checks）落地后一并转？

---

## 5. 风险登记

| #   | 风险                                                | 当前暴露                    | 缓解                                            |
| --- | --------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| R1  | 红色代码合入 main                                   | **已发生约两个月**          | D3                                              |
| R2  | 主工作树 1530 commit 分叉，三个 workflow 本地不可见 | 进行中                      | D4                                              |
| R3  | 141 个文件无归属，责任不可追溯                      | 进行中                      | D6 + D7                                         |
| R4  | 12 个永久 CONFLICT 训练所有人忽略该信号             | 进行中                      | D5                                              |
| R5  | 落地带宽 = 1 条人工串行通道，产能已 ×N              | 27 open PR                  | D1                                              |
| R6  | 重型矩阵（跨平台）长期不跑                          | 约两个月                    | D2                                              |
| R7  | 规范密度过高而执行力过低，新增规范会加剧            | 51 spec / 400+ 行 AGENTS.md | 本 spec R14：每条条款必须指向一个会拒绝你的机器 |

---

## 6. 明确未能验证的部分

诚实标注，避免专家基于错误假设决策：

1. **GitHub 实时设置**只能只读核验；ruleset 的 `bypass_actors` 为空已确认，但组织级/企业级策略无法从此仓库观测。
2. **51 个 spec 未逐一深读**，仅完整读了 `openbot-fabric` 与 `loom-workspace-orchestrator` 两组。其余 spec 可能含与本 spec 冲突的既有决策。
3. **端到端 label 触发**（打 `r: support` 是否真的自动 comment + close）未在真实 issue 上验证，只验证了 label 存在性。
4. **`sharedPaths` 在真实仓库的效果**只在临时仓库验证；本仓库 `sharedPaths` 仍为空数组（等 D5）。
5. **tsgo 存量 68 条**中有 1 条是本会话期间其他 agent 并发引入的，我的改动贡献 0 条（`scripts/**` 无错误）。
6. **Fabric 的 feedback 接入**（GitHub 事件 → Fabric signal）在 Fabric v1 中仅为接口，实际接入需另立 spec，本次未评估其工作量。

---

## 7. 请专家团队优先回答的三个问题

如果时间有限，这三个问题决定其余七项的走向：

1. **是否接受「本轮不新增治理概念，只做通电」这一总判断？** 整份 spec 建立在它之上。若认为应先补齐某项治理能力再谈通电，请指出是哪项。

2. **落地带宽（D1）与门禁强度（D2/D3）哪个优先？** 现在的状态是「产能已放大 N 倍，但落地是 1 条人工串行通道，且通道上没有门」。先装门会让队列更堵，先扩通道会让更多未检验代码进入 main。

3. **D4（主工作树归位）应该在何时做？** 它是最高风险单次操作，也是其余多项的前置（三个 workflow 本地不可见、200+ 脏文件阻塞 registry 写入）。放在最前风险集中，放在最后则其余工作都在错误基线上进行。

---

## 附录：完整复核脚本

```bash
# 工作区
git rev-parse --abbrev-ref HEAD
git rev-list --count HEAD..origin/main; git rev-list --count origin/main..HEAD
git status --porcelain | wc -l; git branch -r --list | wc -l; git worktree list | wc -l

# 治理
node --import tsx scripts/loom.ts status
node --import tsx scripts/loom.ts lint
node --import tsx scripts/loom.ts check --strict; echo "exit=$?"
bun scripts/agent-attribution.ts

# GitHub
gh api /repos/gmood2008/openbot --jq '{ownerType:.owner.type,private,delete_branch_on_merge,allow_auto_merge}'
gh api /repos/gmood2008/openbot/rulesets
gh api /repos/gmood2008/openbot/rulesets/19808307 --jq '[.rules[].type]'
gh run list --repo gmood2008/openbot --workflow=ci.yml --limit 30 --json conclusion
gh run list --repo gmood2008/openbot --workflow=ci-gate.yml --limit 30 --json conclusion
gh pr list --repo gmood2008/openbot --state open --limit 200 --json number,createdAt,mergeable,headRefName

# 本轮改动
git log -8 --format='%h %s' ; OPENBOT_TEST_PROFILE=low pnpm vitest run scripts/__tests__/loom/
```

**相关文档**：`.kiro/specs/engineering-governance/{requirements,design,tasks}.md`（design §8 是「条款 → 机器落点」映射表，验收依据）、`.kiro/specs/loom-workspace-orchestrator/tasks.md`（P2.x 系列）、`deploy/production/RELEASE_RECORD.md`（交付 SoT + 事故记录）、`docs/design/worktree-multiagent-target-architecture-2026-06-16.md`（目标架构，§4 的 Merge Queue 建议待更正）。
