# Design Document — Loom Provisioning（隔离生命周期）

> 需求：`.kiro/specs/loom-provisioning/requirements.md`
> 产品规划：`docs/design/worktree-multiagent-target-architecture-2026-06-16.md`（§4 Layer 0、§9 M2/M3）
> 复用地基：`.kiro/specs/loom-workspace-orchestrator/`（Registry / Attribution / Audit / lifecycle / check，已交付）
> 上位约束：`.kiro/specs/openbot-fabric/`（Loom = signal layer，编译期静态元数据源，禁 runtime lookup）

## Overview

Provisioning 把「每个任务窗口一条隔离工作区」落地：以 `git worktree` + 分支 `<owner>/<task>` 隔离编辑态，用 land/abandon 形成闭环。它是**编排器**而非引擎——所有重活（隔离、分支、合并、归属、审计）都复用既有能力。

### 定位（不变量）

- Loom 仍是 Fabric 的 **Governance 子系统 / signal layer**：worktree/branch 元数据只作为**编译期信号**经 `LoomAttribution` 稳定边界喂 Fabric Stage 2，**禁** runtime lookup，**不**在 Fabric 内建引擎。
- **Provisioning 是 workspace lifecycle manager，不是 execution state machine**（评审采纳）。它编排隔离工作区的创建/落地/回收，**不**承载工具执行的运行时状态；执行属 TOL。它的"状态"只是对 Registry（真相源）与 git（投影）的对账视图，不是一个自驱动引擎。
- **复用优先**：隔离=`git worktree`；合并=GitHub（PR/Merge Queue/CODEOWNERS）；归属/审计=前序 `loom check` 与 audit 门禁。本期不新建并行系统。
- **Architecture Rule #1**：分支身份与归属仅依据 path + owner/task（硬信号）；intent 不参与任何判定。
- **feature-gated 零回归**：未用 `loom task` 时，MVP 与共享树工作流逐字节不变。

> **与前序 R10.5 的关系**：MVP 明确「状态机变更仅为元数据，不触发 worktree 创建/销毁」。本期正是被推迟的 Provisioning 阶段，**显式接管** worktree 的创建/销毁；前序状态机（`lifecycle.ts`）保持不变，本期只是为其状态迁移**附加** git 副作用。

## Architecture

```
                         loom.ts CLI
                              │  task <start|land|abandon|list|reconcile|repair>
                              ▼
                   scripts/loom/provision.ts        ← 本期新增（编排）
            ┌─────────────┬───────┴────────┬──────────────┐
            ▼             ▼                ▼              ▼
   scripts/loom/git.ts  registry.ts   lifecycle.ts   check.ts / audit
   (薄 git 封装,本期新增) (worktree字段) (状态迁移)   (落地前门禁,复用)
            │
            ▼
      git worktree / branch（真正副作用，受 dry-run + 安全闸保护）
```

新增仅两个核心模块 + 一个 CLI 子路由,均为**增量**,不改既有模块对外契约:

- `scripts/loom/git.ts` —— 薄 git 封装(worktree add/remove/list/prune、branch 创建/删除、dirty/ahead-behind 检测、merge/push、PR 经 CLI)。集中所有 `execFile("git", …)`,便于测试 stub 与命令注入防护(数组参数、绝不字符串插值)。
- `scripts/loom/provision.ts` —— 编排逻辑(start/land/abandon/list/reconcile/repair 的纯+副作用分层:决策纯函数 + 一层薄 IO)。
- `scripts/loom.ts` 增 `task` 子命令路由(`cmdTask` → start/land/abandon/list/reconcile/repair)。

## Data Models

**Registry schema 无需变更**:`SessionSchema.worktree?: string` 已存在(前序预留)。本期补充(全部进 `session.metadata`,保持 schema `version: 1`):

