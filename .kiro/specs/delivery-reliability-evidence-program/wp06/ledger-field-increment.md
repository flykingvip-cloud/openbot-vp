# WP-06 — Ledger field increment (ExecutionStep first-class; payload non-authority)

- 状态：**LEDGER_FIELD_INCREMENT + EXECUTION_STEP_CANONICAL**（类型/校验器落地；**非** schema fold 迁移；**非** G4-A）
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 前置：`wp06/field-mapping-adr.md`；用户绑定：字段放 **ExecutionStep**，payload 只放扩展
- 代码：
  - `src/progress-ledger/execution-step-canonical.ts` — **canonical first-class** field set + assert/merge/compat-read
  - `src/progress-ledger/orch-lease-fields.ts` — provisional lease/fence bag（additive；与 canonical 并存）
  - 对照：`src/progress-ledger/types.ts`（既有 `ExecutionStep` fold 合同 **未破坏性迁移**）
  - 对照：`src/task-orchestration/lease-store.ts`（`OrchLeaseRecord`）

## 权威边界（冻结）

| 位置                                  | 角色                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **ExecutionStep**（canonical fields） | 一等权威：logicalActionId / attemptId / idempotencyKey / status / outcome / evidenceRefs / …                  |
| **payload**                           | 非权威：adapter req/res、provider metadata、redacted diagnostics、extensions；须带 content hash / version ref |
| **orch-lease-fields**                 | lease/fence provisional（holder、fencingToken、heartbeat…）；未来挂 Step 或经 compat 映射                     |

**Compat read** 允许在旧合同只收 payload 时从 payload 读取并映射到 canonical view；**新写入优先填充 ExecutionStep canonical fields**。禁止两处同时成为权威。

## 为何仍用扩展模块而非直接改 fold `ExecutionStep`

直接改 `types.ts` + fold 会牵动 writer / invariants / evidence / admin-read。本切片选择：

1. 冻结 canonical 字段名与校验（`execution-step-canonical.ts`）。
2. 保留 `orch-lease-fields` 作为 lease/fence bag。
3. **不**改 fold；**不**从 readonly invoke 写 ledger；**不**翻转 `ORCHESTRATION_LIVE_INVOKE`。

## Canonical 字段清单（摘要）

见 `wp06/execution-step-canonical-schema.md`。要点：

- `logicalActionId` ≠ `attemptId`；重试同键新 attempt
- `status = unknown_outcome` 用于外部结果不明（禁止 failed→auto-retry）
- `ORCH_LEASE_FIELDS_SCHEMA_VERSION = 1` / `CANONICAL_EXECUTION_STEP_SCHEMA_VERSION = 1` 均非 `PROGRESS_LEDGER_SCHEMA_VERSION` 升级

## Lease/fence provisional（orch-lease-fields）

| provisional 字段                 | 校验要点                                                    |
| -------------------------------- | ----------------------------------------------------------- |
| `leaseHolder`                    | string trim 非空 **或** null                                |
| `fencingToken`                   | 非负整数                                                    |
| `heartbeatAtMs` / `deadlineAtMs` | 非负有限数 **或** null；heartbeat 不得晚于 deadline         |
| `cancelRequested`                | boolean                                                     |
| `attempt`                        | 非负整数（lease 侧；canonical 优先 `attemptId` 字符串身份） |
| `budgetRemaining`                | 有限数                                                      |
| `resultRef`                      | 非空 string **或** null                                     |
| `logicalActionId`                | 非空 string（与 canonical 对齐原料）                        |

## 明确非目标

- 不宣称 G4-A / ACCEPTED。
- 不打开 `ORCHESTRATION_LIVE_INVOKE`。
- 不把 lease-store `rootDir` JSON 当作生产权威。
- 不从 readonly invoke / pilot 写 Progress Ledger。
- 不实施 fold / writer 迁移；不新建 orchestration DB。
- 不让 payload 成为第二隐式数据库。

## 下一步（需人审）

1. 人审后将安全 optional canonical 字段并入 `types.ts` `ExecutionStep`（仍可分阶段）。
2. 挂接生产持久面 + kill/restart 证据包后，才可进入 G4-A（仍需 LIVE 决策另批）。
3. WP-07 适配器接线与 `unknown_outcome` 对账路径。

## 状态声明

- **LEDGER_FIELD_INCREMENT + EXECUTION_STEP_CANONICAL** — schema freeze at **ExecutionStep**; payload non-authority; **NOT G4-A**; **LIVE remains false**.
