# OpenBot Diagnosis P14 Independent Approval Freeze

Status: **No-Go**.
P14 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true.

## Proven LIVE and ledger repair

- LIVE: `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` source=container
- ledger: `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` action=keep
- RELEASE_RECORD: `37cc40e51f468404baf3077307e347f32f636cb1` action=defer_to_delivery_owner
- provenance: `unknown` action=do_not_mint
- aligned: false
- ledgerMutated: false
- releaseRecordMutated: false
- provenanceMinted: false
- blocker: RELEASE_RECORD 37cc40e51f46 lags LIVE 6d9ea1f2d5da; diagnosis must not mask LIVE on a feature branch
- blocker: missing provenance/sha-6d9ea1f2d5da; P14 must not mint it
- evidence gap: delivery_ledger_owner must land Latest cutover on trunk after proving the same LIVE
- evidence gap: cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication

## Frozen dependencies

- composite_report_reader: composite_diagnosis_projection+session_store+skill_invocation_event_store+agent_tool_observations schema=diagnosis.reports@1 timeout=3000ms fail_closed_unavailable
- audit_persist: $CONFIG_DIR/diagnosis-audit/ schema=append_only_audit_v1 timeout=2000ms fail_closed_missing_audit
- quota_store: injected quota backend or process-local window maps schema=windowed_counter/60000ms timeout=1000ms fail_closed_503
- gateway_auth_membership: server_membership_resolver schema=trusted_tenant_from_membership_only timeout=2000ms fail_closed_unauthenticated
- daibai_delivery_transport: injected_allowlisted_transport_only schema=diagnosis.daibai.delivery@1 timeout=5000ms reject_not_pending_then_queue_or_expire
- conversation_state_store: injected_in_process_conversation_store schema=conversation_diagnosis_run@1 timeout=2000ms pause_in_WAITING_AUTHORIZATION
- remediation_executor: injected_allowlisted_executor_only schema=remediation_execution@1 timeout=5000ms unavailable_appliedToRuntime_false
- injection: serverConfigOnly clientEnableForbidden implicitEnableForbidden

## SLO freeze

- completeness: complete
- observed: success, error, latency, stale, authorization_denied, quota_exhausted
- health: not_ready

## Role approvals

- platform_security
  - approve DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED after reader/audit/quota injection
  - approve DIAGNOSIS_REPORT_API_DEPLOYED without self-registering a live pack
  - co-approve Da Bai delivery allowlist and delegation guard
  - co-approve remediation executor allowlist
- enterprise_admin
  - co-approve DIAGNOSIS_DAIBAI_DELIVERY_ENABLED after P5 contract + allowlist
  - co-approve DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED for tenant scope
  - confirm trusted tenant comes only from membership
- employee
  - approve high-risk remediation actions that touch the granted principal
  - confirm personal-scope evidence is not widened by enterprise/platform grants
- delivery_ledger_owner
  - update Latest cutover to the proven LIVE without rewriting ledger history
  - publish provenance only through the normal release path if a future cutover needs it
  - do not ask Diagnosis to mint provenance/sha-\* or hide the running SHA

## Gates (approval ≠ enable)

- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED value=false approver=platform_security rollback=keep_flag_false
- DIAGNOSIS_REPORT_API_DEPLOYED value=false approver=platform_security rollback=keep_flag_false_revoke_live_pack
- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED value=false approver=platform_security+enterprise_admin rollback=disable_gate_stop_delivery_keep_receipts
- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED value=false approver=platform_security+enterprise_admin+employee rollback=disable_gate_stop_tasks_keep_audit

# OpenBot Diagnosis P12 Go/No-Go

Status: **No-Go**.
P12 ≠ 生产部署。gatesOpened=false trafficSwitched=false approvedForProductionCutover=false.

## Identities

| Field          | SHA                                        |
| -------------- | ------------------------------------------ |
| candidate      | `3a413e616c44aa20a4114408b855b409cfd80ea5` |
| origin/main    | `769da88d21a4ade2ed598ece481b1a31d75e3138` |
| LIVE           | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` |
| ledger open    | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` |
| RELEASE_RECORD | `37cc40e51f468404baf3077307e347f32f636cb1` |
| provenance     | `unknown`                                  |

## P5

- contractSigned: true
- liveDeliveryEnabled: false

## Checks

| Check                             | Result | Detail                                                                           |
| --------------------------------- | ------ | -------------------------------------------------------------------------------- |
| p5_contract_signed                | pass   | P5 in-process delivery contract re-verified and signed; live Da Bai still closed |
| candidate_equals_origin_main      | fail   | candidate 3a413e616c44 != origin/main 769da88d21a4                               |
| origin_main_ancestor_of_candidate | pass   | origin/main is an ancestor of candidate                                          |
| live_known                        | pass   | LIVE 6d9ea1f2d5da resolved                                                       |
| live_ancestor_of_candidate        | pass   | LIVE is an ancestor of candidate                                                 |
| origin_main_contains_live         | pass   | origin/main contains LIVE                                                        |
| single_open_ledger_row            | pass   | ledger open row 6d9ea1f2d5da                                                     |
| live_equals_ledger                | pass   | LIVE equals ledger open row                                                      |
| live_equals_release_record        | fail   | LIVE 6d9ea1f2d5da != RELEASE_RECORD 37cc40e51f46                                 |
| live_equals_provenance            | fail   | LIVE 6d9ea1f2d5da != provenance unknown                                          |
| gates_closed                      | pass   | all diagnosis production gates remain false                                      |
| live_pack_unregistered            | pass   | diagnosis-reports is not registered                                              |
| core_handlers_clean               | pass   | coreGatewayHandlers has no diagnosis methods                                     |
| slo_observations_complete         | pass   | SLO observations are complete                                                    |
| reader_available                  | pass   | Composite Report reader is available                                             |
| audit_available                   | pass   | audit persist is available                                                       |
| quota_available                   | pass   | quota store is available                                                         |
| implicit_enable_forbidden         | pass   | implicit enable and client-param enable remain forbidden                         |

## Observability

- SLO healthy: true
- rendered health: not_ready
- completeness: complete
- missing metrics must not render as 正常

## Blocking reasons

- candidate 3a413e616c44 != origin/main 769da88d21a4
- LIVE 6d9ea1f2d5da != RELEASE_RECORD 37cc40e51f46
- LIVE 6d9ea1f2d5da != provenance unknown

## Pending human approvals

- production_backend_config
- live_gateway_pack_registration
- daibai_delivery_allowlist
- remediation_executor_allowlist
- internal_single_tenant_canary
- production_build
- restart
- canary_and_traffic_switch
- p12_release_record_ledger_live_reconcile
- p12_slo_observations
- p12_production_dependency_injection

Recorded at 2026-09-03T07:35:50.135Z.
