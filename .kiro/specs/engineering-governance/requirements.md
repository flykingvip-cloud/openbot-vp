# Requirements Document

> 规范名：**OpenBot AI-Native Engineering Governance v2.1**
> 一句话：把已经建成的 Loom / Fabric / GitHub / CI / Release 子系统**接通成一条有强制力的交付链路**，而不是新增一层治理概念。
> 本质：这不是一个功能 spec，是一次**通电（wiring）工程**。绝大多数能力已存在；缺的是"谁来拒绝你"。

## Introduction

OpenBot 已从单人项目演化为「多 AI Agent 并行执行 + 人工监督 + 自动验证 + 持续交付」的工程系统。治理组件不缺，缺的是执行力。核查证据（2026-07-31）：

| 现象                          | 实测                                                                  | 含义                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` 最近 30 次 run       | 16 `cancelled` / 14 悬挂 / **0 success**                              | 16 个 job 中 13 of 15 条 `runs-on` 指向从未订阅的 `blacksmith-*`；失败模式是 `cancelled`，在 dashboard 上与绿色无法区分 |
| `ci-gate.yml` 最近 30 次      | 10 success / 20 failure                                               | 有真实信号，但**不是必需检查**                                                                                          |
| ruleset `require-pr-on-trunk` | 无 `required_status_checks`；`required_approving_review_count: 0`     | **CI 红着也能合进 main，已两个月**                                                                                      |
| Open PR / Open Issue          | 26 / **3**                                                            | 工作单元是 PR，不是 Issue；需求不可追踪                                                                                 |
| `.loom/registry.yaml`         | `issue:` 出现 **0** 次                                                | 代码变化无法回答"为什么改"                                                                                              |
| Label 总数                    | 14；`type:*` 与 `r:*` **全部缺失**                                    | `auto-response.yml`（521 行）在空转                                                                                     |
| 分支 / worktree / session     | 251 分支（145 远端）/ 40 worktree / 25 dead session / 35 active task  | 产能已放大，回收未建立                                                                                                  |
| `delete_branch_on_merge`      | `false`                                                               | 远端分支膨胀的直接成因                                                                                                  |
| 主工作树                      | HEAD 落后 `origin/main` **1528** commit、领先 289、**205** dirty 文件 | 三个 workflow 在 main 上存在、本地不可见                                                                                |
| 仓库形态                      | `ownerType: User`、`private: true`                                    | **GitHub Merge Queue 不可用**                                                                                           |

### 本期定位（Scope Framing）

**IN（v2.1 范围）：**

1. 分支策略与单一代码事实源的**机器化**（ruleset + 分支模式）。
2. Task 身份模型：Issue ↔ Loom task 双向绑定，作为可追踪性的 join key。
3. CI 门禁**分级上线**（L1/L2/L3），并明确各级捕获与不捕获什么。
4. Runner 治理：清除"配置存在但基础设施不存在"的假门禁。
5. **Landing Queue**：以既有 `loom task land` 实现串行落地，取代不可用的 GitHub Merge Queue。
6. Agent 生命周期：WIP 上限 + workspace GC。
7. PR 治理：唯一入口 + 必填归因/风险声明。
8. CODEOWNERS 由 registry 派生（定位为**信号**，非门禁）。
9. 可观测性与健康指标（含指标定义的修正）。
10. 主工作树恢复（独立、人工执行、带回滚）。

**OUT（明确不做，且给出理由）：**

- ❌ **`develop` / `staging` / `integration` 长期分支**：`main` 已由 `deploy/production/RELEASE_RECORD.md` 确立为唯一 production trunk，`docker-release.yml` 绑 main push + OCI revision label。第二条长期分支 = 第二个事实源，这正是 2026-07-27 force-push 事故（40 commit 失联，含已合并 PR #90/#91）的同类风险。
- ❌ **切换 SemVer**：仓库是 CalVer 且机器校验（tag 必须匹配 `package.json`、必须在 main、距 CalVer 日期 ≤2 天）。切换需改 `docs/reference/RELEASING.md` + tag 校验器 + 5 处版本位点，收益为零。
- ❌ **多部署事实源并存**（Fly + 阿里云 + 手工主机）：已有事故先例（host gateway 抢占 18789 端口打崩容器并静默服务另一个 build）。
- ❌ **一次性建立三环境**：当前仅 production 是真实环境；只增量加 staging。
- ❌ **依赖 GitHub Merge Queue**：User 账户下的 private repo 不提供该功能（详见 R8）。
- ❌ **Fabric 参与 PR / branch / merge / release 决策**：违反 Fabric Rule #4（见 R13）。
- ❌ **新增治理概念**：本 spec 不引入任何新抽象；只把既有能力接线。

### 设计原则（强约束）

1. **可执行性铁律**：每一条规范条款 **SHALL** 指向一个会拒绝违规的机器（ruleset / lint 规则 / CI job / hook）。指不出来的条款从规范中删除，不得以"愿望"形式保留。
2. **单一事实源**：代码事实源唯一为 `main`；ownership 事实源唯一为 `.loom/registry.yaml`；生产事实源唯一为已记录的部署产物 digest。
3. **不存在的基础设施不参与治理**：任何门禁所依赖的 runner / 服务 / 计划特性，若不可用，**SHALL** 被迁移或删除，不得以配置形式留存。
4. **复用优先**：优先接线既有资产（Loom / ci-gate / committer / rulesets / delivery scripts）；任何"重建已有能力"的设计需显式论证。
5. **边界不污染**：Loom 管静态治理元数据（谁拥有什么、在哪落地）；Fabric 管运行时执行治理（这次工具调用是否允许）。互不越界。
6. **门禁只收紧不放宽**：任何门禁变更 **SHALL NOT** 放宽既有拒绝集合。
7. **落点是机器可读位置**：规范 **SHALL** 落在 `AGENTS.md` + `loom lint` 规则 + GitHub ruleset/settings 三处；一份 markdown 文档不构成落地。

## Glossary

- **Task**：最小治理单位。一个 Issue → 一个 Loom task → 一个 branch → 一个 PR。
- **Landing Queue**：进入 `main` 的串行落地通道，由 `loom task land` 实现（rebase → 门禁 → 合并 → 释放）。
- **L1/L2/L3 门禁**：required status checks 的三个强度级别（静态 / 行为 / 架构）。
- **假门禁（phantom gate）**：workflow 配置存在、但因基础设施缺失永不产出结论的检查。
- **Issue Coverage**：处于 `state=active` 的 Loom task 中，已绑定 GitHub issue 的比例。
- **门禁完成率（gate completion rate）**：CI run 中得出 `success` 或 `failure` 结论的比例（`cancelled` / 悬挂计为未完成）。
- **WIP 上限**：单个 agent 同时允许的 active task 数与 open PR 数上限。
- **孤儿 workspace**：git worktree 存在但 registry 中无对应活跃 session 绑定。

## Requirements

### Requirement 1: 单一代码事实源与分支策略

**User Story:** 作为维护者，我希望只有一个代码事实源和一套可被机器校验的分支命名，以便归因、落地与部署都不产生歧义。

#### Acceptance Criteria

1. `main` **SHALL** 是唯一的代码事实源与唯一的生产来源分支。
2. 系统 **SHALL NOT** 存在长期集成分支（`develop` / `staging` / `integration`）。
3. 任务分支命名 **SHALL** 为 `<owner>/<task>`，与 `scripts/loom/provision.ts` 的 `branchTemplate` 一致。
   - **理由**：分支名是「所有 IDE agent 共用同一 git identity」条件下唯一持久、可区分人的 agent 身份（见 `docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §5）。改为 `task/*` 会废掉 `provision.ts`、丢掉该性质、并使 145 个既有分支不合规。
