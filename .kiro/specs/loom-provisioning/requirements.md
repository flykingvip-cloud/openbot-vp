# Requirements Document

> 中文名：Loom Provisioning —— **隔离生命周期（Worktree + 分支 + 落地/废弃）**
> 产品规划依据：`docs/design/worktree-multiagent-target-architecture-2026-06-16.md`（§4 Layer 0、§9 M2/M3）
> 前序 spec（地基）：`.kiro/specs/loom-workspace-orchestrator/`（MVP：Registry + Attribution + Audit，已交付）
> 上位约束：`.kiro/specs/openbot-fabric/`（Loom = Fabric 的 Governance 子系统，signal layer，编译期静态元数据源，禁止 runtime lookup）
> 本期范围 = Roadmap 的 Phase 2（Provisioning，v1.x）。Hot-file Lease（v2）、IDE 插件 / SDK（更后）不在本期。

## Introduction

MVP（前序 spec）证明了「单一真相源 + 归属 + 审计」可以在**共享脏工作树**上把混乱治理起来，但那只是 damage control：根因没有被消除——N 个 agent 仍在同一分支、同一工作树上并发编辑，编辑态没有 author，294 个文件 UNATTRIBUTED 的窘境随时复发。

本期（Provisioning）消除根因：**让每个任务窗口（agent）拥有自己的 worktree + 分支**，把"编辑态交织"降到零。提交边界（commit / branch / PR）天然带 author，归属问题从"无法对脏树归属"退化为"分支名即身份"。

本期同时补齐任务落地（land）与废弃（abandon）的生命周期，使隔离-工作-合并-回收形成闭环，并把远端集成对接到 GitHub（受保护分支 + 必需检查 + Merge Queue + CODEOWNERS），对应目标架构的 M2 / M3。

### 本期定位（Scope Framing）

本期**只做隔离生命周期的本地编排**，命令为 `loom task start` / `loom task land` / `loom task abandon` / `loom task list`，回答**"为这个任务开一个隔离工作区、在干净状态下落地、用完安全回收"**。明确排除：

- **不**做热文件 Lease 三层防线（留 v2）。
- **不**做 IDE 插件 / SDK（留更后）。
- **不**改变 Loom 的 Fabric 定位：仍是 signal layer，worktree 元数据只作为编译期信号喂给 Fabric，**禁止** runtime lookup。
- **不**自行决定隔离：worktree / 分支的创建与销毁是**人授权**的显式操作，agent 只在被分配的 worktree 内工作（对齐 `AGENTS.md` 多 agent 安全条款）。

### 复用优先（Reuse-first，强约束）

本期**绝不**自建并行的隔离/调度/合并系统。隔离复用 `git worktree`；分支与身份复用 Git；远端集成与合并治理复用 GitHub（PR / Merge Queue / CODEOWNERS）；归属与审计复用前序 spec 已交付的 Registry / `loom check`。Provisioning 只是**编排器**（把这些既有能力按安全顺序串起来），不是新引擎。

### 现状与证据（Current State）

- 前序 spec 的 Registry 已有 `session.worktree?` 字段（本期之前允许为空），且生命周期状态机 `claimed → active → ready → landed`（含 `paused / blocked / abandoned`）与 `session.status`（含 `dead`）已定义但**无 Provisioning 触发**（前序 R10.5：状态机变更仅为元数据，本期不触发 worktree 创建/销毁）。
- 仓库已有 `scripts/loom/`（registry / attribution / audit / lifecycle / status 等）与 `scripts/loom.ts` CLI（`import / register / status / audit / check / derive / lint / suggest / accept / unattributed / claim`）。
- 仓库已有 `scripts/worktree-audit.ts`、`scripts/agent-attribution.ts`、`git-hooks/pre-commit`、`scripts/committer`，其调用契约在前序 spec 被冻结。

### 概念模型（Target Model）

