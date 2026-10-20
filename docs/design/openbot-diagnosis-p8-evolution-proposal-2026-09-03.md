# OpenBot Diagnosis Platform — P8 受治理进化提案

Date: 2026-09-03

Status: **进程内 EvolutionProposal 桥已落地。只生成候选与证据引用，不自动应用能力变更。P8 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Evolution Governance、Security、QA

Task: `openbot-diagnosis-platform`

Related:

- [P7 分级授权与会诊](/design/openbot-diagnosis-p7-graded-delegation-2026-09-03)

硬门禁：诊断结论、建议、候选、已批准变更、实际应用、验证结果是不同对象。禁止把 Finding / Recommendation / 模型推测直接写入 Skill、Working DNA、Capsule、Fabric policy 或运行时配置。原始 Evidence 只保存引用；跨租户只能用已授权脱敏摘要。

---

## 1. 对象与生命周期

`EvolutionProposal` 记录来源 Case / Mission / ConversationRun、Finding/Evidence/Report 引用、tenantScope、targetDomain、proposedChange、expectedEffect、riskLevel、confidentialityScope、approvalRequired、auditReceipt。

状态：`SUGGESTED` → `PENDING_APPROVAL` → `APPROVED` → `APPLIED` → `VERIFIED` → `ROLLED_BACK`，或从 `SUGGESTED` / `PENDING_APPROVAL` 进入 `REJECTED` / `EXPIRED` / `REVOKED`。

`apply` 只写入 `EvolutionApplication.appliedToRuntime=false`，不调用既有进化事实源。

---

## 2. 可注入 adapter

默认 adapter 只投影：

| 域                    | 投影                         | 禁止                                              |
| --------------------- | ---------------------------- | ------------------------------------------------- |
| skill                 | Pattern Candidate            | approve / publish / install                       |
| agent_working_dna     | Working DNA proposal         | 写 working-style-store / 注入 prompt              |
| collaboration_capsule | Experience Capsule candidate | approve / promote / apply                         |
| fabric_feedback       | FeedbackSignal               | `autoApplied === true`                            |
| evolution_governance  | verification linkage         | tick / redirect / runtime action / Skill 自动演化 |

不修改 `src/gateway/pattern-detection/`、`src/gateway/agent-growth/`、`src/gateway/collaboration-learning/`、`src/fabric/feedback.ts` 或 evolution-governance 主链。

---

## 3. 权限

创建与导出都必须看到仍为 `APPROVED` 的 P7 grant / mission / share grant。过期、撤销、suspend、consumed 后 fail-closed。Proposal 不得扩大 tenant、Evidence、action 或 confidentiality。平台级 proposal 必须基于至少两家企业的脱敏摘要，不得汇聚原始 Evidence。store / inspector 不可用时 fail-closed。不得从 `sessionTenantId` 推导可信 tenant。

---

## 4. 未做

- 未接真实跨租户 RPC / HTTP / 聊天 / UI / live pack
- 未自动应用 Skill、Working DNA、Capsule、Fabric 或治理 runtime action
- 未执行生产构建、发布、重启或切流量
