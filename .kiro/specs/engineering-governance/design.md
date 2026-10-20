# Design Document

> 对应 `requirements.md`（OpenBot AI-Native Engineering Governance v2.1）。
> 设计立场：**通电，不建楼。** 本文档的每一节都指向一个既有资产 + 一处最小改动。

## Overview

治理链路的目标形态：

```
Human Intent
     │
     ▼
GitHub Issue ─────────────────┐  join key = issue number
     │                        │
     ▼                        │
Loom Task (registry.yaml)  ◄──┘  新增字段 issue?: number
  ownership · lifecycle · paths
     │
     ▼
Worktree + Branch <owner>/<issue>-<slug>     ← provision.ts（已实现）
     │
     ▼
AI Agent Execution ──► Fabric（运行时执行治理，编译期单决策点）
     │
     ▼
Pull Request（唯一入口）
     │
     ▼
CI Gate（L1 → L2 → L3，required status checks）
     │
     ▼
Landing Queue（loom task land，串行）      ← 取代 GitHub Merge Queue
     │
     ▼
main（唯一代码事实源）
     │
     ▼
Release（CalVer tag → digest → RELEASE_RECORD）
     │
     ▼
Production（Fly，单一部署事实源）
     │
     ▼
Feedback → Fabric feedback signal（human-gated，Phase 3，另立 spec）
```

**方向性约束**：图中箭头单向。Fabric 从不反向控制 GitHub；Loom 从不参与运行时拦截。

## Architecture

### 层职责（与 Fabric Rule #4 对齐）

| 层         | 管什么                                                   | 资产                                      | 不管什么                          |
| ---------- | -------------------------------------------------------- | ----------------------------------------- | --------------------------------- |
| **Loom**   | 静态治理元数据：谁拥有什么 / 谁在跑 / 在哪落地           | `.loom/registry.yaml`、`scripts/loom/*`   | 运行时工具权限、执行拦截          |
| **Fabric** | 运行时执行治理：这次调用是否允许 / 什么约束 / 留什么审计 | `src/fabric/**`（54 文件，feature-gated） | PR 状态、分支、合并策略、发布流程 |
| **GitHub** | 落地权威：PR、必需检查、直推拒绝、归因（作者+分支）      | rulesets、workflows                       | 工作区内部状态                    |
| **CI**     | 门禁强制                                                 | `ci-gate.yml`、`ci.yml`                   | 决定该做什么                      |

一句话：**Loom owns what should happen and where it lands · Fabric owns whether an action may execute · GitHub owns whether code may enter · CI owns whether it is safe to enter.**

## 1. 分支策略（R1）

### 1.1 命名收敛

保留 `provision.ts:49` 的 `branchTemplate: "{owner}/{task}"`，把 issue 号放进 task id：

```
Issue #234  "增加企业会员套餐"
   │
   ├─ Loom task id : 234-enterprise-plan
   ├─ owner        : cursor-agent
   └─ branch       : cursor-agent/234-enterprise-plan
```

