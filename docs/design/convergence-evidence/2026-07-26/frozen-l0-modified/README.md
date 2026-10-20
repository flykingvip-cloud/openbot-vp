# Frozen evidence: 主树 L0 已跟踪修改（2026-07-26）

**处置：** `freeze-evidence`（`convergence-base-decision-2026-07-20.md` § Dirty-file policy）
**来源：** 共享主树 `openbot`，分支 `deploy/user-modeling-v92`
**任务：** `local-worktree-consolidation`
**方案：** `docs/design/local-worktree-consolidation-plan-2026-07-26.md` § Phase 1 批 2

## 判定方法（内容级，不是路径级）

批 1 用的是「路径是否在某个 ref 存在」，会漏判「路径在别的分支有、但内容不同」的文件。
批 2 改为内容级判定：

1. 遍历 293 个 ref（本地分支 + `origin` 分支 + tag），用 `git ls-tree -r` 建立
   `path → blob` 索引（76,707 条唯一组合）。
2. 对每个脏条目算 `git hash-object`，在索引里查 `path + blob` 是否命中。
3. 命中 = 内容已在 git 中留存 → **丢弃安全**；未命中 = **工作区唯一** → 必须保全。

结果：

| 分类                | 条目数 | 处置                                            |
| ------------------- | -----: | ----------------------------------------------- |
| 内容已在某 ref 留存 |     45 | 丢弃安全，不提交、不回滚，仅记账                |
| 工作区唯一          |     78 | 保全（提交 或 冻结）                            |
| 本地删除项          |      2 | 记账（被删文件本体在 ref 中，删除意图仅在本地） |

这一步比批 1 多捞出 3 个真实风险项：`operational-metrics-store.test.ts`、
`capsule-governance.ts`、`connector-credential-vault-key.test.ts` —— 路径在
`codex-delivery-guard` 上有，但内容不同，批 1 的路径级判定会误判为安全。

## 78 个唯一项的实际处置

| 处置                              | 条目数 | 说明                                    |
| --------------------------------- | -----: | --------------------------------------- |
| 已提交（新增文件 / 原子资源替换） |     10 | 见下方提交表                            |
| 冻结为补丁（已跟踪修改）          |     64 | 本目录 16 个 `.patch`                   |
| 已在批 1 冻结（`learning-*`）     |      4 | `../frozen-learning-recall-tests.patch` |

### 已提交

| 提交         | stream | 文件数 | 内容                                                                                    |
| ------------ | ------ | -----: | --------------------------------------------------------------------------------------- |
| `d32e6e477b` | F      |      4 | delivery-guard / enterprise-model-governance 的 spec 草稿（与 DG 分支同名文件内容不同） |
| `5402703717` | C      |      1 | `collaboration-learning/capsule-governance.ts`                                          |
| `b29e37a2c3` | EDGSC  |      1 | `enterprise-data/connector-credential-vault-key.test.ts`                                |
| `175f4c05ad` | AGS    |      1 | `agent-growth/operational-metrics-store.test.ts`                                        |
| `0025fa27c8` | EUI    |      3 | `ui/public/cosmic-bg.png`、`openbot-logo.png`、`favicon.svg`                            |

### 为什么已跟踪修改选择冻结而不是提交

1. **不抢别人的活。** 这 64 个文件是其他 agent 正在进行中的 WIP。提交会把半成品落进分支历史，
   并让这些文件从 owner 的 `git status` 里消失（`AGENTS.md` § Multi-Agent 明确禁止代提交
   仍带他人未提交 WIP 的共享文件）。
2. **热文件只能由 hotfile owner 接线提交。** 本批含
   `.loom/registry.yaml`、`scripts/worktree-audit.ts`、`CHANGELOG.md`、
   `src/gateway/method-scopes.ts`、`server-methods-list.ts`、`protocol/index.ts`、
   `protocol-schemas.ts`、`ui/src/i18n/lib/*`、`ui/src/ui/app.ts` ——
   `convergence-base-decision-2026-07-20.md` 规定热文件只走收敛 owner 的接线提交。
3. **冻结对保全的效果等价。** 补丁进 git 并已推远端，内容同样不可丢；差别只是重放时要
   `git apply` 而非 `cherry-pick`。而这些 diff 基于 `deploy/user-modeling-v92`，
   本来也无法直接 cherry-pick 到 SoT，重放必须人工对账。

每个补丁均已用 `git apply --check --reverse` 校验过与工作树逐字一致。

## 冻结清单