4. Issue 编号 **SHOULD** 通过 task id 前缀进入分支名：issue `#234` → task id `234-<slug>` → 分支 `<owner>/234-<slug>`。
   - **实现修正（2026-07-31 核查）**：这是 **advisory（warn）而非硬约束**。仓库同时存在两套 task id 约定：`loom import` 派生的 ownership id 形如 `<spec>:<agent>`，而 `:` 属于 `provision.ts` 的 `UNSAFE_BRANCH_LITERAL`，**这类 id 根本不能作为分支名**；`loom task start` 用的是另一套短 slug id。强制单一形态会破坏前者。
   - 因此 `loom task start` 在 task id 未引用 issue 号时 **SHALL** 仅告警（见 `issueMatchesTaskId`），**SHALL NOT** 拒绝。
5. `hotfix/*` **MAY** 作为唯一例外存在（人工紧急通道），且 **SHALL** 在事后补建 task 与 issue；该例外 **SHALL** 在 `AGENTS.md` 中显式标注为绕过 Loom。
6. 直接向 `main` 推送 **SHALL** 被服务端拒绝（ruleset），本地 **SHALL** 提前失败（`git-hooks/pre-push`）。
7. 合并后 **SHALL** 自动删除源分支（`delete_branch_on_merge: true`）。

