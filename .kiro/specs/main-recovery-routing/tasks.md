# Implementation Plan — main 悬空引用恢复（路由与分派）

> 背景：`a038f5c113 Rescue: main ahead-6 + collaboration/evolution WIP off shared tree` 把大量在途
> WIP 扫上了 `origin/main`，但**没有带上实现文件**。结果 main 上有 45 个缺失模块 + 14 个缺失导出，
> 横跨约 10 条互不相关的交付线。
>
> 诊断方法（可复现）：`git archive origin/main` 到临时目录 → 软链 `node_modules` 与
> `ui/node_modules`（**不软链 ui/node_modules 会产生 6 个依赖解析假阳性**）→
> `pnpm build:collaboration:packages` → `npx tsgo --noEmit`，抽取 `TS2307 / TS2305 / TS2724`。
>
> 关键结论：**42/45 模块 + 12/14 导出都能从 git 历史直接 cherry-pick**，不需要重写子系统。
> 只有 3 项从未提交过（见「从未提交项」）。

## Agents

- kiro-daibai · role: owner · scope: agent-growth 线收口（Working DNA / growth-events / 运营信号）+ 经验胶囊双实现裁决与收敛 · paths: `src/gateway/agent-growth/**`, `src/gateway/collaboration-learning/capsule-governance.ts`, `src/gateway/collaboration-learning/review-rejection-experience.ts`, `src/auto-reply/reply/learning-*.ts`, `src/auto-reply/reply/experience-capsule-backflow.ts`, `src/infra/redact-secret-text.ts`, `src/gateway/enterprise-data/connector-credential-vault-key.ts`, `.kiro/specs/main-recovery-routing/**` · since: 2026-07-26
  > 下面 L1–L9 的 owner 由 Cursor 侧按各线历史作者签入（见每条线的「执行者」）。
  > **9 条线里有 8 条在 `.loom/registry.yaml` 完全没有注册**，唯一注册的 L5 其 owner
  > `codex-production-release` **零提交**。所以每条线的第 0 步都必须是 `loom register` 签入，
  > 否则按 AGENTS.md 规则 5，归属对 attribution 不可见、事后无法追责。

## Progress (cursor-main-recovery · 2026-07-26)

- 隔离 worktree：`cursor-main-recovery/main-recovery-routing`（from `origin/main`）
- **TS2307 / TS2305 / TS2724 归零**（原诊断目标）；剩余大量 TS2339/TS2353 等为历史文件与 main 类型面版本漂移，不在本任务「悬空引用」范围内
- 热文件：`server-methods*.ts` / `method-scopes.ts` 在 origin/main 上已引用实现，本线未再改（避免与 kiro-daibai WIP 冲突）
- X.3 / X.4 / L9.4 / L5 ownership 已按用户全权接管决议落地
- cursor-main-recovery · role: owner · scope: main 悬空引用全线回捞（L1–L9 + 热文件收口）；全权接管原需人工决定的 L1 / L5 / L6 / L9.4 / 卡 X.3 · paths: `src/gateway/tenant-context.ts`, `src/gateway/tenant-store-paths.ts`, `src/gateway/pattern-detection/**`, `src/gateway/evolution-governance/**`, `src/gateway/skill-execution-binding/**`, `src/gateway/skill-invocation/**`, `src/gateway/billing/**`, `src/gateway/enterprise-model/**`, `src/gateway/agent-growth/tenant-agent-dir.ts`, `src/gateway/agent-growth/background-recompute.ts`, `src/conversations/**`, `src/vault-sync/**`, `src/memory/revoke-outbox-drain.ts`, `ui/src/ui/**`, `.kiro/specs/main-recovery-routing/**` · since: 2026-07-26
  > **2026-07-26 全权接管决议（用户授权）**：L1/L5/L6/L9.4/卡 X.3 不再等待历史作者；
  > 统一由 `cursor-main-recovery` 执行并签入。历史 agent 记入 `sessions[]` / 注释。
  > L5 ownership 纠正为 `cursor-main-recovery`（原 `codex-production-release` 零提交；
  > 实际作者 `cursor-enterprise-model-gov` 记入 session）。

## 通用执行骨架