| stream  | 补丁          | 文件数 | stream 含义                                              |
| ------- | ------------- | -----: | -------------------------------------------------------- |
| `A`     | `A.patch`     |     14 | Workbench And Employee UI Recovery                       |
| `AGT`   | `AGT.patch`   |      1 | Agent Tooling And CLI Runner                             |
| `AOR`   | `AOR.patch`   |      1 | AOR Agent Orchestration Runtime                          |
| `ASI`   | `ASI.patch`   |      2 | Asset Incubation Domain (Phases 0-4)                     |
| `B`     | `B.patch`     |      8 | Control-UI And Platform Auth Recovery                    |
| `C`     | `C.patch`     |      7 | Collaboration, Daibai, And Support-Case Runtime          |
| `D`     | `D.patch`     |      3 | Pure Guardrails                                          |
| `EDGSC` | `EDGSC.patch` |      2 | Enterprise Data Governance And Knowledge Universe M6     |
| `F`     | `F.patch`     |      2 | Analysis, Specs, And Architecture Notes                  |
| `GWSV`  | `GWSV.patch`  |      2 | Gateway Supervisor And Protocol Extensions               |
| `H1K`   | `H1K.patch`   |      1 | OpenBot Enterprise Usage Backend Surface                 |
| `ME`    | `ME.patch`    |      2 | Model Entitlement Chain (P1-P5 + gateway connect compat) |
| `OPSD`  | `OPSD.patch`  |      9 | Ops Port Decommission And Platform Absorption            |
| `PM`    | `PM.patch`    |      3 | Platform Models Management And AOR Two-Mode Integration  |
| `SUG`   | `SUG.patch`   |      5 | Steward User Guidance Protocol Skill                     |
| `USRM`  | `USRM.patch`  |      2 | Cross-Session User Modeling                              |

### A — Workbench And Employee UI Recovery

- `ui/index.html`
- `ui/src/i18n/lib/registry.ts`
- `ui/src/i18n/lib/translate.ts`
- `ui/src/styles/auth-home.css`
- `ui/src/styles/trial-apply.css`
- `ui/src/ui/brand-assets.ts`
- `ui/src/ui/capability/ai-workforce-governance/services/governanceApi.ts`
- `ui/src/ui/controllers/chat.ts`
- `ui/src/ui/controllers/knowledge-universe-workspace.ts`
- `ui/src/ui/ports/employee/views/home-page-contracts.ts`
- `ui/src/ui/views/auth-home.browser.test.ts`
- `ui/src/ui/views/auth-home.ts`
- `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`
- `ui/src/ui/views/knowledge-universe-space-import.ts`

### AGT — Agent Tooling And CLI Runner

- `src/commands/status-all/format.ts`

### AOR — AOR Agent Orchestration Runtime

- `ui/src/styles.css`

### ASI — Asset Incubation Domain (Phases 0-4)

- `ui/src/ui/app-gateway.ts`
- `ui/src/ui/app.ts`

### B — Control-UI And Platform Auth Recovery

- `src/gateway/control-ui.http.test.ts`
- `src/gateway/control-ui.ts`
- `src/gateway/enterprise-seat-assets.ts`
- `src/gateway/platform-auth.test.ts`
- `src/gateway/platform-auth.ts`
- `src/gateway/platform-auth/auth-helpers.ts`
- `src/gateway/platform-auth/http-handler.ts`
- `src/gateway/platform-auth/routes-employee.ts`

### C — Collaboration, Daibai, And Support-Case Runtime

- `src/auto-reply/reply/collaboration-learning-backflow.test.ts`
- `src/auto-reply/reply/collaboration-learning-store.ts`
- `src/gateway/collaboration-learning/state-machine.ts`
- `src/gateway/protocol/schema/collaboration.ts`
- `src/gateway/server-methods/collaboration-learning.ts`
- `ui/src/ui/controllers/daibai.test.ts`
- `ui/src/ui/controllers/daibai.ts`

### D — Pure Guardrails

- `deploy/admin-subdomain/README.md`
- `deploy/admin-subdomain/admin.openbot.love.conf`
- `deploy/production/RELEASE_RECORD.md`

### EDGSC — Enterprise Data Governance And Knowledge Universe M6

- `src/gateway/enterprise-data/connector-credential-vault.ts`
- `src/gateway/server-methods/chat.ts`

### F — Analysis, Specs, And Architecture Notes

- `.kiro/specs/development-supervisor/tasks.md`
- `.kiro/specs/platform-pricing-gateway-instability/tasks.md`

