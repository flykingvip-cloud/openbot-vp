# OpenBot Diagnosis Platform — P7 分级授权与会诊

Date: 2026-09-03

Status: **进程内授权/委托状态机已落地。不是真实跨租户 RPC。P7 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、QA

Task: `openbot-diagnosis-platform`

Related:

- [P5 大白投送合同](/design/openbot-diagnosis-p5-daibai-delivery-2026-09-03)
- [P6 对话诊断状态机](/design/openbot-diagnosis-p6-conversation-state-machine-2026-09-03)

硬门禁：调配权是有限期、有限范围、可撤销的 delegation。不得凭角色名自动获得下级数据。不得从 `sessionTenantId` / URL / query / body / header 推导可信 tenant。`canSubdelegate` 默认 false。平台大白不能绕过企业管理员直接调配员工大白。

---

## 1. 能力层级

| 角色           | 可调配对象       | 必需批准                   |
| -------------- | ---------------- | -------------------------- |
| 平台管理员大白 | 企业管理员大白   | 企业管理员                 |
| 平台管理员大白 | 企业普通员工大白 | 企业管理员 **且** 员工本人 |
| 企业管理员大白 | 本企业员工大白   | 员工本人                   |
| 员工大白       | 仅本人已授权目标 | 员工本人                   |

---

## 2. 对象

`AuthorizationGrant`、`AgentDelegationGrant`、`RemoteDiagnosisMission`、`EvidenceShareGrant`、`ReportShareGrant`。Evidence / Finding / Report 必须分别授权。

状态：`REQUESTED` / `APPROVED` / `DENIED` / `EXPIRED` / `REVOKED` / `CONSUMED` / `SUSPENDED`。

---

## 3. P5 / P6

P5 `enqueue` 在注入 `delegationGuard` 时必须看到有效 `AgentDelegationGrant`，否则 `rejected`。调用方必须同时满足：`auth.principalId` 存在且等于 `delegatedAgent`；`sessionDomain`（若提供）与 `delegatedRole` 一致。仅持有 `delegationGrantId` 不足以投送。P6 `WAITING_AUTHORIZATION` 记录 `grantId` / `missionId`；grant 批准后恢复原 conversation run；拒绝/撤销/过期进入 `INCONCLUSIVE` 或 `ESCALATED`。

---

## 4. 进化输出

远程会诊只产生 `EvolutionProposal` / Pattern Candidate / Working DNA Proposal / Experience Capsule Candidate / Fabric Feedback Signal，并继续走 suggest → approve → apply → verify → rollback。不得 publish Skill、修改 Working DNA、promote Capsule、mutate Fabric 或执行 runtime action。跨租户默认只共享脱敏摘要。

---

## 5. 未做

- 未接真实跨租户 RPC / HTTP / 聊天 / UI / live pack
- 未执行自动修复或生产部署