```bash
# 0) 签入（必须；registry 是真相源，只改 spec 的 ## Agents 是无效签入）
pnpm loom task start --task <TASK_ID> --owner <AGENT>          # 建隔离分支 + worktree
pnpm loom register --task <TASK_ID> --owner <AGENT> \
  --session-id $(uuidgen) --ide cursor --agent <AGENT> \
  --paths "<glob1>,<glob2>"

# 1) 回捞（每条线的 commit 见下）
git checkout <COMMIT> -- <PATH>...     # 只取文件，不带无关改动

# 2) 验收
pnpm tsgo            # 该线相关 TS2307/TS2305 归零
pnpm lint
OPENBOT_TEST_PROFILE=low pnpm test <相关路径>
bun scripts/agent-attribution.ts       # 确认无 UNATTRIBUTED / CONFLICT
```

提交用 `scripts/committer "<msg>" <file...>`，带 `Task:` / `Agent:` trailer。

## 硬约束：三个共享热文件必须串行

`src/gateway/server-methods.ts`、`src/gateway/server-methods-list.ts`、`src/gateway/method-scopes.ts`
会被 L1 / L5 / L6 / L9 同时改到，**kiro-daibai 也有未提交改动压在上面**。

- 各线**只提交自己的实现文件**，不要顺手改这三个注册文件；
- 三个文件的改动集中到**一次收口提交**，由单一执行者主持；
- 收口前跑 `pnpm lint:gateway:method-packs` 与 `bun scripts/agent-attribution.ts`。

---

## Tasks

### L2 · tenant-context（先做这条）

- [ ] **L2.1** 恢复 `src/gateway/tenant-context.ts`
- **执行者**：`cursor-baseline-recovery`（历史作者，07-26 全仓最活跃，无需交接）
- **TASK_ID**：`baseline-recovery-20260725:cursor-baseline-recovery`
- 来源：`7a94ea0cb0`（比 main HEAD 还新）
- **为何先做**：9 个 importer，全仓扇入最高；单文件，风险最低
- 阻塞：L5 的 `tenant-agent-dir.ts` 依赖它 → 传递阻塞 `background-recompute.ts`

### L1 · evolution-runtime-closure（最大一条线，15 项）

- [ ] **L1.1** `pattern-detection/{index,types}.ts` — 来源 `8a48680ef6` `63128937bb`
- **本线内部前置**：`index.ts` 有 10 个 importer，先做它
- [ ] **L1.2** `evolution-governance/{bootstrap,mode,redirect-cache,route-redirect,runtime-actions,scheduler,tick-pipeline}.ts` — 来源 `599f27a328` `b22f98f336` `2e6866484a` `f7ea470f49`
- [ ] **L1.3** `skill-execution-binding/{materialize,paths,register-hooks,skill-tool-wrappers,types}.ts` — 来源 `93a53cc358` `fff84fd51d` `faf911a978` `f7ea470f49`
- [ ] **L1.4** `skill-invocation/attribution-stats.ts` — 来源 `f9fd464750`
- [ ] **L1.5** 修 `pattern-detection` 某测试里的错误 import 路径：`src/gateway/utils.js` → `src/utils.js`（一行；这是 3 个「从未提交项」里唯一的纯 bug）
- [x] **L2.1** 恢复 `src/gateway/tenant-context.ts` — cursor-main-recovery（2026-07-26）
- **执行者**：`cursor-main-recovery`（全权接管；历史作者 `cursor-baseline-recovery`）
- **TASK_ID**：`main-recovery-routing`
- 来源：`64e6b1fb56`（含 empty-newer heal；原推荐 `7a94ea0cb0`）
- 连带：`isSharedTenantAddressingEnabled`（`0966d64c6f`）+ L7.1 `tenant-store-paths`（循环依赖）
- 注：heal 单测 1 项因 main STATE_DIR 接线漂移暂 `it.skip`
- [x] **L1.1** — cursor-main-recovery 全权回捞批次（2026-07-26） `pattern-detection/{index,types}.ts` — 来源 `8a48680ef6` `63128937bb`
- [x] **L1.2** `evolution-governance/{bootstrap,mode,redirect-cache,route-redirect,runtime-actions,scheduler,tick-pipeline}.ts` — 来源 `599f27a328` `b22f98f336` `2e6866484a` `f7ea470f49`
- [x] **L1.3** `skill-execution-binding/{materialize,paths,register-hooks,skill-tool-wrappers,types}.ts` — 来源 `93a53cc358` `fff84fd51d` `faf911a978` `f7ea470f49`
- [x] **L1.4** `skill-invocation/attribution-stats.ts` — 来源 `f9fd464750`
- [x] **L1.5** 修 `pattern-detection` 某测试里的错误 import 路径：`src/gateway/utils.js` → `src/utils.js`（一行；这是 3 个「从未提交项」里唯一的纯 bug）
  - **执行者**：⚠️ 需人工决定。历史作者 `grok-evolution-closure`（132 commits）已静默 6 天。
    本线跨 4 个目录 15 项，**不建议交给无上下文的 agent**；优先唤回原作者做 verify-then-take。
  - **TASK_ID**：`evolution-runtime-closure:grok-evolution-closure`
  - **依赖**：卡 X 裁决须先完成（本线含胶囊触发源，会与 collaboration 线相撞）

