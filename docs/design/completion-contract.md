# Completion Contract（完成合同）

**版本**：2026-09-15 rev2.1  
**状态**：**ACCEPTED** — **无运行时依赖**；P0 ACCEPTED **不等于** B1/B2 编码授权；**B1/B2 runtime coding = NOT APPROVED**  
**上级文档**：[CO-Chat 反馈环审阅报告（rev2.1）](/design/openbot-co-chat-feedback-loop-state-machines-2026-09-15)  
**关联**：[Event Mapping](/design/event-mapping)、[Bridge MVP](/design/bridge-mvp)

---

## 1. 目的

定义 OpenBot 跨系统中**唯一可审计、可机械执行**的任务完成判定。

**原则**：展示状态 ≠ 完成事实；LLM summary ≠ evidence；判定结果必须来自**确定性算法 + reason code**，不得由实现方自行解释 `accepted`。

---

## 2. 合同版本

```typescript
/** 合同语义版本；实现须声明支持的 contractVersion */
const COMPLETION_CONTRACT_VERSION = "2026-09-15.rev2" as const;
```

| 规则           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| **演进**       | 仅增字段 / 增 reason code；**禁止** silent 改变优先级             |
| **不兼容变更** | 递增 major（如 `2026-10-01.rev1`），旧 candidate 按写入时版本裁定 |
| **存储**       | 每条 `ContractVerdictRecord` 须持久化 `contractVersion`           |

---

## 3. 裁定结果集合（ContractVerdict）

**唯一合法终态/过程态**（实现不得扩展同义别名）：

| Verdict       | 含义                           | 可否 close CT                  |
| ------------- | ------------------------------ | ------------------------------ |
| `pending`     | 已收 candidate，证据未齐或未验 | 否                             |
| `accepted`    | P1/P2 满足，任务完成           | **是**                         |
| `rejected`    | 证据无效、来源不可信、冲突败北 | 否                             |
| `stale`       | 绑定/代际过期、迟到事件        | 否                             |
| `cancelled`   | 用户取消或 force-off 生效      | 否（若已 accepted 见 §8 回退） |
| `needs_human` | policy / autonomy 要求人工门   | 否                             |

---

## 4. Reason Code（拒绝/过程码）

所有非 `accepted` 的裁定**必须**带 `reasonCode`：

| reasonCode               | verdict     | 说明                                     |
| ------------------------ | ----------- | ---------------------------------------- |
| `RC_OK`                  | accepted    | 唯一成功码                               |
| `RC_PENDING_EVIDENCE`    | pending     | 候选手到，证据未验证                     |
| `RC_PENDING_HUMAN`       | needs_human | 等待人工                                 |
| `RC_EVIDENCE_MISSING`    | rejected    | `evidenceReferences` 空且 source 需证据  |
| `RC_EVIDENCE_NOT_FOUND`  | rejected    | ref 指向的对象不存在                     |
| `RC_EVIDENCE_EXPIRED`    | stale       | 证据 TTL 过期（§6.3）                    |
| `RC_EVIDENCE_TAMPERED`   | rejected    | hash/签名/exitCode 不匹配                |
| `RC_SOURCE_NOT_ALLOWED`  | rejected    | completionSource 不可单独关 CT           |
| `RC_SOURCE_CONFLICT`     | rejected    | 多来源冲突且本 candidate 败北（§7）      |
| `RC_TENANT_MISMATCH`     | rejected    | tenant / ACL 失败                        |
| `RC_BINDING_STALE`       | stale       | bindingVersion 或 primaryGeneration 过期 |
| `RC_RUN_STALE`           | stale       | subagentRunId 已 superseded              |
| `RC_CANCELLED`           | cancelled   | 有效 cancel 已生效                       |
| `RC_FORCE_OFF`           | cancelled   | force-off 已生效                         |
| `RC_RACE_LOST_TO_CANCEL` | cancelled   | 与 cancel 并发，cancel 胜出（§9）        |
| `RC_DUPLICATE_REPLAY`    | —           | 幂等重放：返回已有 record，不新裁定      |
| `RC_SUPERSEDED`          | rejected    | 被更高优先级新 evidence 推翻             |
| `RC_ROLLBACK`            | rejected    | 自 accepted 回退（§8）                   |
| `RC_CONTRACT_VERSION`    | rejected    | 不支持的 contractVersion                 |

