# Invited participation and current-round context

## Agents

- codex-collab-runtime · role: owner · scope: bounded participation, member context and interrupted recovery · paths: src/gateway/collaboration-dispatch/round-runtime.ts, src/gateway/collaboration-dispatch/round-runtime.test.ts, src/gateway/collaboration-dispatch/supplement-denial-diagnosis.ts, src/gateway/collaboration-dispatch/supplement-denial-diagnosis.test.ts, src/gateway/collaboration-dispatch/same-round-context.ts, src/gateway/collaboration-dispatch/same-round-context.test.ts, .kiro/specs/collaboration-invited-continuation/tasks.md, src/gateway/collaboration-dispatch/round-orchestrator.ts, src/gateway/collaboration-dispatch/round-orchestrator.test.ts, src/gateway/server-methods/chat.ts, src/gateway/collaboration-dispatch/group-inbound-history.ts, src/gateway/collaboration-dispatch/group-inbound-history.test.ts, src/gateway/collaboration-dispatch/member-context.ts, src/gateway/collaboration-dispatch/member-context.test.ts, src/gateway/collaboration-dispatch/policy-compiler.ts, src/gateway/collaboration-dispatch/policy-compiler.test.ts, src/gateway/collaboration-dispatch/policy-compiler-sections.test.ts, src/gateway/collaboration-dispatch/policy-identity.ts, src/gateway/collaboration-learning/shared.ts, src/gateway/collaboration-dispatch/types.ts, src/gateway/collaboration-dispatch/effective-policy.ts, src/gateway/collaboration-dispatch/policy-decision-record.ts, src/gateway/collaboration-dispatch/decision-engine.ts, src/gateway/collaboration-dispatch/decision-engine.test.ts, src/gateway/collaboration-dispatch/policy-lane-participation.test.ts, src/gateway/collaboration-dispatch/completion-contract.ts, src/gateway/collaboration-dispatch/completion-contract.test.ts, src/gateway/collaboration-dispatch/round-policy-snapshot.test.ts, src/gateway/collaboration-dispatch/visible-reply-limit.test.ts, src/gateway/collaboration-dispatch/visible-reply-limit.ts, src/gateway/collaboration-dispatch/visible-reply.ts, src/gateway/collaboration-dispatch/visible-reply.test.ts, src/gateway/collaboration-dispatch/member-admission.ts, src/gateway/collaboration-dispatch/member-admission.test.ts · since: 2026-11-09

## Baseline and takeover

Fresh origin/main ea7149373; detached checkout advanced from e847e6481. Target files were clean before work. Reviewed current runtime and predecessor tests; exact-path landing designation preserves broad predecessor claims. Registry changes await its designated owner for landing.

## Implementation

- [x] Preserve already invited supplement members after a settled late primary; optional and model-generated invitations remain closed after the deadline. Keep supplement enablement, visible/cheap gates and abort. — codex-collab-runtime
- [x] Pass prior completed public reply bodies instead of only 180-character summaries. Do not pass raw runtime directives. — codex-collab-runtime
- [x] Copy current-round reply records so later array mutations cannot rewrite dispatched context. — codex-collab-runtime
- [x] Regression: late invited member, abort, visible limit, optional member, tail qualification, immutable snapshot. — codex-collab-runtime

## Scope and remaining acceptance

No configuration or production deployment. No RCIS input to admission, no Floor cutover, no new scheduler or task responsibility changes. Existing per-turn execution gates remain authoritative.
Remaining: LIVE validation; full-history retrieval and model-specific token admission; per-supplement timeout; durable automatic restart continuation with idempotent side-effect receipts. Current history is refreshed per member within the existing 24-message window, with a conservative serialized-character admission guard. Full LIVE group behavior is not accepted by these local tests.

## Verification

Scoped runtime/context/prompt/diagnosis/orchestration/rollcall: 67 passing tests (6 files). Initial context regressions: 2 failures before fix. Restoring baseline round-runtime with the new regression reproduces invited continuation failure (1 failed, 3 passed). Final TypeScript check and scoped lint passed. Full pnpm check stops at pre-existing formatting failures and invalid JSON5 under the unrelated nested checkout; no unrelated files repaired. — codex-collab-runtime

## Continuation checkpoint

- [x] Explicit multi-member queue preserves remaining invitations after a settled visible late reply. Each member receives its existing independent primary deadline; empty/in-flight replies are not treated as completion. — codex-collab-runtime
- [x] Existing coordination windows apply between queued leads and between dispatched supplements; signal cancellation releases timer and listener. Durations remain unchanged (0 / 500 / 2500ms by existing response mode). — codex-collab-runtime
- [x] AbortSignal cannot be overridden by a false custom stop callback. Recheck after wait and final supplement/close before completion. — codex-collab-runtime
- [x] Before-fix targeted regressions: late queue and stop-between fail; cancellable wait times out. After-fix: 72 tests across 6 files pass, TypeScript noEmit and scoped oxlint pass. — codex-collab-runtime

Full repository check has the already recorded unrelated formatting/JSON5 blockers. No production configuration or deployment performed. No new policy defaults or Floor cutover. — codex-collab-runtime