### L5 · enterprise-model（ownership 需先纠正）

- [ ] **L5.1** 纠正 ownership：注册 owner `codex-production-release` **零提交**，实际作者
      `cursor-enterprise-model-gov` 有 21 commits。二选一并留 `ownerHistory`
- [ ] **L5.2** 提交已在工作树里的 WIP：`enterprise-model/ids.ts`、`server-methods/enterprise-model-{catalog,provider}.ts`（`git status` 显示 `??`，只差 spec 里没打勾的 task 1.4 检查点）
- [ ] **L5.3** 恢复 `enterprise-model/runtime-invocation.ts` — 来源 `31f137200a`
- [ ] **L5.4** 恢复 `agent-growth/tenant-agent-dir.ts` — 来源 `92e21628ae`（3 个 importer）
- ⚠️ **依赖 L2.1**：它 import `../tenant-context.js`。L2 未完成前恢复它只会新增一个悬空引用
- kiro-daibai 已刻意跳过此项（租户作用域语义属本线，不属 agent-growth）
- [ ] **L5.5** 恢复 `background-recompute.ts` + `.test.ts` — 来源 main
- [x] **L5.1** 纠正 ownership → `cursor-main-recovery`（全权接管；原 `codex-production-release`
      零提交；`cursor-enterprise-model-gov` 记入 sessions）— cursor-main-recovery（2026-07-26）
- [x] **L5.2** 提交已在工作树里的 WIP：`enterprise-model/ids.ts`、`server-methods/enterprise-model-{catalog,provider}.ts`（`git status` 显示 `??`，只差 spec 里没打勾的 task 1.4 检查点）
- [x] **L5.3** 恢复 `enterprise-model/runtime-invocation.ts` — 来源 `31f137200a`
- [x] **L5.4** 恢复 `agent-growth/tenant-agent-dir.ts` — 来源 `92e21628ae`（3 个 importer）
- [x] **L5.5** 恢复 `background-recompute.ts` + `.test.ts` — 来源 main
  - 依赖 L5.4；`growth-events.ts` 与 `computeAdaptivityAdjustment` 已由 kiro-daibai 备好，直接可用
  - **执行者**：`cursor-enterprise-model-gov`（21 commits，07-21）
  - **TASK_ID**：`enterprise-ai-model-governance:codex-production-release`（现存）

### L3 · conversation-lifecycle

- [ ] **L3.1** 整体回捞 `5bce1d4c33` + `ee24d6f006`（同一次 landing 被拆散了）
- [x] **L3.1** 整体回捞 `5bce1d4c33` + `ee24d6f006`（同一次 landing 被拆散了）
  - `src/conversations/{history-cursor,memory-recall-deny}.ts`
  - `src/memory/revoke-outbox-drain.ts`
  - `ui/src/ui/controllers/conversations.ts`
  - `ui/src/ui/ports/employee/conversation-lifecycle-wire.ts`
  - **执行者**：`cursor-conversation-lifecycle`（122 commits）
  - ⚠️ 本线有两个 agent 碰过（另一个 `codex-conversation-lifecycle` 仅 4 commits）。
    按「任一时刻只有一个问责执行者」，选提交量压倒性的那个，另一个记入 `sessions[]`
  - **TASK_ID**：`openbot-conversation-lifecycle:cursor-conversation-lifecycle`

### L4 · vault-sync

