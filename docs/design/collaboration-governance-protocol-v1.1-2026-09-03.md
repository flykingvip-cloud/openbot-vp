# Collaboration Governance Protocol v1.1

日期：2026-09-03  
状态：**规则治理基线**。不是最终生产冻结。五条架构约束已锁定。  
替代：`docs/design/collaboration-two-layer-rules-2026-09-03.md` 中的 S-xxx / G-xxx 清单不再扩张。

## 治理原则

1. **L1 / L2 是治理来源，不是运行时架构。**
2. **EffectivePolicy = L1 ∩ L2。** L1 划安全与一致性边界；L2 只能在边界内收紧或选择被允许的默认替代，不能放宽。
3. **Runtime gate 不是第三套规则。** 它是执行 EffectivePolicy 的机械防线（ACL / Resource / Governance / Orchestrator）。
4. **自定义规则摘要是行为指导，不是强制约束。**
5. **Round ≠ Task。** 一轮交互怎么协作，和整个任务怎么交付，必须分开。

```
System Invariants (L1-Hard) + L1-Default
                 +
           Group Policy (L2)
                 ↓
          Policy Compiler
                 ↓
           Effective Policy  (+ provenance)
                 ↓
     Round Orchestrator / Gates
                 ↓
     PolicyDecisionRecord / Ledger
```

Compiler 决定「当前政策是什么」。Runtime 只负责「按照政策执行」。禁止再出现：设置页说 A → Compiler 算出 B → `decideParticipants()` 又偷偷变成 C。

实现：

- 类型：`src/gateway/collaboration-dispatch/effective-policy.ts`
- 编译：`src/gateway/collaboration-dispatch/policy-compiler.ts`
- 选人：`decision-engine.ts` 读 `effective.strategy`；关键词只作讨论模板内回退，**不再扩规则**
- 治理闸：`governance-gate.ts`
- 现行回合机（仍是 live）：`round-state-machine.ts`
- 目标回合机：预留，不替换 live 回合机
- 任务机 / Handoff：P2 overlay，叠在 live `TaskStatus` 上；live 写路径经 `transitionGovernanceTask` 走 hop，不替换 `packages/collaboration-core` Task SM

## 锁定的五条架构约束

进入后续实现前，这五条不再改语义：

1. **EffectivePolicy 必须保留 provenance。** 每个被管理员可见的生效值要能回答「为什么是这个数」：`value` / `source: l1-hard | l1-default | l2` / 可选 `requested` / `constrainedBy`。
2. **`enabledSkills=[]` = 无群级 Skill 限制，不是无权限限制。**  
   `Tool Permission = Tenant/System ACL ∩ Agent Capability ACL ∩ L1-Hard ∩ Group L2 Skill Policy`。空群白名单只表示 `Group Skill Restriction = none`。
3. **Primary Owner ≠ Executor。** Owner 对交付结果负责；Executor 执行子工作。复杂任务用责任图，而不是一个角色字段。
4. **Task 必须有显式 Handoff Contract。** Bot→Bot 交接不能靠「你自己去看前面聊天」。P2 overlay 已接线；工作台任务详情可提交 `collaboration.task.handoff`。
5. **Confidentiality 是 Context Scope / Retrieval 的硬闸。**  
   `Effective Context = Requested Scope ∩ Group Confidentiality ∩ Agent Authorization ∩ Task Need`。群里有能力搜 Group KB，不等于本轮可以扩大上下文。现行闸：`src/gateway/context-scope/authorize.ts`。

## L1 必须拆成两种

| 种类           | 含义         | L2 能否改                    |
| -------------- | ------------ | ---------------------------- |
| **L1-Hard**    | 绝对不可违反 | 否                           |
| **L1-Default** | 系统默认策略 | 可以收紧，或在白名单内换策略 |

### L1-Hard

- ACL：非成员不能写；observer `canRespond/canExecute/canApprove = false`（可读）
- 归档群不能继续执行
- @ 无法解析不能假装已点名；被 @ 必须进入本轮候选，可见回复允许 NO_REPLY
- 单轮可见回复硬顶 12
- 空 `enabledSkills` = **无群级限制**（不绕过租户 / Agent ACL）；1:1 不继承群 allowlist
- 群回合不传 `inboundDepth`
- 不得绕过 confidentiality（经 Context Scope 授权，不是群成员默认全库）
- 托管不回退未授权 workspace

### L1-Default（可被 L2 覆盖的默认）

- 低信号确认默认 1 人回（L2 可改为「具名确认人全部回」）
- 协调者收口默认关
- 默认开放讨论
- 默认每轮 5 条（仍受硬顶 12）
- 主答先出、补充后到（证据收集例外为预留，Compiler 现为 `allowEvidenceCollection: false`）
- 主答超时允许二次接管（L2 可关，关则等待人类 / abort）

## 五类，而不是继续扩编号表

| 类                      | 产品名                   | 强制力                   |
| ----------------------- | ------------------------ | ------------------------ |
| A. System Invariants    | 系统底线                 | 强制                     |
| B. Collaboration Policy | 本小组协作策略           | 调度执行（经 Compiler）  |
| C. Round / Task State   | （运行时，不进设置枚举） | 状态约束                 |
| D. Governance Gate      | 任务治理                 | 发布/拍板闸（P1 已接线） |
| E. Guidance             | 自定义协作规则           | 仅 prompt                |

设置页与规则抽屉对管理员只出现产品名，不出现 L1/L2。被钳制的值必须同时显示 **本群设置** 与 **系统生效**。

