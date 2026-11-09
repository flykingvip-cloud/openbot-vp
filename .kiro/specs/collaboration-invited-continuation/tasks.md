# Invited participation and current-round context

## Agents

- codex-collab-runtime · role: owner · scope: invited continuation and public context snapshot · paths: src/gateway/collaboration-dispatch/round-runtime.ts, src/gateway/collaboration-dispatch/round-runtime.test.ts, src/gateway/collaboration-dispatch/supplement-denial-diagnosis.ts, src/gateway/collaboration-dispatch/supplement-denial-diagnosis.test.ts, src/gateway/collaboration-dispatch/same-round-context.ts, src/gateway/collaboration-dispatch/same-round-context.test.ts, .kiro/specs/collaboration-invited-continuation/tasks.md · since: 2026-11-09

## Baseline and takeover

Fresh origin/main ea7149373; detached checkout advanced from e847e6481. Target files were clean before work. Reviewed current runtime and predecessor tests; exact-path landing designation preserves broad predecessor claims. Registry changes await its designated owner for landing.

## Implementation

- [x] Preserve already invited supplement members after a settled late primary; optional and model-generated invitations remain closed after the deadline. Keep supplement enablement, visible/cheap gates and abort. — codex-collab-runtime
- [x] Pass prior completed public reply bodies instead of only 180-character summaries. Do not pass raw runtime directives. — codex-collab-runtime
- [x] Copy current-round reply records so later array mutations cannot rewrite dispatched context. — codex-collab-runtime
- [x] Regression: late invited member, abort, visible limit, optional member, tail qualification, immutable snapshot. — codex-collab-runtime

## Scope and remaining acceptance

No configuration or production deployment. No RCIS input to admission, no Floor cutover, no new scheduler or task responsibility changes. Existing per-turn execution gates remain authoritative.
Remaining: default proactive participation policy (requires explicit compiler migration), explicit_multi late-primary queue semantics, user interjection/history refresh, context token-budget verification, per-supplement timeout and durable restart continuation. Full LIVE group behavior is not accepted by these local tests.

## Verification

Scoped runtime/context/prompt/diagnosis/orchestration/rollcall: 67 passing tests (6 files). Initial context regressions: 2 failures before fix. Restoring baseline round-runtime with the new regression reproduces invited continuation failure (1 failed, 3 passed). Final TypeScript check and scoped lint passed. Full pnpm check stops at pre-existing formatting failures and invalid JSON5 under the unrelated nested checkout; no unrelated files repaired. — codex-collab-runtime
