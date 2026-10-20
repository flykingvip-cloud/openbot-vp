# Track I / M2 — InterventionCase 干预台基础

- 日期：2026-10-14
- 仓库：upbeyond/openbot
- 产品方案（共享盒，不在 git）：`/workspace/diagnosis-loop-closure/PRODUCT_LOOP_PLAN.md` Track I §4 / M2
- 验收包：`/workspace/track-i-m2/ACCEPTANCE_PACK.md`
- 硬约束：`/workspace/diagnosis-loop-closure/TRACK_I_M2_CONSTRAINTS.md`

## Done checklist

- [x] InterventionCase 模型 + 状态机 + 非法迁移测试（含 parent 禁止 dispatching、verified 预留）
- [x] next-actions → Case；组先 `expandDiagnoseGroupMembers`（Track D）再 1:1 dispatch children
- [x] Track D `dataPlaneCases`（含 `locator_failed`）→ `status: "suggested"`，字段名不改
- [x] 大白 canary 接线：gate_closed → stewardReceipt + `daibaiReceipt.skipReason=gate_closed`；不 live send
- [x] RPC：`diagnosis.intervention.{list,get,dispatch,expand}`
- [x] `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` / `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` 保持默认 false
- [x] 不碰 A confirm / B submit / Adapter Apply

## 状态同义词（PRODUCT_LOOP）

| PRODUCT_LOOP | InterventionCase |
| --- | --- |
| authorized | queued |
| acknowledged | receipted |
| verified | 预留；M2 不实现迁移（receipted ≠ 再诊断闭合） |

## 组派发

- parent `group_parent` 永不 dispatch
- 仅 `member_1to1` / `agent_1to1`
- space sessionKey 继续硬拒 `group_not_1to1`（复用 diagnose-action-dispatch）

## Track D 依赖

本 PR 纳入与 #703 相同的 `diagnose-group-member-expand` / `diagnose-data-plane-cases` 合同文件，避免 vs main 无法编译；**禁止第二套成员表**。若 #703 先合，rebase 去重即可。

## 闸门开启（人工，非本 PR）

见 ACCEPTANCE_PACK §4.3 — 不得在本里程碑翻转生产闸门。
