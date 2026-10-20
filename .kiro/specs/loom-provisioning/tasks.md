# Implementation Plan — Loom Provisioning（隔离生命周期）

> 需求：`requirements.md` · 设计：`design.md`
> 前序地基（复用，不改其对外契约）：`.kiro/specs/loom-workspace-orchestrator/`
> 上位约束：`.kiro/specs/openbot-fabric/`（Loom = signal layer，编译期，禁 runtime lookup）

## Overview

本计划落地 `requirements.md` / `design.md` 定义的 **Phase 2（Provisioning）**：以 `git worktree` + 分支 `<owner>/<task>` 隔离每个任务窗口，消除共享脏工作树这一根因，并补齐 `start → land → abandon` 的隔离生命周期闭环。方法论是 **编排而非新引擎**：隔离复用 `git worktree`、合并复用 GitHub、归属/审计复用前序 `loom check`，Provisioning 只把它们按安全顺序串起来，全程 feature-gated 零回归。

## Agents

- kiro-loom · role: owner · scope: Loom Provisioning（worktree 隔离生命周期：git 封装 + 编排 + CLI task 子命令 + 测试） · paths: .kiro/specs/loom-provisioning/\*_, scripts/loom/git.ts, scripts/loom/provision.ts, scripts/loom/**tests**/git.test.ts, scripts/loom/**tests**/provision.test.ts, scripts/**tests**/loom/provision_.test.ts · since: 2026-06-16

## 约束与架构铁律

- TypeScript（ESM），以 `node --import tsx` 运行；校验/序列化复用前序依赖（`zod@^4` / `yaml@^2.8.2`）。
- **复用优先**：隔离=`git worktree`，合并=GitHub，归属/审计=前序 `loom check`；不自建并行系统。
- **feature-gated 零回归**：未调用 `loom task` 时，MVP 与共享树工作流逐字节不变；不放宽既有 pre-commit / CI 拒绝集合。
- **数据安全第一**：删 worktree/分支前默认拒绝有未提交/未推送变更；`--force` 需二次确认 + 丢失摘要。
- **不越界**：只操作调用者拥有的 task worktree；不碰他人 worktree/分支。
- **人授权 provisioning**：`loom task` 为人发起命令；提供 `--dry-run` 供审阅。
- **Architecture Rule #1**：分支身份/归属仅依据 path + owner/task（硬信号）；intent 不参与任何判定。
- **Fabric signal-only**：worktree 元数据仅作编译期 Stage 2 信号经 `LoomAttribution` 边界；不引入 runtime lookup；本期代码全部落在 `scripts/loom/**`，不碰 `src/fabric/**`。
- **共享热文件**：`scripts/loom.ts`（增 `task` 子路由）按 AGENTS 多 agent 规范 scoped commit，避让他人 WIP；`registry.ts` schema 保持 `version: 1`（branch/identity 入 `metadata`，不改 schema）。

## Tasks

---

- [x] 1. Wave 1：git 薄封装 `scripts/loom/git.ts`
  - [x] 1.1 实现可注入 runner 的 git 封装
    - 集中所有 `execFile("git", [args])`（数组传参，绝不 shell 字符串插值，防注入）；导出 `worktreeAdd` / `worktreeRemove` / `worktreeList`（解析 `--porcelain`）/ `worktreePrune` / `branchExists` / `createBranch` / `deleteBranchRef`（安全删 ref）/ `isDirty` / `aheadBehind` / `push` / `mergeFfOnly` / `prCreate`（经配置 CLI）。
    - 失败封装为携带 stderr 摘要的 `GitError`，不吞错；runner 可注入便于测试 stub。
    - _Requirements: 1.1, 5.4, 5.5_
  - [x] 1.2 `git.ts` 单测
    - `git.test.ts`：命令构造（参数数组、模板渲染、特殊字符防注入）、`worktree list --porcelain` 解析、dirty/ahead-behind 解析；全部用 fake runner，无真实 git。
    - _Requirements: 1.1, 5.4_