- `session.worktree` 存 worktree path,`session.metadata.branch` 存分支名。
- **`session.metadata.provisionId`**(评审采纳):每次 provisioning 生成的**不可变绑定标识**(UUID/hash),绑定 `taskId → branch → worktreePath → session`。**所有 worktree 归属判定(land/abandon/reconcile 的不越界)依据此已记录绑定,绝不依据脏文件 path 推断**——path 会移动、分支会 rebase,绑定记录才是稳定身份(R1.6)。
- **`session.metadata.events[]`**(评审采纳,轻量审计轨迹):追加式 `{ ts, kind }`,`kind ∈ worktree_created|branch_created|landed|abandoned|reconciled|repaired`。**有界**——只保留最近 N 条(默认 50,超出丢最旧),防无界增长/调试噪声/内存开销。仅作审计/调试投影;**Registry 仍是 state-store,不改为 event-sourcing**(整库事件溯源会冲击已交付 MVP schema,留待 v2)。
- 可选仓库级配置 `.loom/config.yaml`:`provisioning.worktreeRoot`(默认 `<repoRoot>/..`)、`provisioning.branchTemplate`(默认 `{owner}/{task}`)、`provisioning.defaultBase`(默认仓库默认分支)、`provisioning.defaultLandMode`(`merge`|`pr`,默认 `pr`)。配置缺失时用内置默认。

> 选择把 branch/provisionId/events 塞进 `session.metadata` 而非加 schema 字段,是为本期保持 schema `version: 1` 不变、零迁移成本;若后续 Provisioning 稳定,再以 upgrader 升 `version: 2` 提升为一等字段(D4)。

### 规范状态模型与对账(Canonical State & Reconciliation,评审采纳)

**真相源唯一**:Registry 是**规范真相源**;git 分支存在性、worktree 文件系统是**投影**。任何"状态"= Registry 记录与 git 投影的对账结果,而非独立来源(消除"Registry 说 active 但 worktree 缺失"无法判定的问题)。

`loom task reconcile` 对每个 provisioning 绑定(按 `provisionId`)对账,产出**健康发现(非持久化 TaskState)**:

**分级 mode(评审采纳,杜绝 reconcile 沦为隐式 mutation 引擎):`report`(默认,只读) → `dry`(打印将执行的修复,不执行) → `apply`(显式才变更)**。`repair --task <id>` ≡ 单任务 `reconcile --mode apply`;任何 apply 变更先列改动项 + 要求确认(非交互需 `--yes`),会丢工作的走 R3 规则。

| 发现                 | 含义                             | repair 选项                                   |
| -------------------- | -------------------------------- | --------------------------------------------- |
| `OK`                 | Registry 记录与 git 投影一致     | —                                             |
| `ORPHANED`           | Registry 有记录、worktree 缺失   | 重建 worktree(从分支) 或 迁移任务到 abandoned |
| `MISSING_BRANCH`     | 分支被外部删除                   | 从 worktree 重建分支 或 标记需人工            |
| `UNTRACKED_WORKTREE` | worktree 在、Registry 无绑定记录 | 重新登记(claim)为一个 session                 |
| `STALE`              | 分支已远端合并/删除、本地仍在    | 提示回收(走 abandon/land 收尾)                |

- `ORPHANED` 等**是对账派生发现**(类比前序 `session.status=dead`),**不**新增持久化 `TaskState`,因此**不改前序 `lifecycle.ts` / registry schema**(R8.3)。
- 任何会丢失工作的 repair 走 R3 破坏性确认规则。reconcile/repair 记入 `events[]`。

## Components and Interfaces

所有子命令:支持 `--json`、`--dry-run`(打印将执行的 git 操作不实际执行,R5.5);破坏性操作默认拒绝 + 显式确认(R5.3)。

### `loom task start --task <id> --owner <o> [--from <ref>] [--identity <name:email>]`

1. 解析配置 → 计算 `branch = render(branchTemplate, {owner, task})`、`worktreePath = join(worktreeRoot, "<repo>-<task>")`。
2. **安全前置**:若 branch 已存在 或 worktreePath 已存在 → 拒绝并报可定位错误(R1.3),不覆盖。
3. `git worktree add <worktreePath> -b <branch> <from|defaultBase>`;可选 `git -C <worktreePath> config user.name/email`(R1.4)。
4. Registry:确保任务存在(否则以最小信息 `register`),为其追加/更新一个 Session,写 `worktree=worktreePath`、`metadata.branch=branch`;经 `lifecycle.transitionTask` 把 state `claimed→active`(若已 active 则幂等),刷新 `lastSignalAt`。
5. 输出新建 worktree 的 path/branch;**不**切换调用者当前目录/分支(R1.5)——提示用户 `cd` 进入。