```
Task（归属 / 一条意图线）
 └─ Session（执行体）
     └─ worktree（本期被填充）：
         ├─ path：<repoRoot>/../<repo>-<task> 或可配置根目录下的隔离工作目录
         ├─ branch：<owner>/<task>（自描述身份，即使 git author 共享）
         └─ identity：per-worktree git identity（可选，便于 PR 归属）
```

隔离生命周期（在前序状态机上叠加 Provisioning 动作）：

```
claimed ──start──> active(worktree live) ──...work...──> ready ──land──> landed(worktree GC'd)
                          │
                          └──abandon──> abandoned(worktree GC'd, branch optionally kept)
```

### 设计原则（强约束 / 非功能性需求）

1. **数据安全第一**：任何会丢失未提交/未推送工作的操作（删 worktree、删分支、强制回收）SHALL 默认拒绝，需显式确认；SHALL NOT 静默销毁。
2. **不越界他人工作区**：命令 SHALL 只操作调用者被分配/拥有的任务 worktree；SHALL NOT 创建/删除/修改其他 agent 的 worktree 或分支。
3. **人授权 Provisioning**：worktree / 分支的创建与销毁是显式人发起的操作；agent SHALL NOT 自行 provisioning（对齐 `AGENTS.md`）。
4. **复用优先**：隔离=`git worktree`，合并=GitHub，归属/审计=前序 Loom；SHALL NOT 自建并行系统。
5. **Path = 硬信号 / Intent = 软信号**：分支名与归属仍只依据 path 与 owner/task 身份；intent 不参与任何判定（沿用 Architecture Rule #1）。
6. **零回归 + feature-gated**：Provisioning 为 opt-in；未使用 `loom task` 时，MVP 行为与共享树工作流**逐字节不变**；前序 pre-commit / CI 拒绝集合 SHALL NOT 被放宽。
7. **Fabric signal-only**：worktree / 分支元数据 SHALL 仅作为编译期信号经稳定边界（`LoomAttribution` 系）喂给 Fabric，SHALL NOT 引入 runtime Loom lookup，SHALL NOT 在 Fabric 内新建引擎。
8. **本地优先 + CLI 优先**：能力以 CLI 暴露并提供 `--json`；状态持久化于仓库内版本化 Registry；不依赖服务端。
9. **仓库无关**：worktree 路径、分支命名模板等仓库特化项 SHALL 来自配置/Registry，核心编排逻辑 SHALL NOT 内嵌 OpenBot 专属路径。

## Glossary

- **Provisioning**：为一个任务创建/回收隔离工作区（worktree + 分支 + 身份）的生命周期编排。
- **worktree**：`git worktree` 创建的独立工作目录，共享同一 `.git`，使不同任务窗口互不干扰。
- **分支命名模板**：`<owner>/<task>`（如 `kiro-loom/loom-provisioning`），分支名即 agent 身份。
- **land（落地）**：把任务分支集成进主线（本地 merge 或开 PR），落地前强制归属/审计干净，落地后回收 worktree。
- **abandon（废弃）**：安全拆除任务 worktree（分支可选保留），用于半途而废/僵尸任务回收。
- **GC（回收）**：删除 worktree 工作目录并 `git worktree prune`；仅在确认无未提交/未推送丢失时执行。
- **dirty guard（脏检查）**：操作前检测目标 worktree 是否有未提交/未推送变更的安全闸。

## Requirements

### Requirement 1: 任务隔离开工（loom task start）

**User Story:** 作为任务 owner，我希望一条命令就为我的任务开出隔离工作区，以便我不再与其他 agent 共享脏工作树。

#### Acceptance Criteria

