# Phase C Independent Execution-chain Review

## Review identity

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| reviewerStableId | `conversation-task-runtime:kiro-conversation-task-runtime` |
| role             | Independent Execution-chain Reviewer                       |
| reviewedMainSha  | `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`                 |
| reviewedAt       | `2026-09-24`                                               |
| materialOwner    | `constitutional-governance-phase-c-decision:grok-bot`      |
| decision         | `AGREE_NO_GO`                                              |
| conditions       | None within the Execution-chain Reviewer scope             |

The Execution-chain Reviewer is independent of the Material Owner and of Architecture
(`codex-architecture`). This receipt fills only the Execution-chain Reviewer slot.
It does not fill or represent the Security Reviewer slot. Findings below were
verified against `origin/main` at the reviewed SHA; they are not a copy of Material
Owner or Architecture prose.

## Reviewed material

The following per-file SHA-256 digests are authoritative and were re-checked on the
Phase C Mac worktree before this review:

| File                         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `failure-cases.md`           | `55475cd9e3a4c007206f32e411d379a4f418ceb78db8f43772913ce026abb6b9` |
| `alternatives-matrix.md`     | `44c75c25fe4b0570adc23ea26a412913ca2d7221b97180e3b6963fbbe0ece4c5` |
| `metrics-and-evidence.md`    | `651225d3eff3d03f029dd830760231e621c0e4b8a165de582fb4879f7dcf4b60` |
| `security-profile-review.md` | `ce86af449fc8cac1a2aba6170e64f26a0312236e14e1e9bfd72901e404596be7` |
| `decision.md`                | `bba958653f902f519f9d902b75423e4510c1d8eb025d3732b0149f3cebfd762b` |

Optional combined digest (SHA-256 of `shasum -a 256` output over those five files,
as frozen in `decision-digest.md`):

`c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20`

Also read for context (non-frozen): `reviews/architecture-review.md` (Architecture
already `AGREE_NO_GO`), `tasks.md`, `decision-digest.md`.

## FC-01 result — `/tools/invoke` vs execution-preflight

**Verdict: Material Owner claim ACCURATE.**

At reviewed SHA `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`:

- `src/gateway/tools-invoke-http.ts` (`handleToolsInvokeHttpRequest`) performs
  gateway HTTP auth, tool-policy pipeline (`applyToolPolicyPipeline` /
  `buildDefaultToolPolicyPipelineSteps`), gateway HTTP deny list, then tool
  `execute`. It optionally runs `runGatewayToolkitPhase2Gate` (Policy→Approval→Receipt;
  default OFF via `OPENBOT_TOOLKIT_PHASE2_GATE`).
- That file has **zero** imports from `src/agents/execution-preflight/`. It does
  not call `buildExecutionPreflight`, `armCompletionHold`, `issueValidationReceipt`,
  or write preflight delivery/completion traces.
- Execution-preflight **is** wired on the embedded Pi hot path:
  `src/agents/pi-embedded-runner/run/attempt.ts` imports
  `buildExecutionPreflight` / `armCompletionHold` / `disarmCompletionHold` from
  `../../execution-preflight/index.js`, with `buildExecutionPreflight({...})` at
  approximately line 1111 and `armCompletionHold` later in the attempt lifecycle.

**Implication:** FC-01 is a real structural bypass of the **execution-preflight
completion envelope**, not a naming issue. The optional Phase 2 toolkit gate on
HTTP invoke is a different gate stack and does **not** substitute for
execution-preflight hold/trace/receipt semantics.

**Fix shape:** Localized A/B work (call existing preflight/hold APIs from the HTTP
adapter, or extend preflight with an HTTP adapter) is sufficient. A new
`constitutional-contracts` package is not required for this coverage.

## FC-02 result — ConversationTask close vs delivery hold

**Verdict: Material Owner claim ACCURATE.**

- Close path: `observeConversationTaskReplyCompleted` in
  `src/conversation-task/reply-completion.ts`. When activation is on and identity /
  goal / optional reply-alignment checks pass, it calls
  `completeConversationTaskLedgerOnReply` then `store.transitionTask(task.id, "closed")`.
- That module imports CTR feature/store/ledger helpers only. It does **not** import
  or call `judgeCompletionSend`, `judgeSessionOutbound`, `evaluateDeliveryEvidence`,
  `hasDeliveryContext`, `armCompletionHold`, or any other
  `src/agents/execution-preflight/*` symbol.
- Delivery/completion hold lives in `src/agents/execution-preflight/completion-hold.ts`
  (`armCompletionHold`, `judgeSessionOutbound`, `dispatchGuardedSend`,
  `finalizeDeliveryContext`). Hold state is process-local for attempt/task delivery
  guarding; CTR close does not consult it.
- Call site: `src/auto-reply/reply/dispatch-from-config.ts` invokes
  `observeConversationTaskReplyCompleted(...)` after assistant reply dispatch
  (final/routed path), with no preceding delivery-hold consultation on that close.

**Implication:** Two legitimate domain authorities can diverge (CTR `closed` while
skill-delivery completion remains blocked). The gap is a missing **finalization
handshake**, not missing vocabulary. Option C/A (CTR close consults existing
delivery evidence/hold APIs, or dispatch orders delivery judgment before observe)
addresses it. Creating a cross-domain writer over multiple terminal states must
not be the fix.

## FC-03 result — side-effect entry inventory

**Verdict: Material Owner claim ACCURATE for the three named entries; inventory still open.**