### GWSV — Gateway Supervisor And Protocol Extensions

- `src/gateway/server-methods/agent-growth.ts`
- `src/gateway/server-methods/chat.mentions.test.ts`

### H1K — OpenBot Enterprise Usage Backend Surface

- `src/gateway/enterprise-seat-assets-store.ts`

### ME — Model Entitlement Chain (P1-P5 + gateway connect compat)

- `src/auto-reply/reply/agent-runner-execution.ts`
- `src/gateway/platform-auth/session-domain.ts`

### OPSD — Ops Port Decommission And Platform Absorption

- `ui/src/ui/app-render.ts`
- `ui/src/ui/app-settings.ts`
- `ui/src/ui/ports/employee/views/workbench-chrome.node.test.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts`
- `ui/src/ui/ports/enterprise/semantic/organization-seat-deletion.node.test.ts`
- `ui/src/ui/ports/enterprise/semantic/organization-seat-deletion.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-org-position-detail.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-workforce-governance-surface.ts`
- `ui/src/ui/ports/platform/advanced/page.ts`

### PM — Platform Models Management And AOR Two-Mode Integration

- `src/gateway/protocol/index.ts`
- `src/gateway/protocol/schema/protocol-schemas.ts`
- `ui/src/ui/app-view-state-shell-slices.ts`

### SUG — Steward User Guidance Protocol Skill

- `.loom/registry.yaml`
- `CHANGELOG.md`
- `scripts/worktree-audit.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/server-methods-list.ts`

### USRM — Cross-Session User Modeling

- `src/auto-reply/reply/get-reply-run.ts`
- `src/gateway/server-methods.ts`

## 本地删除项（仅记账，未保全）

| 文件                                                                   | 说明                                  |
| ---------------------------------------------------------------------- | ------------------------------------- |
| `ui/src/ui/controllers/knowledge-universe-passive-connector.ts`        | 本体在多个 ref 中；本地删除意图未提交 |
| `ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts` | 同上                                  |

删除意图属于重构决策，需由 stream A / OPSD 的 owner 确认后随重构一并落地，不在本次保全范围。

## 丢弃安全清单（45 项，不提交也不回滚）

这些条目的工作树内容已逐字存在于某个 ref，因此不构成丢失风险。**本次不做任何回滚**
（回滚会破坏其他 agent 的在途工作），仅记账；实际清理留到 Phase 3 主树切换前由 owner 处理。

主要簇：

- `src/gateway/enterprise-model/**`（12）、`server-methods/enterprise-model-*`（3）
  → 已在 `codex-delivery-guard/delivery-alignment-guard`
- `src/gateway/agent-growth/**` 的 genome / growth-events / working-style 等（10）
  → 已在 `codex-delivery-guard` 或 `cursor-main-recovery/main-recovery-routing`
- `src/auto-reply/reply/learning-recall{,-context}.ts`、`learning-skill-curation.ts`、
  `experience-capsule-backflow.ts`（4）→ 已在 `cursor-main-recovery/main-recovery-routing`
- `ui/src/ui/ports/platform/shared/subscription-contract-reminder*`（2）
  → 已在 `kiro/v116-salvage-subscription-contract-reminder`
- 其余为 spec `requirements.md`、`packages/collaboration-*` 契约、`operational-score.ts` 等

复核命令：

```bash
G=/usr/bin/git
f=src/gateway/enterprise-model/store.test.ts
h=$($G hash-object -- "$f")
for r in $($G for-each-ref --format='%(refname)' refs/heads refs/remotes/origin); do
  [ "$($G rev-parse "$r:$f" 2>/dev/null)" = "$h" ] && echo "content preserved in $r" && break
done
```

## 解冻步骤（重放到主干时）

```bash
# 单个 stream 重放（示例：Control-UI / platform auth）
git apply docs/design/convergence-evidence/2026-07-26/frozen-l0-modified/B.patch
# 补丁基于 deploy/user-modeling-v92，直接 apply 到 SoT 通常会冲突，改用三方合并：
git apply -3 docs/design/convergence-evidence/2026-07-26/frozen-l0-modified/B.patch
# 冲突逐处对账后，按 stream 单独提交并登记 provenance
```

**顺序建议：** 与方案 §5 Phase 2 一致，热文件（`SUG`、`PM`、`D`）留到最后，
由 hotfile owner 接线；`A` / `OPSD` 体量最大（14 / 9 文件，含 2515 行 diff），
需要单独排期。