**为什么不用 `task/234-...`**：分支名是"所有 IDE agent 共用同一 git identity"下唯一持久可区分的 agent 身份（`docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §5）。把 owner 从分支名里去掉 = 丢掉该性质、废掉 `provision.ts`、使 145 个既有分支不合规。本方案同时满足可追溯与身份性，且**零工具改动**。

### 1.2 机器落点

| 条款            | 落点                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| 禁止直推 main   | ruleset `require-pr-on-trunk`（19808307，已生效）                      |
| 禁止 force-push | ruleset `protect-trunk-no-force-push`（19803181，已生效，bypass 为空） |
| 本地提前失败    | `git-hooks/pre-push`（已存在）                                         |
| 分支命名        | `provision.ts` 的 `renderBranch` + `validateBranchName`（已存在）      |
| 合并后删分支    | repo setting `delete_branch_on_merge: true`（**待开启**）              |
| `hotfix/*` 例外 | `AGENTS.md` 条目（**待新增**）                                         |

## 2. Registry Schema Delta（R2）

当前 `TaskSchema`（`scripts/loom/registry.ts:112`）字段：`id / owner / intent / paths / state / sessions / ownerHistory / since / metadata`。

**唯一改动**——新增一个真实列：

```ts
export const TaskSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  /** GitHub issue this task implements. The join key for intent -> code -> release. */
  issue: z.number().int().positive().optional(),
  intent: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  state: TaskState.default("active"),
  sessions: z.array(SessionSchema).default([]),
  ownerHistory: z.array(OwnerHistoryEntrySchema).default([]),
  since: z.string().optional(),
  metadata: TaskMetadata.default({}),
});
```

**刻意不做的三件事**：

| 提案中的写法      | 为什么不做                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `status: active`  | `state` 已存在，值域 `claimed/active/paused/blocked/ready/landed/abandoned`。新增会造双状态源。 |
| task 层 `branch:` | branch/worktree 已绑定在 `sessions[].metadata`（`provision.ts` 写入）。task 层复制会漂移。      |
| 塞进 `metadata`   | `TaskMetadata` 注释明确："新结构化字段应提升为真实列，不得临时堆入 metadata"。                  |

### 2.1 迁移路径（35 个 active task 需回填）

```
1. loom lint 新增 active-task-no-issue（severity: warn）
2. 为每个 active task 建 issue 或关联既有 issue，回填 issue 字段
3. Issue Coverage 达 100% 后，severity 提升为 error
```

**注意**：`.loom/registry.yaml` 目前带有他人 263 行未提交 WIP。回填 **必须** 在干净树上进行，且由各 task owner 各自回填自己的条目（AGENTS.md 规则 2：共享热文件由其 task-owner 落地）。

## 3. CI 门禁分级（R6、R7）

### 3.1 现状：为什么 `ci.yml` 是假门禁

`origin/main` 的 `ci.yml` 共 **16 个 job**，15 条 `runs-on:` 中 **13 条**声明在 `blacksmith-*` runner 上（2 条不是），而本仓库从未订阅 Blacksmith——标签是首个 commit 从上游 openclaw 继承来的。这些 job 永久 `queued`（`runner=none`），而推送速度快于队列，`concurrency` 在分配 runner 前就取消了每次 run。结果：**最近 30 次 run = 16 cancelled / 14 悬挂 / 0 success**。

> **口径修正（2026-07-31 审核）**：原文写"34 个 job 中 30 个"，那是转引 `ci-gate.yml` 头部注释而未独立核验。可复核口径为 **16 job / 13 of 15 `runs-on`**，命令：`git show origin/main:.github/workflows/ci.yml | grep -cE 'runs-on:.*blacksmith'`。

失败模式是 `cancelled` 而非 `failure`——在 dashboard 上与绿色无法区分。这是它能隐藏两个月的原因，也是 R12.4「门禁完成率」这个指标存在的理由。

### 3.2 三级设计

| 级别   | 阶段    | required checks                                   | 捕获                                                                                                                 | **不捕获**                     |
| ------ | ------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **L1** | Phase 0 | `check (types, lint, format)`<br>`delivery guard` | 格式；新增 tsgo/oxlint 诊断（增量 delta）；生成物一致性；page-tab 完整性；交付不变量（forward-only、release ledger） | **行为回归**；跨平台；架构边界 |
| **L2** | Phase 1 | 追加 `test (core slice)`                          | 核心路径行为回归                                                                                                     | 全量矩阵；e2e；live            |
| **L3** | Phase 2 | 追加 `loom check --strict`；shadow lint 逐条转硬  | 归因一致性；ownership 重叠；架构边界                                                                                 | —                              |

**L1 的诚实声明**：L1 完成后 `pnpm test`（vitest 主套件）**仍然不是门禁**。而 `AGENTS.md` 的 bug-fix 合并门槛要求"回归测试 fail-before / pass-after"。这两条在 L2 落地前是矛盾的，规范与 `AGENTS.md` 必须显式写出该缺口，而不是假装门禁已完整。

### 3.3 L2 实现形态（沿用既有窄切片写法）

`ci-gate.yml` 已经在用这个模式，直接扩展：

```yaml
test:
  name: test (core slice)
  runs-on: ubuntu-latest
  timeout-minutes: 20
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-env
    - name: Core slice tests
      env:
        OPENBOT_TEST_PROFILE: low
        OPENBOT_TEST_SERIAL_GATEWAY: "1"
      run: pnpm vitest run <按变更域解析出的文件集>
```

**不要**直接把 `pnpm test`（`scripts/test-parallel.mjs`）设为必需：私有仓 minutes 计费，`ci-gate.yml` 的头部注释已经算过这笔账，并明确要求"先跑几次看真实成本再扩范围"。

### 3.4 Runner 处置（R7）

`ci.yml` 中 13 条 `runs-on: blacksmith-*`（共 16 job / 15 条 `runs-on`）。**修订版 Option A**（按 2026-07-31 审核）：

```
需要成为门禁的 job          → 迁 ubuntu-latest（已由 ci-gate.yml 承担）
重型矩阵（Win/macOS/Android/Docker/benchmark）
                            → 从默认触发路径移除
                              （改 workflow_dispatch 或低频 schedule）
                            → 仅在 runner 能力确认后重新启用
