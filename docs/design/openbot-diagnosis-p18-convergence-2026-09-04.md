# OpenBot Diagnosis P15 Trunk Convergence

Status: **No-Go**.
P15 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true.

## Trunk

- candidateEqualsOriginMain: true
- liveIsAncestorOfCandidate: true
- liveIsAncestorOfOriginMain: true
- pullRequest: <https://github.com/gmood2008/openbot/pull/943>

## Identity consistency

- ledger: false
- RELEASE_RECORD: false
- provenance: false

## Evidence chain

| Id             | SHA                                        | Source                    | Time                     | Provable | Approver              | Blocker                                                                      |
| -------------- | ------------------------------------------ | ------------------------- | ------------------------ | -------- | --------------------- | ---------------------------------------------------------------------------- |
| candidate      | `330d92207478850800284b39c5f89852d77ca324` | git rev-parse HEAD        | n/a                      | true     | platform_security     | none                                                                         |
| origin_main    | `330d92207478850800284b39c5f89852d77ca324` | git rev-parse origin/main | n/a                      | true     | platform_security     | none                                                                         |
| live           | `e59aede2506dbe8c571f0019f7e1bac0687778b6` | container build-info.json | 2026-09-04T06:19:02.441Z | true     | delivery_ledger_owner | none                                                                         |
| ledger         | `457057ba2adbdb6958fe092d211f75108d866f42` | open ledger row           | 2026-09-04T05:55:49Z     | true     | delivery_ledger_owner | ledger 457057ba2adb != LIVE e59aede2506d; do not rewrite history             |
| release_record | `37cc40e51f468404baf3077307e347f32f636cb1` | Latest cutover            | 2026-09-02T09:50:59Z     | true     | delivery_ledger_owner | Latest cutover 37cc40e51f46 lags LIVE e59aede2506d; do not mask LIVE         |
| provenance     | `unknown`                                  | annotated provenance tag  | n/a                      | false    | delivery_ledger_owner | missing or mismatched provenance for LIVE e59aede2506d; P15 must not mint it |

## Provenance remint plan

- action: do_not_mint
- proposedTag: provenance/sha-e59aede2506d
- published: false
- requiredApprover: delivery_ledger_owner
- reason: cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication

# OpenBot Diagnosis P12 Go/No-Go

Status: **No-Go**.
P12 ≠ 生产部署。gatesOpened=false trafficSwitched=false approvedForProductionCutover=false.

## Identities

| Field          | SHA                                        |
| -------------- | ------------------------------------------ |
| candidate      | `330d92207478850800284b39c5f89852d77ca324` |
| origin/main    | `330d92207478850800284b39c5f89852d77ca324` |
| LIVE           | `e59aede2506dbe8c571f0019f7e1bac0687778b6` |
| ledger open    | `457057ba2adbdb6958fe092d211f75108d866f42` |
| RELEASE_RECORD | `37cc40e51f468404baf3077307e347f32f636cb1` |
| provenance     | `unknown`                                  |

## P5

- contractSigned: true
- liveDeliveryEnabled: false

## Checks

| Check                             | Result | Detail                                                                           |
| --------------------------------- | ------ | -------------------------------------------------------------------------------- |
| p5_contract_signed                | pass   | P5 in-process delivery contract re-verified and signed; live Da Bai still closed |
| candidate_equals_origin_main      | pass   | candidate 330d92207478 equals origin/main                                        |
| origin_main_ancestor_of_candidate | pass   | origin/main is an ancestor of candidate                                          |
| live_known                        | pass   | LIVE e59aede2506d resolved                                                       |
| live_ancestor_of_candidate        | pass   | LIVE is an ancestor of candidate                                                 |
| origin_main_contains_live         | pass   | origin/main contains LIVE                                                        |
| single_open_ledger_row            | pass   | ledger open row 457057ba2adb                                                     |
| live_equals_ledger                | fail   | LIVE e59aede2506d != ledger 457057ba2adb                                         |
| live_equals_release_record        | fail   | LIVE e59aede2506d != RELEASE_RECORD 37cc40e51f46                                 |
| live_equals_provenance            | fail   | LIVE e59aede2506d != provenance unknown                                          |
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

- LIVE e59aede2506d != ledger 457057ba2adb
- LIVE e59aede2506d != RELEASE_RECORD 37cc40e51f46
- LIVE e59aede2506d != provenance unknown

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

Recorded at 2026-09-04T06:59:36.605Z.