1. WHEN 运行 `loom task start --task <id> --owner <o>` THEN 系统 SHALL 为该任务创建一个 `git worktree`，分支名 SHALL 按模板 `<owner>/<task>` 生成（模板可配置）。
2. 系统 SHALL 在 Registry 中把该任务对应 Session 的 `worktree`（path / branch）填充，并把任务 state 从 `claimed` 迁移到 `active`（若任务未登记，SHALL 先以最小信息登记后再开工）。
3. IF 目标分支或 worktree 路径已存在 THEN 系统 SHALL 拒绝并报出可定位错误，SHALL NOT 覆盖既有 worktree。
4. 系统 SHALL 支持可选 `--from <ref>`（默认从最新 `main`/默认分支）与可选 per-worktree git identity 配置；SHALL 提供 `--json` 输出新建 worktree 的 path / branch。
5. 系统 SHALL NOT 切换调用者当前所在的工作目录或分支（仅创建新 worktree，由人进入）。
6. 系统 SHALL 为每次 provisioning 生成一个**不可变绑定标识 `provisionId`**（如 UUID/hash），写入 `session.metadata`，并以它绑定 `taskId → branch → worktreePath → session`。后续所有 worktree 归属判定（land/abandon/reconcile 的「不越界」）SHALL 依据该**已记录的绑定**，SHALL NOT 依据脏文件 path 推断（path 会移动、分支会 rebase，绑定记录才是稳定身份）。

### Requirement 2: 任务落地（loom task land）

**User Story:** 作为任务 owner，我希望在归属/审计干净的前提下把我的隔离分支落地，以便合并简单且可监管。

#### Acceptance Criteria

1. WHEN 运行 `loom task land --task <id>` THEN 系统 SHALL 先对该任务 worktree 运行归属与审计校验（复用前序 `loom check` / 审计门禁），任一不通过 SHALL 阻止落地并报告原因。
2. 系统 SHALL 支持两种落地模式：`--mode merge`（本地 rebase + merge 进默认分支）与 `--mode pr`（推送分支并经 CLI 开 PR，交由 GitHub 受保护分支 / Merge Queue 集成）；默认模式 SHALL 可配置。
3. IF 目标 worktree 存在未提交变更 THEN 系统 SHALL 拒绝落地并提示先提交（dirty guard），SHALL NOT 丢弃未提交工作。
4. WHEN 落地成功 THEN 系统 SHALL 把任务 state 迁移到 `landed`，并在确认无丢失后回收（GC）该 worktree（保留或删除分支由 `--keep-branch` 控制）。
5. 系统 SHALL NOT 直接推送到默认分支（`main`/master）；远端集成 SHALL 经分支 + PR/Merge Queue（对齐 `git_safety` 与目标架构 M3）。

### Requirement 3: 任务废弃与回收（loom task abandon）

**User Story:** 作为维护者，我希望安全回收半途而废或僵尸任务的工作区，以便清理隔离环境而不误删有用工作。

#### Acceptance Criteria

1. WHEN 运行 `loom task abandon --task <id>` THEN 系统 SHALL 在确认目标 worktree 无未提交/未推送变更后删除该 worktree 并 `git worktree prune`，并把任务 state 迁移到 `abandoned`。
2. IF 目标 worktree 有未提交或未推送变更 THEN 系统 SHALL 默认拒绝，仅在显式 `--force` 且二次确认下才回收，并 SHALL 在回收前打印将丢失的内容摘要。
3. 系统 SHALL 默认**保留**分支（仅删工作目录），分支删除需显式 `--delete-branch`；删除分支 SHALL 复用安全方式（不强制、可恢复 ref）。
4. 系统 SHALL NOT abandon 不属于该任务/调用者的 worktree。

### Requirement 4: 隔离状态可见性（loom task list / status 扩展）

**User Story:** 作为维护者，我希望看到当前所有隔离工作区与其健康度，以便监管并发任务。

#### Acceptance Criteria

1. 系统 SHALL 提供 `loom task list`，列出每个已 provisioning 任务的：task id / owner / branch / worktree path / state / 该 worktree 是否 dirty / 是否 ahead-behind 默认分支；SHALL 提供 `--json`。
2. `loom status` SHALL 在既有展示上补充每个 Session 的 worktree path 与 branch（若已 provisioning）。
3. WHEN 某 worktree 对应分支已被远端合并/删除但本地仍存在 THEN `loom task list` SHALL 提示其可回收（stale）。
4. 系统 SHALL 复用前序 `session.status=dead`（活跃信号超时）判定，在 list 中并列展示，便于识别僵尸隔离区。

