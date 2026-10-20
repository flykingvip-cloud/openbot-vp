# OpenBot Diagnosis P15 Trunk Convergence

Status: **No-Go**.
P15 ≠ 生产部署。gatesOpened=false approvalDoesNotOpenGate=true.

## Trunk

- candidateEqualsOriginMain: true
- liveIsAncestorOfCandidate: true
- liveIsAncestorOfOriginMain: true
- pullRequest: <https://github.com/gmood2008/openbot/pull/953>

## Identity consistency

- ledger: true
- RELEASE_RECORD: false
- provenance: false

## Evidence chain

| Id             | SHA                                        | Source                    | Time                     | Provable | Approver              | Blocker                                                                      |
| -------------- | ------------------------------------------ | ------------------------- | ------------------------ | -------- | --------------------- | ---------------------------------------------------------------------------- |
| candidate      | `65a8195278224840bfde4de850e4ce53f067d765` | git rev-parse HEAD        | n/a                      | true     | platform_security     | none                                                                         |
| origin_main    | `65a8195278224840bfde4de850e4ce53f067d765` | git rev-parse origin/main | n/a                      | true     | platform_security     | none                                                                         |
| live           | `04690f8d2ed51f24a06825c153b7c1885d17182a` | container build-info.json | 2026-09-04T13:29:54.802Z | true     | delivery_ledger_owner | none                                                                         |
| ledger         | `04690f8d2ed51f24a06825c153b7c1885d17182a` | open ledger row           | 2026-09-04T13:39:37Z     | true     | delivery_ledger_owner | none                                                                         |
| release_record | `e59aede2506dbe8c571f0019f7e1bac0687778b6` | Latest cutover            | 2026-09-04T06:53:46Z     | true     | delivery_ledger_owner | Latest cutover e59aede2506d lags LIVE 04690f8d2ed5; do not mask LIVE         |
| provenance     | `unknown`                                  | annotated provenance tag  | n/a                      | false    | delivery_ledger_owner | missing or mismatched provenance for LIVE 04690f8d2ed5; P15 must not mint it |

## Provenance remint plan

- action: do_not_mint
- proposedTag: provenance/sha-04690f8d2ed5
- published: false
- requiredApprover: delivery_ledger_owner
- reason: a cutover claimed publication but the tag is missing; remint only through the normal release path

# OpenBot Diagnosis P12 Go/No-Go

Status: **No-Go**.
P12 ≠ 生产部署。gatesOpened=false trafficSwitched=false approvedForProductionCutover=false.

## Identities

| Field          | SHA                                        |
| -------------- | ------------------------------------------ |
| candidate      | `65a8195278224840bfde4de850e4ce53f067d765` |
| origin/main    | `65a8195278224840bfde4de850e4ce53f067d765` |
| LIVE           | `04690f8d2ed51f24a06825c153b7c1885d17182a` |
| ledger open    | `04690f8d2ed51f24a06825c153b7c1885d17182a` |
| RELEASE_RECORD | `e59aede2506dbe8c571f0019f7e1bac0687778b6` |
| provenance     | `unknown`                                  |

## P5

- contractSigned: true
- liveDeliveryEnabled: false

## Checks

| Check                             | Result | Detail                                                                           |
| --------------------------------- | ------ | -------------------------------------------------------------------------------- |
| p5_contract_signed                | pass   | P5 in-process delivery contract re-verified and signed; live Da Bai still closed |
| candidate_equals_origin_main      | pass   | candidate 65a819527822 equals origin/main                                        |
| origin_main_ancestor_of_candidate | pass   | origin/main is an ancestor of candidate                                          |
| live_known                        | pass   | LIVE 04690f8d2ed5 resolved                                                       |
| live_ancestor_of_candidate        | pass   | LIVE is an ancestor of candidate                                                 |
| origin_main_contains_live         | pass   | origin/main contains LIVE                                                        |
| single_open_ledger_row            | pass   | ledger open row 04690f8d2ed5                                                     |
| live_equals_ledger                | pass   | LIVE equals ledger open row                                                      |
| live_equals_release_record        | fail   | LIVE 04690f8d2ed5 != RELEASE_RECORD e59aede2506d                                 |
| live_equals_provenance            | fail   | LIVE 04690f8d2ed5 != provenance unknown                                          |
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

- LIVE 04690f8d2ed5 != RELEASE_RECORD e59aede2506d
- LIVE 04690f8d2ed5 != provenance unknown

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

Recorded at 2026-09-04T22:33:23.897Z.
