# Collab — align submit/accept RPC schema with S3 versioning

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | Code ready; **flags unchanged (default OFF)** |
| Depends | #737 S3 submit-review-versioning (entry + claim-contract) |
| Code | `src/gateway/protocol/schema/collaboration.ts`, schema unit test |

## Why

Tip gray retest (数字人战队 2 万字) found gateway RPC AJV schema lagging S3 entry:

- `collaboration.task.submitForReview` rejected `artifactVersion` (`unexpected property`)
- `collaboration.task.acceptSubmission` accepted bare ids only — missing `expectedSubmissionId` / `reason` / `checkedAcceptanceCriteria`
- Operators had to bypass gateway with `tsx` direct `claim-contract-entry` calls

Entry (`claim-contract-entry.ts`) and claim-contract already require S3 fields; this PR only aligns the RPC TypeBox/AJV params schemas so Control UI / gateway call can pass them.

## Behavior

| Method | Required S3 fields after align |
| --- | --- |
| `submitForReview` | `submissionId`, `artifactVersion` (+ optional `submissionSummary`) |
| `acceptSubmission` | `expectedSubmissionId`, `reason`, `checkedAcceptanceCriteria` (+ optional `proxyForActorId`, `proxyBasis`) |
| `returnSubmission` | `reason`, `expectedSubmissionId` |

`additionalProperties: false` retained. Business rules (version match, criteria coverage, proxy basis) stay in claim-contract / entry — schema only admits the fields.

## Flags (unchanged)

- No claim / wake / challenge / heartbeat / selfAdvance flips
- No LIVE / Floor / Production Auto Failover

## Acceptance

- Vitest: RPC schema accepts S3 field shapes used by tip retest; rejects pre-align bare accept and missing `artifactVersion`
- Existing S3 claim-contract suites unchanged
- LIVE_touched = false

## Out of scope

Entry/business logic changes, flag defaults, gray allowlist edits, Floor live.