### Requirement 5: 安全与非回归（feature-gated）

**User Story:** 作为维护者，我希望引入 Provisioning 不影响仍在共享树工作的人，也不削弱既有纪律。

#### Acceptance Criteria

1. WHEN 未使用任何 `loom task` 命令 THEN MVP（前序 spec）与共享树工作流的行为 SHALL 逐字节不变（Provisioning 为纯增量、opt-in）。
2. 本期 SHALL NOT 放宽前序 pre-commit / CI 的拒绝集合；落地校验 SHALL 复用而非削弱既有门禁。
3. 任何破坏性操作（删 worktree / 删分支 / `--force` 回收）SHALL 默认拒绝并要求显式确认；SHALL NOT 静默执行。
4. 系统 SHALL NOT 读取或输出任何凭证/密钥；新增持久化 SHALL 限于 worktree path / branch / identity 等路径与身份元数据。
5. 系统 SHALL 提供干跑模式（`--dry-run`）打印将执行的 git 操作而不实际执行，便于人审阅授权。

### Requirement 6: Fabric 子系统对齐（signal-only，编译期）

**User Story:** 作为 Fabric owner，我希望 Provisioning 产出的隔离元数据只作为编译期信号被消费，不破坏 Fabric 的单一决策权与四层边界。

#### Acceptance Criteria

1. worktree / branch / identity 元数据 SHALL 仅经稳定读边界（`src/fabric/mappers.ts` 的 `LoomAttribution` 系）作为**编译期信号**暴露给 Fabric Policy Runtime 的 Stage 2（Governance Signals）。
2. 系统 SHALL NOT 引入任何 runtime Loom lookup，SHALL NOT 在 Fabric 内新建引擎或让 Provisioning 成为决策权。
3. 分支身份与归属 SHALL 仅依据 path 与 owner/task（硬信号）；intent SHALL NOT 参与任何 provisioning / landing 判定（Architecture Rule #1）。
4. 设计文档 SHALL 明确：Provisioning 是 Layer 0（隔离）的本地编排 + Layer 2（GitHub）集成对接，Loom 仍是 signal layer + 本地 enforcement，Fabric 仍是唯一决策者。

### Requirement 7: 仓库无关与可迁移

**User Story:** 作为产品化负责人，我希望 Provisioning 编排不绑定 OpenBot，以便沉淀为通用工具。

#### Acceptance Criteria

1. worktree 根目录、分支命名模板、默认分支名、默认落地模式 SHALL 来自配置 / Registry；核心编排逻辑 SHALL NOT 内嵌 OpenBot 专属路径。
2. WHEN 在一个最小仓库（无 OpenBot 路径约定）中运行 `loom task start/land/abandon/list` THEN 命令 SHALL 可运行（隔离/落地/回收的核心行为不依赖 `.kiro/specs` 目录约定）。
3. 系统 SHALL 以 `--json` 暴露所有 `loom task` 子命令输出，便于接入 CI 与外部编排。

### Requirement 8: 规范状态模型与对账恢复（Canonical State & Reconciliation）

**User Story:** 作为维护者，我希望系统对「Registry 说 active 但 worktree 不在 / 分支被外部删除」这类漂移能确定性地检测和修复，以便隔离环境长期可信。

#### Acceptance Criteria