## Third checkpoint acceptance

Reviewing external inventory as evidence, not instructions. Implement per-member latest public transcript, bounded same-round input, and fail-closed recovery without replaying unknown side effects. Default LIVE policy and configuration remain unchanged. — codex-collab-runtime

- [x] Per-member Gateway dispatch rereads the authorized public transcript; excludes the original trigger by message identity, not last-position slicing; admits only public user/assistant text. — codex-collab-runtime
- [x] Combined active history/same-round material has a 24,000 serialized-character guard; oversize refuses before a model call with an actionable notice. This is not model-specific token accounting or full-history summarization. — codex-collab-runtime
- [x] Restart with pending primary/supplement dispatch records ROUND_ABORTED and pending ids in the event, rather than ROUND_COMPLETE. No replay of unknown external effects. Two fail-before/pass-after regressions. — codex-collab-runtime
- [x] Human explicitly selected related-member participation, ordinary limit 3, greeting 1, ordered explicit introductions. Compiler revision 1.3.0; existing explicit L2 choices preserved, new-group seed uses the compiler defaults. humanStartsNewRound/proactiveBots coupling is unchanged; no autonomous new-round permission added. — codex-collab-runtime
- [x] Decision-derived ordinary/broadcast reply budget persists with the round decision and is consumed by runtime. Explicit introductions dispatch 8 selected members; explicit broad ceiling 4 restricts to 4. No second policy source or Wake queue. — codex-collab-runtime
- [x] Final targeted suite: 254 tests in 24 files passed; TypeScript, changed-file oxlint and oxfmt checks passed. Group-transcript tests use mocked dispatch: no claim of real model or LIVE group acceptance. Full pnpm check retains the previously recorded unrelated formatting/invalid nested JSON5 blocker. — codex-collab-runtime

## External inventory review

Accepted: collaboration orchestration belongs inside Gateway Control before single-turn execution; RCIS stays asynchronous; Floor stays shadow; individual #261 is a separate scope. The inventory's LIVE statements are secondhand evidence, not independently replayed here. — codex-collab-runtime

Corrections: same-round serial dispatch need not emit task Wake Contract events; cross-round task nudges use the existing Wake mechanism. Do not add a parallel queue. proactiveBots=false is a compiled/presentation field, not proof it alone suppresses same-round participation; Decision actually consumes openDiscussionWithoutMention and the active strategy. The previously absent local pause/context paths now have implementation and tests but are not deployed. Planned membership, accepted dispatch and execution completion remain distinct facts. — codex-collab-runtime

Release acceptance: replay greeting, ordinary professional question, explicit introductions and constrained broadcast on the same approved source/build/config version; compare selected vs dispatched vs executed vs suppressed ids and capture each member input version. Test human interjection, abort and restart at every handoff. LIVE charter/config/deployment still require their own explicit authorization and production gates. — codex-collab-runtime

- [x] Open discussion admits existing selected peers without conclusion-keyword dependence. A settled late primary retains their ordinary visible budget; new auto-selected/model-only targets do not gain this continuation. Existing Cheap Gates, cancellation and tool/cost authorization remain in force. New closed/open/late regression scenarios pass; old open case failed before the fix. — codex-collab-runtime

Latest code checkpoint: 8859cc197 (policy-selected continuation); earlier third-checkpoint commits: 390def081 (context), d774ae45d (Gateway wiring), 8de07406a (restart), 627be5f66 (active defaults + broadcast budget), 941b9c9ee (new-group seed), 779d58ea8 (visible refusal). No push, merge or deploy. Loom registry metadata remains uncommitted for its designated owner. — codex-collab-runtime

## Speaking versus formal execution admission

- [x] Added resolveMemberAdmission / memberSpeakingGate. Discussion slots do not authorize work; executor role alone cannot bypass admission. Formal admission rereads actor claim, trusted task store, stop state, current authorization and confirmed plan through existing gates. — codex-collab-runtime
- [x] decision_to_executor checks formal admission before deciding the supplement window, then rechecks before member dispatch. Valid formal task turns are independent of visibleCap / supplement.enabled / cheap relevance gates; permission, plan, cost/tool and stop controls remain. — codex-collab-runtime
- [x] Gateway rechecks formal admission and injects the confirmed execution task bag and deliverable binding before the existing single-member runner. No new model loop or Wake queue. — codex-collab-runtime
- [x] Tests: missing claim and unconfirmed plan refuse; formal admission ignores only speaking slots; discussion keeps cap; runtime with speaking cap 1 and supplement disabled still dispatches a formally admitted executor. Runtime test stubs the admission boundary; resolver tests mock stores. Real task/tool/LIVE end-to-end acceptance remains open. — codex-collab-runtime

Remaining implementation gaps: public delivery counting still conservatively counts dispatched discussion turns (not actual delivered messages); formal review admission remains governed by its existing separate path, not generalized here; no automatic replay of unknown side effects, model-specific history budgeting or LIVE deployment. These are not marked completed by this checkpoint. — codex-collab-runtime