### Requirement 2: Task 身份模型与 Issue 双向绑定

**User Story:** 作为维护者，我希望任何代码变化都能机器化地回答"为什么改 / 谁改的 / 属于哪个任务 / 进了哪个版本"，以便需求可追踪不依赖人工纪律。

#### Acceptance Criteria

1. 最小治理单位 **SHALL** 是 Task，而非 branch 或 PR。
2. `TaskSchema`（`scripts/loom/registry.ts`）**SHALL** 新增一个**真实字段** `issue?: number`（正整数）。
   - **约束**：**SHALL NOT** 塞进 `metadata`——`TaskMetadata` 的注释已规定"新结构化字段应提升为真实列，不得临时堆入 metadata"。
3. 系统 **SHALL NOT** 在 task 层新增 `status` 或 `branch` 字段：`state` 已存在（`claimed/active/paused/blocked/ready/landed/abandoned`），branch/worktree 绑定已存在于 `sessions[].metadata`。
4. `loom lint` **SHALL** 新增规则 `active-task-no-issue`：`state=active` 且无 `issue` → `error`。
   - **迁移**：首次上线 **SHALL** 以 `warn` 起步，待现存 35 个 active task 回填完毕后转 `error`。
5. `loom task start` 与 `loom register` **SHALL** 接受 `--issue <n>`，把它绑定到 registry task；非正整数 **SHALL** 拒绝调用。
   - 一个 task 已绑定 issue 后，改绑到**不同** issue **SHALL** 被拒绝：这会重写该 task 下已有 commit 的可追溯性。正确做法是新建 task（一 task 一 issue）。
6. PR 正文 **SHALL** 包含 `Closes #<n>`，其中 `<n>` 与 task 的 `issue` 一致。
7. Issue Coverage **SHALL** 可由 `loom status --json` 计算，无需人工统计。

### Requirement 3: Agent 生命周期与 WIP 上限

**User Story:** 作为维护者，我希望 agent 的产能不超过落地带宽，以便 PR 队列不再无限积压。

#### Acceptance Criteria

1. Agent 生命周期 **SHALL** 为：`Created → Assigned → Active → Waiting Review → Merged → Archived`，并映射到既有 task `state` 与 session `status`，**SHALL NOT** 引入第三套状态机。
2. 单个 agent **SHALL** 同时最多持有 2 个 `state=active` 的 task。
3. 单个 agent **SHALL** 同时最多持有 2 个 open PR。
4. WHEN 超过上限 THEN `loom task start` **SHALL** 拒绝并给出当前占用清单。
5. `loom lint` **SHALL** 新增规则 `agent-wip-exceeded`（`warn`，`--strict` 下为 `error`）。

### Requirement 4: Workspace 回收

**User Story:** 作为维护者，我希望死掉的 session、孤儿 worktree、已落地分支被周期性回收，以便工作区状态可读。

#### Acceptance Criteria

1. 系统 **SHALL** 提供周期性回收入口，复用既有 `loom task reconcile`。
2. 回收 **SHALL** 识别：dead session（无近期 `lastSignalAt`）、孤儿 worktree（无活跃 session 绑定）、已落地/已放弃分支。
3. 回收的默认模式 **SHALL** 为只读报告；写操作 **SHALL** 需要显式 `--yes`。
4. 回收 **SHALL NOT** 删除任何含未提交改动的 worktree，除非显式 `--force --yes`。
5. 每次回收 **SHALL** 输出可归档的摘要（数量 + 目标清单），供健康指标消费。