## 模式是策略模板，不是三值开关

`discussion_driven` / `task_driven` / `review_driven` 编译为 `ModeTemplate`。  
选人链路：`intent → effective.strategy → ModeTemplate → candidates → policy filter → ranking → Primary Owner / contributors`。  
消息关键词只在讨论模板内、或任务模板的聚焦主答里作为回退。**禁止继续给 keyword router 加规则。**

## Primary Owner ≠ Executor

Owner 对该轮 / 该任务的交付结果负责，不是第一个说话的人，也不是唯一动手的人。

```
Task Responsibility
-------------------
Owner
Executor(s)
Reviewer
Approver
Coordinator
Decision Authority
```

协调者 ≠ 决策者。Bot 可以 Proposal / Review / Recommendation；不天然拥有 Decision Authority 或 Commit Authority。`decisionAuthority` 是明确授权主体。

## 状态机

**Live 回合机保持** PRIMARY*\* / SUPPLEMENT*\* / CONVERGENCE / OPTIONAL_CLOSE。  
`PRIMARY_TIMEOUT`：

- `allowSecondaryTakeover = false` → 等待人类 / ABORT
- `allowSecondaryTakeover = true` → 从**本轮已经过选人**的候选人里接管（FALLBACK），不随便另找一个 Bot

**目标回合机（预留，不替换 live）：**

`ROUND_CREATED → CONTEXT_RESOLVE → PARTICIPANT_SELECT → PRIMARY_DISPATCHED → PRIMARY_ACTIVE`  
→ 需要证据则 `EVIDENCE_COLLECTION → EVIDENCE_COMPLETE`  
→ 否则 `SUPPLEMENT_EVAL → SUPPLEMENT_DISPATCH`  
→ `GOVERNANCE_GATE → ROUND_CLOSED`

**任务机（P2 overlay）：**

`OPEN → TRIAGED → ASSIGNED → IN_PROGRESS → REVIEW → REVISION → READY → HUMAN_DECISION → DELIVERED → CLOSED`

live `Task.status` 仍是 `draft / ready / in_progress / blocked / review / completed / cancelled`。  
`governanceState` + `responsibility` + `handoffs[]` 叠在同一条 Task JSON 上。无责任图的旧任务在首次 transition / handoff 时自动补种：Owner 取 `ownerMemberId` / `createdBy` / 群主，**不用 UI operator 冒充 Owner**；Executor 取指派成员，缺省时才落到 Owner 或当前执行人。Owner 与 Executor 可以是同一主体。

live 写路径保持 `packages/collaboration-core` Task SM 权威。每次 live status 变更后，`applyGovernanceAfterLiveTransition` 先算出 overlay 目标，再经 `transitionGovernanceTask` 走最短合法 hop（例如 live `in_progress → completed` 会经过 `REVIEW → READY → DELIVERED`）。这不是替换 live Task SM。

任务交接必须带 `TaskHandoff`（已完成产物、剩余工作、假设、阻塞、验收条件），经 HandoffContract（`proposeHandoff`→accept→approve→apply）落账；历史捷径 RPC `collaboration.task.handoff` 已退役，不能靠聊天记录推断。`reason === "owner_transfer"` 是唯一改 Owner 的交接。  
`task_driven` 完成前必须有已提交的关联交付物；交付物批准/发布走 Governance Gate。

## Governance Gate

`Proposal → Review → Decision Gate → Human Confirm | Delegated Authority → Commit`

Proposal 和 Decision 分开。`finalDecisionPolicy` 是闸，不是设置页装饰。

## PolicyDecisionRecord ≠ Collaboration Ledger

| 产物                 | 回答                                                              |
| -------------------- | ----------------------------------------------------------------- |
| PolicyDecisionRecord | 为什么选择这些 Bot（mode、hash、participants、policyConstraints） |
| Collaboration Ledger | 这些 Bot 实际做得怎么样（时延、产物、handoff、评审、人类反馈）    |

PDR 在 P1 落账。Ledger `quality` 记录（时延、handoff、评审、交付物、`human_feedback`）在 P3 落账，经 behavior-buffer 进入 `collaboration.spaces.recompute-growth`。`human_feedback` 是满意度写账后的观察镜像，不另计一分。Growth 仍是 hints，不是产品 SLO。

## Effective Context

```
User Context Request
        ↓
Context Scope
        ↓
Confidentiality Gate
        ↓
Agent ACL
        ↓
Group Policy
        ↓
Retrieval
```

群成员身份不能单独扩大本轮检索范围。

## 实施阶段

| 阶段              | 做了什么                                                                                                           | 状态                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **P0** 真相源     | Compiler + EffectivePolicy + 抽屉五段口径                                                                          | 已落地                      |
| **P1** 运行时     | 选人读 strategy；Governance Gate；observer ACL；PDR                                                                | 已接线                      |
| **P1.1** 约束锁定 | provenance；技能语义；超时接管；Owner≠Executor / Handoff 类型                                                      | 已落地                      |
| **P2** 任务交付   | overlay + live 写路径经 `transitionGovernanceTask` + Responsibility Graph + Handoff RPC/UI + Deliverable/Review 闸 | **已接线**                  |
| **P3** Growth     | Ledger quality（含 `human_feedback`）+ 贡献质量聚合 + Growth hints                                                 | **已接线（hints，非 SLO）** |

不再扩 S-xxx / G-xxx。后续只实现 `Policy → Compiler → EffectivePolicy → State Machine → Gate → Decision Record / Ledger`。