---

## 5. 核心类型（TypeScript 合同）

```typescript
type CompletionContractVersion = typeof COMPLETION_CONTRACT_VERSION;

type ContractVerdict =
  | "pending"
  | "accepted"
  | "rejected"
  | "stale"
  | "cancelled"
  | "needs_human";

type ReasonCode = /* 见 §4 表 */;

type TaskIdentity = {
  /** 逻辑主键：ConversationTask id 或 correlationId */
  primaryId: string;
  /** CT 代际；retry/reopen 递增，用于 stale 判定 */
  primaryGeneration: number;
  tenantId: string; // 必填
  scope: "group_tenant" | "personal_local"; // 见 event-mapping §10
  conversationTaskId?: string;
  flowStepSeq?: number;
  ledgerTaskId?: string;
  bindingId?: string;
  bindingVersion?: number;
  groupId?: string;
  sessionId?: string;
  employeeId?: string;
  conversationId?: string;
};

type CompletionSource =
  | "supervisor_accepted"
  | "ledger_verified"
  | "ledger_completed"
  | "round_converged"
  | "flow_step_done"
  | "taskcard_done"
  | "autopilot_candidate"
  | "llm_summary";

type EvidenceReference = {
  kind: "supervisor_report" | "ledger_step" | "artifact" | "argv_exit" | "round_snapshot";
  ref: string;
  /** 可选：验证用 content hash */
  contentHash?: string;
  /** 证据有效截止（ISO）；缺省按 §6.3 默认 TTL */
  validUntil?: string;
  summary?: string; // 人类可读，不参与验证
};

type CompletionCandidate = {
  contractVersion: CompletionContractVersion;
  candidateId: string; // uuid
  taskIdentity: TaskIdentity;
  completionSource: CompletionSource;
  evidenceReferences: EvidenceReference[];
  actor: {
    type: "session" | "system" | "supervisor" | "user";
    sessionId?: string;
    /** 服务端签发 attribution；CO-Chat bridge 必填 */
    serverAttribution: string;
  };
  recordedAt: string; // ISO-8601，系统时钟
  idempotencyKey: string;
  supersedes?: string; // candidateId
};

type ContractVerdictRecord = {
  contractVersion: CompletionContractVersion;
  candidateId: string;
  idempotencyKey: string;
  taskIdentity: TaskIdentity;
  verdict: ContractVerdict;
  reasonCode: ReasonCode;
  /** accepted 时非空 */
  winningSource?: CompletionSource;
  evaluatedAt: string;
  /** 幂等重放时指向首次 record */
  replayOf?: string;
};
```

### 5.1 必填字段

| 对象                    | 必填                                                                                                                              | 条件必填                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `CompletionCandidate`   | `contractVersion`, `candidateId`, `taskIdentity.*`, `completionSource`, `actor.serverAttribution`, `recordedAt`, `idempotencyKey` | `evidenceReferences`：P1/P2 源至少 1 条 |
| `TaskIdentity`          | `primaryId`, `primaryGeneration`, `tenantId`, `scope`                                                                             | `group_tenant` 须 `groupId`             |
| `EvidenceReference`     | `kind`, `ref`                                                                                                                     | `argv_exit` 须可解析 argv+exitCode      |
| `ContractVerdictRecord` | 全部字段                                                                                                                          | `verdict=accepted` → `winningSource`    |

**CO-Chat / bridge 事件**：`scope=group_tenant` 时 **`tenantId` 缺失 → fail-closed**（不调用 `resolveActivationTenantId` fallback）。

---

## 6. 证据验证（evidenceReferences）

### 6.1 验证步骤（按 kind）

