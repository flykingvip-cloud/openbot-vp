# OpenBot Diagnosis P15 Trunk Convergence

Status: **No-Go**.
P15 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true.

## Trunk

- candidateEqualsOriginMain: true
- liveIsAncestorOfCandidate: true
- liveIsAncestorOfOriginMain: true
- pullRequest: <https://github.com/gmood2008/openbot/pull/919>

## Identity consistency

- ledger: true
- RELEASE_RECORD: false
- provenance: false

## Evidence chain

| Id             | SHA                                        | Source                    | Time                     | Provable | Approver              | Blocker                                                                      |
| -------------- | ------------------------------------------ | ------------------------- | ------------------------ | -------- | --------------------- | ---------------------------------------------------------------------------- |
| candidate      | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` | git rev-parse HEAD        | n/a                      | true     | platform_security     | none                                                                         |
| origin_main    | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` | git rev-parse origin/main | n/a                      | true     | platform_security     | none                                                                         |
| live           | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | container build-info.json | 2026-09-03T01:37:57.887Z | true     | delivery_ledger_owner | none                                                                         |
| ledger         | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | open ledger row           | 2026-09-03T02:52:10Z     | true     | delivery_ledger_owner | none                                                                         |
| release_record | `37cc40e51f468404baf3077307e347f32f636cb1` | Latest cutover            | 2026-09-02T09:50:59Z     | true     | delivery_ledger_owner | Latest cutover 37cc40e51f46 lags LIVE 6d9ea1f2d5da; do not mask LIVE         |
| provenance     | `unknown`                                  | annotated provenance tag  | n/a                      | false    | delivery_ledger_owner | missing or mismatched provenance for LIVE 6d9ea1f2d5da; P15 must not mint it |

## Provenance remint plan

- action: do_not_mint
- proposedTag: provenance/sha-6d9ea1f2d5da
- published: false
- requiredApprover: delivery_ledger_owner
- reason: cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication

# OpenBot Diagnosis P12 Go/No-Go

Status: **No-Go**.
P12 ≠ 生产部署。gatesOpened=false trafficSwitched=false approvedForProductionCutover=false.

## Identities

| Field          | SHA                                        |
| -------------- | ------------------------------------------ |
| candidate      | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` |
| origin/main    | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` |
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
| candidate_equals_origin_main      | pass   | candidate 0712f1a5357a equals origin/main                                        |
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

Recorded at 2026-09-03T13:08:02.890Z.