```

> **修订原因（2026-07-31 审核）**：原方案是"保留 blacksmith 标签 + 加注释标注非门禁"。这不够 —— 只要 job 仍挂在 `push`/`pull_request` 上，就会继续产生 queued/cancelled 噪声，而**这正违反 R7.1 自身的原则**。原方案在此处自相矛盾。注释不是治理手段；把 job 移出默认触发路径才是。

关键：**不得静默留存**。假门禁的成本不是它不工作，是它让人以为有保护。而"加注释说明它不工作"仍然留着它 —— 噪声照旧，只是多了一句免责声明。

## 4. Landing Queue（R8）

### 4.1 为什么不能用 GitHub Merge Queue

实测仓库形态：`ownerType: "User"`、`private: true`、`allow_auto_merge: false`。GitHub merge queue 仅在 org 拥有的 public repo，或 org + Enterprise Cloud 的 private repo 提供（[Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)；内容已改写以符合许可要求）。

因此 `docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §4 中"开启 Merge Queue"的建议在本仓库不可执行，需按 R8.7 更正。

### 4.2 `loom task land` 的实际状态（原对照表已被证伪）

> **2026-07-31 专家审核推翻本节原内容。** 原表逐条对照 `loom task land` 与 Merge Queue 语义，结论是"能力已存在，只是以手工形态"。逐行核验后该结论**不成立**：对照表比较的是「实现存在」，而队列语义要求「能力被实际调用且串行」。四项关键语义没有一项真正成立。

| Merge Queue 语义       | `loom task land` 实际状态                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **串行化集成**         | ❌ 锁按 `taskId` 建（`provision.ts:490`），只互斥同一 task 重复落地；**不同 task 可并行落地**。无队首、无队列状态、无失败退尾   |
| **重跑检查**           | ❌ `loom.ts:554` 未注入 `runGate`，`provision.ts:650` 回退 `?? (() => true)` ⇒ **CLI 路径不跑任何门禁**                         |
| 自动 rebase 到最新 tip | ❌ base 是**本地** `main`（`provision.ts:632`，实测落后 `origin/main` 15 commit），fetch 失败被 `catch {}` 吞掉                 |
| 落地后校验             | ❌ 未注入 `prCreate`（`provision.ts:680` 可选调用）⇒ `--mode pr`（**默认模式**）推分支、置 `landed`、删 worktree，却**不开 PR** |
| 作用域提交             | ✅ `scripts/committer`（拒绝 `git add .`）—— 唯一真正成立的一项                                                                 |

`.pi/prompts/landpr.md` 的 17 步流程确实做了 rebase→门禁→merge→校验，但那是**人在执行 prompt**，不是 `loom task land` 在执行。把两者混为一谈是本次审核发现的核心错误。

**结论**：自建队列是**新建高风险协调能力**。上表 4 处 ❌ 是任何队列设计的前置修复项。短期方案见 R8.2（required checks + 人工串行 `/landpr`）。

### 4.3 队列算法（未来设计草案，不代表现状）

> 本节描述的是**尚不存在**的能力。按 R8.4，动工前须先修复 §4.2 的 4 处缺陷，并另立含全局锁 / 强制同步 `origin/main` / check-SHA 绑定 / 幂等恢复 / 审计事件的安全设计。

```
loom task land --queue
  ├─ 1. 取队首（就绪 task 中最早进入 ready 的）
  ├─ 2. 加落地锁（同一时刻至多一个 task 落地中）
  ├─ 3. rebase 到 origin/main 当前 tip
  ├─ 4. 运行必需门禁（L1 → 后续 L2/L3）
  ├─ 5. 绿 → 合并；红 → 退回队列尾并标注失败原因
  ├─ 6. 释放锁
  └─ 7. 记录落地事件（供 R12 指标消费）
```

服务端保底：ruleset 禁止直推 + required status checks，使**绕过队列的落地在服务端失败**。这是"队列是唯一入口"的强制来源——本地脚本本身不构成强制。

### 4.4 过渡机制

`allow_auto_merge: true` 开启后，必需检查通过即自动合并，是当前 plan 下最接近串行化的原生机制。它不替代队列，但在队列自动化落地前显著降低人工等待。

## 5. CODEOWNERS（R11）