- [x] 2. Wave 1：编排核心 `scripts/loom/provision.ts`（决策纯函数）
  - [x] 2.1 实现配置解析与命名
    - 读可选 `.loom/config.yaml` 的 `provisioning.*`（worktreeRoot / branchTemplate / defaultBase / defaultLandMode），缺失用内置默认；`renderBranch(template,{owner,task})` 与 `worktreePathFor(task)` 为纯函数 + 白名单校验（拒绝路径穿越/非法分支名）。
    - _Requirements: 1.1, 7.1_
  - [x] 2.2 实现安全判定纯函数
    - `canDestroy(wt, {force})`（Property 1）、`ownsWorktree(binding, caller)`（按 `provisionId` 记录绑定判定，**不靠 path 推断**，Property 2/7）、`landTargetState(task)`（选择 active→ready→landed，复用 `lifecycle.canTransition`，Property 4）、`gcSafe(wtStatus)`。纯输入纯输出，便于穷举单测。
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.4, 1.6_
  - [x] 2.3 实现稳定绑定与有界审计轨迹
    - `newProvisionId()`（UUID/hash）；`bindProvision(session,{provisionId,branch,worktree})` 写 `session.metadata`；`appendEvent(session,kind)` 追加 `metadata.events[]`（`worktree_created|branch_created|landed|abandoned|reconciled|repaired`），**有界保留最近 N=50**（超出丢最旧）。纯函数，不改 registry schema（仍 `version:1`）。
    - _Requirements: 1.6, 8.5_

- [x] 3. Wave 1：`loom task start`（**Milestone M-Prov-1 起点**）
  - [x] 3.1 实现 start 编排 + CLI
    - `provision.ts` 的 `start()`：前置（branch/worktree 不存在校验）→ `worktreeAdd -b <branch>` → 可选 identity → `bindProvision`（写 `provisionId`/branch/worktree）→ `transitionTask(claimed→active)` + 刷新 `lastSignalAt` + `appendEvent(worktree_created/branch_created)`；`scripts/loom.ts` 增 `task` 子路由与 `start`，支持 `--from` / `--identity` / `--json` / `--dry-run`；不切换调用者目录/分支。
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Wave 2：`loom task land`（两阶段 + LandResult）
  - [x] 4.1 实现 prepare 阶段（可逆）
    - 取 `landLock(taskId)`（互斥，防重复 PR/merge；陈旧锁安全清理）→ 按 `provisionId` 定位绑定 worktree → dirty guard（→`DIRTY_WORKTREE`）→ 复用归属+审计门禁（`runCheck`/audit `--fail-on-*`，不过→`POLICY_BLOCKED`）→ fetch + rebase 预演（冲突→`CONFLICTED`，非快进→`NON_FAST_FORWARD`）。任一失败即返回结果、释放锁、**不进入 finalize**。
    - _Requirements: 2.1, 2.3, 9.1, 9.2, 9.3, 9.6_
  - [x] 4.2 实现 finalize 阶段（不可逆）+ CLI
    - 仅当 prepare 全绿：`transitionTask(→ready)` → `--mode merge`（ff-only 进 defaultBase，绝不 push main）或 `--mode pr`（push + `prCreate`）→ **集成成功后**写 `ready→landed`（失败回滚，保证 R9.4 原子性）→ GC worktree + `appendEvent(landed)` + **释放 `landLock`**，返回 `SUCCESS`；`--keep-branch` / `--json` / `--dry-run`。
    - _Requirements: 2.2, 2.4, 2.5, 9.3, 9.4, 9.6_

- [x] 5. Wave 2：`loom task abandon`
  - [x] 5.1 实现 abandon 编排 + CLI
    - 按 `provisionId` 定位（不越界，Property 7）→ dirty/unpushed guard（默认拒绝）→ `--force` 二次确认 + 丢失摘要 → `worktreeRemove` + `prune` + `transitionTask(→abandoned)` + `appendEvent(abandoned)`；分支默认保留，`--delete-branch` 才删（安全 ref 删除）；`--json` / `--dry-run`。
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 6. Wave 3：可见性与恢复面
  - [x] 6.1 实现 list 与 status 扩展
    - `task list`：交叉 `worktreeList` 与 Registry，列 task/owner/branch/path/state/dirty?/ahead-behind/session.status（含 dead），stale 检测（远端已合并/删除本地仍在）；`--json`。`loom status` 补 worktree path + branch。
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 6.2 实现 reconcile / repair（Recovery Plane）
    - `reconcile --mode dry|report|apply`（**默认 report 只读，绝不静默变更**；`dry` 打印待修复不执行；`apply` 才变更）：按 `provisionId` 对账 Registry 与 git/worktree，产出 `OK|ORPHANED|MISSING_BRANCH|UNTRACKED_WORKTREE|STALE`（`--json`，CI 只跑 report）。`repair`（≡ 单任务 `--mode apply`）：确定性修复（重建 worktree / 重新登记 untracked / orphan→abandoned），先列改动项 + 确认（非交互 `--yes`），丢失工作走 R3；记（有界）`appendEvent(reconciled/repaired)`。ORPHANED 等为派生健康发现，**不**新增持久化 TaskState、不改前序 lifecycle/schema。
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 7. Wave 4：测试与零回归证据（**Milestone M-Prov-1 验收**）
  - [x] 7.1 编排单测（fake git runner）
    - `provision.test.ts`：start/land/abandon/reconcile 的决策与状态迁移、安全闸（dirty/越界/`--force`）、`provisionId` 绑定归属（path 移动不改结论）、LandResult 分类与可重试性、两阶段原子性（finalize 失败回滚）、`reconcile` 默认 report 不变更、`landLock` 串行、`events[]` 有界（>50 丢最旧）、dry-run 无副作用；断言 Property 1–4、7–10。
    - _Requirements: 2.3, 3.1, 3.2, 3.4, 5.5, 9.3, 9.4, 9.6, 1.6, 8.2, 8.5_
  - [x] 7.2 真实 git 集成测（gated e2e）
    - `provision.e2e.test.ts`：临时仓库 `start → 改文件+提交 → land --mode merge → 断言 SUCCESS + worktree GC + state=landed`；`start → 脏 → land 返回 DIRTY_WORKTREE`；`start → 外部删 worktree → reconcile 报 ORPHANED → repair`；`start → 脏 → abandon 默认拒绝 → --force 回收`。
    - _Requirements: 1.1, 2.4, 3.2, 8.2, 9.1_
  - [x] 7.3 仓库无关 + 零回归
    - 最小仓库（无 OpenBot 路径）跑 start/land/abandon/list/reconcile（Property 验证 R7.2）；断言未调用 `loom task` 时 `loom check` 仍 0 diffs（Property 5）。
    - _Requirements: 5.1, 5.2, 7.2, 7.3_