### Requirement 5: Pull Request 治理

**User Story:** 作为审阅者，我希望每个 PR 自带任务引用、归因和风险声明，以便不必逆向推断变更意图。

#### Acceptance Criteria

1. PR **SHALL** 是代码进入 `main` 的唯一入口。
2. PR 正文 **SHALL** 包含：任务引用（`Closes #<n>`）、Agent 归因（agent-id + 角色）、人工审阅者、风险声明（数据迁移 / 生产影响 / 安全影响）。
3. 上述字段 **SHALL** 复用既有 `.github/pull_request_template.md`（115 行，已含必填 Security Impact 与 Human Verification），**SHALL NOT** 新建模板。
4. bug-fix 类 PR **SHALL** 满足 `AGENTS.md` 既定合并门槛：症状证据、代码级根因（文件/行）、修复覆盖该路径、回归测试（fail-before / pass-after）或说明为何不可行。
5. Review 会话 **SHALL** 在合并前解决（ruleset `required_review_thread_resolution: true`，已生效）。

### Requirement 6: CI 门禁分级

**User Story:** 作为维护者，我希望 CI 结果真正决定合并权限，且我清楚每一级门禁能捕获什么，以便不把静态检查误当成回归保护。

#### Acceptance Criteria

1. 合并权限 **SHALL** 由 required status checks 决定；红色 **SHALL NOT** 可合并。
2. **L1（第一阶段）** required checks **SHALL** 为 `check (types, lint, format)` 与 `delivery guard`。
   - 捕获：格式、新增 tsgo/oxlint 诊断（增量 delta）、生成物一致性、交付不变量。
   - **不捕获：行为回归。** 该限制 **SHALL** 在规范与 `AGENTS.md` 中显式声明。
3. **L2** **SHALL** 新增一个 `test (core slice)` job：GitHub-hosted runner、`OPENBOT_TEST_PROFILE=low`、按变更域运行 vitest 子集。
   - **SHALL NOT** 一次性把 `pnpm test` 全量矩阵设为必需（私有仓 minutes 计费）。
   - 实现 **SHALL** 沿用 `ci-gate.yml` 既有的窄切片写法（`pnpm vitest run <files>`）。
4. **L3** —— 以下是**两件独立的事**，原条款将其混为一谈，已按 2026-07-31 审核拆分（见 `review-decision-2026-07-31.md` §2.2）：
   - **4a. `loom lint` 接入 CI。** `scripts/loom/check.ts` **完全不引用** `lintRegistry`；`loom check` 只做 legacy↔registry 的归因 parity。实测 `loom check --strict` exit 0 而 `loom lint` 有 **123 条 / 18 条 error**。因此 `ownership-overlap`、`impossible-glob` 等结构检查要成为门禁，**SHALL** 在 `ci-gate.yml`（GitHub-hosted runner）**新增独立硬门禁**跑 `loom lint`，**SHALL NOT** 通过修改 `ci.yml` 的 shadow 步骤达成 —— `ci.yml` 当前不可运行，改它无治理效果。
   - **4b. `loom check --strict` 的 shadow 提升。** 该步骤（`ci.yml:237`）只保证 parity 不回退，与结构检查无关。其提升 **SHALL** 排在 4a 与基线清理（D5/D6）之后。
   - **4c.** `ci-gate.yml` 中 15 项 shadow 结构 lint **SHALL** 逐条在基线清零后转硬。
5. 任一级别的提升 **SHALL NOT** 放宽既有拒绝集合。
6. WHEN 门禁上线导致既有 PR 变红 THEN 处置 **SHALL** 是修复或 rebase，**SHALL NOT** 是降低门禁。

### Requirement 7: Runner 治理

**User Story:** 作为维护者，我希望不存在的基础设施不参与治理，以便"永久 cancelled"这类静默故障无法再隐藏两个月。

#### Acceptance Criteria

