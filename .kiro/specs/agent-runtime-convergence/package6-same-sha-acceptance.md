# Package6 — final same-SHA acceptance & new-main takeover proof

**Date:** 2026-11-08 (Asia/Shanghai)  
**Agent:** grok-bot  
**Charter:** 最终同版本真实验收与替代证明 — no new features, no architecture expansion.  
**No push / PR / merge / deploy / production restart. No outbound channel sends.**

**Independent review (2026-11-08):** **conditional PASS** at tip `f47b5b8cca85f572a440d393516d108cb84c2063` (freeze source `a1b14f80c…`). Docs-only remelt; no production source changes.  
**This pack is not “all green”** — four test-contract failures remain listed below as **pending test-contract fixes** (not Package6 continuity blockers).  
**Source-code migration phase** for Packages 1–6 is closable after these doc corrections. **Runtime final acceptance** (real-model / real-channel / PPT physical) remains a **separate checklist** — not deploy-ready; do **not** claim all old executors retired.

## Freeze

| Field                                | Value                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeze source SHA (clean tree tests) | `a1b14f80c0de6483ab3a9659c090eb6881912ffe` (= Package5 remelt tip)                                                                                                                                                                                        |
| `origin/main` ancestor               | `658bb327ef7470433f092b50dd122d8d6bc5262b` — **PASS** (`merge-base --is-ancestor`)                                                                                                                                                                        |
| Clean test worktree                  | `/tmp/openbot-p6-freeze-a1b14f80c` (detached HEAD, status clean; `node_modules` + `ui/node_modules` symlinked from primary)                                                                                                                               |
| Primary worktree                     | `/Users/daniel/.codex/worktrees/runtime-convergence/openbot` — foreign WIP preserved (`.loom/registry.yaml`, `context-component-plan.md`, `materials-manifest.md`, `out/`, `executor-evidence/`, task-outcome/model-call closeout, etc.) — **not staged** |
| Commits since Package5 tip           | docs-only Package6 acceptance pack (this file + tasks.md); **no src/** changes                                                                                                                                                                            |
| Source edits for continuity defects  | **none**                                                                                                                                                                                                                                                  |

## Evidence class ledger (do not splice across SHAs)

All PASS/FAIL/GAP below were collected on freeze source `a1b14f80c…` in the clean worktree. Historical Package2–5 PASS are cited only as prior charter context, not as this SHA’s proof.

| Class                                      | What ran this turn                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **unit**                                   | delivery dispatch/acceptance/artifacts; catalog/assembly; interpret-interaction; explicit-task-control; admission; admitted-turn/candidate; turn-outcome; package5-retire; claim-fence; four-defects; stale-callback; recovery enqueue; PPT wiring (save/edit/preview node); preview-artifact hash/envelope; office-pptx text/isolated |
| **integration**                            | organization collab-dispatch lifecycle/broadcast/confirmation/delivery; collaboration-board tool (most paths); discuss-to-task turn/injection; trusted-locator; collab-dialogue regressions; task-outcome collab entry wiring; collab continuity memory; controlled-collab P1/P3 loops; P4 gate repros (7/8)                           |
| **stub-channel**                           | production-path followup runner (stub returns drive acceptance/delivery); channel-fail → delivery-only retry                                                                                                                                                                                                                           |
| **real-process**                           | `async-wait-recovery.cross-process` (4); `pending-delivery.restart` rehydrate active/paused/cancelled (3)                                                                                                                                                                                                                              |
| **static**                                 | retired alias absence; sole `armAsyncWaitRecoveryContinuation` export; entry call graph from source; kept façades inventory                                                                                                                                                                                                            |
| **real-model**                             | **GAP** — not run (charter: no production restart / no live model acceptance this package)                                                                                                                                                                                                                                             |
| **real-channel outbound**                  | **GAP** — not run (charter: do not send external messages for acceptance)                                                                                                                                                                                                                                                              |
| **PPT physical preview / real-render env** | **runtime GAP** — conversion-stub + UI isolation unit ≠ physical Office render pass                                                                                                                                                                                                                                                    |

---

## Personal main-chain matrix (same SHA)

<!-- prettier-ignore -->
| Scenario | Verdict | Evidence class | Evidence |
| --- | --- | --- | --- |
| Ordinary chat / interpret → reply|clarify (no task writer) | **PASS** | unit | `interpret-interaction` 20 PASS — reply/clarify/execution_request/task_control parsing; no task writer exposed |
| Explicit task admission / control | **PASS** | unit | `explicit-task-control` 11 PASS |
| Execution admission (command/wiring/lease/session) | **PASS** | unit | command + wiring admission 8; admission-lease 6; command-admission-session 4 |
| Admitted turn execute path | **PASS** | unit | `admitted-turn` 9; `admitted-candidate` 3; `turn-outcome` 6 |
| Query vs revision (interaction kinds) | **PASS** | unit | interpret kinds: reply/clarify vs execution_request vs task_change/task_control |
| Visible prepare ≠ delivered; confirm closes delivery | **PASS** | unit | prepare-visible 12; confirm-pending 5; complete-reply 23 |
| Acceptance criteria / validation | **PASS** | unit | criteria 5; validation 3 |
| Capability catalog + context assembly | **PASS** | unit | catalog 3; assembly 7 |

## Collab main-chain matrix (same SHA)

| Scenario                                             | Verdict                                | Evidence class       | Evidence                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Collaboration entry / mission context                | **PASS**                               | unit                 | collaboration-entry 3; collaboration-mission 2                                                                                                                                                                                                                           |
| Claim actor fence (no proxy claim)                   | **PASS**                               | unit/integration     | collaboration-board-tool claim/proxy refusals + self claim                                                                                                                                                                                                               |
| Claim → mark_in_progress → list                      | **PASS**                               | unit                 | board tool success paths                                                                                                                                                                                                                                                 |
| Submit → review → return → revise → accept (Mode B)  | **PASS**                               | integration          | controlled-collab **P3** two-member MD loop 1 PASS; **P1** combo closed-loop 1 PASS                                                                                                                                                                                      |
| Group / roster delivery helpers                      | **PASS**                               | integration          | collab-dispatch-delivery 7; broadcast 12; confirmation 2; lifecycle 13                                                                                                                                                                                                   |
| Collab dialogue regressions                          | **PASS**                               | integration          | 27 PASS                                                                                                                                                                                                                                                                  |
| Member turn / shared executor ≠ close group contract | **PASS**                               | static + integration | `admitted-turn-ownership.md` + `scenario-architecture.md`: shared executor cannot close group contract; formal team delivery is `submit_team_deliverable` (separate from member `submit_for_review`); P3 accept is board accept after review, not member-turn auto-close |
| Board tool success-detail mocks (`item` shape)       | **PENDING test-contract fix** (3 FAIL) | unit mock drift      | Mocks return bare item; production entry returns `{ item, eventRelay }` — tool forwards `result.item` correctly against real entry. Independent review: does **not** prove prod main-chain break; **must remain visible** — not “all green”                              |
| P4 post-cap heartbeat terminal class                 | **PENDING test-contract fix** (1 FAIL) | integration assert   | After escalate exhaustion, `human_todo:…` appears; revise-to-claimant remains 0. Assert too narrow (escalate\|skip only). Independent review: not a Package6 continuity blocker; **must remain visible**                                                                 |

## Async / recovery / cancel / claim / delivery-only matrix (same SHA)

| Scenario                                                                                                                | Verdict  | Evidence class | Evidence                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------------------------- |
| Four defects (bind/release/CAS/delivery-only)                                                                           | **PASS** | unit           | four-defects 9                                                                        |
| Production path: followup runner (controlled lifecycle + queued candidate) → acceptance/delivery; channel fail ≠ re-run | **PASS** | stub-channel   | production-path 3 (incl. delivery-only original payloads); not chat `runAdmittedTurn` |
| Claim fence                                                                                                             | **PASS** | unit           | claim-fence 5                                                                         |
| Stale callback after pause/cancel                                                                                       | **PASS** | unit           | stale-callback 3                                                                      |
| Recovery arm / enqueue                                                                                                  | **PASS** | unit           | async-wait-job-recovery 8; recovery-enqueue 2                                         |
| Package5 retired aliases unreachable                                                                                    | **PASS** | unit/static    | package5-retire 3                                                                     |
| Cross-process recovery / claim race / crash-before-enqueue                                                              | **PASS** | real-process   | cross-process 4                                                                       |
| Pending delivery rehydrate across process (active/paused/cancelled)                                                     | **PASS** | real-process   | pending-delivery.restart 3                                                            |
| Session recovery / claimed recovery prompt                                                                              | **PASS** | unit           | session-recovery 4; claim-queued recovery-prompt 2                                    |

## Artifacts / PPT (PASS vs runtime GAP)

| Scenario                                           | Verdict         | Evidence class | Evidence                                                                                                                                |
| -------------------------------------------------- | --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PPTX patch CAS / version bind                      | **PASS**        | unit           | patch-pptx 1; criteria/validation as above                                                                                              |
| Preview vs download isolation (sidebar)            | **PASS**        | unit           | download-lane 9; html-preview 6                                                                                                         |
| Deliverable save refuses preview-as-original       | **PASS**        | unit           | deliverable-save 24                                                                                                                     |
| Workspace file preview wiring                      | **PASS**        | unit           | workspace-file-preview.node 21                                                                                                          |
| PPTX preview-edit wiring                           | **PASS**        | unit           | pptx-preview-edit 4                                                                                                                     |
| Preview artifact hash / envelope                   | **PASS**        | unit           | artifact-hash 4; deliverable-envelope 10                                                                                                |
| Office PPTX text / isolated conversion stubs       | **PASS**        | unit (stub)    | office-pptx-text 3; office-pptx-isolated 3                                                                                              |
| **Physical PPT render env + human visual preview** | **runtime GAP** | —              | No `openbot-pptx-renderer` production image / physical preview this turn. Conversion-stub + UI isolation **≠** physical pass (charter). |
| Real-channel download of original bytes end-to-end | **runtime GAP** | —              | No outbound/real channel send                                                                                                           |

---

## Entry call graph (by scenario — do not collapse entries)

Scene adapters share the **controlled execution lifecycle** stage contract, but they do **not** all call the same function. Chat uses `runAdmittedTurn`; followup/queued work uses `runQueuedCandidate` after claim. One diagram must not imply every entry calls chat `runAdmittedTurn`.

### Personal / chat

```
inbound auto-reply (get-reply-run / agent-runner)
  → interpretInteraction (reply | clarify | execution_request | task_control)
  → explicit task control / execution admission (when task path)
  → replyTurnRuntime.execution.runAdmittedTurn   ← chat scene only
       → admitted candidate / model+tools (embedded|CLI backends)
       → completeReplyDelivery
            empty/filtered → delivery awaiting/pending (silence ≠ delivered w/o send evidence)
            visible → prepareVisibleDelivery (awaiting)
                 → channel send
                 → confirmPendingTurnDelivery (only path that marks delivered + may close with acceptance bind)
```

### Followup / queued (async-wait continue & delivery-only) — not chat `runAdmittedTurn`

```
Gateway boot → recoverAsyncWaitJobsAtGatewayBoot
  → armAsyncWaitRecoveryContinuation  (SOLE recovery arm entry)
       → continue enqueue | delivery-only enqueue (boundPayloads)
  → followup runner:
       claimQueuedExecution
         → createExecutionLifecycle / controlled stages (prepare → infer → …)
         → runQueuedCandidate   ← queued scene; does NOT call chat runAdmittedTurn
         → acceptance / prepareVisible / confirmPendingTurnDelivery as applicable
pause|cancel|replace → stale callbacks cleared/rejected (no business re-run)
delivery_unknown retry → delivery_only + original boundPayloads → confirm (no model / no business re-run)
```

### Cron / command (scene adapters; brief)

```
cron isolated-agent / command hosts
  → same controlled execution lifecycle stage order
  → their own candidate runners (not chat runAdmittedTurn)
```

### Collab

```
collaboration_board tool (claimContract allowlist)
  → claim_item / mark_in_progress / submit_for_review
  → accept_submission | return_submission (S3 version ids)
  → submit_team_deliverable (formal group delivery + contentSha256)  ≠ member turn end
organization collab-dispatch → roster delivery (human workbench / agent bus)
controlled Mode B loop: submit → review dispatch → return → revise → accept
```

Chat `runAdmittedTurn` / shared lifecycle does **not** close a group ClaimContract or treat member output as final group deliverable (`admitted-turn-ownership.md`). Independent collab contracts retain their own duties.

---

## Retired unreachable + kept façades / backends / triggers

**Do not claim all old executors retired or deleted.** Scoped retirement only.

### Retired this migration window (unreachable on this SHA)

| Path                                                                                                                       | Proof                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `claimAsyncWaitJobIntent`                                                                                                  | Removed from prod implementation and public `state/index` export; archive comment only; package5-retire 3 PASS; delete found **no break** |
| `deliverRecoveredAsyncWaitCompletion`                                                                                      | Same — name implied delivery; only armed continue; **no break** on removal                                                                |
| Prior shells (`untrusted-context`, `execution-stall-continue-loop`, `agent-runner-payloads`, eager mention `tool.execute`) | Already archived in `safe-retirements.md` / prior packages — no live import                                                               |

### Kept (duties retained — not “full config audit complete”)

| Item                                                            | Reason kept                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/cli-runner.ts` façade                                   | Needed façade; forward-only to `execution/runner/cli-run`; consumers still import                                                           |
| `agents/pi-embedded.ts` / `pi-embedded-runner.ts`               | Needed façades; live Gateway/cron/commands/auto-reply consumers                                                                             |
| Embedded / CLI execution backends                               | **Retain duties** as model/tool loop providers under chat / cron / followup scene adapters                                                  |
| BOOT / cron / followup triggers                                 | Legitimate scene adapters onto controlled execution lifecycle — **retain duties**                                                           |
| Independent collab contracts (ClaimContract / board / dispatch) | **Retain duties**; not collapsed into chat `runAdmittedTurn`                                                                                |
| Thin usage / abort / preflight / session-usage façades          | Needed forward-only façades; do not force-delete for zero count                                                                             |
| Lobster (`extensions/lobster`)                                  | **Insufficient evidence** to delete (resumeToken / pipeline assets / install surface unknown) — **kept; not a completed full config audit** |
| OpenProse (`extensions/open-prose`)                             | **Insufficient evidence** (`.prose` assets / VM / child sessions unknown) — **kept; not a completed full config audit**                     |
| `task-orchestration`                                            | Shadow observe / dormant (`LIVE_INVOKE` frozen false) — not bulk-delete by name                                                             |
| Unknown external workflows / recovery assets                    | Not inventoried to deletion — leave; evidence gap, not “audited clear”                                                                      |

---

## Suite tally this turn (freeze `a1b14f80c…`)

**Not an all-green pack.** Four failures remain **pending test-contract fixes** (3 board-tool mock shape + 1 P4 assert). They stay listed; independent review found no prod main-chain break from them, so they are not Package6 continuity blockers.

| Batch                                          | Result (this SHA)                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A delivery/async/context (unit)                | 14 files / **90 PASS**                                                                     |
| B admission/collab-entry/restart/cross-process | 14 files / **56 PASS** (incl. real-process 7)                                              |
| C interpret/explicit/PPT wiring/org dispatch   | 9 files / **114 PASS** (+ 2 UI sidebar re-run **15 PASS** after linking `ui/node_modules`) |
| D collab board / dialogue / continuity         | **63 PASS / 3 FAIL** — board-tool success-path mocks (**pending test-contract**)           |
| E controlled collab + PPT stubs                | **29 PASS / 1 FAIL** — P4 `human_todo` assert (**pending test-contract**)                  |
| package5-retire recheck                        | **3 PASS**                                                                                 |
| Continuity/state/delivery defect fixes         | **none** (no re-freeze of src)                                                             |
| Total visible failures kept in pack            | **4** (do not describe this acceptance as all green)                                       |

---

## Pending test-contract fixes (visible; not continuity blockers)

1. Collab board unit mocks (3 FAIL): update `submitForReview` / `acceptSubmission` / `returnSubmission` mocks to `{ item, eventRelay }` shape (production already correct).
2. P4 gate repro (1 FAIL): allow `human_todo:` after escalate failures exhausted (or assert revise-dispatch=0 explicitly).

## Runtime final-acceptance checklist (separate — do not expand architecture to close)

These gaps do **not** negate source-level evidence; stub/unit tests do **not** substitute:

1. Same-candidate **real-model** personal + collab loops.
2. Authorized-env **real channel** outbound + receipts.
3. Real PPT render image + **physical** preview + original download.

## Other residual / out of charter

1. DQ1–DQ4 quality platform items (explicitly out of charter).
2. Foreign concurrent WIP on primary worktree — other teams; do not bag into convergence commits.
3. Broader `src/agents` / Gateway e2e not re-run in full this package (scoped to charter windows).

## Evidence archive boundary

- Local batch logs (`/tmp/p6-batch-*.log`) and the clean freeze worktree dir `/tmp/openbot-p6-freeze-a1b14f80c` matched freeze source `a1b14f80c…` for this run.
- This markdown records suite **tallies and scenario verdicts**, not a full per-batch command line + log digest set suitable for long-term standalone re-verification.
- **Final delivery is not a self-contained durable evidence archive.** Re-verification needs re-running suites on the freeze SHA (or an equivalent clean worktree), not relying on this document alone.

## Hand-off

**Conditional PASS** after independent review + these doc corrections.

- **Source-code migration phase (Packages 1–6):** closable.
- **Runtime final acceptance:** separate checklist (real-model / real-channel / PPT physical) — **not** closed; **not** deploy-ready.
- **Do not** claim all old executors retired, all tests green, or production restart authorization.  
  Freeze source `a1b14f80c…`. **No push / merge / deploy / production restart.**