### `loom task land --task <id> [--mode merge|pr] [--keep-branch]`

落地是**两阶段**(评审采纳,保证 git + Registry 原子性),返回标准化 `LandResult`:

```
LandResult = SUCCESS | CONFLICTED | NON_FAST_FORWARD | DIRTY_WORKTREE | POLICY_BLOCKED
可重试:  CONFLICTED / NON_FAST_FORWARD / DIRTY_WORKTREE  (修复后重跑)
不可经 git 重试:  POLICY_BLOCKED  (须先改代码/归属)
终态:  SUCCESS
```

**Phase 1 — `prepare`(全部可逆,失败即止,不进入 finalize):**

0. 取 `landLock(taskId)`(评审采纳):同一任务并发/重复 land 串行化,锁被占用 → 拒绝并提示已有进行中的 land;锁在完成/失败/进程退出释放(陈旧锁安全清理),防 retry 引发重复 PR/重复 merge。
1. 按 `provisionId` 定位绑定的 worktree(不靠 path 推断);**dirty guard**:有未提交变更 → 返回 `DIRTY_WORKTREE`(可重试),绝不丢工作。
2. **落地门禁(复用)**:在该 worktree 上跑归属 + 审计校验(`loom check` / audit `--fail-on-*`),不过 → 返回 `POLICY_BLOCKED`(不可经 git 重试)。
3. `git fetch` + rebase 预演到 defaultBase:冲突 → `CONFLICTED`;非快进 → `NON_FAST_FORWARD`(均可重试)。

**Phase 2 — `finalize`(不可逆,仅当 prepare 全绿):**

4. `transitionTask(active→ready)`;落地:
   - `--mode merge`:rebase 后 ff-only merge 进 defaultBase(本地)。**绝不**直接 push `main`(R2.5)。
   - `--mode pr`:`git push -u origin <branch>` → `gh pr create`,交 GitHub 受保护分支/Merge Queue(R2.5、目标架构 M3)。
5. **原子性**:Registry 的 `ready→landed` 写入在不可逆 git 集成**成功之后**执行;IF finalize 中途失败 THEN 回滚到 finalize 前状态,不留下"Registry landed 但未集成"的不一致(R9.4)。成功后 GC worktree(`remove`+`prune`),分支留删由 `--keep-branch` 控制,记 `events: landed`,返回 `SUCCESS`。

### `loom task abandon --task <id> [--force] [--delete-branch]`

1. 定位 worktree;**dirty/unpushed guard**:有未提交或未推送变更 → 默认拒绝(R3.2);仅 `--force` + 二次确认才继续,且**先打印将丢失内容摘要**。
2. `git worktree remove`(`--force` 时强制)+ `git worktree prune`;state `→abandoned`。
3. 分支默认**保留**(仅删工作目录);`--delete-branch` 才删,且用安全方式(非 `-D` 强制;若策略阻止则 `git update-ref -d` 删本地 ref,可恢复,对齐 AGENTS Git Notes)(R3.3)。
4. 越界保护:目标 worktree 的 owner/task 与调用者不符 → 拒绝(R3.4、R5.3)。

### `loom task list [--json]`

- 交叉 `git worktree list --porcelain` 与 Registry,列出每个 provisioning 任务:task/owner/branch/worktree path/state/dirty?/ahead-behind/`session.status`(含 dead)。
- **stale 检测**:分支在远端已合并/删除但本地仍在 → 标 `stale`(可回收)(R4.3)。
- `loom status` 扩展:在既有展示补 worktree path + branch(R4.2)。

### `loom task reconcile [--task <id>] [--mode dry|report|apply] [--json]` / `repair --task <id>`

