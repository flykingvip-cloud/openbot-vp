# Executor and observation deployment handoff

Owner: codex-observe-owner. Status: local integration candidate, not production approved.

## Source identity

Latest-main base: b20db5861958748d2fa759ec618c61a2e283c88c. Committed executor source: c8a710cd2ec1c06da30f75fd78113a206ba1ea85. Integration preserves both histories; original working tree WIP is excluded. Final delivery SHA must be read from git after commits, never inferred from build timestamps.

## Local evidence

- TypeScript check passed after phase-state typing and split-boundary corrections.
- Owner rerun: five backend suites, 36 passed, including failure usage, candidate terminal state and recovery imports.
- Owner rerun: four Chromium suites, 36 passed, platform/enterprise observation and workbench. These use simulated RPC, not production membership authentication.
- Contributor phase regression: five suites, 38 passed. Contributor semantic regression: six suites, 49 passed. Counts overlap; do not sum.
- Failed-before evidence: four error-return cases previously produced completed; prompt-error usage handoff and failed-call evidence each failed before correction.

## Behavior

Failed usage is transferred by trusted in-process identity binding; aggregate usage is explicitly provider_aggregate_internal_retries_unknown. Candidate technical status is independent of TaskOutcome judgement. Existing stream remains execution_only. Platform explicit version inputs do not grant cross-tenant access. Unknown cost/source/history remain unknown.

## Deployment prerequisites and stop conditions

This is not an instruction to deploy a side branch. Fetch main, deliver via reviewed PR, and rebuild the fresh main tip from a clean tree. Read actual LIVE from running container build-info; require forward-only and LIVE anchoring, provenance identity, delivery alignment, gateway/UI source continuity, and retained rollback image/config. Never hot-copy dist.

Paid provider invocation, enabling observation flags, existing gateway restart, same-candidate real end-to-end and production authentication verification remain unperformed. User authorization exists, but these must be executed and recorded before claiming runtime acceptance. Local running gateway was previously identified as a different checkout; verify its actual entry and build identity before changing it.

Relevant flags: OPENBOT_EXECUTOR_EVIDENCE, OPENBOT_EXECUTION_ROUTER_OBSERVATION, OPENBOT_EXECUTION_JOURNAL, OPENBOT_OBSERVATION_REASONING. Verify supported environment injection and readback; enabling is not proof of linkage. No automatic improvement authorization is inferred.

Do not rewrite historical outcomes to fabricate missing provenance or execution evidence. Prior local read-only acceptance read 223 outcomes as outcome_only; zero executor associations existed then.

## Rollback

Before cutover preserve actual image digest, config, runtime entry and flag values. Follow release forward-only rules; any intentional revert requires explicit operator decision. Code revert does not erase durable evidence.

No push, PR, merge to main or production deployment has been performed by this handoff. — codex-observe-owner
