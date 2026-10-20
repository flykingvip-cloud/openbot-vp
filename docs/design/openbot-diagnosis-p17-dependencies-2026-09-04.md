# P17 生产依赖证据清单

Date: 2026-09-04

Status: **reader / audit persist / quota 不可用，fail-closed。未新建 Report DB、Skill Health DB 或平行事实源。**

Authority 合同来自 `src/diagnosis/production-preflight.ts` 与 `PRODUCTION_ADAPTER_STORAGE`。可用性来自当前树 standalone preflight（`readerAvailable/auditAvailable/quotaAvailable=false`）。

---

| 依赖                      | authority of record                                                                          | schema / version                      | 租户边界                 | 超时   | 故障行为                                                 | 可用性                   |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------ | ------ | -------------------------------------------------------- | ------------------------ |
| composite report reader   | existing CompositeDiagnosis projection + session/skill/agent/tool stores；**不是** Report DB | `diagnosis.reports@1`                 | `server_membership_only` | 3000ms | fail_closed_unavailable；do_not_render_as_healthy        | **不可用**               |
| audit persist             | `$CONFIG_DIR/diagnosis-audit/`                                                               | `append_only_audit_v1`                | `server_membership_only` | 2000ms | fail_closed_missing_audit；block_write_keep_history      | **不可用**               |
| quota store               | injected quota backend or process-local window maps                                          | `windowed_counter/60000ms`            | `server_membership_only` | 1000ms | fail_closed_503；deny_new_query                          | **不可用**               |
| gateway auth / membership | `server_membership_resolver`                                                                 | `trusted_tenant_from_membership_only` | `server_membership_only` | 2000ms | fail_closed_unauthenticated；reject_client_tenant_claims | 合同在；生产注入 pending |
| Da Bai transport          | injected allowlisted transport only                                                          | `diagnosis.daibai.delivery@1`         | `server_membership_only` | 5000ms | reject_not_pending_then_queue_or_expire                  | **未接通**               |
| conversation store        | injected in-process conversation store                                                       | `conversation_diagnosis_run@1`        | `server_membership_only` | 2000ms | pause_in_WAITING_AUTHORIZATION；no_live_chat_bind        | **无 live chat bind**    |
| remediation executor      | injected allowlisted executor only                                                           | `remediation_execution@1`             | `server_membership_only` | 5000ms | unavailable_appliedToRuntime_false；dry_run_only         | **dry-run only**         |

Stub 或未注入时必须 fail-closed。本清单不把 rehearsal 注入渲染成可用。