Static check at the reviewed SHA (no `execution-preflight` import / no
`buildExecutionPreflight` call):

| Entry                        | Path                                                             | Uses execution-preflight?                                            | Gate stack (brief)                                                                  |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| HTTP `/tools/invoke`         | `src/gateway/tools-invoke-http.ts`                               | **No**                                                               | Gateway auth + tool policy + HTTP deny + optional Phase 2 toolkit gate              |
| `node.invoke`                | `src/gateway/server-methods/nodes.ts`                            | **No**                                                               | Param validate + command allowlist + sanitize + `nodeRegistry.invoke` (+ APNS wake) |
| Enterprise capability invoke | `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` | **No**                                                               | Trusted seat context + grant + quota + `invokeEnterpriseDataAction` audit           |
| Embedded Pi attempt          | `src/agents/pi-embedded-runner/run/attempt.ts`                   | **Yes**                                                              | `buildExecutionPreflight` + `armCompletionHold` / delivery path                     |
| Fabric `fabric.tool.execute` | `src/gateway/server-methods/fabric.ts`                           | **No** (separate Fabric pipeline; feature-gated / often UNAVAILABLE) | Fabric service when `isFabricEnabled()`; not Pi preflight                           |

`ORCHESTRATION_LIVE_INVOKE` remains false in orchestration types (Material Owner
reproduction); live orchestration invoke is not a substitute that closes these
entries.

**Implication:** Closing C10-style bypass accounting still requires per-entry
classify|exempt(+break-glass)|retire work. A contracts package does not replace that
engineering under limited GO (and Path/Gate remain unauthorized).

## Alternatives result

The A/B/C vs D matrix is fair for execution-chain scope:

- FC-01 → A or B (wire or extend preflight) covers the gap; D is not uniquely required.
- FC-02 → C (or A on dispatch ordering) covers the handshake; D would still need the
  same domain call and must not invent a global writer.
- FC-03 → A (per-entry) plus maintained inventory; D’s registry value is documentary
  and does not close entries without the same per-entry work.

Unique-benefit gate for Option D: **FAIL** from an execution-chain perspective.

## Duplication risk

Agree with Material Owner / Architecture on this point:

- Do **not** add a fifth execution state machine.
- Do **not** add a new production evidence/log store that duplicates preflight
  trace/receipt or Fabric audit.
- Do **not** create a cross-domain terminal-state writer over CTR + delivery +
  orchestration (+ others).

NO-GO avoids those duplication risks. Continuing convergence inside
execution-preflight, ConversationTask, task-orchestration observation, and an
explicit side-effect entry table is the lower-risk path.

## Material Owner check (omissions / exaggeration)

- No material call-chain mis-attribution found for FC-01/02/03 on the reviewed SHA.
- Clarifying nuance (not a REVISE trigger): `/tools/invoke` has an optional Phase 2
  toolkit gate. That is real HTTP-side governance, but it is **not**
  execution-preflight. The FC-01 symptom statement remains correct as written.
- Frozen `decision.md` still narrates Architecture as pending receipt file; the
  worktree now has `reviews/architecture-review.md` with `AGREE_NO_GO`. That is
  historical freeze text. Per charter this reviewer does **not** modify the five
  frozen bodies; the mismatch does not change the FC code facts or the NO-GO
  recommendation.

## Gate results

| Gate                                                                           | Result             |
| ------------------------------------------------------------------------------ | ------------------ |
| FC-01 structural bypass of execution-preflight on `/tools/invoke`              | `PASS` (confirmed) |
| FC-02 CTR close ignores delivery hold                                          | `PASS` (confirmed) |
| FC-03 named side-effect entries outside preflight                              | `PASS` (confirmed) |
| Three failures demonstrate unique Meta-Schema / contracts-package benefit      | `FAIL`             |
| Option D has measurable, non-substitutable benefit over A–C                    | `FAIL`             |
| Localized A/B/C can address FC-01..03 without new cross-domain write authority | `PASS`             |
| Fifth state machine / new evidence store / cross-domain writer required        | `FAIL` (must not)  |
| Execution-chain decision                                                       | `AGREE_NO_GO`      |

## Execution-chain decision

`AGREE_NO_GO`

This reviewer agrees with stopping Meta-Schema / `constitutional-contracts` /
four-product engineering milestones on execution-chain grounds.

Continue:

- wire or adapt existing execution-preflight APIs onto HTTP (and other) tool
  surfaces where completion envelope parity is required;
- add an explicit ConversationTask↔delivery finalization handshake;
- keep the side-effect entry inventory explicit with
  reuse | exempt+break-glass | retire per row;
- keep orchestration / Fabric default-off unless separately authorized.

Meta-Schema may remain a vocabulary / review lens only — not an engineering
milestone that claims to close these call chains.

## Explicit non-authorization

This receipt does not authorize:

- enabling B2 / orchestration / Fabric live flags;
- deployment or production canary activity;
- Phase D implementation;
- creation of `constitutional-contracts`;
- creation of a real Path runtime;
- Gate tightening;
- `ORCHESTRATION_LIVE_INVOKE=true`;
- merging Profile A and Profile B;
- receipt-to-proof promotion;
- a cross-domain terminal-state writer;
- commit / push / PR by this reviewer.

## Conditions

None within the Execution-chain Reviewer scope.

## Signature

— `conversation-task-runtime:kiro-conversation-task-runtime`  
(agent: Phase C Execution-chain Reviewer / `f227e0d9-9944-41d5-8bb3-b477de09cc6c`)