1. 任何 required check 所依赖的 runner **SHALL** 实际可用。
2. `ci.yml` 中 13 处 `blacksmith-*` 引用 **SHALL** 二选一处置：迁移至 GitHub-hosted runner，或正式接入 Blacksmith。
3. 未接入前，依赖该 runner 的 job **SHALL** 被**移出默认触发路径**（改为 `workflow_dispatch` 或低频 `schedule`），**SHALL NOT** 仅加注释后继续挂在 `push`/`pull_request` 上。
   - **理由（2026-07-31 审核）**：仅加注释而保留默认触发，依然产生 queued/cancelled 噪声，违反本节 R7.1 自身的原则。原方案在此处自相矛盾。
4. 系统 **SHALL** 监控门禁完成率（R12），任何长期无结论的 workflow **SHALL** 被视为故障而非"未运行"。

### Requirement 8: Landing Queue（取代 GitHub Merge Queue）

**User Story:** 作为维护者，我希望多分支并发下的落地是自动串行的，以便不再出现人工串行 merge 与 CI 状态漂移。

> **本节已按 2026-07-31 专家审核整节重写。** 原表述称「能力已存在，只需设为唯一入口」，经核验**不成立** —— 见 `review-decision-2026-07-31.md` §2.1。自建队列是**新建能力**，不是接线。

#### Acceptance Criteria

1. **可行性约束**：`gmood2008/openbot` 为 User 账户下的 private repo。GitHub merge queue 仅在 org 拥有的 public repo，或 org + Enterprise Cloud 的 private repo 提供（[Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)；内容已改写以符合许可要求）。因此本规范 **SHALL NOT** 依赖 GitHub Merge Queue。
2. **短期方案（当前批准执行）**：进入 `main` 的路径 **SHALL** 为 required status checks + **人工串行** `/landpr`（`.pi/prompts/landpr.md`）。**SHALL NOT** 声称已具备自动队列。
3. **`loom task land` 当前不是 Landing Queue。** 以下 4 处缺陷 **SHALL** 在任何队列设计动工前修复：
   - `provision.ts:490` 锁按 `taskId` 建（`.loom/.locks/<taskId>.lock`），只互斥「同一 task 重复落地」，**不串行化落地本身**；
   - `loom.ts:554` 未注入 `runGate`，`provision.ts:650` 回退 `?? (() => true)` ⇒ **CLI 落地路径不跑任何门禁**；
   - 同处未注入 `prCreate`，`provision.ts:680` 为可选调用 ⇒ `--mode pr`（**默认模式**）推分支、置 `landed`、删 worktree，却**永不开 PR**；
   - `provision.ts:632` 的 base 是**本地** `main`（实测落后 `origin/main` 15 commit），且 fetch 失败被吞 ⇒ rebase 落在过期 base 上。