- `reconcile`:按 `provisionId` 对账 Registry 记录与 git/worktree 实况,产出健康发现 `OK|ORPHANED|MISSING_BRANCH|UNTRACKED_WORKTREE|STALE`(见 Data Models 表)。**默认 `--mode report`(只读);`dry` 打印将执行的修复但不执行;只有显式 `--mode apply` 才变更**——reconcile 绝不静默修改 system view。`--json` 可入 CI 巡检(CI 只跑 report)。
- `repair`(≡ 单任务 `reconcile --mode apply`):确定性修复(重建缺失 worktree / 重新登记 untracked / 把无可恢复工作的 orphan 迁移到 `abandoned`)。先列将改动项 + 要求确认(非交互需 `--yes`);会丢失工作的走 R3 确认规则;每次 reconcile(apply)/repair 追加(有界)`events[]`。
- 这是评审要求的 **Recovery Plane**:让"外部删 worktree / 远端删分支 / Registry 漂移 / 半完成 land"可被确定性发现与修复(R8.2、R8.4),且变更路径**显式、可审、默认关闭**。

## 安全设计(贯穿)

| 风险                    | 防线                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| 误删未提交/未推送工作   | dirty guard + unpushed guard;默认拒绝;`--force` 需二次确认 + 丢失摘要(R1/R2/R3)                    |
| 越界他人工作区          | 操作前校验目标 worktree 的 owner/task == 调用者;不匹配即拒绝(R2/R3.4)                              |
| 直接污染 main           | land 绝不 push main;仅经分支 + PR/Merge Queue(R2.5)                                                |
| agent 擅自 provisioning | `loom task` 为人发起的显式命令;文档与 `--dry-run` 支持人审阅授权(R3 原则、AGENTS)                  |
| 命令注入                | `git.ts` 一律 `execFile("git", [args])` 数组传参,绝不 shell 字符串插值;路径/分支名做模板白名单校验 |
| 破坏 MVP/共享树用户     | 纯增量、opt-in;未用 `loom task` 时零行为变化(R5.1)                                                 |

## Fabric 对齐(signal-only,编译期)

- 新增的 worktree/branch/identity 元数据经既有 `src/fabric/mappers.ts` 的 `LoomAttribution` 形状作为**编译期信号**进入 Policy Runtime **Stage 2**(Governance Signals);`attributionTraceEntry` 的 `effect:"neutral"` 不变——Provisioning 元数据**永不**成为 ALLOW/DENY/MODIFY 的决定因素(R6.1、R6.2)。
- 不新增 runtime 调用;不在 `src/fabric/**` 落任何 Provisioning 代码(本期全部在 `scripts/loom/**`)(R6.2)。

## 零回归与 feature-gating

- Provisioning 代码路径仅由新 `loom task` 子命令进入;既有 `loom`/`worktree-audit`/`agent-attribution`/`pre-commit`/`committer` 调用契约**完全不变**(R5.1、R5.2)。
- 不放宽任何既有拒绝集合;land 门禁是既有门禁的**复用调用**,不是替代(R5.2)。
- schema 保持 `version: 1`(branch/identity 入 `metadata`),既有 Registry 文件无需迁移。

## Correctness Properties

### Property 1: 数据不丢失

任一命令在删除 worktree/分支前,IF 存在未提交或未推送变更 THEN 默认不执行删除;`--force` 路径必先打印丢失摘要。形式化:`destroy(wt) ⇒ clean(wt) ∨ (force ∧ confirmed ∧ summaryShown)`。

**Validates: Requirements 2.3, 3.1, 3.2, 5.3**

### Property 2: 不越界

任一 `land`/`abandon` 仅作用于 `owner(targetWorktree) == caller.owner ∧ task(targetWorktree) == args.task` 的 worktree;否则拒绝。

**Validates: Requirements 3.4, 5.3**

### Property 3: main 不被直接写

`land` 的任何路径都不产生 `push origin <defaultBranch>`;集成只经分支 + PR/Merge Queue 或本地 merge 进默认分支(无远端推送)。

**Validates: Requirements 2.5**

### Property 4: 状态机一致

所有 state 迁移经 `lifecycle.transitionTask`,非法迁移抛错;Provisioning 副作用与 state 同事务语义(先校验/可逆动作,后写 Registry)。

**Validates: Requirements 1.2, 2.4, 3.1**

### Property 5: 零回归

未调用 `loom task` 时,`loom check` 结论、pre-commit 拦截、`worktree-audit`/`agent-attribution` 输出与本期前**逐字节一致**。