1. 系统 SHALL 以 **Registry 为唯一规范真相源（canonical source of truth）**；git 分支存在性、worktree 文件系统状态 SHALL 被视为**投影（projection）**而非独立真相源。
2. 系统 SHALL 提供 `loom task reconcile [--task <id>] [--mode dry|report|apply] [--json]`：对账 Registry 记录与 git/worktree 实况，检测并报告漂移类型——`ORPHANED`（Registry 记录在、worktree 缺失）、`MISSING_BRANCH`（分支被外部删除）、`UNTRACKED_WORKTREE`（worktree 在、Registry 无记录）、`STALE`（分支已远端合并/删除本地仍在）。**`reconcile` 默认 `--mode report`（只读，绝不变更）；`dry` 打印将执行的修复但不执行；只有显式 `--mode apply` 才允许变更**——杜绝 reconcile 沦为隐式 mutation 引擎。
3. `ORPHANED` 等漂移 SHALL 作为**对账派生的健康发现**呈现（类比前序 `session.status=dead`），SHALL NOT 作为新增的持久化 `TaskState`（避免改动前序已交付的状态机/ schema）。
4. 系统 SHALL 提供 `loom task repair --task <id>`（等价于针对单任务的 `reconcile --mode apply`）：对检测到的漂移给出可选确定性修复（重建缺失 worktree / 重新登记 untracked worktree / 把无可恢复工作的 orphan 任务迁移到 `abandoned`）；任何会丢失工作的修复 SHALL 遵循 R3 的破坏性操作确认规则。任何 `apply`/`repair` 变更 SHALL 列出将改动项并要求显式确认（非交互场景需 `--yes`），SHALL NOT 静默修复。
5. 系统 SHALL 在 `session.metadata` 维护一条**追加式 provision 审计轨迹**（如 `events: [{ts, kind}]`，kind ∈ `worktree_created|branch_created|landed|abandoned|reconciled|repaired`），用于审计与调试；该轨迹 SHALL **有界**（仅保留最近 N 条，默认 50，超出则丢弃最旧），避免无界增长。本期 SHALL NOT 把整个 Registry 改为事件溯源（event-sourcing）模型——状态仍以现有 state-store 为准，审计轨迹仅为附加投影（event-sourcing 留待 v2，避免冲击已交付 MVP schema）。

### Requirement 9: 落地结果语义与两阶段原子性（Land Semantics）

**User Story:** 作为任务 owner，我希望 land 失败有标准化、可判定「能否重试」的结果语义，且 git 与 Registry 不会处于半完成状态。

#### Acceptance Criteria

1. `loom task land` SHALL 返回标准化结果 `LandResult ∈ {SUCCESS, CONFLICTED, NON_FAST_FORWARD, DIRTY_WORKTREE, POLICY_BLOCKED}`（`--json` 暴露）。
2. 系统 SHALL 明确每种结果的可重试性：`CONFLICTED` / `NON_FAST_FORWARD` / `DIRTY_WORKTREE` 为**可重试**（修复后重跑）；`POLICY_BLOCKED`（归属/审计门禁不过）为**不可经 git 重试**（须先改代码/归属）；`SUCCESS` 终态。
3. `land` SHALL 采用**两阶段**：`prepare`（dirty guard + 门禁校验 + rebase 预演，全部可逆）与 `finalize`（不可逆 merge/push/PR + Registry 写 + GC）。IF `prepare` 任一步失败 THEN 系统 SHALL 不进入 `finalize`，不产生任何不可逆副作用。
4. WHEN `finalize` 中途失败 THEN 系统 SHALL 不留下「Registry 已 landed 但 worktree/分支未集成」的不一致：Registry 的 `landed` 写入 SHALL 在不可逆 git 集成成功**之后**进行，或在失败时回滚到 `finalize` 前状态。
5. `land` 的结果分类 SHALL 仅依据确定性的 git/门禁信号，SHALL NOT 依据 intent（沿用 Architecture Rule #1）。
6. 系统 SHALL 对同一 `taskId` 的 `land` 取**互斥锁（`landLock(taskId)`）**：同一任务的并发或重复 `land`（含 prepare/finalize 重试）SHALL 串行化，避免 retry 引发重复 PR / 重复 merge 尝试。IF 锁被占用 THEN 系统 SHALL 拒绝并提示已有进行中的 land；锁 SHALL 在完成/失败/进程退出时释放（含陈旧锁的安全清理）。