| kind                | 验证动作                                                   | 失败 reasonCode                                  |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `supervisor_report` | 加载 report；状态=`accepted`；tenant 一致                  | `RC_EVIDENCE_NOT_FOUND` / `RC_EVIDENCE_TAMPERED` |
| `ledger_step`       | 加载 step；状态 ∈ `{verified, completed}`；evidence 链完整 | 同上                                             |
| `argv_exit`         | 重放或读 stored exitCode；与 ref 一致                      | `RC_EVIDENCE_TAMPERED`                           |
| `artifact`          | ref 可读；`contentHash` 匹配（若提供）                     | 同上                                             |
| `round_snapshot`    | round 状态=`ROUND_COMPLETE`；**不**单独关 CT               | 仅 P3                                            |

### 6.2 来源与证据最低要求

| completionSource                                   | 最低 evidence          | 单独关 CT |
| -------------------------------------------------- | ---------------------- | --------- |
| `supervisor_accepted`                              | ≥1 `supervisor_report` | 是        |
| `ledger_verified` / `ledger_completed`             | ≥1 `ledger_step`       | 是        |
| `round_converged`                                  | ≥1 `round_snapshot`    | 否        |
| `autopilot_candidate`                              | 须转验 P1/P2           | 否        |
| `flow_step_done` / `taskcard_done` / `llm_summary` | 不要求                 | 否        |

### 6.3 证据过期（TTL）

| 证据类型            | 默认 TTL               | 过期 verdict                    |
| ------------------- | ---------------------- | ------------------------------- |
| `supervisor_report` | 7d（可配置）           | `stale` / `RC_EVIDENCE_EXPIRED` |
| `ledger_step`       | 无（以 step 状态为准） | step 回退则 `RC_SUPERSEDED`     |
| `argv_exit`         | 24h                    | `stale`                         |
| `round_snapshot`    | 1h                     | `stale`                         |

`validUntil` 显式字段 **优先于** 默认 TTL。权威时间一律先解析为 epoch ms 再比较；`recordedAt` / `validUntil` / `cancelEffectiveAt` / evaluate `clock` 非法、无时区、或**非法日历日**（如 `2026-02-30`，禁止 `Date.parse` 归一化）→ `rejected` / `RC_CONTRACT_VERSION`。

---

## 7. 冲突解决（多来源同时存在）

**优先级（高 → 低）**：与 §4 旧 P 级一致，但**同优先级冲突**按下列规则：

| 情况                            | 胜出方                                                                               | 败方 reasonCode          |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| P1 vs P2 同时 valid             | **P1**（Supervisor）                                                                 | `RC_SOURCE_CONFLICT`     |
| 两个 P2 ledger step 冲突        | **completed > verified**；同态则 **recordedAt epoch 较晚**（`pickWinningCandidate`） | `RC_SOURCE_CONFLICT`     |
| P1/P2 vs cancel 已生效          | **cancel**                                                                           | `RC_RACE_LOST_TO_CANCEL` |
| accepted 后新 rejected evidence | **触发 rollback 流程**（§8）                                                         | `RC_ROLLBACK`            |
| autopilot_candidate vs 无 P1/P2 | 保持 `pending`                                                                       | `RC_PENDING_EVIDENCE`    |

**不变量**：同一 `(tenantId, primaryId, primaryGeneration)` 至多 **一个** `accepted` record；第二个 accepted 尝试 → `RC_SOURCE_CONFLICT` + audit。

---

## 8. accepted → rejected 回退

| 条件                         | 允许             | 流程                                                                                                          |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| 新证据证明原 acceptance 错误 | **是**           | 新 candidate + `supersedes` → verdict `rejected` + `RC_ROLLBACK`；CT 从 `closed` → `active`（若 policy 允许） |
| 用户 cancel 在 accepted 之后 | **是**（policy） | `cancelled` + `RC_CANCELLED`；是否 reopen CT 由 control plane                                                 |
| LLM 撤回 summary             | **否**           | 忽略                                                                                                          |
| Flow step 改回 in_progress   | **否**           | 不影响 Contract                                                                                               |

回退须写入 audit log：`{ previousVerdictRecordId, rollbackCandidateId, actor }`。

---

## 9. 取消 vs 后台完成（竞态顺序）

**逻辑顺序键**（比较器）：

1. `cancelGeneration`（单调递增，CT 或 task 级）
2. `recordedAt` epoch（禁止字符串顺序）
3. `candidateId`（tie-break，字典序）

**规则**：