4. IF 决定自建队列 THEN **SHALL** 另立安全设计，至少含：**全局**落地锁、强制同步最新 `origin/main`、检查结果与 SHA 绑定、幂等恢复、审计事件。此设计 **SHALL NOT** 声称复用既有实现。
5. ruleset（禁止直推 + required status checks）的作用 **SHALL** 被准确表述为**防止直推 `main`**。它 **SHALL NOT** 被声称能证明某次落地「经由队列产生」—— required checks 只证明某 SHA 通过了检查，`allow_auto_merge` 是条件满足后自动合并，二者均非队列。
6. WHEN 仓库迁入 Organization + Enterprise Cloud THEN GitHub Merge Queue **MAY** 作为托管形态替换本方案；届时既有工作**不计入沉没成本**。
7. `docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §4 中"开启 Merge Queue"的建议 **SHALL** 被更正，标注其在当前仓库 plan 下不可执行。
8. 自建队列的必要性 **SHALL** 在有实际合并吞吐数据后再评估（批准顺序第 7 步），**SHALL NOT** 前置于门禁恢复。

### Requirement 9: Release 治理

**User Story:** 作为发布者，我希望版本与产物 digest、部署记录一一对应，以便任何线上版本都可回溯与回滚。

#### Acceptance Criteria

1. 版本方案 **SHALL** 保持 CalVer（`vYYYY.M.D` / `-beta.N`）；**SHALL NOT** 切换 SemVer。
2. Release 链路 **SHALL** 为：`main` commit → tag → 产物 digest → 部署记录。
3. 每次生产部署 **SHALL** 在 `deploy/production/RELEASE_RECORD.md` 留下可回滚的 digest 引用。
4. 语义变更信息 **SHALL** 通过 `CHANGELOG.md` 的 `Changes` / `Fixes` 分区表达，而非版本号。

### Requirement 10: 部署治理与环境策略

**User Story:** 作为运维者，我希望生产只有一个事实源，且环境扩展是增量的，以便不重演端口抢占与静默服务另一构建的事故。

#### Acceptance Criteria

1. 生产 **SHALL** 只有一个部署事实源。当前为 Fly（`docker-release.yml` → digest 镜像 → Fly 部署 → `/healthz` 校验）。
2. 系统 **SHALL NOT** 同时存在多个生产部署面（Fly + 阿里云 + 手工主机）。
3. IF 未来迁移至阿里云 THEN **SHALL** 先立独立 Migration Specification，覆盖：产物、digest、回滚、健康检查、切换与回退窗口。
4. 环境扩展 **SHALL** 为增量：第一步只增加 `staging`，模型为「同一 digest 先部 staging 再部 production」。
5. **SHALL NOT** 一次性建立 Development / Testing / Production 三环境映射。

### Requirement 11: CODEOWNERS 治理（定位为信号）

**User Story:** 作为维护者，我希望 ownership 在 PR 界面可见且与 registry 不漂移，同时不把它误当成门禁。

#### Acceptance Criteria

1. `.github/CODEOWNERS` **SHALL** 由 `.loom/registry.yaml` 派生（`loom derive --codeowners --write`），**SHALL NOT** 人工维护。
2. CI **SHALL** 校验 CODEOWNERS 与 registry 的 drift（`loom derive --codeowners --check`）。
   2a. registry 的 `owner` 是 **agent id**（如 `kiro-loom`），不是 GitHub 账号——所有 agent 共用同一 git identity。因此派生 **SHALL** 经 `.loom/config.yaml` 的 `codeowners.handles` / `codeowners.defaultHandle` 把 agent id 映射为真实 handle；存在未映射 agent 时 **SHALL** 拒绝生成并列出它们，**SHALL NOT** 输出 `@<agent-id>`（GitHub 视为 unknown owner，会静默作废整个文件）。
   2b. 无法表达为 CODEOWNERS 路径的 registry 声明（含 `#` 的子符号声明、含空白的路径）**SHALL** 被跳过并告警，**SHALL NOT** 使整个 task 的其余路径丢失。
   2c. 终态（`landed`/`abandoned`）task **SHALL** 被省略，与 `attribution.ts` 的 `TERMINAL_TASK_STATES` 一致。
3. CODEOWNERS **SHALL NOT** 被计入"代码进入规则"。
   - **理由**：`require_code_owner_review` 生效需要 reviewer 具备 push 权限且非 PR 作者。本仓库仅一名人类 owner 且 `required_approving_review_count: 0`，故 CODEOWNERS 无法阻止任何合并。
4. path 归属的真实门禁 **SHALL** 是 `loom lint` 的 `ownership-overlap` 检查（`scripts/loom/lint.ts`）。
   - **修正（2026-07-31）**：原文称其"随 L3 转为必需"，该依赖建立在被证伪的 R6.4 之上 —— `loom check` 不含 lint。它成为门禁的正确路径是 **R6.4a**（在 `ci-gate.yml` 新增独立 `loom lint` 硬门禁），而非 `ci.yml` 的 shadow 提升。

### Requirement 12: 可观测性与健康指标

**User Story:** 作为维护者，我希望指标能暴露真实故障而非奖励错误行为，以便"永久 cancelled"这类问题被立刻发现。

#### Acceptance Criteria

1. 系统 **SHALL** 记录三层链路：Task 层（task id / owner / agent / 时长）、Code 层（commit / PR / release）、Runtime 层（部署 / 健康 / 回滚）。
2. Task 层观测 **SHALL** 依赖 R2 的 `issue` 绑定作为 join key；本要求 **SHALL** 排在 R2 之后实施。
3. Code 层与 Runtime 层 **SHALL** 复用既有资产：`scripts/delivery/*`、`pnpm delivery:ledger:audit`、`deploy/production/RELEASE_RECORD.md`。
4. 健康指标 **SHALL** 包含且区分：
   - **门禁完成率**：得出 `success`/`failure` 结论的 run 比例。目标 **100%**。
   - **main 门禁绿率**：`main` 上必需检查通过率。目标 **>95%**。