- [ ] **L4.1** 恢复 `src/vault-sync/index.ts` — 来源 `3714dd116b`
- [ ] **L4.2** 恢复 `server-methods/vault-sync.ts` — 来源 `ded83d998b`
- [ ] **L4.3** 恢复 `ui/.../gateway-subscriptions/vault-sync.ts` — 来源 `f963576ed8`
- [ ] **L4.4** 恢复 `ui/.../controllers/knowledge-universe-vault-sync.ts` — 来源 `951149975b`
- [x] **L4.1** 恢复 `src/vault-sync/index.ts` — 来源 `3714dd116b`
- [x] **L4.2** 恢复 `server-methods/vault-sync.ts` — 来源 `ded83d998b`
- [x] **L4.3** 恢复 `ui/.../gateway-subscriptions/vault-sync.ts` — 来源 `f963576ed8`
- [x] **L4.4** 恢复 `ui/.../controllers/knowledge-universe-vault-sync.ts` — 来源 `951149975b`
  - **执行者**：`cursor-vault-sync`（159 commits，07-24 活跃，直接签入）
  - **TASK_ID**：`knowledge-vault-sync:cursor-vault-sync`

### L6 · commercial-runtime-closure

- [ ] **L6.1** 恢复 `billing/{usage-outbox-store,usage-outbox-drain}.ts` — 来源 `429bf76862` `316c422047`
- [x] **L6.1** 恢复 `billing/{usage-outbox-store,usage-outbox-drain}.ts` — 来源 `429bf76862` `316c422047`
  - **执行者**：`grok-commercial-closure`（27 commits，静默 7 天）。与 L1 同属 grok 系列，
    **建议与 L1 打包给同一执行者**，避免两条线都卡在唤回上
  - ⚠️ 碰 `src/gateway/billing/**`，与 `entitlement-v2:cursor-phase3`、L5 的 path 声明重叠，需协调顺序
  - **TASK_ID**：`commercial-runtime-closure:grok-commercial-closure`

### L7 · org-monthly-usage

- [ ] **L7.1** 恢复 `src/gateway/tenant-store-paths.ts` — 来源 `7716bb9fec`
- [ ] **L7.2** 恢复 `server-methods/enterprise-organization-monthly-usage.ts` — 来源 `d393e3c061`
- [x] **L7.1** 恢复 `src/gateway/tenant-store-paths.ts` — 来源 `7716bb9fec`（随 L2 一并落地；循环依赖）— cursor-main-recovery（2026-07-26）
- [x] **L7.2** 恢复 `server-methods/enterprise-organization-monthly-usage.ts` — 来源 `d393e3c061`
  - **执行者**：`cursor-grok-org-usage`（32 commits）
  - **TASK_ID**：`enterprise-organization-monthly-usage:cursor-grok-org-usage`

### L8 · knowledge-import-ia

- [ ] **L8.1** 恢复 `ui/.../controllers/knowledge-universe-passive-connector.ts` — 来源 `a9c9f30315`
- [ ] **L8.2** 补 `ui/.../controllers/knowledge-universe-workspace.ts` 的导出 `createKnowledgeUniverseFolderInSection` — 来源 `1c16f48ceb`
- [x] **L8.1** 恢复 `ui/.../controllers/knowledge-universe-passive-connector.ts` — 来源 `a9c9f30315`
- [x] **L8.2** 补 `ui/.../controllers/knowledge-universe-workspace.ts` 的导出 `createKnowledgeUniverseFolderInSection` — 来源 `1c16f48ceb`
  - **执行者**：`cursor-composer`（136 commits，07-26 全仓最活跃，且 `a9c9f30315` 是它提的）；
    `cursor-deploy-import-ia-v94` 仅 8 commits，记入 `sessions[]`
  - **TASK_ID**：`knowledge-workbench-import-ia:cursor-composer`

### L9 · UI 零散导出（6 项，多主）

