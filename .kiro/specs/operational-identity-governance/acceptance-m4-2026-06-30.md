# M4 Acceptance Audit: Enterprise Operational Identity

Date: 2026-06-30
Session: `019f12e0-ddf4-7751-9ab4-ab663e8c36ed`
Agent: `codex-oig`

## Verdict

Status: not yet accept-ready.

## Reason

In `docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`,
`M4` is defined as:

- `Next`
- `审批深化、更多企业系统、统一治理分析`

Unlike `M1` through `M3`, the document does not provide:

- a task breakdown,
- concrete file targets,
- QA rows,
- or milestone-specific acceptance criteria

for `M4`.

This means there is no stable, implementation-backed acceptance contract to execute against yet.

## What Is Present Today

The current codebase still reflects the `M1` to `M3` scope:

- enterprise identity directory / policy / audit
- Agent and DataSource linkage
- second-batch provider adapters and action boundaries

The exposed enterprise operational identity RPC surface is still limited to:

- access resolution/listing
- employee authorize/revoke/enrollment
- relationship summary
- bindings list
- providers catalog

No separate implementation surface was found for the three `M4` themes:

1. approval deepening for enterprise operational identity usage,
2. broader enterprise-system rollout beyond the current provider set,
3. unified governance analysis as a new milestone deliverable distinct from existing summaries.

## Acceptance Blocking Gaps

Before `M4` can be meaningfully accepted, the spec needs to define at least:

1. exact scope and non-scope for approval workflow expansion,
2. the additional enterprise systems/providers included in M4,
3. the shape of "unified governance analysis" read models and UI surfaces,
4. explicit QA rows and milestone acceptance criteria,
5. the expected audit additions, if any.

## Notes

- This is a scope/contract blocker, not a code-quality blocker.
- A targeted Vitest rerun attempt was aborted after `pnpm` tried to reinstall dependencies and hit restricted-network registry resolution. That did not affect the conclusion above, because the blocker is the absence of an M4 acceptance contract in the design doc itself.