### 5.1 派生而非维护

```
.loom/registry.yaml  ──(loom derive --codeowners)──►  .github/CODEOWNERS
                                                            │
                                                     CI drift check
```

`loom derive` 命令已存在（当前输出 `## Agents` 视图），新增 `--codeowners` 输出形态即可。

### 5.2 定位修正：它不是门禁

`require_code_owner_review` 生效需要 reviewer 具备 push 权限**且非 PR 作者**。本仓库只有一名人类 owner，`required_approving_review_count: 0`。因此无论 CODEOWNERS 怎么生成，都拦不住任何合并。

**它的真实价值**：把 registry ownership 暴露到 PR 界面（自动提示 reviewer）+ drift 检测。

**真实的 path 归属门禁**是 `loom lint` 的 `ownership-overlap`（`scripts/loom/lint.ts`）——那个才随 L3 转必需。把 CODEOWNERS 计入"代码进入规则"会产生虚假的安全感。

## 6. 健康指标定义（R12）

### 6.1 为什么"CI 成功率"是错的指标

| workflow      | 最近样本                 | 成功率 | 真实状态                      |
| ------------- | ------------------------ | ------ | ----------------------------- |
| `ci-gate.yml` | 10 success / 20 failure  | 33%    | **健康**（PR 红了 → 修 → 绿） |
| `ci.yml`      | 0 success / 25 cancelled | 0%     | **死亡**（runner 不存在）     |

单一"成功率"把两者同等对待，并且奖励"不设门禁"（不设门禁 = 100% 成功）。

### 6.2 正确的两个指标

```
门禁完成率 = (success + failure) / total_runs        目标 100%
   └─ 抓的是「永久 cancelled / 悬挂」这类静默故障

main 门禁绿率 = success / total_runs   (仅统计 main)   目标 > 95%
   └─ PR 上红是健康的，不计入
```

### 6.3 三层链路与依赖顺序

| 层      | 内容                           | 资产                                                          | 状态                   |
| ------- | ------------------------------ | ------------------------------------------------------------- | ---------------------- |
| Task    | task id / owner / agent / 时长 | `loom status --json`                                          | **依赖 R2 的 `issue`** |
| Code    | commit / PR / release          | `scripts/delivery/*`、`pnpm delivery:ledger:audit`            | 已有                   |
| Runtime | 部署 / 健康 / 回滚             | `deploy/production/RELEASE_RECORD.md`、`/healthz`、Fly digest | 已有                   |

**顺序约束**：Task 层是 join key 的来源，Code/Runtime 两层已就绪。所以可观测性工作**必须排在 Issue 绑定之后**，否则只能得到两段互不相连的链路。

## 7. 主工作树恢复（Phase 0.5）

这是全计划风险最高的单次操作，不是 checklist 的一行。

**现状**：HEAD = `deploy/user-modeling-v92`，落后 `origin/main` 1528 commit、领先 289，205 个 dirty 文件，40 个 worktree。以致 `ci-gate.yml` / `delivery-sot-alignment.yml` / `ci-canary.yml` 三个 workflow 在 `origin/main` 上存在、在本地工作树中根本不可见。

**协议**（沿用 `deploy/production/RELEASE_RECORD.md` 在 2026-07-27 事故后确立的规则）：

```
1. bun scripts/agent-attribution.ts            → 把 205 个 dirty 文件映射到 owner
2. 各 owner 自行落地或归档自己的文件            → 不得代他人提交（AGENTS.md 规则 2）
3. 建备份分支 backup/<topic>-<YYYYMMDD>         → 先备份再动
4. 主工作树切回 main
5. 记录 before/after SHA 与原因
```

**执行主体：人，不是 agent。** 理由：2026-07-27 那次 40 commit 失联（含已合并 PR #90/#91）正是这个操作类别的事故，且当时"git 里没有任何记录，只能靠 per-ref 审计发现"。

## 8. 条款 → 落点映射表（R14.5）

> **2026-07-31 专家审核重写。** 原表把全部落点一律称为「机器落点」，其中 `AGENTS.md` 条目与 PR 模板字段**都不是拒绝器** —— 前者是行为规范（agent 可以不读、读了可以不遵守），后者无法强制填写。且大量"待新增/待开启"被当成已有落点。现按 R14 的三类重标。

| 记号     | 类别           | 含义                                    |
| -------- | -------------- | --------------------------------------- |
| **强制** | 强制门禁       | 违反则动作被机器拒绝                    |
| 检测     | 自动检测不阻断 | 机器会报，但不拒                        |
| 人工     | 人工流程约束   | 仅靠人遵守，**不计入治理强度**          |
| —        | 非治理项       | 卫生/便利自动化，或结构上不可能成为门禁 |

