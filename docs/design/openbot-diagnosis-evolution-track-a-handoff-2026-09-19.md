# Track A → Track B Handoff — Diagnosis Producer Contract

Date: 2026-09-19
Task: `openbot-diagnosis-evolution-integration`
Agent: `cursor-grok`

Track B must import these contracts. Do not copy the DTO into `evolution-control`.

## Contract paths

| Contract                     | Path                                              | Exports                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| StructuralEvolutionCandidate | `src/diagnosis/structural-evolution-candidate.ts` | `StructuralEvolutionCandidate`, `StructuralProposedChange`, `StructuralReportingCadence`, `validateStructuralEvolutionCandidate`, `buildStructuralEvolutionCandidate`, `workingStyleDeltaFromProposedChange`     |
| SkillInstallationCandidate   | `src/diagnosis/skill-installation-candidate.ts`   | `SkillInstallationCandidate`, `SkillInstallationProposedChange`, `validateSkillInstallationCandidate`, `buildSkillInstallationCandidate`, `skillInstallDeltaFromProposedChange`, `skillInstallationBaselineHash` |
| DiagnosisRecheckPort         | `src/diagnosis/diagnose-evolution-recheck.ts`     | `createDiagnosisRecheckPort`, `DIAGNOSIS_RECHECK_SURFACES`, observer injected; diagnosis does not import evolution-control                                                                                       |
| Barrel                       | `src/diagnosis/index.ts`                          | same public names                                                                                                                                                                                                |
| GrowthAssessmentSnapshot     | `src/diagnosis/diagnose-growth-snapshot.ts`       | `GrowthAssessmentSnapshot`, `readGrowthAssessmentSnapshot`, `validateGrowthAssessmentSnapshot`                                                                                                                   |

`schemaVersion = 1` for all three:

- `STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION`
- `SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION`
- `GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION`

## Working DNA proposedChange

```text
proposedChange = {
  field: "reportingCadence",
  value: "on_completion" | "milestone" | "periodic" | "on_request"
}
```

These are `WorkingStyle.reportingCadence` values. Track B may construct:

```ts
const delta = { reportingCadence: candidate.proposedChange.value };
// or
const delta = workingStyleDeltaFromProposedChange(candidate.proposedChange);
```

Forbidden Cron/prescription values: `daily`, `weekday_daily`, `weekly`.

## Skill installation proposedChange

```text
proposedChange = {
  field: "skillId",
  operation: "install",
  skillId: "<existing skill id>"
}
```

Track B may construct:

```ts
const delta = skillInstallDeltaFromProposedChange(candidate.proposedChange);
// { skillId, operation: "install" }
```

Surface must be `capability.skill-installation`. Forbidden this period: `capability.skill-spec`, unused-skill observations, missing skillId, already-installed baseline, Path A `learn_capability`.

## candidateVersion

Hash only:

- `schemaVersion`
- `structuralIntent`
- `proposedChange`
- `mechanismRef`
- `surfaceId`
- `targetHint`
- `baselineHash`

Provenance must not enter `candidateVersion`:

- `evidenceRefs`
- `snapshotRef`
- `reportRef`
- `findingRef`
- `observedWindow`

`cooldownKey` hashes `intent + proposedChange + targetHint + surfaceId`. It does not include the observation window.

## Current period limits

- Surfaces: `agent.working-dna` and `capability.skill-installation`.
- Diagnose emits and persists preview DTOs only. Confirm-submit is Gateway `evolution.diagnosis.submit`.
- Live status is Gateway `evolution.diagnosis.status` (operator.read) plus diagnose-report overlay. Both call `getProposal` / `getExperiment` ports; they do not copy status onto `EvolutionSubmissionRef`.
- 大白 shows `申请开实验`. Creating an experiment stays `evolution.experiments.create` and requires `operator.approvals`.
- Clients cannot send a `candidate` payload. Server loads the preview by `candidateVersion`.
- `src/diagnosis` does not import `gateway/evolution-control` and does not call `submitDiagnosisCandidate`.
- Path A confirm gray gate stays closed (`DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED=false`).
- Recheck surfaces this period: `agent.working-dna` and `capability.skill-installation`. Empty skillId → `BLOCKED`/`unknown_target`. `capability.skill-spec` → `BLOCKED`/`unsupported_surface`. Unchanged live hash vs baseline → `STILL_OPEN`/`sot_unchanged`. Live skill baseline is `skillInstallationBaselineHash(skillId, installed)`.
- Recheck binding: `EvolutionVerificationRef` must carry proposalId/experimentId/applicationId/verificationId; request/result target keys must match; findingRefs compare as a sorted unique set; trusted tenant mismatch → `BLOCKED`; `observedEvidenceRefs` is a non-empty reference list. Report prose / Evidence payload is rejected.
- Working DNA SoT is `working-style-store`. RESOLVED requires observed hash == Application `targetVersionAfter` and a readable effect window. Store unchanged → `STILL_OPEN`. Unreadable / timeout → `INCONCLUSIVE`.
- Skill SoT is Skill Lifecycle. RESOLVED requires the target agent relation, version, and enabled bit. Missing relation / wrong version / disabled → `STILL_OPEN`. Fake control-plane VERIFIED with an unchanged store must not RESOLVE.
- Live confirm supplies `readSkillTarget`. Diagnose never auto-submits, starts experiments, or Applies. A does not decide Promote/Hold/Rollback.

## Snapshot reader

```ts
readGrowthAssessmentSnapshot({ tenantId, snapshotId, configDir, nowMs? })
validateGrowthAssessmentSnapshot(input)
```

Reader checks hash, tenant, ISO `createdAt`/`expiresAt`, `createdAt < expiresAt`, TTL ≤ 7 days, symlink, and path traversal.

## Contract commit SHA

A0.2 on trunk: `a4368cfade` (#1202).
A1 Preview + skill DTO on trunk: `83bb072cb7` (#1204).
B ingest on trunk: `28ff3afef3` (#1206).
A2 confirm-submit on trunk: `d9f0b6eeb8` (#1211).
A3 live status projection on trunk: `f0c9e64248` (#1213).
A4 DiagnosisRecheckPort on trunk: `b20c28825c` (#1217). A4 close rebases onto `643dcd6a4f`.

The contract is the file + `schemaVersion=1`, not the branch name.

## Track B still owns

- `submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })`
- WAL / recovery
- `src/gateway/evolution-control/diagnosis-ingest.ts`
- Authority Gate
- Evaluation / Recheck Registry
