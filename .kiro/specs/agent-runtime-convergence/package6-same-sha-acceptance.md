# Package6 — final same-SHA acceptance & new-main takeover proof

**Date:** 2026-11-08 (Asia/Shanghai)  
**Agent:** grok-bot  
**Charter:** 最终同版本真实验收与替代证明 — no new features, no architecture expansion.  
**No push / PR / merge / deploy / production restart. No outbound channel sends.**

## Freeze

| Field | Value |
| --- | --- |
| Freeze source SHA (clean tree tests) | `a1b14f80c0de6483ab3a9659c090eb6881912ffe` (= Package5 remelt tip) |
| `origin/main` ancestor | `658bb327ef7470433f092b50dd122d8d6bc5262b` — **PASS** (`merge-base --is-ancestor`) |
| Clean test worktree | `/tmp/openbot-p6-freeze-a1b14f80c` (detached HEAD, status clean; `node_modules` + `ui/node_modules` symlinked from primary) |
| Primary worktree | `/Users/daniel/.codex/worktrees/runtime-convergence/openbot` — foreign WIP preserved (`.loom/registry.yaml`, `context-component-plan.md`, `materials-manifest.md`, `out/`, `executor-evidence/`, task-outcome/model-call closeout, etc.) — **not staged** |
| Commits since Package5 tip | docs-only Package6 acceptance pack (this file + tasks.md); **no src/** changes |
| Source edits for continuity defects | **none** |

## Evidence class ledger (do not splice across SHAs)

All PASS/FAIL/GAP below were collected on freeze source `a1b14f80c…` in the clean worktree. Historical Package2–5 PASS are cited only as prior charter context, not as this SHA’s proof.

| Class | What ran this turn |
| --- | --- |
| **unit** | delivery dispatch/acceptance/artifacts; catalog/assembly; interpret-interaction; explicit-task-control; admission; admitted-turn/candidate; turn-outcome; package5-retire; claim-fence; four-defects; stale-callback; recovery enqueue; PPT wiring (save/edit/preview node); preview-artifact hash/envelope; office-pptx text/isolated |
| **integration** | organization collab-dispatch lifecycle/broadcast/confirmation/delivery; collaboration-board tool (most paths); discuss-to-task turn/injection; trusted-locator; collab-dialogue regressions; task-outcome collab entry wiring; collab continuity memory; controlled-collab P1/P3 loops; P4 gate repros (7/8) |
| **stub-channel** | production-path followup runner (stub returns drive acceptance/delivery); channel-fail → delivery-only retry |
| **real-process** | `async-wait-recovery.cross-process` (4); `pending-delivery.restart` rehydrate active/paused/cancelled (3) |
| **static** | retired alias absence; sole `armAsyncWaitRecoveryContinuation` export; entry call graph from source; kept façades inventory |
| **real-model** | **GAP** — not run (charter: no production restart / no live model acceptance this package) |
| **real-channel outbound** | **GAP** — not run (charter: do not send external messages for acceptance) |
| **PPT physical preview / real-render env** | **runtime GAP** — conversion-stub + UI isolation unit ≠ physical Office render pass |

---

## Personal main-chain matrix (same SHA)

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

| Scenario | Verdict | Evidence class | Evidence |
| --- | --- | --- | --- |
| Collaboration entry / mission context | **PASS** | unit | collaboration-entry 3; collaboration-mission 2 |
| Claim actor fence (no proxy claim) | **PASS** | unit/integration | collaboration-board-tool claim/proxy refusals + self claim |
| Claim → mark_in_progress → list | **PASS** | unit | board tool success paths |
| Submit → review → return → revise → accept (Mode B) | **PASS** | integration | controlled-collab **P3** two-member MD loop 1 PASS; **P1** combo closed-loop 1 PASS |
| Group / roster delivery helpers | **PASS** | integration | collab-dispatch-delivery 7; broadcast 12; confirmation 2; lifecycle 13 |
| Collab dialogue regressions | **PASS** | integration | 27 PASS |
| Member turn / shared executor ≠ close group contract | **PASS** | static + integration | `admitted-turn-ownership.md` + `scenario-architecture.md`: shared executor cannot close group contract; formal team delivery is `submit_team_deliverable` (separate from member `submit_for_review`); P3 accept is board accept after review, not member-turn auto-close |
| Board tool success-detail mocks (`item` shape) | **FOLLOW-UP** | unit mock drift | 3 FAIL: mocks return bare item; production entry returns `{ item, eventRelay }` — tool forwards `result.item` correctly against real entry. **Not** a production continuity defect |
| P4 post-cap heartbeat terminal class | **FOLLOW-UP** | integration assert | 1 FAIL: after escalate exhaustion, `human_todo:…` appears; revise-to-claimant remains 0. Assert too narrow (escalate\|skip only) — polish |

## Async / recovery / cancel / claim / delivery-only matrix (same SHA)

| Scenario | Verdict | Evidence class | Evidence |
| --- | --- | --- | --- |
| Four defects (bind/release/CAS/delivery-only) | **PASS** | unit | four-defects 9 |
| Production path: followup → acceptance/delivery; channel fail ≠ re-run | **PASS** | stub-channel | production-path 3 (incl. delivery-only original payloads) |
| Claim fence | **PASS** | unit | claim-fence 5 |
| Stale callback after pause/cancel | **PASS** | unit | stale-callback 3 |
| Recovery arm / enqueue | **PASS** | unit | async-wait-job-recovery 8; recovery-enqueue 2 |
| Package5 retired aliases unreachable | **PASS** | unit/static | package5-retire 3 |
| Cross-process recovery / claim race / crash-before-enqueue | **PASS** | real-process | cross-process 4 |
| Pending delivery rehydrate across process (active/paused/cancelled) | **PASS** | real-process | pending-delivery.restart 3 |
| Session recovery / claimed recovery prompt | **PASS** | unit | session-recovery 4; claim-queued recovery-prompt 2 |

## Artifacts / PPT (PASS vs runtime GAP)

| Scenario | Verdict | Evidence class | Evidence |
| --- | --- | --- | --- |
| PPTX patch CAS / version bind | **PASS** | unit | patch-pptx 1; criteria/validation as above |
| Preview vs download isolation (sidebar) | **PASS** | unit | download-lane 9; html-preview 6 |
| Deliverable save refuses preview-as-original | **PASS** | unit | deliverable-save 24 |
| Workspace file preview wiring | **PASS** | unit | workspace-file-preview.node 21 |
| PPTX preview-edit wiring | **PASS** | unit | pptx-preview-edit 4 |
| Preview artifact hash / envelope | **PASS** | unit | artifact-hash 4; deliverable-envelope 10 |
| Office PPTX text / isolated conversion stubs | **PASS** | unit (stub) | office-pptx-text 3; office-pptx-isolated 3 |
| **Physical PPT render env + human visual preview** | **runtime GAP** | — | No `openbot-pptx-renderer` production image / physical preview this turn. Conversion-stub + UI isolation **≠** physical pass (charter). |
| Real-channel download of original bytes end-to-end | **runtime GAP** | — | No outbound/real channel send |

---

## Entry call graph (concise — current main)

### Personal / chat

```
inbound auto-reply (get-reply-run / agent-runner)
  → interpretInteraction (reply | clarify | execution_request | task_control)
  → explicit task control / execution admission (when task path)
  → replyTurnRuntime.execution.runAdmittedTurn
       → admitted candidate / model+tools (embedded|CLI backends)
       → completeReplyDelivery
            empty/filtered → delivery awaiting/pending (silence ≠ delivered w/o send evidence)
            visible → prepareVisibleDelivery (awaiting)
                 → channel send
                 → confirmPendingTurnDelivery (only path that marks delivered + may close with acceptance bind)
```

### Async wait / restart

```
Gateway boot → recoverAsyncWaitJobsAtGatewayBoot
  → armAsyncWaitRecoveryContinuation  (SOLE arm entry)
       → continue enqueue | delivery-only enqueue (boundPayloads)
  → followup claimQueuedExecution → runAdmittedTurn / delivery confirm
pause|cancel|replace → stale callbacks cleared/rejected (no business re-run)
delivery_unknown retry → delivery_only + original boundPayloads → confirm (no model)
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

Shared `runAdmittedTurn` does **not** close a group ClaimContract or treat member output as final group deliverable (`admitted-turn-ownership.md`).

---

## Retired unreachable + kept façades / backends / triggers

### Retired (unreachable on this SHA)

| Path | Proof |
| --- | --- |
| `claimAsyncWaitJobIntent` | No export in `state/index` or recovery module; source archive comment only; package5-retire 3 PASS |
| `deliverRecoveredAsyncWaitCompletion` | Same |
| Prior shells (`untrusted-context`, `execution-stall-continue-loop`, `agent-runner-payloads`, eager mention `tool.execute`) | Already archived in `safe-retirements.md` / prior packages — no live import |

### Kept (with reasons — do **not** claim all old executors deleted)

| Item | Reason kept |
| --- | --- |
| `agents/cli-runner.ts` façade | Forward-only to `execution/runner/cli-run`; consumers still import façade |
| `agents/pi-embedded.ts` / `pi-embedded-runner.ts` | Live Gateway/cron/commands/auto-reply consumers; capability backend |
| Embedded / CLI execution backends | Model/tool loop providers under admitted-turn / cron / followup |
| Lobster (`extensions/lobster`) | Delegated workflow + unknown resumeToken/assets — no delete proof |
| OpenProse (`extensions/open-prose`) | Skill VM / unknown `.prose` assets — no delete proof |
| `task-orchestration` | Shadow observe / dormant (`LIVE_INVOKE` frozen false) — not bulk-delete by name |
| BOOT / cron / followup triggers | Legitimate scene adapters onto controlled execution lifecycle |
| Thin usage / abort / preflight / session-usage façades | Harmless forward-only; do not force-delete for zero count |
| Unknown external workflows | Not inventoried to deletion — leave |

---

## Suite tally this turn (freeze `a1b14f80c…`)

| Batch | Result (this SHA) |
| --- | --- |
| A delivery/async/context (unit) | 14 files / **90 PASS** |
| B admission/collab-entry/restart/cross-process | 14 files / **56 PASS** (incl. real-process 7) |
| C interpret/explicit/PPT wiring/org dispatch | 9 files / **114 PASS** (+ 2 UI sidebar re-run **15 PASS** after linking `ui/node_modules`) |
| D collab board / dialogue / continuity | 6 files PASS + board-tool **3 FAIL (mock drift)** → **63 PASS / 3 FAIL** |
| E controlled collab + PPT stubs | 6 files PASS + P4 **1 FAIL (assert polish)** → **29 PASS / 1 FAIL** |
| package5-retire recheck | **3 PASS** |
| Continuity/state/delivery defect fixes | **none** (no re-freeze of src) |

---

## Follow-up / residual risks (not Package6 blockers)

1. Collab board unit mocks: update `submitForReview` / `acceptSubmission` / `returnSubmission` mocks to `{ item, eventRelay }` shape (production already correct).
2. P4 gate repro: allow `human_todo:` after escalate failures exhausted (or assert revise-dispatch=0 explicitly).
3. Real-model same-SHA personal+collab acceptance (live provider).
4. Real-channel outbound delivery receipt proof (authorized send environment).
5. PPT physical renderer image deploy + human visual preview (`openbot-pptx-renderer`).
6. DQ1–DQ4 quality platform items (explicitly out of charter).
7. Foreign concurrent WIP on primary worktree — other teams; do not bag into convergence commits.
8. Broader `src/agents` / Gateway e2e not re-run in full this package (scoped to charter windows).

## Hand-off

Package6 acceptance package ready for **independent review**. Candidate freeze source `a1b14f80c…`; docs tip filled in `tasks.md` remelt line after commit. **No push / merge / deploy / production restart.**