**「类别」列是验收关键**：只有「强制」且「已生效」的行才是真实保护。

| 需求  | 条款                      | 类别                     | 落点                                                                                                                 | 现状                   |
| ----- | ------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| R1.1  | main 唯一事实源           | **强制**                 | `docker-release.yml` 绑 main push（`RELEASE_RECORD.md` 是记录，非门禁）                                              | 已生效                 |
| R1.2  | 禁长期集成分支            | 人工                     | `AGENTS.md` 条目 —— ruleset **无**分支模式限制                                                                       | 待新增                 |
| R1.3  | 分支命名 `<owner>/<task>` | **强制**（限 loom 路径） | `provision.ts` `validateBranchName` 抛错；**人工建分支不受限**                                                       | 已生效                 |
| R1.4  | issue 号进 task id        | 检测                     | `loom task start` 的 advisory warn（`issueMatchesTaskId`）                                                           | 已实现                 |
| R1.5  | `hotfix/*` 例外           | 人工                     | `AGENTS.md` 条目                                                                                                     | 待新增                 |
| R1.6  | 禁直推 main               | **强制**                 | ruleset 19808307 + `git-hooks/pre-push`                                                                              | 已生效                 |
| R1.7  | 合并后删分支              | —                        | repo setting `delete_branch_on_merge`（卫生自动化，非拒绝）                                                          | **待开启**             |
| R2.2  | `issue` 真实列            | **强制**                 | `TaskSchema` zod —— 非法值使 registry **拒绝加载**                                                                   | 已实现                 |
| R2.4  | Issue 绑定                | 检测→强制                | `loom lint` `active-task-no-issue`（当前 `warn`，37 条）                                                             | 已实现（warn）         |
| R2.5  | `--issue` 参数校验        | **强制**                 | `loom register` / `task start` 拒绝非正整数                                                                          | 已实现                 |
| R2.6  | PR 关联 issue             | 人工                     | PR 模板**无法强制填写**                                                                                              | 模板已有               |
| R3.2  | active task ≤ 2           | **强制**                 | `loom task start` 拒绝 + `loom lint` `agent-wip-exceeded`                                                            | 待新增                 |
| R3.3  | open PR ≤ 2               | **强制**                 | 同上（经 `gh pr list` 计数）                                                                                         | 待新增                 |
| R4.1  | 周期回收                  | 检测                     | `loom task reconcile` 默认只读；写操作需 `--yes`                                                                     | 部分                   |
| R5.1  | PR 唯一入口               | **强制**                 | ruleset 19808307                                                                                                     | 已生效                 |
| R5.2  | PR 必填字段               | 人工                     | PR 模板**无法强制填写**                                                                                              | 已存在但不阻断         |
| R5.5  | review 会话须解决         | **强制**                 | ruleset `required_review_thread_resolution: true`                                                                    | 已生效                 |
| R6.1  | CI 决定合并权限           | **强制**                 | ruleset `required_status_checks`                                                                                     | **待新增（核心）**     |
| R6.2  | L1 检查项                 | **强制**                 | `ci-gate.yml` 的 `check` + `delivery-guard` —— **须被列为必需才生效**                                                | job 已存在，门禁待新增 |
| R6.3  | L2 测试切片               | **强制**                 | `ci-gate.yml` 新增 `test (core slice)` job                                                                           | 待新增                 |
| R6.4a | `loom lint` 结构门禁      | **强制**                 | `ci-gate.yml` **新增独立 job** —— 不是 `ci.yml` 的 shadow 提升                                                       | 待新增                 |
| R6.4b | `loom check` shadow 提升  | 检测→强制                | `ci.yml:237` 去 `continue-on-error`（只保归因 parity，**与结构检查无关**）                                           | 待提升                 |
| R7.2  | runner 处置               | —                        | 把不可用 job **移出默认触发路径**（治理动作是"移除"，不产生拒绝）                                                    | 待处置                 |
| R7.4  | 门禁完成率监控            | 检测                     | 指标脚本（消费 `gh run list`）                                                                                       | 待新增                 |
| R8.2  | 进入 main 的路径          | **强制**（部分）         | ruleset 禁直推 = 强制；**「经由队列」无法由 ruleset 证明**                                                           | 部分                   |
| R8.3  | `loom task land` 4 处缺陷 | —                        | 待修复项（当前 CLI 落地路径**不跑门禁、不开 PR**）                                                                   | **待修复**             |
| R8.8  | auto-merge                | —                        | repo setting `allow_auto_merge`（便利自动化，**不是队列**）                                                          | **待开启**             |
| R9.1  | CalVer                    | **强制**                 | `openclaw-npm-release.yml` tag 校验器拒绝不合规 tag                                                                  | 已生效                 |
| R9.3  | 部署记录                  | 人工 + 检测              | `RELEASE_RECORD.md` 人工写；`delivery-sot-alignment.yml` 定时校验（**仅监听 `release/baseline-recovery-20260725`**） | 部分                   |
| R10.1 | 单一部署源                | **强制**                 | `docker-release.yml` 的 `production` Environment 审批                                                                | 已生效                 |
| R11.1 | CODEOWNERS 派生           | 检测                     | `loom derive --codeowners --check`（drift 检测，不阻断合并）                                                         | 已实现                 |
| R11.3 | CODEOWNERS 非门禁         | —                        | 单人 owner + review count 0 ⇒ **结构上不可能成为门禁**                                                               | 已确认                 |
| R11.4 | path 归属门禁             | **强制**                 | 经 R6.4a 的 `loom lint` job（`ownership-overlap` / `impossible-glob`）                                               | 待新增                 |
| R12.4 | 指标定义                  | 检测                     | 指标脚本 + 周报                                                                                                      | 待新增                 |
| R13.6 | 反馈接入                  | —                        | 另立 spec；`src/fabric/feedback.ts` 在 v1 仅为接口                                                                   | Phase 3                |
| R14.4 | 消除悬空引用              | 人工                     | 无机器检查 —— 需新增一条 lint 才能进「强制」类                                                                       | 待处置                 |