```
if epoch(cancelEffectiveAt) <= epoch(completionEvent.recordedAt)
   AND cancelGeneration >= taskIdentity.primaryGeneration:
     → verdict cancelled (RC_RACE_LOST_TO_CANCEL)
else if completion already accepted before cancel:
     → cancel 可能仅禁止新 work；已 accepted 不回滚除非 §8
else:
     → 正常 evaluate completion
```

**force-off**：等价于 `cancelGeneration = MAX`，**胜出**于一切 pending completion。

---

## 10. 幂等与重放

### 10.1 IdempotencyKey 构成

```
idempotencyKey = sha256(
  contractVersion + tenantId + primaryId + primaryGeneration +
  completionSource + canonicalEvidenceRefs + candidateId
)
```

### 10.2 幂等存储（概念）

```typescript
type IdempotencyStoreEntry = {
  idempotencyKey: string;
  firstVerdictRecordId: string;
  createdAt: string;
  expiresAt: string; // 建议 30d
};
```

| 重放场景                 | 行为                             | reasonCode             |
| ------------------------ | -------------------------------- | ---------------------- |
| 完全相同 key             | 返回 `firstVerdictRecordId`      | `RC_DUPLICATE_REPLAY`  |
| 同 key 不同 payload hash | **reject**                       | `RC_EVIDENCE_TAMPERED` |
| 过期 key 重放            | 按新 candidate 处理；旧 entry GC | —                      |

---

## 11. 判定算法 `evaluateCandidate`

```
function evaluateCandidate(candidate, store, clock):
  assert candidate.contractVersion supported

  if idempotencyStore.has(candidate.idempotencyKey):
    return store.get(candidate.idempotencyKey) with RC_DUPLICATE_REPLAY

  if resolveBridgeTenantId({tenantId}) is empty
     OR store.bindingTenantId missing/mismatch
     OR (group_tenant AND attributionVerified !== true):
    return rejected, RC_TENANT_MISMATCH
    // never use requesterId (BR-T2)

  if activeCancel(taskIdentity) and cancelWinsRace(candidate):
    return cancelled, RC_RACE_LOST_TO_CANCEL or RC_FORCE_OFF

  if binding stale (bindingVersion / primaryGeneration):
    return stale, RC_BINDING_STALE or RC_RUN_STALE

  if completionSource in {flow_step_done, taskcard_done, llm_summary}:
    return rejected, RC_SOURCE_NOT_ALLOWED

  if completionSource == autopilot_candidate:
    return pending, RC_PENDING_EVIDENCE  // 转 P1/P2 验证路径

  if priorVerdict == accepted AND not supersede AND not post-accept cancel:
    return rejected, RC_SOURCE_CONFLICT

  if evidenceReferences fails validation (§6; empty → RC_EVIDENCE_MISSING; default TTL if no validUntil):
    return rejected or stale per §6

  if completionSource == supervisor_accepted AND P1 valid:
    return accepted, RC_OK, winningSource=supervisor_accepted

  if completionSource in {ledger_verified, ledger_completed} AND P2 valid:
    return accepted, RC_OK, winningSource=...

  if completionSource == round_converged:
    return pending or rejected  // 不 close CT；可写 round 级 record

  if policy requires human:
    return needs_human, RC_PENDING_HUMAN

  return rejected, RC_EVIDENCE_MISSING
```

**持久化**：每次新裁定写入 `ContractVerdictRecord`；`accepted` 触发 CT close **仅**经 control plane 显式调用（非 LLM）。

---

## 12. 状态迁移表

| 当前 verdict | 事件                       | 新 verdict  | reasonCode                      |
| ------------ | -------------------------- | ----------- | ------------------------------- |
| —            | 新 candidate（有效 P1/P2） | accepted    | RC_OK                           |
| —            | 新 candidate（需验）       | pending     | RC_PENDING_EVIDENCE             |
| pending      | 证据补齐                   | accepted    | RC_OK                           |
| pending      | 证据失败                   | rejected    | RC\_\*                          |
| pending      | cancel                     | cancelled   | RC_CANCELLED                    |
| accepted     | 新 accepted 尝试           | rejected    | RC_SOURCE_CONFLICT              |
| accepted     | rollback candidate         | rejected    | RC_ROLLBACK                     |
| \*           | stale 事件                 | stale       | RC_BINDING_STALE / RC_RUN_STALE |
| \*           | duplicate key              | 不变        | RC_DUPLICATE_REPLAY             |
| pending      | human gate                 | needs_human | RC_PENDING_HUMAN                |