**Validates: Requirements 5.1, 5.2**

### Property 6: Fabric signal-only

Provisioning 元数据进入 Policy Runtime 的路径上,`loom.attribution` 的 `effect` 恒为 `neutral`(永不决定 ALLOW/DENY/MODIFY)。

**Validates: Requirements 6.1, 6.2**

### Property 7: 稳定身份绑定

worktree 归属判定(land/abandon/reconcile 的不越界)恒依据已记录的 `provisionId` 绑定(`taskId→branch→worktreePath→session`),从不依据脏文件 path 推断;path 移动/分支 rebase 不改变归属结论。

**Validates: Requirements 1.6, 3.4**

### Property 8: Land 原子性

`land` 经 prepare(可逆)/finalize(不可逆)两阶段:prepare 任一失败则不产生不可逆副作用;Registry 的 `landed` 写入在不可逆集成成功之后或失败回滚,系统永不停在"Registry landed 但未集成"的不一致态。

**Validates: Requirements 9.3, 9.4**

### Property 9: 可对账可恢复

Registry 为规范真相源、git/worktree 为投影;任一漂移(orphan / missing-branch / untracked / stale)可被 `reconcile` 确定性检出,并由 `repair` 在遵守数据安全规则下修复。

**Validates: Requirements 8.1, 8.2, 8.4**

### Property 10: 默认无副作用 + 串行落地 + 有界轨迹

`reconcile` 默认 `report`(只读),变更仅经显式 `--mode apply`/`repair` 并需确认;同一 `taskId` 的 land 经 `landLock` 串行,杜绝重复 PR/merge;`events[]` 有界(最近 N=50),不无界增长。

**Validates: Requirements 8.2, 8.5, 9.6**

## Error Handling

- **可定位错误**:branch/worktree 已存在、目标任务不存在、非法状态迁移 → 抛出含「字段/任务 id/路径」的明确错误,非零退出。
- **git 失败传播**:`git.ts` 捕获 `execFile` 非零退出,封装为携带 stderr 摘要的 `GitError`,不吞错;`provision.ts` 在副作用中途失败时,SHALL 不留下半截状态(Registry 写入放在不可逆 git 动作**之后**,或失败时回滚已建 worktree)。
- **dirty/unpushed 拒绝**:返回专用退出码 + 人类可读提示(先 commit / push 或 `--force`)。
- **越界拒绝**:明确指出目标 worktree 归属与调用者不符,拒绝执行。
- **`--dry-run`**:任何错误前置校验仍执行(便于预检),但不产生副作用;输出将执行的 git 命令序列。

## Testing Strategy

- `git.ts`:对 `execFile` 注入可 stub 的 runner,单测命令构造(数组参数、模板渲染、注入防护)与解析(`worktree list --porcelain`、dirty/ahead-behind)。
- `provision.ts`:决策纯函数(前置校验、状态迁移选择、GC 安全判定)以纯输入单测;副作用层用 fake git runner 做集成测。
- **真实 git 集成测**(`*.e2e.test.ts`,可 gated):在临时仓库里 `start → 提交 → land(merge) → 验证 worktree GC + state=landed`;以及 `start → 脏 → abandon 拒绝 → --force 回收`。
- **仓库无关测**:最小仓库(无 OpenBot 路径)跑 start/land/abandon/list(R7.2)。
- **零回归**:断言未调用 `loom task` 时 `loom check` 仍 0 diffs、pre-commit 行为不变。

## Open Decisions

- **D1 默认落地模式**:倾向 `pr`(对齐 M3 受保护分支/Merge Queue);`merge` 仅为无远端/本地实验场景。配置可改。
- **D2 worktree 根目录**:默认 `<repoRoot>/..`(与 AGENTS `git worktree add ../openbot-<task>` 惯例一致);可配置。
- **D3 per-worktree identity**:本期可选(默认沿用全局 git identity,分支名已是身份);若团队需 PR 级区分再启用。
- **D4 schema 升级时机**:branch/identity 暂存 `metadata`;Provisioning 稳定后再升 `version: 2` 提为一等字段(走既有 upgrader 链)。
