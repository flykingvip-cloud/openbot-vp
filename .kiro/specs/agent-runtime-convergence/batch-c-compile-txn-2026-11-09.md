# Batch C follow-up: compiler, transactions, handoff

- Continues Draft PR #260. Does not start Batch D.
- Previous partial acceptance `fd686b5ffd148e2feddfecb8710f7dd05a549110` stays in history.

## T5 compile and hash

Moved into policy, exported from `policy/index`:

- `collaboration-policy-model.ts` — effective policy types
- `collaboration-compile.ts` — `compileEffectiveCollaborationPolicy` and the operating-state field map
- `collaboration-compile-sections.ts` — segment compile and provenance coverage
- `collaboration-compile-hash.ts` — content hash and legacy slice hash
- `collaboration-policy-identity.ts` — freeze, compiler revision `1.2.0`, provenance hash
- `clampMaxBeatsPerEpisode` — same 1..12 clamp

`resolve-effective-policy.ts` still reads operating state and the legacy overlay, then calls the policy compiler. `PolicyDecisionRecord` stays in the gateway host because it carries the event key and diagnosis payload.

Empty-input policy hash, captured before the move and asserted as a literal:

`af8fc3ccd96c2038fbdfb6af8799bca488daa93433d9eb1d667d752c3e97f52a`

Legacy slice hash:

`c3b82cd4f227d042254c971dabf40f14ae19ac2bca36b3f0479f1ee4d45600ca`

A request for 99 visible replies still clamps to 12. Its hash is `81431e093940792af5109035961214d4007c88d9071504aa8e83e85f3059c60f`.

## T6 transaction ports

`src/agent-runtime/state/collaboration/round-txn.ts`, exported from `state/index`:

| Store                   | Entry                                                              | What stayed outside                                          |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| ClaimContract           | `mutateBoardClaimLog`, `appendBoardClaimLog`                       | flag check, status decision, wake / fan-out                  |
| ExecutorPrivateTodolist | `commitPrivateTodolistLog`                                         | propose / confirm / revise decisions; separate directory     |
| Peer review             | `appendPeerReviewLog`                                              | author and verdict checks; quality ledger after the lock     |
| Handoff                 | `withHandoffRoundLock`, `appendHandoffLogLine`, `writeHandoffJson` | flag, governance check, recovery callback, wake after unlock |

The three stores are not merged. Locks still wrap read, check, and append. Handoff recovery still runs inside the lock and does not delete an already written fact.

## T6 handoff decisions

`policy/collaboration-handoff.ts` holds approval selection, bot-id shape, responsibility projection, live-apply classification, and history append-by-id. Owner transfer still forces human approval. A history-length mismatch is still `conflict`, not a silent apply.

## Fidelity

`src/agent-runtime/policy/collaboration-rules.test.ts` asserts the hashes and limits above as literals. It also asserts refused claim edges (`accepted` cannot cancel, `published` cannot accept) and the handoff conflict sample. It does not compare a policy function to a gateway file that only re-exports it.

## Regression

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run` on the fidelity file, catalog, compiler, compiler sections, resolve-effective-policy, multi-beat, handoff invariant, claim contract, private todolist, peer review, plan gate, and governance: **12 files, 121 tests passed.**

## Still outside this slice

- Round orchestration, floor, and wake fan-out stay in the gateway host.
- No new auto-confirm mode, collaboration card, or scope merge.
- No merge and no deploy.