- [ ] **L9.1** `enterprise-operational-identity.ts` 的 `loadEnterpriseIdentityCredentialEditPreview` + `startEnterpriseWechatOfficialOAuth` — 来源 `192ef9e653` · 归属 `codex-oig`（⚠️ 静默 14 天，最 stale）
- [ ] **L9.2** `user-operational-identity.ts` 的 `applyEnterpriseIdentityRobotBindings` + `syncEmployeeEnterpriseIdentityAccess` — 来源 `478c78b107` · 归属 `cursor-daniel`（活跃）
- [ ] **L9.3** `app-settings.ts` 的 `loadEnterpriseTabShell` — 来源 `2210786747` · 归属 `grok-build`（与 L5/L1 同碰此文件，注意串行）
- [ ] **L9.4** `org-target-picker.ts` 的 `resolvePolicySeatIdsFromPicker` — 来源 `9d9f13b124`
- ⚠️ **该 commit 无 `Agent:` trailer，归属不可恢复，必须人工认领后再动**
- [ ] **L9.5** `ui/src/ui/chat-session-key-match.ts` — 来源 `5c3a96e9ca` · 归属 `cursor-wrapup`
- [ ] **L9.6** `ui/src/ui/chat/focus-message.ts` — 来源 `efde1dda5d` · 归属 `cursor-human-mentions`
- [x] **L9.1** `enterprise-operational-identity.ts` 的 `loadEnterpriseIdentityCredentialEditPreview` + `startEnterpriseWechatOfficialOAuth` — 来源 `192ef9e653` · 归属 `codex-oig`（⚠️ 静默 14 天，最 stale）
- [x] **L9.2** `user-operational-identity.ts` 的 `applyEnterpriseIdentityRobotBindings` + `syncEmployeeEnterpriseIdentityAccess` — 来源 `478c78b107` · 归属 `cursor-daniel`（活跃）
- [x] **L9.3** `app-settings.ts` 的 `loadEnterpriseTabShell` — 来源 `2210786747` · 归属 `grok-build`（与 L5/L1 同碰此文件，注意串行）
- [x] **L9.4** `org-target-picker.ts` 的 `resolvePolicySeatIdsFromPicker` — 来源 `9d9f13b124`
- ✅ **已认领**：`cursor-main-recovery`（2026-07-26 全权接管；原 commit 无 Agent trailer）
- [x] **L9.5** `ui/src/ui/chat-session-key-match.ts` — 来源 `5c3a96e9ca` · 归属 `cursor-wrapup`
- [x] **L9.6** `ui/src/ui/chat/focus-message.ts` — 来源 `efde1dda5d` · 归属 `cursor-human-mentions`
  - **执行者**：建议 `cursor-composer` 统一扫（它已占其中 2 项），L9.4 除外

### 卡 X · 经验胶囊双实现裁决（kiro-daibai 已完成裁决，待确认）

- [x] **X.1** 裁决完成 — 见「胶囊双实现裁决」章节 — kiro-daibai
- [x] **X.2** 吸收 main 更优的「纯迁移 + 存储分离」结构进 `capsule-governance.ts` + 8 项单测 — kiro-daibai
- [ ] **X.3** `kiro-daibai`（`f12ffd6112` 作者，120 commits，07-25 活跃）确认裁决结论
- [ ] **X.4** 由 L1 执行者吸收 execution ledger 触发源（见裁决章节「应吸收」第 2 条）
- [x] **X.3** 全权接管确认裁决结论（以本轮实现为主；纯迁移已吸收；ledger 触发源交 L1）— cursor-main-recovery（2026-07-26）
- [x] **X.4** — cursor-main-recovery（execution ledger → deriveCandidateCapsule） 由 L1 执行者吸收 execution ledger 触发源（见裁决章节「应吸收」第 2 条）

---

## 胶囊双实现裁决

`f12ffd6112`（2026-07-12，`Agent: kiro-daibai`，`Task: agent-growth-evolution`）与本轮 Working DNA/
经验闭环工作**各自独立实现了同一件事**，且 `src/gateway/collaboration-learning/capsule-governance.ts`
**同路径直接冲突**。

| 维度     | main 那套（f12ffd6112）                                                                                   | 本轮这套                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 生成器   | `generateCandidateCapsule` + `TaskRunLearningSignal`（在 collaboration-core，**从未提交**）               | `deriveCandidateCapsule`（`agent-growth/experience-capsule.ts`）                                                      |
| 治理     | `capsule-governance.ts`：`applyCapsuleGovernanceTransition`（纯）+ `transitionGroupMemoryCapsule`（存储） | `capsule-governance.ts`：`listCandidateCapsules` / `approveCandidateCapsule`（含投影+晋升）/ `rejectCandidateCapsule` |
| RPC      | `collaboration.capsule.transition`（单方法带 toStatus）                                                   | `.capsule-candidates.list` / `.capsule.approve` / `.capsule.reject`                                                   |
| 触发源   | execution ledger 咽喉点（轮次 failed）、review-outcome、memory-flush-outcome                              | runner 失败（3 类 reason）、human_takeover、交付物 `in_review → submitted`                                            |
| 回流     | `learning-asset-application-store.ts`（应用记录）                                                         | 注入系统提示词 + 复用计数 + 阈值策展                                                                                  |
| 可运行性 | ❌ 核心生成器与类型从未提交，任何分支都跑不起来                                                           | ✅ 真实文件 e2e 19 项通过                                                                                             |

