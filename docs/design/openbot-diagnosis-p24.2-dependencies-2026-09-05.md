# P24.2 统一窗口生产依赖清单

Date: 2026-09-05

Status: **host injection for reader/audit/quota/auth. Da Bai / conversation / remediation stay unconnected until verify-live. productionWrite=false。**

| 依赖                      | authority                                                                                         | schema                                | host  | 待 verify-live | 生产写入 |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- | ----- | -------------- | -------- |
| composite_report_reader   | composite_diagnosis_projection+session_store+skill_invocation_event_store+agent_tool_observations | `diagnosis.reports@1`                 | true  | false          | false    |
| audit_persist             | $CONFIG_DIR/diagnosis-audit/                                                                      | `append_only_audit_v1`                | true  | false          | false    |
| quota_store               | injected quota backend or process-local window maps                                               | `windowed_counter/60000ms`            | true  | false          | false    |
| gateway_auth_membership   | server_membership_resolver                                                                        | `trusted_tenant_from_membership_only` | true  | false          | false    |
| daibai_delivery_transport | injected_allowlisted_transport_only                                                               | `diagnosis.daibai.delivery@1`         | false | true           | false    |
| conversation_state_store  | injected_in_process_conversation_store                                                            | `conversation_diagnosis_run@1`        | false | true           | false    |
| remediation_executor      | injected_allowlisted_executor_only                                                                | `remediation_execution@1`             | false | true           | false    |
