# OpenBot Diagnosis Platform — P6 对话诊断状态机

Date: 2026-09-03

Status: **进程内状态机已落地。未接入真实聊天通道，不执行修复。P6 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、QA

Task: `openbot-diagnosis-platform`

Related:

- [P5 大白投送合同](/design/openbot-diagnosis-p5-daibai-delivery-2026-09-03)

硬门禁：只编排已注册 Diagnoser / Evidence Source 与 P5 delivery contract。禁止写 Session / 消息主链 / Skill Invocation / Doctor `--fix` / Channel restart / 配置。对话消息不是 Evidence。模型输出不得写成正式 RCA。

---

## 1. ConversationDiagnosisRun

字段：`conversationRunId`、`signalId` / `caseId` / `target`、`tenantId` / `principal`、`state`、`currentStep`、`pendingQuestion`、`requiredAuthorization`、`createdAt` / `updatedAt` / `expiresAt`、`lastEvidenceRefs` / `lastFindingRefs`、分层 hypothesis/recommendation refs、`audit`。

---

## 2. 状态与命令

状态：`DETECTED` → `TRIAGING` → `COLLECTING_EVIDENCE` → `DIAGNOSING` → `WAITING_AUTHORIZATION` → `VERIFYING` → `RESOLVED` / `INCONCLUSIVE` / `ESCALATED` / `CANCELLED`。

命令：`start` / `ask` / `answer` / `pause` / `resume` / `approve` / `deny` / `cancel` / `timeout`。

`WAITING_AUTHORIZATION` 与 `paused` 期间禁止采集和诊断。`approve` 回到原 run 的 `resumeState`。`deny` / `cancel` / 过期后不得继续采集。`timeout` 进入 `INCONCLUSIVE`，`escalate: true` 进入 `ESCALATED`。

---

## 3. 恢复与幂等

可注入 store；`restore()` 重新校验 tenant / principal / 授权有效期。`commandId` / `transitionId` 幂等。重复 `approve` / `resume` / `cancel` 不重复执行。

---

## 4. 未做

- 未接入真实聊天 transcript / HTTP / RPC / Gateway live handler / UI
- 未做跨租户委托
- 未执行自动修复
- 未生产部署
