# OpenBot Diagnosis P22 Independent Approval Pack

Status: **Ready for independent approval**.
P22 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true approvedForProductionCutover=false.

## Identity and evidence

- P20 hard conditions: true
- P21 hard conditions: true
- LIVE: `04690f8d2ed51f24a06825c153b7c1885d17182a` source=container
- ledger: `04690f8d2ed51f24a06825c153b7c1885d17182a` action=keep
- RELEASE_RECORD: `04690f8d2ed51f24a06825c153b7c1885d17182a` action=keep
- provenance: `04690f8d2ed51f24a06825c153b7c1885d17182a` action=keep
- aligned: true
- P21 isolated deps verified: true
- P21 faults passed: true
- P21 SLO completeness: complete

## Role approvals

- platform_security signed=false receipt=pending_human_approval
  - approve DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED after reader/audit/quota injection
  - approve DIAGNOSIS_REPORT_API_DEPLOYED without self-registering a live pack
  - co-approve Da Bai delivery allowlist and delegation guard
  - co-approve remediation executor allowlist
- enterprise_admin signed=false receipt=pending_human_approval
  - co-approve DIAGNOSIS_DAIBAI_DELIVERY_ENABLED after P5 contract + allowlist
  - co-approve DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED for tenant scope
  - confirm trusted tenant comes only from membership
- employee signed=false receipt=pending_human_approval
  - approve high-risk remediation actions that touch the granted principal
  - confirm personal-scope evidence is not widened by enterprise/platform grants
- delivery_ledger_owner signed=false receipt=pending_human_approval
  - update Latest cutover to the proven LIVE without rewriting ledger history
  - publish provenance only through the normal release path if a future cutover needs it
  - do not ask Diagnosis to mint provenance/sha-\* or hide the running SHA

## Gates (approval ≠ enable)

| Gate                                    | value | approver                                    | rollback                                 | signed |
| --------------------------------------- | ----- | ------------------------------------------- | ---------------------------------------- | ------ |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false | platform_security                           | keep_flag_false                          | false  |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false | platform_security                           | keep_flag_false_revoke_live_pack         | false  |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false | platform_security+enterprise_admin          | disable_gate_stop_delivery_keep_receipts | false  |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false | platform_security+enterprise_admin+employee | disable_gate_stop_tasks_keep_audit       | false  |

- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED preconditions: reader_injected, audit_injected, quota_injected, slo_observations_complete, independent_platform_security_approval
- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED audit: pending_human_approval
- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED evidence: p20_identity_aligned, p21_isolated_reader_audit_quota_injected, p21_fault_injection_passed, p21_isolated_slo_complete, independent_platform_security_approval
- DIAGNOSIS_REPORT_API_DEPLOYED preconditions: adapters_approved, live_pack_not_self_registered, slo_observations_complete, independent_platform_security_approval
- DIAGNOSIS_REPORT_API_DEPLOYED audit: pending_human_approval
- DIAGNOSIS_REPORT_API_DEPLOYED evidence: p20_identity_aligned, adapters_approved_but_not_enabled, live_pack_not_self_registered, p21_isolated_slo_complete, independent_platform_security_approval
- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED preconditions: p5_contract_signed, allowlisted_transport, delegation_guard_bound, slo_observations_complete, platform_security_and_enterprise_admin_approval
- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED audit: pending_human_approval
- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED evidence: p20_identity_aligned, p5_contract_signed, allowlisted_transport, delegation_guard_bound, p21_isolated_slo_complete, platform_security_and_enterprise_admin_approval
- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED preconditions: allowlisted_executor, human_approval_for_high_risk, slo_observations_complete, platform_security_enterprise_admin_and_employee_approval
- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED audit: pending_human_approval
- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED evidence: p20_identity_aligned, allowlisted_executor, human_approval_for_high_risk, p21_isolated_slo_complete, platform_security_enterprise_admin_and_employee_approval

## Signature format

- kind: `human_independent_approval_record`
- acceptsClientParam: false
- acceptsModelOutput: false
- pendingApprovers: platform_security, enterprise_admin, employee, delivery_ledger_owner

Standalone production-preflight / trunk-convergence remain empty-SLO/fail-closed. P22 Ready uses P21 isolated preprod evidence and must not be treated as live diagnosis traffic or as an opened gate.
