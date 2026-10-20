# Tasks — repository-wide-branch-convergence

> 上位：`docs/design/repository-wide-branch-convergence-plan-2026-07-20.md`（治理宪法）  
> 执行：`docs/design/repository-convergence-execution-plan-2026-07-20.md`（务实执行序列）  
> **状态（2026-07-20）：** `BASE LOCKED` — 代理维护者已锁定 production SHA 为 convergence start；worktree 已授权创建。**仍禁止** 共享树 merge 与未门禁的 production RC cutover。

## Overview

全仓库分支/PR/tag 收敛与功能完整性治理。代码 landing **仅** 在 `convergence/2026-07-20` worktree（根 SHA 见 signed base decision）。

## Agents

- grok-evolution-closure · role: owner · scope: repository convergence execution plan, evidence, base decision (proxy maintainer), convergence lander coordination · paths: `.kiro/specs/repository-wide-branch-convergence/**`, `docs/design/repository-wide-branch-convergence-plan-2026-07-20.md`, `docs/design/repository-convergence-execution-plan-2026-07-20.md`, `docs/design/convergence-evidence/**`, `docs/design/convergence-base-decision-*.md` · since: 2026-07-20
- cursor-convergence-day0 · role: contributor · scope: Day0 evidence pack · paths: `docs/design/convergence-evidence/**` · since: 2026-07-20
- cursor-convergence-phase-c · role: contributor · scope: Phase C baseline on locked SHA (install/build/tsgo reports; no feature land) · paths: `docs/design/convergence-evidence/**/phase-c/**` · since: 2026-07-20

## Role roster (proxy-signed 2026-07-20)

| Role                       | Person / handle                          | Status                                                 |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Human maintainer (proxy)   | `grok-evolution-closure`                 | **signed** — delegated by owner                        |
| Convergence owner / lander | `grok-evolution-closure`                 | **signed**                                             |
| Day0 evidence contributor  | `cursor-convergence-day0`                | complete                                               |
| Release owner (proxy)      | `grok-evolution-closure`                 | **signed** (staging/base; prod cutover second confirm) |
| Hotfile owner              | `grok-evolution-closure`                 | **signed**                                             |
| Security reviewer (proxy)  | `grok-evolution-closure` + `SECURITY.md` | **signed** (process)                                   |

Binding: `docs/design/convergence-base-decision-2026-07-20.md`

## Locked base

- **SHA:** `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`
- **Branch:** `convergence/2026-07-20`
- **Worktree:** `/Users/daniel/AI项目/openbot-convergence`

## Checklist

### Day 0

- [x] 执行计划 + 复审修订 + Loom/spec 登记
- [x] Day0 证据包（cursor）验收 PASS
- [x] 角色名单代理确认
- [x] Canonical Base 决策单签署（proxy）
- [x] wecom readyz waiver（dated）
- [x] freeze-evidence 政策接受

### Phase C+

- [x] 创建 `convergence/2026-07-20` worktree @ locked SHA
- [x] Cursor Phase C brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-C-BRIEF.md`
- [x] 基线 `pnpm install` / `pnpm build` / `pnpm tsgo` 记录（cursor-convergence-phase-c）— reports on convergence branch `phase-c/`；install 绿；build/tsgo 红基线已冻结（`0bf0c53dd0`+）
- [x] Cursor Phase D0 build brief：`CURSOR-PHASE-D0-BUILD-BRIEF.md`
- [x] D0 构建收口 PASS — Path A `pnpm build` 绿；tsgo 86→77（`cursor-convergence-phase-d0`，convergence 分支）
- [x] Cursor Phase D1 brief：`CURSOR-PHASE-D1-AUTH-TENANT-BRIEF.md`
- [x] D1 身份/租户/权限薄包 PASS — forged-tenant 拒绝 + scopes；33 tests；build 绿；tsgo 77（convergence）
- [x] Cursor Phase D2 brief：`CURSOR-PHASE-D2-SESSION-BRIEF.md`
- [x] D2 session 同根/promote heal PASS — S1–S5；29 tests；build 绿；tsgo 77
- [x] Cursor Phase D3 brief：`CURSOR-PHASE-D3-SESSION-TRANSCRIPT-BRIEF.md`
- [x] D3 会话/transcript + checkpoint PASS — T1–T4+T6；72 tests；build 绿；tsgo 77
- [x] Cursor Phase D4 brief：`CURSOR-PHASE-D4-KNOWLEDGE-BRIEF.md`
- [x] D4 知识导入矩阵 K1–K6 PASS — localFolder 6/6；build 绿；tsgo 77
- [x] Cursor RC0-PREP brief：`CURSOR-PHASE-RC0-PREP-BRIEF.md`
- [x] RC0-PREP 返工 PASS — `rc0-prep/*` 12 文件；`RECOMMENDED_RC0_TIP=9aceda7349`；`STAGING_GO=GO_WITH_GATES`；`PRODUCTION_GO=NO`
- [x] Cursor Staging brief：`CURSOR-PHASE-STAGING-DEPLOY-BRIEF.md`
- [x] Staging 本地 sim PASS/PARTIAL @ `9aceda7349`（`cursor-convergence-staging`）
- [x] Cursor Staging-**host** brief：`CURSOR-PHASE-STAGING-HOST-BRIEF.md`
- [ ] 真 staging 主机全量 SUCCESS — `cursor-convergence-staging-host`（需维护者提供隔离主机）
- [x] 人类生产 cutover 清单：`docs/design/convergence-evidence/2026-07-20/HUMAN-PRODUCTION-CUTOVER-CHECKLIST.md`
- [ ] 生产 cutover — **仅维护者二次确认（默认 NO）**

## Hard constraints

1. 共享工作树不做批量 merge / rebase / cherry-pick / stash 清场。
2. Landing 只在 convergence worktree。
3. 安全/GHSA：先读 `SECURITY.md`；私密证据；ledger 脱敏。
4. Trailers：`Task: repository-wide-branch-convergence` / `Agent: <actor>`.