---

## 13. UI 只读投影（uiStatusProjection）

**术语**：使用 **`uiStatusProjection`** / **`readModel`**，**勿**称 `projection` alone——避免与 ConversationTask **projection phase**（生产 flag `projection=OFF`）混淆。

```
uiStatusProjection = {
  contractVerdict: ContractVerdict | null,
  ledgerProgress: ...,      // 只读
  flowDisplay: ...,         // 只读
  label: "step_done" | "task_completed" | ...
}
```

- `task_completed` 标签：**仅** `contractVerdict === accepted`
- 开启 CT projection phase **不是** uiStatusProjection 的前提

---

## 14. force-off（S8 目标合同，非现有实现）

当前 **无** 统一 kill switch。force-off 在 Contract 中仅作为**目标语义**：

| 子系统                      | 目标行为           | 现有                  |
| --------------------------- | ------------------ | --------------------- |
| ConversationTask activation | 停止新 activation  | 部分（control plane） |
| Autopilot                   | stop               | extension             |
| Supervisor                  | 停止新 dispatch    | 独立                  |
| 运行中 subagent             | TBD：drain / abort | 无统一                |

P2 前须单独立项：kill switch owner、最大生效时间、运行中任务策略、跨进程传播、恢复 CAS。**P0 不声明已满足 S8。**

---

## 15. JSON Schema 锚点（P0 完成标准）

P0 完成须产出可测试消费的 schema（路径建议，实现期落地）：

| 文件                                                            | 内容                  |
| --------------------------------------------------------------- | --------------------- |
| `docs/design/schemas/completion-candidate.schema.json`          | CompletionCandidate   |
| `docs/design/schemas/contract-verdict-record.schema.json`       | ContractVerdictRecord |
| `docs/design/schemas/background-completion-payload.schema.json` | B1 载荷               |

TypeScript 类型以本文 §5 为准；schema 与 types **同步 CI 检查**（P0 末任务）。

**标准 schema 结构校验**（不受 shell `$schema` 展开影响）：

```bash
./docs/design/scripts/validate-completion-contract-schemas.sh
# 或
for f in docs/design/schemas/*.schema.json; do
  jq -e 'has("$schema") and has("type")' "$f" >/dev/null
done
```

