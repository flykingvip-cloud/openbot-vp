# Batch C collaboration ownership

- Date: 2026-11-09
- Base: accepted Batch B `a679f5ca6158d7bfb23f0dc17faf66feb95d6958`
- Branch: `cursor/runtime-authority-batch-c-bf87`
- Not merge, deploy, typecheck, or build approval. Batch D is not started.

## What moved

| Decision | Now | Host that remains |
| --- | --- | --- |
| `SYSTEM_INVARIANTS`, `OBSERVER_PERMISSIONS`, `MODE_TEMPLATES` | `policy/collaboration-rules.ts`, exported from `policy/index` | `effective-policy.ts` re-exports and still holds the EffectivePolicy type |
| `L1_DEFAULT` | same policy module, same values (`human_required`, self-advance false, mention-must-respond false) | `policy-compiler.ts` re-exports and still compiles segments and `policyHash` |
| Governance actor classification and `evaluateGovernanceGate` | policy | `governance-gate.ts` re-exports |
| Submit version, empty body, duplicate body, proxy, pending submission match | policy | `submit-review-versioning.ts` re-exports |
| Peer-review accept count and `peerReviewMustNotDriveAdmission` | policy | `peer-review-gate.ts` still appends review facts and reads the flag (default false) |
| Board/todolist delivery mapping | policy | `plan-gate-exec.ts` still builds the execution bag |
| Claim status edges | policy `claimBoardActionAllowed` | `claim-contract.ts` still holds `withRoundLock`, revision bump, and lock-out fan-out |
| `oralDispatchCreatesBoardFact`, `freeChatIsTodolist`, `todolistIsGroupSharedBoardSubrecord`, confirmed-todolist check | policy | private todolist file IO stays in `executor-private-todolist.ts` |

SessionTaskBoard, ClaimContract, and ExecutorPrivateTodolist were not merged. No new auto-confirm mode, no confirmation-policy change, no collaboration UI card, and no default-on flag.

## Fidelity

`src/agent-runtime/policy/collaboration-rules.test.ts` compares policy `L1_DEFAULT` and `SYSTEM_INVARIANTS` to the gateway exports, and compares governance, empty-submit, pending-submission, and plan-mapping results to the host functions.

Existing host suites were re-run after the re-export:

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/agent-runtime/policy/collaboration-rules.test.ts src/gateway/collaboration-dispatch/governance-gate.test.ts src/gateway/collaboration-dispatch/policy-compiler.test.ts src/gateway/collaboration-dispatch/collab-s3-submit-review-versioning.test.ts src/gateway/collaboration-dispatch/peer-review-gate.test.ts src/gateway/collaboration-dispatch/collab-s2-plan-gate-all-paths.test.ts src/gateway/collaboration-dispatch/executor-private-todolist.test.ts src/gateway/collaboration-dispatch/claim-contract.test.ts`

Result before the claim-edge commit was included in the working tree: 8 files, 83 tests passed. The claim-edge edit was in that same run.

Catalog metadata was checked with `src/agent-runtime/policy/catalog.test.ts` (included in a 2-file / 12-test run with the fidelity file).

## Not moved

- `compileEffectiveCollaborationPolicy` and `policyHash` stay in the gateway compiler because the section modules are still there.
- ClaimContract lock transactions and private-todolist propose/confirm/revise IO stay in their gateway hosts. Legal edges are policy; the lock is not a new state package.
- Floor, LIVE, and delegation supplements S0–S7 / D0–D5 were not implemented.

## Non-goals confirmed

No new auto-confirm modes. No silence switch of confirmation mode. No collaboration cards. No scope merge. Catalog remains read-only metadata. No production deploy.
