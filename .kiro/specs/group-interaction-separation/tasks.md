# Group interaction and formal execution separation

## Agents

- codex-kb-review · role: owner · scope: integrate and independently validate receipt identity and group interaction · paths: src/gateway/server-methods/chat.ts, src/gateway/server-methods/chat-transcript-inject*, src/gateway/collaboration-learning/group-interaction*, src/gateway/collaboration-learning/discuss-to-task-chat-turn*, ui/src/ui/controllers/chat*, src/gateway/chat-group-interaction-isolation.s1b.test.ts · since: 2026-11-23

- codex-kb-implement · role: contributor · scope: group host interaction, formal target projection and regression · paths: src/gateway/collaboration-learning/group-interaction-understanding*, src/gateway/collaboration-learning/group-interaction-host*, src/gateway/server-methods/chat.ts, src/gateway/chat-group-interaction-isolation.s1b.test.ts · since: 2026-11-23

- [x] Fresh fetch/main ancestry checked before work. — codex-kb-implement
- [x] Preserve resolveGroupDiscussionScope membership ACL and initial authority/decideParticipants already preceding interpretation. Correct the narrower gap: dynamic rules were resolved after ordinary reply returned; move the existing dynamic resolver/reselection before interpretation. Do not fall back to a coordinator excluded from the selected primaryQueue. — codex-kb-implement
- [x] Keep formal refusal structured receipt. Host facts now also yield actionable explanation with no tools, model call, added budget or second admission. Explanation persist failure does not discard the original receipt; final still carries safe explanation. No configuration changes. — codex-kb-implement
- [x] Bind taskTarget only to the current formal group board task and item revisions/statuses; namespace/group/task mismatch or missing revisions cannot bind. Never use personal SessionTaskBoard. Re-read scope/board before handling controls. — codex-kb-implement
- [x] status reports saved formal board facts only. Chat mutations without a supported direct adapter clarify where to use existing group board controls, do not claim mutation, create or replace a task, or call personal controls. — codex-kb-implement
- [x] Real in-process chat.send handler tests: formal flag-off refusal explanation and later ordinary consultation, unbound foreign task change, no selected speaker. Semantic inference is stubbed because the legacy fixture lacks a current commercial subscription; tests do not claim real-model quality or a running-gateway socket experiment. — codex-kb-implement

## Validation

- /tmp/group-separation-handler.log: 4 new handler cases pass, 22 older cases deliberately skipped by name filter (not a whole-file pass).
- /tmp/group-separation-unit.log: 13 tests across three files.
- /tmp/group-separation-types.log: type check.
- /tmp/group-separation-lint.log: changed-file type-aware lint.

No real group state, runtime flags, production build or service process changed. Root owns independent acceptance, commit and deployment. — codex-kb-implement

- [x] Formal-board read failure is an explicit unavailable read-model, not an empty-board success: ordinary consultation still reaches the interpreter, task control returns a clear no-mutation notice, and only a sanitized warning is logged. New real-handler regression keeps a nonempty currentTaskId and forces board read failure; consultation replies and cancellation is refused. Dynamic policy snapshot persistence retains its original failure behavior; only its existing ordering changed. — codex-kb-implement

- [ ] Unify persisted/status/final receipt identity; replace separate rejection explanation with the same receipt. Verify legacy history, distinct requests, and final run closure. — codex-kb-review

## Receipt repair checkpoint 2026-11-23

- Unified terminal feedback with the emitted status receipt rather than persisting a second explanation. Formal flag-off explanation is generated once before receipt persistence. — codex-kb-review
- Newly persisted discuss-to-task receipts carry canonical id/receiptId, source round and marker. UI recovers legacy identity from idempotencyKey; same-request status/final/history update one bubble while different requests retain separate bubbles. — codex-kb-review
- 159 tests passed across chat controller (144), discuss-to-task chat turn (12), and transcript injection (3). Evidence: /tmp/receipt-tests.log. New status/final/history cases included. — codex-kb-review
- WIP: final lint/typecheck, full handler regression, fail-before proof, commit and real service test are NOT complete. Escalated tool execution was rejected because the automatic approval service returned HTTP 403 Insufficient user balance; this was a review service failure, not an unsafe-action determination. No bypass, commit, flag change or deployment attempted after that rejection. — codex-kb-review
- The real 数字人测试 formal-task gate remains disabled. Do not report successful execution until a bounded authorized enablement and real-service task lifecycle test succeed. — codex-kb-review

Final checkpoint: 159 receipt/controller tests, 4 new real-handler cases, scoped lint and full tsgo pass. Whole handler file: 19 older cases fail at missing-subscription fixture gate; 4 new cases pass with 22 older skipped in targeted run. Live-service verification pending. — codex-kb-review

2026-11-23 final fixture repair: synthetic commercial admission supplied at model-session admission seam; production subscription logic unchanged. Entire 26-case handler suite plus 9 actual billing gate tests now pass (35 total), /tmp/s1b-final-gate.log. Earlier 19 missing-subscription failures resolved. Live service test remains pending. — codex-kb-review
