# A/B Contract Ownership

Track B does **not** redefine `StructuralEvolutionCandidate`.

## Track A owns

| Contract                                      | Path                                                                                               | Status                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `StructuralEvolutionCandidate`                | `src/diagnosis/structural-evolution-candidate.ts`                                                  | Consumed from `origin/main` `3a01fe0963`. Producer freeze `a4368cfade`. `schemaVersion=1`          |
| `SkillInstallationCandidate`                  | `src/diagnosis/skill-installation-candidate.ts`                                                    | Consumed from PR #1204 `07b73ad3e2` (`install_existing_skill` only). Not copied. `schemaVersion=1` |
| DTO `schemaVersion`                           | same modules                                                                                       | `1`                                                                                                |
| DTO export path                               | `src/diagnosis/structural-evolution-candidate.ts`, `src/diagnosis/skill-installation-candidate.ts` | frozen; B type-imports only                                                                        |
| `GrowthAssessmentSnapshot` reader / validator | `src/diagnosis/diagnose-growth-snapshot.ts`                                                        | `readGrowthAssessmentSnapshot` / `validateGrowthAssessmentSnapshot`                                |
| Professional report / Finding prose           | `src/diagnosis/**`                                                                                 | A only                                                                                             |
| `DiagnosisRecheckPort` **implementation**     | `src/diagnosis/diagnose-evolution-recheck.ts`                                                      | A4 `#1217` `b20c28825c` on `origin/main`                                                           |
| WDNA / Skill **observer**                     | `src/gateway/evolution-control/diagnosis-recheck-observer.ts`                                      | B reads live SoT; does not copy A DTOs                                                             |

Do not consume `c7d7aa54f2` or `bb97b44ce6` as a frozen DTO.
Legal `reportingCadence` values: `on_completion | milestone | periodic | on_request`.

## Track B owns

| Contract                                                         | Path                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `EvolutionSubmissionRef`                                         | `packages/evolution-core/src/evaluation-refs.ts`              |
| `EvolutionVerificationRef`                                       | `packages/evolution-core/src/evaluation-refs.ts`              |
| `DiagnosisRecheckRequest` / `Result` / `Port` interface          | `packages/evolution-core/src/diagnosis-recheck.ts`            |
| `EvaluationPolicy`                                               | `packages/evolution-core/src/evaluation-policy.ts`            |
| Type-only ingest port `DiagnosisCandidateIngestPort<TCandidate>` | `packages/evolution-core/src/diagnosis-candidate-port.ts`     |
| E1 WAL state machine                                             | `packages/evolution-core/src/diagnosis-ingest-wal.ts`         |
| Preview (zero write)                                             | `src/gateway/evolution-control/diagnosis-ingest.ts`           |
| `submitDiagnosisCandidate`                                       | `src/gateway/evolution-control/submit-diagnosis-candidate.ts` |

## Frozen field lists

`EvolutionSubmissionRef`: `commandId`, `proposalId`, `candidateRef`, `surfaceId`, `contentHash`.
Forbidden: `recoveryState`, mutable `status`.

`EvolutionVerificationRef`: `proposalId`, `experimentId`, `applicationId`, `verificationId`, optional `rollbackRef`, optional `externalEffectRef`.

`DiagnosisRecheckRequest`: verification ref, target, non-empty finding refs, surface, tenant.
`DiagnosisRecheckResult`: same binding plus outcome, reasonCode, non-empty `observedEvidenceRefs`.
Finding refs compare as a sorted unique set. Order and duplicates do not change the set. Missing or extra findings fail.
Forbidden: report prose, Evidence payload, domain object bodies.

`evolution-core` must not import `src/diagnosis`. Gateway type-imports `src/diagnosis/structural-evolution-candidate.ts` and `src/diagnosis/skill-installation-candidate.ts` and does not copy those DTOs.
