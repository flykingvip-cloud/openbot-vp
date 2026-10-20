# OpenBot Diagnosis P15 Trunk Convergence

Status: **No-Go**.
P15 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true.

## Trunk

- candidateEqualsOriginMain: true
- liveIsAncestorOfCandidate: true
- liveIsAncestorOfOriginMain: true
- pullRequest: <https://github.com/gmood2008/openbot/pull/936>

## Identity consistency

- ledger: true
- RELEASE_RECORD: false
- provenance: false

## Evidence chain

| Id             | SHA                                        | Source                    | Time                     | Provable | Approver              | Blocker                                                                      |
| -------------- | ------------------------------------------ | ------------------------- | ------------------------ | -------- | --------------------- | ---------------------------------------------------------------------------- |
| candidate      | `e7c614eb54214b2f62f082c8d99dca08b8c58232` | git rev-parse HEAD        | n/a                      | true     | platform_security     | none                                                                         |
| origin_main    | `e7c614eb54214b2f62f082c8d99dca08b8c58232` | git rev-parse origin/main | n/a                      | true     | platform_security     | none                                                                         |
| live           | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` | container build-info.json | 2026-09-04T00:43:19.076Z | true     | delivery_ledger_owner | none                                                                         |
| ledger         | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` | open ledger row           | 2026-09-04T02:11:42Z     | true     | delivery_ledger_owner | none                                                                         |
| release_record | `37cc40e51f468404baf3077307e347f32f636cb1` | Latest cutover            | 2026-09-02T09:50:59Z     | true     | delivery_ledger_owner | Latest cutover 37cc40e51f46 lags LIVE 3d03d3b4df91; do not mask LIVE         |
| provenance     | `unknown`                                  | annotated provenance tag  | n/a                      | false    | delivery_ledger_owner | missing or mismatched provenance for LIVE 3d03d3b4df91; P15 must not mint it |

## Provenance remint plan

- action: do_not_mint
- proposedTag: provenance/sha-3d03d3b4df91
- published: false
- requiredApprover: delivery_ledger_owner
- reason: cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication

# OpenBot Diagnosis P12 Go/No-Go

Status: **No-Go**.
P12 ≠ 生产部署。gatesOpened=false trafficSwitched=false approvedForProductionCutover=false.

## Identities

| Field          | SHA                                        |
| -------------- | ------------------------------------------ |
| candidate      | `e7c614eb54214b2f62f082c8d99dca08b8c58232` |
| origin/main    | `e7c614eb54214b2f62f082c8d99dca08b8c58232` |
| LIVE           | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` |
| ledger open    | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` |
| RELEASE_RECORD | `37cc40e51f468404baf3077307e347f32f636cb1` |
| provenance     | `unknown`                                  |

## P5

- contractSigned: true
- liveDeliveryEnabled: false

## Checks

| Check                             | Result | Detail                                                                           |
| --------------------------------- | ------ | -------------------------------------------------------------------------------- |
| p5_contract_signed                | pass   | P5 in-process delivery contract re-verified and signed; live Da Bai still closed |
| candidate_equals_origin_main      | pass   | candidate e7c614eb5421 equals origin/main                                        |
| origin_main_ancestor_of_candidate | pass   | origin/main is an ancestor of candidate                                          |
| live_known                        | pass   | LIVE 3d03d3b4df91 resolved                                                       |
| live_ancestor_of_candidate        | pass   | LIVE is an ancestor of candidate                                                 |
| origin_main_contains_live         | pass   | origin/main contains LIVE                                                        |
| single_open_ledger_row            | pass   | ledger open row 3d03d3b4df91                                                     |
| live_equals_ledger                | pass   | LIVE equals ledger open row                                                      |
| live_equals_release_record        | fail   | LIVE 3d03d3b4df91 != RELEASE_RECORD 37cc40e51f46                                 |
| live_equals_provenance            | fail   | LIVE 3d03d3b4df91 != provenance unknown                                          |
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

- LIVE 3d03d3b4df91 != RELEASE_RECORD 37cc40e51f46
- LIVE 3d03d3b4df91 != provenance unknown

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

Recorded at 2026-09-04T05:30:31.761Z.