## 里程碑

- **M-Prov-1（隔离闭环）= 任务 3 + 4 + 5 + 6.2 + 7**：`start/land/abandon/reconcile` 在临时真实仓库端到端通过、worktree 正确 GC、orphan 可对账修复、零回归证据全绿。M-Prov-1 未达成，不推进其余增强。
- 配置（`.loom/config.yaml provisioning.*`）随 2.1 落地；Fabric Stage 2 信号对接为后续（M4，跨 spec，需 kiro-fabric 协作），本期仅保证 worktree 元数据写入 Registry 且不触发 runtime lookup。

## 备注

- 本期是前序 spec 明确推迟的 Provisioning 阶段；前序 R10.5（状态机不触发 worktree 创建/销毁）在本期被显式接管，`lifecycle.ts` 不改，仅为其迁移附加 git 副作用。
- **规范状态模型（评审采纳）**：Registry = 唯一真相源，git/worktree = 投影；`ORPHANED` 等为 reconcile 派生健康发现，非持久化 TaskState（不改前序 schema）。
- **不做整库 event-sourcing（评审反驳）**：仅在 `session.metadata.events[]` 留轻量、有界（N=50）审计轨迹；整库事件溯源会冲击已交付 MVP schema，留待 v2。
- **运行安全（评审采纳）**：`reconcile` 默认 `report`（只读），变更仅经显式 `--mode apply`/`repair` + 确认；同一任务 `land` 经 `landLock` 串行防重复 PR/merge。
- 破坏性 git 操作（worktree remove / branch delete / `--force`）遵循 `AGENTS.md` 多 agent 安全：默认非破坏、可逆、需显式确认；CI/自动化中默认 `--dry-run`。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3"] }
  ]
}
```

## Notes

- M-Prov-1（隔离闭环）依赖 Wave 0–4 完成；Wave 5（测试）是其验收证据，不得为加速跳过。
- Fabric Stage 2 信号对接属跨 spec 的 M4，需 kiro-fabric 协作；本期仅保证 worktree 元数据写入 Registry 且无 runtime lookup。
- **状态：M-Prov-1 达成**。`scripts/loom/git.ts` + `scripts/loom/provision.ts` + `scripts/loom.ts`（`task` 子路由）落地；`scripts/__tests__/loom/provision.test.ts`（48 单测）+ `provision.e2e.test.ts`（7 真实 git e2e）全绿；全 Loom 套件 152 测试通过，M1 parity 仍 0 diffs。
- **运行 gated e2e**（默认被 `**/*.e2e.test.ts` 排除，不进 `pnpm test`）：
  `npx vitest run --config vitest.e2e.config.ts --dir scripts scripts/__tests__/loom/provision.e2e.test.ts`
  或临时把 `scripts/__tests__/**/*.e2e.test.ts` 加入 `vitest.e2e.config.ts` 的 include（该配置文件目前无 landing 处置，需维护者 disposition 后再持久化接入 `pnpm test:e2e`）。