### 8.1 治理强度实况

按上表统计（这是本 spec 最重要的一个数字）：

| 类别         | 条数 | 其中已生效  |
| ------------ | ---- | ----------- |
| **强制门禁** | 16   | **9**       |
| 检测不阻断   | 7    | 4           |
| 人工约束     | 6    | —（不计入） |
| 非治理项     | 6    | 2           |

**已生效的 9 条强制门禁**：R1.1 main 部署绑定、R1.3 分支命名（限 loom 路径）、R1.6 禁直推、R2.2 registry schema、R2.5 `--issue` 校验、R5.1 PR 唯一入口、R5.5 review 会话、R9.1 CalVer tag 校验、R10.1 production Environment 审批。

**最关键的一条 R6.1（CI 决定合并权限）仍是「待新增」** —— 这正是本 spec 存在的理由。在它生效前，上面 9 条保护的是**发布链路与元数据**，**没有一条保护代码质量**。

## 9. 待确认事项 — **已于 2026-07-31 全部裁决**

> 本节原列 4 项待决策。专家审核已对全部 10 项决策（含本节 4 项）给出裁决，完整记录见 **`review-decision-2026-07-31.md`** §3。此处仅保留裁决结果。

| 原待确认项             | 裁决                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1. Blacksmith 归属     | **修订版 A/C**：门禁 job 跑 `ubuntu-latest`；不可用重型 job **移出默认触发路径**（不是加注释保留）               |
| 2. L1 上线时机         | **尽快上线，不等 dependabot 清仓**；`strict=false`；**先用故意失败的 PR 验证服务端确实拒绝，再改 ruleset**       |
| 3. 是否迁 Organization | 暂不迁。短期用 required checks + 人工串行 `/landpr`；自建队列排到最后评估。迁 org 后可平滑替换，**不算沉没成本** |
| 4. Issue 回填责任      | **先 GC，再回填**。活跃 task 由 owner 补；dead task 先判定 landed/abandoned/takeover；维护者**不得无痕代填**     |

### 9.1 新增的待办（由本次审核产生）

1. `loom task land` 的 4 处缺陷须独立修复（见 §4.2），**与是否建队列无关** —— 当前 CLI 落地路径不跑门禁、默认模式不开 PR。
2. `sharedPaths` 的 `lander` 须改为引用稳定 task/role 并加 `reviewAfter`，**在 P2.5 填表之前**完成（`sharedPaths` 当前为空，迁移成本为零）。
3. §8 映射表其余行若有新增条款，须按三类格式标注，不得回到"一律称机器落点"。
4. 执行 GitHub 侧改动前须重跑 `gh api` / `gh run list` —— 专家本轮无法连接 `api.github.com`，该部分数据未经第二方核验。