**裁决：以本轮实现为主实现。** 依据不是作者归属，而是：

1. **可运行性** — 对方链路的核心 `generateCandidateCapsule` / `TaskRunLearningSignal` 从未提交。
2. **闭环完整性** — 对方有生成+治理，但没有「回流进提示词 + 复用计数 + 阈值策展」；
   `learning-asset-application-store` 是应用记录，不是提示词注入。这正是最初审计里
   「只写不读」那条缺陷，对方那套同样没解决。
3. **触发面已覆盖** — 失败 / 接管 / 评审退回三类真实信号均已接线并有回归测试。

**应吸收对方的（对方更好）：**

1. ✅ **纯迁移与存储分离** — `applyCapsuleGovernanceTransition` 纯函数比把 approve 与投影/晋升
   糅在一个 async 函数里更可测。**已吸收**，并补上原实现缺的驳回审计字段
   （`rejectedBy` / `rejectedAt` / `rejectionReason`），配 8 项单测。
2. ⏳ **execution ledger 触发源** — `appendCollaborationExecutionRecord`（被 `chat.ts` 4 处共用）
   是群协作轮次失败的唯一咽喉点，**本轮没有覆盖这个入口**。需由 L1 执行者接入，
   映射到 `deriveCandidateCapsule`（而非 `generateCandidateCapsule`）。
   碰 `collaboration-ledger/writer.ts` 与 `chat.ts`，属 C 线路径，不由 kiro-daibai 代改。

**应作废对方的：** 重复的 `capsule-governance.ts`、`collaboration.capsule.transition` RPC、
以及那两个从未提交的 core 符号（不必再补）。

---

## 从未提交项（3 个，无法 cherry-pick）

| 项                                                     | 处置                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/gateway/utils.js`                                 | 不是缺失模块，是 `pattern-detection` 测试里的错误路径，应为 `src/utils.js`（见 L1.5） |
| `@openbot/collaboration-core :: TaskRunLearningSignal` | 按裁决作废，不必补                                                                    |
| `collaboration-core :: generateCandidateCapsule`       | 按裁决作废，改用 `deriveCandidateCapsule`                                             |

## kiro-daibai 已消除的 main 缺口（不必重复回捞）

模块：`agent-growth/{genome,working-style-store,working-style-effectiveness,growth-events}.ts`、
`collaboration-learning/capsule-governance.ts`、`infra/redact-secret-text.ts`、
`enterprise-data/connector-credential-vault-key.ts`

导出：`operational-score.ts::computeAdaptivityAdjustment`、
`operational-metrics-store.ts::{recordSatisfactionOutcome,satisfactionPolarityFromStatus}`、
`growth-events.ts::{registerGrowthEventBroadcast,getGrowthEventBroadcast}`、
`ai-workforce-governance/types/index.ts::{WorkingStyleEffectItem,WorkingStyleEffectivenessAggregate}`

> `growth-events.ts` 是从 `server-methods/agent-growth.ts` 里内联的 `emitGrowthEvents` 抽出来的，
> 刻意对齐 main 的模块边界（`background-recompute.ts` 与 `server.impl.ts` 都按该路径 import），
> 目的是让 L5.5 落地时不必再改这两个文件、也不会在 agent-growth.ts 上产生合并冲突。

## 建议派发顺序

1. **L2**（解锁面最大、单文件、执行者最活跃）
2. **卡 X 确认**（不需写代码，可并行；阻塞 L1 与 collaboration 合并）
3. **L5**（WIP 已在树里；L5.4/L5.5 等 L2）
4. **L1 + L6**（打包；先解决执行者可用性）
5. **L3 / L4 / L7 / L8**（相互独立，可并行）
6. **L9**（最后扫；L9.4 先认领）
7. **三个共享热文件收口提交**（单一执行者主持）
