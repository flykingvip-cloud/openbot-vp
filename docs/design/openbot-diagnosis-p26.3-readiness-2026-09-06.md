# OpenBot Diagnosis Platform — P26.3 hold record

Date: 2026-09-06

Status: **Cutover hold No-Go**

## Identity (exact match required)

- candidate/origin-main: `91d4247ee21604f60b37fb1de3cc30209443ef76`
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`
- historical P26.2 candidate: `040e714cfc1266cb9becaa2b42a159dd503a9b89` invalidated
- ancestor image published: true
- ancestor image forbidden as candidate: true
- merged PRs: #988, #989, #990, #992, #993
- forwardOnly: true
- ghcrImageAvailable: false
- deliveryMayStage: false
- nextOfficialStep: delivery_wait_ghcr_then_cutover
- furtherDiagnosisResignBlocked: true
- p26ProductionReady: false
- cutoverOwner: delivery

## Isolated acceptance

- chainHeld: true
- probesPassed: true

## Blockers

- live_not_equal_candidate
- production_slo_empty
- live_executor_undeployed
- live_cutover_pending
- production_ready_not_separately_approved
- historical_p26_2_invalidated
- ancestor_image_not_candidate
- further_diagnosis_resign_blocked
- ghcr_image_unproven

P26.3 cutover hold recorded as No-Go. Isolated chain still holds. Do not stage the 040e714c image. Do not treat this as Production Ready.