5. 系统 **SHALL NOT** 使用未区分来源的"CI 成功率"作为健康指标。
   - **理由**：实测 `ci-gate.yml` 为 10 success / 20 failure（33%，健康：PR 红了被修绿），`ci.yml` 为 0 success / 25 cancelled（死亡）。单一成功率会把两者同等对待，并奖励"不设门禁"。
6. Agent 指标 **SHALL** 包含：active task 数、dead session 数、孤儿 workspace 数。
7. 交付指标 **SHALL** 包含：Issue → Merge 前置时间、落地等待时间、Issue Coverage（目标 100%）。

### Requirement 13: 反馈闭环（Fabric 方向单一）

**User Story:** 作为架构负责人，我希望 GitHub 的门禁结果能反哺 agent 策略，但 Fabric 绝不反向控制 GitHub，以便运行时治理边界不被污染。

#### Acceptance Criteria

1. GitHub 侧事件（PR 结果 / CI 结果 / 合并结果）**MAY** 作为 Fabric feedback signal 的输入。
2. Fabric **SHALL NOT** 参与 PR 状态、分支管理、合并策略或发布流程的决策（Fabric Rule #4）。
3. Loom **SHALL NOT** 参与运行时工具权限或执行拦截。
4. 反馈 **SHALL** 保持 human-gated `suggest → accept`，**SHALL NOT** 自动改写任何策略（Fabric R19.2）。
5. 该接入 **SHALL NOT** 引入 runtime Loom lookup（Fabric D10）。
6. 本能力 **SHALL** 归入 Phase 3 并另立 spec：`src/fabric/feedback.ts` 在 Fabric v1 中仅为接口与数据通道，接入 GitHub 事件不是配置项。

### Requirement 14: 规范落点（可执行性铁律）

**User Story:** 作为维护者，我希望这份规范不会变成第 52 份无人遵守的文档，以便治理密度转化为治理强度。

#### Acceptance Criteria

> **本节已按 2026-07-31 专家审核修正。** 原文把「有落点」与「会拒绝」混为一谈，并把 `AGENTS.md` 条目、PR 模板字段也算作机器落点 —— 前者是行为规范（agent 可以不读、读了可以不遵守），后者无法强制填写。二者都不是拒绝器。

#### Acceptance Criteria

1. 每条规范条款 **SHALL** 被归入下列**三类之一**，且 **SHALL** 标注所属类别 —— 不得一律称为"机器落点"：

   | 类别               | 含义                 | 落点形态                                                                              |
   | ------------------ | -------------------- | ------------------------------------------------------------------------------------- |
   | **强制门禁**       | 违反则动作被机器拒绝 | GitHub ruleset、required status checks、已接入 CI 的 `loom lint` error 级别、git hook |
   | **自动检测不阻断** | 机器会报告，但不拒绝 | `loom lint` 的 warn 级别、`continue-on-error` 的 shadow 步骤、drift 检查              |
   | **人工流程约束**   | 仅靠人遵守           | `AGENTS.md` 条目、PR 模板字段、spec 里的 review 要求                                  |

2. 归入「强制门禁」的条款 **SHALL** 给出该门禁**被实际调用**的证据（调用点 + 实测拒绝输出），**SHALL NOT** 仅以实现存在为据。
3. 无任何落点的条款 **SHALL** 从规范中删除，**SHALL NOT** 以愿望形式保留。
4. 「人工流程约束」类条款 **SHALL NOT** 被计入治理强度指标 —— 它们是意图声明，不是保护。
5. 面向 agent 的规则 **SHALL** 写入 `AGENTS.md`——这是 agent 唯一会读取的规则书。
6. 系统 **SHALL** 消除悬空引用：`AGENTS.md` 引用的 `.agents/skills/PR_WORKFLOW.md` 在本地与 `origin/main` 上均不存在，**SHALL** 创建该文件或将引用改指 `.pi/prompts/landpr.md` + `reviewpr.md`。
7. 本 spec **SHALL** 交付一张「条款 → 机器落点」映射表（见 design.md），并在验收时逐条核对。