**合同同步测试**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run --config docs/design/scripts/vitest.config.ts
```

---

## 16. 测试向量（P0 交付）

### 16.1 幂等 / 重放

```json
{
  "name": "duplicate_same_key",
  "given": { "two identical candidates, same idempotencyKey": true },
  "expect": { "secondVerdict": "same as first", "reasonCode": "RC_DUPLICATE_REPLAY" }
}
```

### 16.2 Cancel race

```json
{
  "name": "cancel_before_completion",
  "given": { "cancelGeneration": 2, "completion.recordedAt": "after cancelEffectiveAt" },
  "expect": { "verdict": "cancelled", "reasonCode": "RC_RACE_LOST_TO_CANCEL" }
}
```

### 16.3 Stale run

```json
{
  "name": "late_subagent_after_retry",
  "given": { "subagentRunId": "run-v1", "bindingVersion": 2, "run bound to v2": "run-v2" },
  "expect": { "verdict": "stale", "reasonCode": "RC_RUN_STALE" }
}
```

### 16.4 Duplicate delivery

```json
{
  "name": "double_announce",
  "given": { "same idempotencyKey, same payload": true },
  "expect": { "flowUpdates": 1, "reasonCode": "RC_DUPLICATE_REPLAY" }
}
```

### 16.5 Tenant missing（bridge）

```json
{
  "name": "cochat_event_no_tenant",
  "given": { "scope": "group_tenant", "tenantId": null },
  "expect": { "eventAccepted": false, "failClosed": true }
}
```

完整向量集在 P0 收官时扩展至 ≥20 条，覆盖 P1/P2 准入。

---

## 17. 与现有枚举映射

（同 rev1 §9，略；`ConversationTask.closed` **仅** `accepted` 后由 control plane 写入。）

---

## 18. P0 完成标准（本合同）

| #   | 项                                                                              | 状态                                                                   |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Verdict / reason code / 算法 / 迁移表                                           | **done**（本文 §3–§12）                                                |
| 2   | JSON Schema（5 文件）+ CI 同步测试                                              | **done** — `docs/design/scripts/completion-contract-p0-schema.test.ts` |
| 3   | ≥20 测试向量 fixtures                                                           | **done** — 46 条：`fixtures/completion-contract/test-vectors.json`     |
| 4   | [uiStatusProjection](/design/ui-status-projection) 冲突/失败规则                | **done**                                                               |
| 5   | [B2 存储 SoT 冻结](/design/bridge-mvp#45-p0-冻结绑定存储-sot不可推迟到编码阶段) | **done**                                                               |
| 6   | §3–§12 `evaluateCandidate` 纯函数实现 + 向量驱动测试                            | **done** — 规范侧 runner；TC001–TC046（未接入运行时）                  |
| 7   | 与 event-mapping ACL 交叉一致性自动化                                           | **partial**（schema + reason code 已测）                               |
| 8   | **独立**安全 reviewer 签署                                                      | **PASS @ `da79ee8774`**（2026-09-16T06:54:21Z；R14 原文）              |
| 9   | **独立**运行时 reviewer 签署                                                    | **PASS @ `da79ee8774`**（2026-09-16T06:54:20Z；R14 原文）              |
| 10  | B1/B2 编码准入单独发布                                                          | **NOT APPROVED**                                                       |

**P0 收官**：本合同 **ACCEPTED**（基线 `da79ee8774`）。P0 ACCEPTED **不等于** B1/B2 编码授权；第 10 项须另开准入。`projection` / `authorization` 不受本次变更影响。统一 force-off 控制面仍未实现。

---

## 19. 变更记录

| 日期              | 变更                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-09-15        | 初稿                                                                                                               |
| 2026-09-15 rev2   | 可执行深化：Verdict、reason code、算法、迁移表、竞态、幂等、TTL、uiStatusProjection、S8 目标化、测试向量           |
| 2026-09-15 rev2.1 | P0 证据：24 vectors、5 schemas、schema CI test；P0 清单诚实化；收官仍待独立签署                                    |
| 2026-09-16        | #1144 合入 `5d23e99db9`；`evaluateCandidate` 纯函数 + 24 向量测试落地；**P0 未 ACCEPTED**；签署仍空                |
| 2026-09-16        | 未知 evidence ref fail-closed（`RC_EVIDENCE_NOT_FOUND`）+ TC025；来源优先级表；**#1145 未合入 / 未 ACCEPTED**      |
| 2026-09-16        | #1145 合入 `540f868`；干净主干 schema 5/5 + vitest 40/40；**P0 仍未 ACCEPTED**                                     |
| 2026-09-16        | 关闭 CONDITIONAL：binding fail-closed、默认 TTL、RC_SOURCE_CONFLICT、TC007 真调用、PII 拒绝名单；**仍待独立 PASS** |
| 2026-09-16        | #1150 合入后 A 剩余：`bindingScope` fail-closed + 递归嵌套 PII；运行时已 PASS；**P0 仍未 ACCEPTED**                |
| 2026-09-16        | epoch 时间比较 + 非法时间 fail-closed（TC037–TC042）；敏感键大小写/snake 别名；**仍待独立 PASS**                   |
| 2026-09-16        | 严格日历日（TC043–TC046）；P0 payload 事件级 schema；**不承诺内容级 DLP；仍待独立 PASS**                           |
| 2026-09-16        | 转载 #1153 A/B PASS @ `90f12cb5`；`#1154` 使签署过期；**当前尖仍未 ACCEPTED**                                      |
| 2026-09-16        | R14 授权代理双 PASS @ `da79ee8774`；Completion Contract **ACCEPTED**；B1/B2 **NOT APPROVED**                       |
