# WP-06 — Ledger field increment (provisional shapes, no fold migration)

- 状态：**LEDGER_FIELD_INCREMENT**（类型/校验器落地；**非** schema 迁移；**非** G4-A）
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 前置：`wp06/field-mapping-adr.md`（备选切片 #2：Ledger event extension）
- 代码：
  - `src/progress-ledger/orch-lease-fields.ts` — types + parse/validate + lease-record mapper
  - `src/progress-ledger/orch-lease-fields.test.ts`
  - 对照：`src/progress-ledger/types.ts`（`ExecutionStep` / `ExecutionEvent` **未改**）
  - 对照：`src/task-orchestration/lease-store.ts`（`OrchLeaseRecord`）

## 为何选扩展模块而非直接改 `ExecutionStep` / `ExecutionEvent`

ADR 允许在 step **或** event payload 上挂 provisional 字段。直接改 `types.ts` 会牵动：

- fold / writer / invariants / evidence / admin-read 投影
- 既有单测与 schemaVersion=1 兼容假设

本切片选择 **additive extension module**（更安全、可审）：

1. 冻结字段名与校验规则，供 WP-06/WP-07 与未来迁移对照。
2. **不**改 fold；**不**从 readonly invoke 写 ledger；**不**翻转 `ORCHESTRATION_LIVE_INVOKE`。
3. 生产权威仍属「人审同意后的 ledger/task 增量」；lease-store 继续是形状+夹具。

## 字段清单（与 ADR / OrchLeaseRecord 对齐）

| provisional 字段 | 来源 | 校验要点 |
| --- | --- | --- |
| `leaseHolder` | OrchLeaseRecord.leaseHolder | string trim 非空 **或** null |
| `fencingToken` | OrchLeaseRecord.fencingToken | 非负整数 |
| `heartbeatAtMs` | OrchLeaseRecord.heartbeatAt | 非负有限数 **或** null；不得晚于 deadline |
| `deadlineAtMs` | OrchLeaseRecord.deadlineAt | 非负有限数 **或** null |
| `cancelRequested` | OrchLeaseRecord.cancelRequested | boolean |
| `attempt` | OrchLeaseRecord.attempt | 非负整数 |
| `budgetRemaining` | OrchLeaseRecord.budgetRemaining | 有限数 |
| `resultRef` | OrchLeaseRecord.resultRef | 非空 string **或** null（→ WP-01 信封/deliverable/receipt） |
| `logicalActionId` | WP-01 / readonly pilot | 非空 string（幂等键原料，见 WP-07） |

`ORCH_LEASE_FIELDS_SCHEMA_VERSION = 1` 仅标记本扩展模块合同，**不是** `PROGRESS_LEDGER_SCHEMA_VERSION` 升级。

## 明确非目标

- 不宣称 G4-A / ACCEPTED。
- 不打开 `ORCHESTRATION_LIVE_INVOKE`。
- 不把 lease-store `rootDir` JSON 当作生产权威。
- 不从 `invokeReadonlySurface` / readonly multi-step pilot 写 Progress Ledger。
- 不实施 fold / writer 迁移；不新建 orchestration DB。

## 下一步（需人审）

1. 人审本字段合同后，再决定挂 `ExecutionEvent.payload` 还是 `ExecutionStep` 可选字段。
2. 挂接生产持久面 + kill/restart 证据包后，才可进入 G4-A 验收（仍需 LIVE 决策另批）。
3. WP-07 动作幂等键与 `logicalActionId` / `resultRef` 对齐（见 `wp07/`）。

## 状态声明

- **LEDGER_FIELD_INCREMENT** only — PREP for future migration; **NOT G4-A**; **LIVE remains false**.
